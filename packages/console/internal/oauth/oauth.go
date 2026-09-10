// Package oauth is how this machine signs in to cloudflare: the browser "allow" the operator
// presses, and the credential that press leaves behind.
//
// **the credential never leaves this process.** it is written into the state directory at mode
// 0600, carried into a header by ../cf and nowhere else, and no phase, address or sentence this
// package hands back carries it. nothing here prints one either — a token in a terminal is a token
// in a scrollback, in a screen share and in whatever collects that machine's logs.
//
// **the client is public and the proof is pkce.** there is no client secret to ship inside a binary
// an operator downloads, so what ties the code cloudflare hands back to the press that asked for it
// is a verifier this process generated and kept: the browser carries only its sha-256, and the
// exchange is refused for anyone who did not make it. The `state` parameter is the other half —
// it ties the callback to this flow, so a code arriving under any other one is dropped rather than
// exchanged.
//
// **the callback address is the one thing here that cannot be chosen.** cloudflare registered
// http://localhost:8976/oauth/callback against this client id and refuses a redirect uri it was not
// registered with, so the port is fixed: a second console on this machine cannot open a sign-in
// while one is listening. what makes a second press join the flow already open is the flow itself,
// which holds the one attempt in flight and hands it back.
//
// **an environment token wins and cannot be signed out of.** CLOUDFLARE_API_TOKEN is for
// contributors and scripts: where it is set it is the credential, whatever is stored, and Out
// refuses because there is nothing on this machine to forget.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/state"
)

// what this binary is registered as at cloudflare.
//
// The client id is wrangler's own public client. It is not a secret and could not be one: it ships
// inside every copy of a binary an operator downloads, which is why the flow is pkce.
const (
	// ClientID is the public oauth client this sign-in is made as.
	ClientID = "54d11594-84e4-41aa-b438-e81b8fa78ee7"
	// Dash is cloudflare's dashboard, which is where the three oauth endpoints live.
	Dash = "https://dash.cloudflare.com"
	// AuthorizeURL is the page the operator allows the access on.
	//
	// It is opened in the operator's browser rather than fetched here, so it is cloudflare's own
	// address rather than the Base the token and revoke calls are made to.
	AuthorizeURL = Dash + "/oauth2/auth"
	// CallbackURL is the address cloudflare sends the browser back to, registered against ClientID.
	CallbackURL = "http://" + callbackAddress + callbackPath
	// TokenVar names the credential an environment can hand this console instead of a sign-in.
	TokenVar = "CLOUDFLARE_API_TOKEN"
	// Record is what the stored credential is called under the state directory.
	Record = "oauth.json"

	tokenPath       = "/oauth2/token"
	revokePath      = "/oauth2/revoke"
	callbackAddress = "localhost:8976"
	callbackPath    = "/oauth/callback"
)

// Scopes is what this console asks the operator to allow, and it is the whole of what the deploy
// needs.
//
// `offline_access` is what makes cloudflare hand back a refresh token; without it the operator
// would be sent to their browser again every hour. The other five are the reads and writes a first
// deploy makes — the account and the user for the connect screen, the script upload, the migration
// over d1's query api, and the turnstile widget.
var Scopes = []string{
	"account:read",
	"user:read",
	"workers_scripts:write",
	"d1:write",
	"challenge-widgets.write",
	"offline_access",
}

// how long one flow waits to be allowed before it gives up.
//
// A wait with no end promises something no screen can keep: the listener would hold the callback
// port for as long as the console runs, and an operator who closed the browser tab would be left
// looking at a page that says a sign-in is open when nothing is.
const waits = 2 * time.Minute

// how far before its stated expiry a credential is refreshed.
//
// A token refreshed at the moment it expires is a token that expires mid-call: the deploy chain
// takes minutes, and the read that dies half way through it is the one nothing can retry safely.
const skew = time.Minute

// Options is what one flow is built around.
type Options struct {
	// Store is where the credential is kept between runs.
	Store state.Store
	// Base is the host the token and revoke calls are made to. Empty is cloudflare's own.
	Base string
	// Open opens the operator's browser at an address, and may be nil.
	//
	// A machine with no browser to open — an ssh session, a container — is one the operator reaches
	// by hand, and the address is on the screen either way.
	Open func(address string)
	// Waits is how long a flow waits to be allowed. Zero is the two minutes above.
	Waits time.Duration
	// Listen opens the listener one flow's callback is answered on. Nil is the registered address.
	//
	// The address cloudflare redirects the browser to is registered against ClientID and refused
	// where it differs, so what a listener of another kind moves is the port bound on this machine
	// and never the `redirect_uri` a sign-in states.
	Listen func() (net.Listener, error)
	// Now is the clock a stored credential's expiry is read against. Nil is this machine's.
	Now func() time.Time
}

// New is the sign-in this machine runs, and the credential it already holds.
func New(options Options) *Flow {
	base := options.Base
	if base == "" {
		base = Dash
	}
	waiting := options.Waits
	if waiting == 0 {
		waiting = waits
	}
	clock := options.Now
	if clock == nil {
		clock = time.Now
	}
	listen := options.Listen
	if listen == nil {
		listen = func() (net.Listener, error) { return net.Listen("tcp", callbackAddress) }
	}
	return &Flow{
		store:  options.Store,
		send:   cf.FormSend(base, nil),
		open:   options.Open,
		waits:  waiting,
		now:    clock,
		listen: listen,
	}
}

// the credential this machine has stored, as it is written down.
//
// The refresh token is the durable half and the reason the record exists at all: an access token
// lasts an hour, and a console that stored only that one would send the operator back to their
// browser every time they opened it.
type record struct {
	Access  string    `json:"access_token"`
	Refresh string    `json:"refresh_token"`
	Expires time.Time `json:"expires_at"`
	Scopes  []string  `json:"scopes"`
}

// what cloudflare answers an exchange or a refresh with.
type grant struct {
	Access  string `json:"access_token"`
	Refresh string `json:"refresh_token"`
	Expires int    `json:"expires_in"`
	Scope   string `json:"scope"`
}

// Credential is what a cloudflare call is made with, refreshed on the way out where it had expired.
//
// It is the CredentialReader every fold of this console asks, which is why a refresh happens here
// rather than at a press: nothing that reads the account has to know a token has a lifetime.
func (flow *Flow) Credential(ctx context.Context) cf.Credential {
	if token := os.Getenv(TokenVar); token != "" {
		return cf.BearerCredential(token)
	}

	flow.held.Lock()
	defer flow.held.Unlock()

	stored, ok := flow.stored()
	if !ok {
		return cf.Credential{Kind: cf.NoCredential}
	}
	if flow.now().Before(stored.Expires.Add(-skew)) || stored.Refresh == "" {
		return cf.BearerCredential(stored.Access)
	}
	// a refresh that could not be written down is carried on with and said out loud: what came back
	// is good for the call being made now, and the pair that was not written is the one the next run
	// would have read — so this machine is signed in and is one launch away from not being.
	refreshed, ok, err := flow.refresh(ctx, stored)
	if ok {
		flow.kept(err)
	}
	if !ok {
		// the stored token is carried on rather than dropped: cloudflare's own refusal is what
		// tells an expired sign-in from a network that is down, and dropping it here would draw the
		// second as the first.
		return cf.BearerCredential(stored.Access)
	}
	return cf.BearerCredential(refreshed.Access)
}

// Waits is how long this flow waits to be allowed before it gives up.
//
// It is read rather than spelled a second time by whoever says so: a flow may be built with a wait
// of its own (./Options), so a sentence carrying a number of its own is one that goes wrong on the
// flow that moved it.
func (flow *Flow) Waits() time.Duration { return flow.waits }

// TokenSet is whether the environment the console was started in is where the credential came from.
//
// No answer from cloudflare can say so, and it decides two things a screen draws: a sign-in control
// that would be offering a refusal, and a sign-out that has nothing to forget.
func (flow *Flow) TokenSet() bool { return os.Getenv(TokenVar) != "" }

// Out revokes this machine's sign-in and forgets it.
//
// Revoked first and forgotten second: a token forgotten here is still one cloudflare would accept,
// and the operator pressing this is saying they want it to stop working rather than to stop being
// on this machine. A revoke cloudflare would not take is not an error the operator can act on —
// what they asked for is that this machine hold it no longer, and that is what the forgetting does.
func (flow *Flow) Out(ctx context.Context) error {
	if flow.TokenSet() {
		return errors.New("the sign-in in use came from " + TokenVar + " in this console's environment")
	}

	// a sign-in still open in a browser is ended first: a callback landing after this would write
	// down a credential the operator has just asked this machine to stop holding.
	flow.Stop()

	flow.held.Lock()
	defer flow.held.Unlock()

	if stored, ok := flow.stored(); ok {
		// both halves are handed back. revoking the refresh token is what stops another access
		// token being taken on it, and the access token already in hand outlives that by up to its
		// own hour.
		for _, token := range []string{stored.Refresh, stored.Access} {
			if token == "" {
				continue
			}
			flow.send(ctx, revokePath, url.Values{
				"token":     {token},
				"client_id": {ClientID},
			})
		}
	}
	return flow.store.Forget(Record)
}

// the credential written down on this machine, or that there is none to read.
//
// A machine with nothing remembered is the ordinary state of a first run, and so is one whose
// record cannot be read at all: either way there is no sign-in, and the screen that says so is the
// one with the way out on it.
func (flow *Flow) stored() (record, bool) {
	read, err := flow.store.Read(Record)
	if err != nil || len(read) == 0 {
		return record{}, false
	}
	var held record
	if err := json.Unmarshal(read, &held); err != nil || held.Access == "" {
		return record{}, false
	}
	return held, true
}

func (flow *Flow) write(held record) error {
	written, err := json.Marshal(held)
	if err != nil {
		return err
	}
	return flow.store.Write(Record, written)
}

// exchanges the code cloudflare handed back for the pair this machine keeps.
func (flow *Flow) exchange(ctx context.Context, code, verifier string) (record, bool, error) {
	return flow.granted(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {ClientID},
		"redirect_uri":  {CallbackURL},
		"code_verifier": {verifier},
	}, "")
}

// takes a fresh access token on the refresh half of the stored pair.
func (flow *Flow) refresh(ctx context.Context, stored record) (record, bool, error) {
	return flow.granted(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {stored.Refresh},
		"client_id":     {ClientID},
	}, stored.Refresh)
}

// one call to the token endpoint, written down where cloudflare answered with a pair.
//
// `carried` is the refresh token to keep where the answer names none of its own, which is what a
// refresh that rotates nothing hands back.
//
// The second answer is whether cloudflare handed a pair back at all, and the error is the writing
// of it — two different things to say, because every read of the credential goes through the record
// and one that was not written is one this process cannot read either.
func (flow *Flow) granted(ctx context.Context, form url.Values, carried string) (record, bool, error) {
	answer := flow.send(ctx, tokenPath, form)
	if answer.Kind != cf.Answered || answer.Status < 200 || answer.Status > 299 {
		return record{}, false, nil
	}
	written, err := json.Marshal(answer.Body)
	if err != nil {
		return record{}, false, nil
	}
	var took grant
	if err := json.Unmarshal(written, &took); err != nil || took.Access == "" {
		return record{}, false, nil
	}

	refresh := took.Refresh
	if refresh == "" {
		refresh = carried
	}
	held := record{
		Access:  took.Access,
		Refresh: refresh,
		Expires: flow.now().Add(time.Duration(took.Expires) * time.Second),
		Scopes:  strings.Fields(took.Scope),
	}
	return held, true, flow.write(held)
}

// a value nobody else can guess, which is what both the verifier and the state have to be.
func secret() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// the sha-256 of the verifier, which is the whole of what travels through the browser.
func challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
