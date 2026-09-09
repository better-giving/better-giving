// Package stripe is the console's door to the payment processor, and the third host this binary
// calls.
//
// **plain http and no sdk.** ../cf is the precedent in this binary for exactly that, against
// cloudflare and against a deployment's own console surface: the calls are few and form-encoded,
// and every failure a screen has a sentence for is one of the four kinds below.
//
// **the key is a local value for the length of one press.** it arrives in this process from the
// browser's own press, is closed over by Calls, and is never written down, logged, put in a
// sentence a screen draws, or passed to a child process. every request carries it in a header and
// every url carries none, which is what makes a failure's own sentence safe to draw.
//
// **the version is pinned on every call.** ../release holds it and the rest of the endpoint's
// spelling, gated against packages/operator/src/stripe/webhook-endpoint.ts — so what this console
// asks the processor for and what the deployment reads back are the same version of the same
// objects.
//
// **nothing here is retried and nothing carries an idempotency key.** one press makes one call and
// a failed one is reported rather than repeated. what stands in for a key on the one create is the
// read in front of it — the account's own endpoint list in ./setup.go, which cannot go stale the
// way a replayed idempotent answer can.
//
// every failure is a value, the way ../cf's are: nothing here returns an error, and an error handed
// up to a handler would be a 500 in place of the state that explains it.
package stripe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// API is where the processor answers.
const API = "https://api.stripe.com/v1"

// Request is one call to the processor, as a value before it is made.
type Request struct {
	Method string
	Path   string
	// Form is nil on a read, which is what decides whether the request declares a body at all.
	Form url.Values
}

// Call is one authenticated call, bound to a key the caller never sees again.
type Call func(ctx context.Context, request Request) cf.Answer

// Bind binds one secret key to a caller, against the live processor.
//
// The caller is handed a function and never the key, which is ../cf's arrangement for every
// credential this binary holds: nothing that decides what a screen says is ever holding one.
func Bind(secretKey string) Call {
	return Calls(cf.FormSender(API, headers(secretKey)))
}

// Calls is that same caller over a bound host, so a case can look at every state below without a
// processor account and without a network.
func Calls(send cf.FormCall) Call {
	return func(ctx context.Context, request Request) cf.Answer {
		return send(ctx, request.Method, request.Path, request.Form)
	}
}

func headers(secretKey string) map[string]string {
	return map[string]string{
		"Authorization":  "Bearer " + secretKey,
		"Stripe-Version": release.StripeAPIVersion,
	}
}

// Form is one write's body: the named values, and one list under `name[0]`, `name[1]` and so on.
//
// The indices are the processor's own spelling of a list. A comma-joined value would register an
// endpoint subscribed to one event whose name is every event name at once, which it refuses — and a
// repeated bare name is read as the last one alone, which would subscribe an endpoint to one
// delivery and look like it worked.
func Form(values map[string]string, listName string, list []string) url.Values {
	form := url.Values{}
	for name, value := range values {
		form.Set(name, value)
	}
	for at, member := range list {
		form.Set(listName+"["+strconv.Itoa(at)+"]", member)
	}
	return form
}

// ResultKind is one answer sorted into the states a screen draws differently.
type ResultKind string

const (
	// Value is an answer this console was written against.
	Value ResultKind = "value"
	// Refused is a key the processor would not accept, or would not let do this. The way out is a
	// different key, which is the one box on the screen that can supply one.
	Refused ResultKind = "refused"
	// Rejected is a request the processor understood and would not carry out. The way out is not a
	// key: Detail is its own sentence and it names what was wrong.
	Rejected ResultKind = "rejected"
	// Unreachable is nothing found out either way, a 5xx included. On a create that is exactly the
	// state the endpoint list in front of it exists for: the endpoint may or may not be there, and
	// the next press reads the account rather than assuming.
	Unreachable ResultKind = "unreachable"
	// Unreadable is an answer in a shape this console was not written against.
	Unreadable ResultKind = "unreadable"
)

// Result is one answer, read.
type Result struct {
	Kind ResultKind
	// Value is the object the processor sent, on Value alone.
	Value map[string]any
	// Detail is the processor's own words about the failure, in its own words where it wrote any.
	Detail string
}

// Failure is the ways a call did not answer, which are the ones a screen has a sentence for.
//
// Flat and on the wire, because that is what a screen reads: the kind decides which sentence, and
// the processor's own words ride underneath every one of them.
type Failure struct {
	Kind   ResultKind `json:"kind"`
	Detail string     `json:"detail"`
}

// Turned is one read that did not land, as the failure a screen draws.
func (result Result) Turned() *Failure {
	return &Failure{Kind: result.Kind, Detail: result.Detail}
}

// Read sorts one answer into the states a screen draws differently.
//
// 401 is a key the processor will not accept and 403 is one it will not let do this
// (https://docs.stripe.com/api/errors). Both are one arm because the screen's way out of either is
// the box the key was typed in.
func Read(answer cf.Answer) Result {
	if answer.Kind == cf.Unreachable {
		return Result{Kind: Unreachable, Detail: answer.Detail}
	}
	detail := Said(answer)
	switch {
	case answer.Status == 401 || answer.Status == 403:
		return Result{Kind: Refused, Detail: detail}
	case answer.Status >= 400 && answer.Status < 500:
		return Result{Kind: Rejected, Detail: detail}
	case answer.Status < 200 || answer.Status > 299:
		return Result{Kind: Unreachable, Detail: detail}
	}
	held, ok := answer.Body.(map[string]any)
	if !ok {
		return Result{Kind: Unreadable, Detail: detail}
	}
	return Result{Kind: Value, Value: held}
}

// Said is what the processor said about a failure, in its own words where it wrote any.
func Said(answer cf.Answer) string {
	if answer.Kind == cf.Unreachable {
		return answer.Detail
	}
	if body, ok := answer.Body.(map[string]any); ok {
		if failure, ok := body["error"].(map[string]any); ok {
			if said, ok := failure["message"].(string); ok && said != "" {
				return said
			}
		}
	}
	return fmt.Sprintf("Stripe answered %d", answer.Status)
}

// Account is the account a key belongs to, as the screen names it back.
type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ReadAccount reads `GET /v1/account`.
//
// The name is the first of four that is actually there, in the order an operator would recognise
// one: what the dashboard calls the account, the business name, the address it is reached at, and
// finally the id — which a brand-new account is all it has, and which is still something to hold
// against the dashboard. An account is never reported as unnamed while it has an id.
//
// No mode is read here, and none is available: the processor answers this with the same object
// under either key and puts no `livemode` on it (https://docs.stripe.com/api/accounts/retrieve).
// What says the mode is the key's own prefix, which the browser reads.
func ReadAccount(value any) *Account {
	held, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	id := text(held["id"])
	if id == "" {
		return nil
	}
	settings, _ := held["settings"].(map[string]any)
	dashboard, _ := settings["dashboard"].(map[string]any)
	profile, _ := held["business_profile"].(map[string]any)

	name := text(dashboard["display_name"])
	if name == "" {
		name = text(profile["name"])
	}
	if name == "" {
		name = text(held["email"])
	}
	if name == "" {
		name = id
	}
	return &Account{ID: id, Name: name}
}

// Endpoint is one endpoint on the account, in the facts this console acts on.
type Endpoint struct {
	ID  string `json:"id"`
	URL string `json:"url"`
	// Delivering is whether the processor is currently delivering to it. An endpoint that exists
	// and is switched off is the shape that reads as a finished setup while nothing ever arrives,
	// and the processor switches one off itself after a run of failures — so it is a state a
	// working deployment reaches without anybody touching it.
	Delivering bool     `json:"delivering"`
	EventTypes []string `json:"eventTypes"`
	// Fingerprint is the stamp the signing secret's was written under, or nil where it carries
	// none. Read rather than trusted: an operator can type anything into that map from the
	// dashboard, so a value that is not a non-empty string is no stamp at all.
	Fingerprint *string `json:"fingerprint"`
}

// ReadEndpoints reads `GET /v1/webhook_endpoints`, and says whether it read a list at all.
//
// **the signing secret is deliberately not among the fields.** it is populated only on the answer
// to a create and absent from every other read
// (https://docs.stripe.com/api/webhook_endpoints/create), so a mapper that copied whatever was
// there would put a credential into a value this console draws a list from.
//
// **an answer carrying no list is not an account holding no endpoints.** the empty list is what
// decides there is nothing to delete, so reading one off a shape this was not written against would
// register a second endpoint beside the one already there.
func ReadEndpoints(value any) ([]Endpoint, bool) {
	held, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	data, ok := held["data"].([]any)
	if !ok {
		return nil, false
	}
	rows := []Endpoint{}
	for _, one := range data {
		row, ok := one.(map[string]any)
		if !ok {
			continue
		}
		id, address := text(row["id"]), text(row["url"])
		if id == "" || address == "" {
			continue
		}
		metadata, _ := row["metadata"].(map[string]any)
		types := []string{}
		if listed, ok := row["enabled_events"].([]any); ok {
			for _, member := range listed {
				if name, ok := member.(string); ok {
					types = append(types, name)
				}
			}
		}
		rows = append(rows, Endpoint{
			ID:          id,
			URL:         address,
			Delivering:  row["status"] == "enabled",
			EventTypes:  types,
			Fingerprint: stamp(text(metadata[release.FingerprintMetadataKey])),
		})
	}
	return rows, true
}

// Created is what a create answered: the endpoint, and the one copy of its signing secret there
// will ever be.
type Created struct {
	ID string
	// SigningSecret is empty where the processor created the endpoint and returned none. That is an
	// arm of a successful read rather than a failure of one, because the endpoint exists either way
	// and the id is the only thing that can be acted on afterwards — what makes it a loud failure
	// is the caller, ./setup.go, which has the endpoint to name in the sentence.
	SigningSecret string
	// LiveMode is the processor's own word for which mode the endpoint is in, which the key's
	// prefix only implied.
	LiveMode bool
}

// ReadCreated reads `POST /v1/webhook_endpoints`.
func ReadCreated(value any) *Created {
	held, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	id := text(held["id"])
	if id == "" {
		return nil
	}
	return &Created{
		ID:            id,
		SigningSecret: text(held["secret"]),
		LiveMode:      held["livemode"] == true,
	}
}

// how many hex characters of the digest are kept, from
// packages/operator/src/stripe/secret-fingerprint.ts. Sixteen, which is 64 bits — far past any
// chance of two of an account's at most sixteen endpoints colliding, and short enough to sit in a
// metadata value and be read at a glance.
const keptDigits = 16

// Fingerprint is the stamp of a signing secret, or empty for a value that is not one.
//
// Empty rather than the digest of an empty string, because an unset value and a set one must not
// produce comparable stamps: two deployments holding nothing would otherwise agree, and a console
// would report a match over a deployment that verifies nothing.
//
// The digest is the deployment's own — sha-256, hex, truncated — so the stamp this writes onto an
// endpoint is the one it reads back off it.
func Fingerprint(secret string) string {
	if strings.TrimSpace(secret) == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(digest[:])[:keptDigits]
}

func text(value any) string {
	held, ok := value.(string)
	if !ok {
		return ""
	}
	return held
}

func stamp(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
