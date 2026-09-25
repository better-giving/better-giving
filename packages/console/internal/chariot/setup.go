package chariot

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// setting Chariot up from the screen: the key and the address handed in, and one chain that leaves
// the organisation's Connect, the event subscription at this deployment's address and the deployment
// in the state that key implies.
//
// **one press, because once the key is in hand nothing is left to ask.** the organisation is found
// by the EIN the deployment's own profile holds, its Connect is fetched or made with the profile's
// notification email as the contact, the subscription is settled, and the four values are one write.
// the operator never types a Connect id or an email, and never opens Chariot's dashboard for the
// subscription.
//
// **the Connect is asked for rather than listed.** Chariot answers a create for an organisation that
// has one with that one (https://docs.givechariot.com/api/connects/create), so a repeated press
// stores the same id. its `apiKey` is a token for that Connect's data and is never read off the
// answer.
//
// **every press makes a new subscription, and no subscription already here is kept.** Chariot hands
// no signing secret back from any call, so nothing proves a secret the deployment holds is the one an
// existing subscription signs with — a secret stored beside a sandbox subscription and a live one at
// the same address read the same. so a fresh secret is minted, a subscription made with it, the
// secret written, and only then is every older match marked deleted, so there is no moment at which
// the deployment holds a secret no active subscription signs with. matched on the url, the category
// and a status that is not deleted, over every page, because an account may carry another
// deployment's.
//
// **nothing is written until the subscription is settled.** a key written with no subscription behind
// it is a deployment whose grants never read received, so every stop in front of the write leaves the
// deployment holding exactly what it held — and a write that does not land takes the subscription it
// was for back down, so nothing delivers here signed with a secret nobody holds.
//
// **no credential is in a value this returns.** neither the key nor the minted secret reaches an
// answer, an error sentence or a log line; the one write is ../deployment's var door, which keeps
// every value out of an argument list. the Connect id and the subscription's id do reach the facts,
// because both are public.
//
// every failure is a value: nothing here returns an error.

// Stage is which part of the chain is running.
type Stage string

const (
	// Checking is asking Chariot whether the key answers at the address.
	Checking Stage = "checking"
	// Finding is reading the EIN and the notification email off the deployment's profile and finding
	// the organisation by the EIN.
	Finding Stage = "finding"
	// Connecting is fetching or making the organisation's Connect.
	Connecting Stage = "connecting"
	// Subscribing is deriving the address, reading every subscription, and settling the one here.
	Subscribing Stage = "subscribing"
	// Storing is writing the values onto the deployment, as vars.
	Storing Stage = "storing"
)

// Organisation is one organisation in Chariot's directory, in the facts an operator recognises it by.
type Organisation struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	City  string `json:"city"`
	State string `json:"state"`
	// Eligible is whether Chariot accepts DAF grants to it.
	Eligible bool `json:"eligible"`
}

// Connect is the organisation's Connect.
type Connect struct {
	ID string `json:"id"`
	// Active false is a Connect Chariot will not process grants on yet. Its id is stored all the same.
	Active bool `json:"active"`
}

// Subscription is what the press did about the subscription at this deployment's address.
type Subscription struct {
	// Kind is `created` where there was no match, and `replaced` where there were matches and a new
	// one was made in their place.
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Facts is what the chain found out along the way, which the screen states beside the lines.
type Facts struct {
	Organisation *Organisation `json:"organisation"`
	Connect      *Connect      `json:"connect"`
	Subscription *Subscription `json:"subscription"`
}

// OutcomeKind is how the chain ended.
type OutcomeKind string

const (
	// Done is every step landing.
	Done OutcomeKind = "done"
	// Unauthorized is the key not answering at the address, so nothing was read, made or stored.
	Unauthorized OutcomeKind = "unauthorized"
	// Unprofiled is the deployment's profile not being read. Read says which way.
	Unprofiled OutcomeKind = "unprofiled"
	// NoEIN is the profile holding no EIN, or none that is nine digits.
	NoEIN OutcomeKind = "no-ein"
	// NoContact is the profile holding no notification email, which the Connect is made with.
	NoContact OutcomeKind = "no-contact"
	// Unsearched is Chariot's directory not answering the search.
	Unsearched OutcomeKind = "unsearched"
	// Unlisted is no organisation in Chariot's directory carrying the EIN, which EIN names.
	Unlisted OutcomeKind = "unlisted"
	// Ambiguous is more than one carrying it. Candidates is every one, for the operator to name to
	// Chariot: picking one here would be a Connect made for an organisation nobody chose.
	Ambiguous OutcomeKind = "ambiguous"
	// Ineligible is the one organisation carrying it not accepting DAF grants. Facts names it.
	Ineligible OutcomeKind = "ineligible"
	// Unconnected is Chariot refusing the Connect.
	Unconnected OutcomeKind = "unconnected"
	// Nowhere is there being nowhere to subscribe, and Address says why.
	Nowhere OutcomeKind = "nowhere"
	// Insecure is the deployment's address not being https, and Chariot delivers to https alone in
	// production. Origin is the address.
	Insecure OutcomeKind = "insecure"
	// Unread is the account's subscriptions not being read, so nothing was subscribed or stored.
	Unread OutcomeKind = "unread"
	// Unsubscribed is Chariot refusing the create. Nothing new delivers here and nothing was stored.
	Unsubscribed OutcomeKind = "unsubscribed"
	// Unstored is the write not landing. Written is the write; a subscription this press made was
	// marked deleted, and Left names it where that did not land either.
	Unstored OutcomeKind = "unstored"
	// Unretired is everything landing but an older subscription at this address not being marked
	// deleted. Left names each: it delivers signed with a secret the deployment no longer holds, and
	// the next press replaces it with the rest.
	Unretired OutcomeKind = "unretired"
	// ConsoleStopped is the chain dying on this console's own goroutine. It carries no member,
	// ./run.go states why.
	ConsoleStopped OutcomeKind = "console-stopped"
)

// Outcome is how the chain ended, and what the step that stopped it answered.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Outcome struct {
	Kind OutcomeKind `json:"kind"`
	// Failure is Chariot's own answer, on Unauthorized, Unsearched, Unconnected, Unread and
	// Unsubscribed.
	Failure *Failure `json:"failure"`
	// Read is which way the profile was not read, on Unprofiled alone.
	Read *deployment.NoReport `json:"read"`
	// EIN is the nine digits searched for, on Unlisted alone.
	EIN string `json:"ein"`
	// Candidates is every organisation carrying the EIN, on Ambiguous alone.
	Candidates []Organisation `json:"candidates"`
	// Address is why there was nowhere to subscribe, on Nowhere alone.
	Address *deployment.AddressRead `json:"address"`
	// Origin is the address that is not https, on Insecure alone.
	Origin string `json:"origin"`
	// Written is the write that did not land, on Unstored alone.
	Written *deployment.Written `json:"written"`
	// Left is the subscriptions still delivering here that should not be, on Unstored and Unretired.
	Left []string `json:"left"`
}

// Asked is what a press asked for. The key reaches no answer: it is bound into Effects.Call before
// the chain is reached, and written in one request body.
type Asked struct {
	APIKey string
	// Address is what ../cf's Base made of the typed one, API where it was blank.
	Address string
}

// Effects is every effect the chain has, handed in, so every stage and failure above is reachable in
// ./setup_test.go with no Chariot account, no cloudflare account and no network.
type Effects struct {
	// Call is ./chariot.go's BindAt, bound to the key.
	Call Call
	// Profile is the deployment's own report, whose organisation carries the EIN.
	Profile func(ctx context.Context) deployment.ReportRead
	Address func(ctx context.Context) deployment.Address
	// Publish writes vars; a name mapped to nil is taken off.
	Publish func(ctx context.Context, values map[string]*string) deployment.Written
	// Mint is the signing secret a new subscription is made with. Mint where nothing stands in.
	Mint func() string
	// At and Found are how the chain says where it is and what it has found out. Both are called on
	// the goroutine the run is on, so a call that blocks holds the run up.
	At    func(stage Stage)
	Found func(facts Facts)
}

// the four names the press writes.
const (
	apiKeyVar        = "CHARIOT_API_KEY"
	apiURLVar        = "CHARIOT_API_URL"
	connectIDVar     = "CHARIOT_CONNECT_ID"
	webhookSecretVar = "CHARIOT_WEBHOOK_SECRET"
)

// SetUpOnly is every name the press writes, and the press alone.
var SetUpOnly = []string{apiKeyVar, apiURLVar, connectIDVar, webhookSecretVar}

const subscriptionsPath = "/v1/event_subscriptions"

// the largest page the list hands back, and how many pages are read before an account holding more
// is an answer this console was not written against rather than a loop.
const (
	subscriptionsPage = 100
	subscriptionPages = 100
)

// Mint is a fresh signing secret: 32 random bytes as hex, safe in json, in a var and as an HMAC key.
func Mint() string {
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	return hex.EncodeToString(secret)
}

// Chain is the whole press, from the effects and what was asked.
//
// the order is not interchangeable: a key that does not answer can find nothing, a Connect is made
// for the organisation the search found, and the write carries the id the Connect step settled on and
// the secret the subscription step made.
func Chain(ctx context.Context, asked Asked, effects Effects) Outcome {
	facts := Facts{}
	found := func() {
		if effects.Found != nil {
			effects.Found(facts)
		}
	}
	at := func(stage Stage) {
		if effects.At != nil {
			effects.At(stage)
		}
	}
	mint := effects.Mint
	if mint == nil {
		mint = Mint
	}
	call := effects.Call

	checked := Read(call(ctx, Request{Method: http.MethodGet, Path: subscriptionsPath + "?limit=1"}))
	if checked.Kind != Value {
		return Outcome{Kind: Unauthorized, Failure: checked.Turned()}
	}

	at(Finding)
	profile := effects.Profile(ctx)
	if profile.Kind != deployment.Reported {
		read := profile.NoReport
		return Outcome{Kind: Unprofiled, Read: &read}
	}
	ein, held := einOf(profile.Org)
	if !held {
		return Outcome{Kind: NoEIN}
	}
	contact, held := contactOf(profile.Org)
	if !held {
		return Outcome{Kind: NoContact}
	}
	organisation, stopped := find(ctx, call, ein)
	if stopped != nil {
		return *stopped
	}
	facts.Organisation = organisation
	found()
	if !organisation.Eligible {
		return Outcome{Kind: Ineligible}
	}

	at(Connecting)
	made := Read(call(ctx, Request{
		Method: http.MethodPost,
		Path:   "/v1/connects",
		Body: map[string]any{
			"organization_id": organisation.ID,
			"contact":         map[string]string{"email": contact},
		},
	}))
	if made.Kind != Value {
		return Outcome{Kind: Unconnected, Failure: made.Turned()}
	}
	connect := readConnect(made.Value)
	if connect == nil {
		return Outcome{Kind: Unconnected, Failure: unreadable(
			"Chariot answered the Connect in a shape this console was not written against.")}
	}
	facts.Connect = connect
	found()

	at(Subscribing)
	address := effects.Address(ctx)
	origin := address.Origin()
	if origin == "" {
		read := address.Read()
		return Outcome{Kind: Nowhere, Address: &read}
	}
	if !strings.HasPrefix(origin, "https://") {
		return Outcome{Kind: Insecure, Origin: origin}
	}
	endpoint := origin + release.ChariotWebhookPath

	listed, failure := subscriptions(ctx, call)
	if failure != nil {
		return Outcome{Kind: Unread, Failure: failure}
	}
	matches := []listedSubscription{}
	for _, one := range listed {
		if one.URL == endpoint && one.Category == release.ChariotEventCategory && one.Status != "deleted" {
			matches = append(matches, one)
		}
	}

	values := map[string]*string{
		apiKeyVar:    &asked.APIKey,
		connectIDVar: &connect.ID,
		// live is what a deployment holding no address calls, so live is stored as no address: an
		// address left from a sandbox press would otherwise send the live key to the sandbox.
		apiURLVar: nil,
	}
	if asked.Address != API {
		values[apiURLVar] = &asked.Address
	}

	secret := mint()
	created := Read(call(ctx, Request{
		Method: http.MethodPost,
		Path:   subscriptionsPath,
		// `signing_secret` is the member Chariot's API reference names
		// (https://docs.givechariot.com/api/event-subscriptions/create), and a member it does not know
		// is ignored for a random secret nobody holds. what proves the spelling is a real delivery
		// verifying at a deployment. the answer is not the reference's: the sandbox answers 200 with
		// the subscription wrapped in `event_subscription`, and createdID reads both.
		Body: map[string]string{
			"url":            endpoint,
			"category":       release.ChariotEventCategory,
			"signing_secret": secret,
		},
	}))
	if created.Kind != Value {
		return Outcome{Kind: Unsubscribed, Failure: created.Turned()}
	}
	id := createdID(created.Value)
	if id == "" {
		return Outcome{Kind: Unsubscribed, Failure: unreadable(
			"Chariot answered the subscription in a shape this console was not written against.")}
	}
	kind := "created"
	if len(matches) > 0 {
		kind = "replaced"
	}
	facts.Subscription = &Subscription{Kind: kind, ID: id}
	found()

	at(Storing)
	values[webhookSecretVar] = &secret
	written := effects.Publish(ctx, values)
	if !landed(written) {
		left := []string{}
		if !retire(ctx, call, id) {
			left = append(left, id)
		}
		return Outcome{Kind: Unstored, Written: &written, Left: left}
	}

	left := []string{}
	for _, old := range matches {
		if !retire(ctx, call, old.ID) {
			left = append(left, old.ID)
		}
	}
	if len(left) > 0 {
		return Outcome{Kind: Unretired, Left: left}
	}
	return Outcome{Kind: Done}
}

// the one organisation carrying `ein`, or the outcome that stopped the search.
//
// an EIN-shaped `q` is an exact lookup, so more than one row is not expected — but the answer is a
// list, and rows are held to the EIN rather than trusted to it.
func find(ctx context.Context, call Call, ein string) (*Organisation, *Outcome) {
	searched := Read(call(ctx, Request{
		Method: http.MethodGet,
		Path:   "/v1/organizations/search?" + url.Values{"q": {ein}}.Encode(),
	}))
	if searched.Kind != Value {
		return nil, &Outcome{Kind: Unsearched, Failure: searched.Turned()}
	}
	rows, read := readOrganisations(searched.Value, ein)
	if !read {
		return nil, &Outcome{Kind: Unsearched, Failure: unreadable(
			"Chariot answered the search in a shape this console was not written against.")}
	}
	switch len(rows) {
	case 0:
		return nil, &Outcome{Kind: Unlisted, EIN: ein}
	case 1:
		return &rows[0], nil
	default:
		return nil, &Outcome{Kind: Ambiguous, Candidates: rows}
	}
}

// the organisations in a search answer carrying `ein`, and whether the answer was read at all.
func readOrganisations(value map[string]any, ein string) ([]Organisation, bool) {
	results, ok := value["results"].([]any)
	if !ok {
		return nil, false
	}
	rows := []Organisation{}
	for _, one := range results {
		row, ok := one.(map[string]any)
		if !ok {
			return nil, false
		}
		if text(row["ein"]) != ein {
			continue
		}
		eligible, isBool := row["daf_eligible"].(bool)
		if text(row["id"]) == "" || !isBool {
			return nil, false
		}
		rows = append(rows, Organisation{
			ID:       text(row["id"]),
			Name:     text(row["name"]),
			City:     text(row["city"]),
			State:    text(row["state"]),
			Eligible: eligible,
		})
	}
	return rows, true
}

// the EIN the profile holds, as the nine digits Chariot looks one up by.
//
// the profile stores it as printed (`einAsPrinted` in packages/operator/src/console/org-rules.ts), so
// the hyphen is dropped; anything else that is not nine digits is no EIN, because Chariot reads any
// other `q` as a name to search for.
func einOf(org any) (string, bool) {
	profile, _ := org.(map[string]any)
	ein := strings.ReplaceAll(text(profile["tax_id"]), "-", "")
	if len(ein) != 9 {
		return "", false
	}
	if _, err := strconv.ParseUint(ein, 10, 64); err != nil {
		return "", false
	}
	return ein, true
}

// the notification email the profile holds, which Chariot keeps as the Connect's contact.
//
// the profile is the only source: Chariot's organisation objects carry no email.
func contactOf(org any) (string, bool) {
	profile, _ := org.(map[string]any)
	email := text(profile["notification_email"])
	return email, strings.TrimSpace(email) != ""
}

// the Connect in a create's answer, or nil where it is not one.
func readConnect(value map[string]any) *Connect {
	id := text(value["id"])
	active, isBool := value["active"].(bool)
	if id == "" || !isBool {
		return nil
	}
	return &Connect{ID: id, Active: active}
}

// the id of the subscription a create made, off the `event_subscription` wrapper the sandbox answers
// with or off the bare subscription the reference shows, and "" where neither carries one.
func createdID(value map[string]any) string {
	if wrapped, ok := value["event_subscription"].(map[string]any); ok {
		return text(wrapped["id"])
	}
	return text(value["id"])
}

// one subscription as the list hands it back.
type listedSubscription struct {
	ID, URL, Category, Status string
}

// every subscription on the account, every page, or the failure that stopped the reading.
func subscriptions(ctx context.Context, call Call) ([]listedSubscription, *Failure) {
	rows := []listedSubscription{}
	cursor := ""
	for range subscriptionPages {
		query := url.Values{"limit": {strconv.Itoa(subscriptionsPage)}}
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		listed := Read(call(ctx, Request{Method: http.MethodGet, Path: subscriptionsPath + "?" + query.Encode()}))
		if listed.Kind != Value {
			return nil, listed.Turned()
		}
		results, ok := listed.Value["results"].([]any)
		if !ok {
			return nil, unreadable(
				"Chariot listed this account’s subscriptions in a shape this console was not written against.")
		}
		for _, one := range results {
			row, _ := one.(map[string]any)
			rows = append(rows, listedSubscription{
				ID:       text(row["id"]),
				URL:      text(row["url"]),
				Category: text(row["category"]),
				Status:   text(row["status"]),
			})
		}
		next := text(listed.Value["nextPageToken"])
		if next == "" {
			return rows, nil
		}
		cursor = next
	}
	return nil, unreadable("Chariot listed more subscriptions on this account than this console reads.")
}

// marks one subscription deleted, which is the only way Chariot takes one down, and says whether it
// landed.
func retire(ctx context.Context, call Call, id string) bool {
	return Read(call(ctx, Request{
		Method: http.MethodPatch,
		Path:   subscriptionsPath + "/" + url.PathEscape(id),
		Body:   map[string]string{"status": "deleted"},
	})).Kind == Value
}

func landed(written deployment.Written) bool {
	return written.Kind == deployment.WriteSet || written.Kind == deployment.WriteUnchanged
}
