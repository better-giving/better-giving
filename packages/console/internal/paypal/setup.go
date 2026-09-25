package paypal

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// setting PayPal up from the screen: the client id, the secret and the address handed in, and one
// chain that leaves the app's listener and the deployment in the state that pair implies.
//
// **one press, because once the pair is in hand nothing is left to ask.** the listener at this
// deployment's address is found or registered, its subscription is brought to exactly what the
// deployment reads, the pair, the address and the listener's id are written as vars in one write,
// and the deployment is asked to put what a repeating gift is collected against on the account. the
// operator never opens PayPal's dashboard for the listener and never types its id.
//
// **a listener already here is kept, which is where this differs from ../stripe.** Stripe hands a
// signing secret over once, so an endpoint that is kept is one that console can never store a secret
// for, and it registers afresh on every press. what verifies a PayPal delivery is the listener's own
// id, which every list hands back — so the listener here is kept and its id stored, and a press never
// leaves a window in which the deployment has no listener at all.
//
// **the list stands in for an idempotency key.** a create that went unanswered may have landed; the
// next press reads the app, finds that listener by its url and keeps it, so a repeated press never
// registers a second one. matched on the url and on nothing else, because that is the only fact this
// console holds about this deployment's listener: an app may carry another deployment's.
//
// **the two refusals PayPal would make at the create are made here first, in its own terms.** an app
// holds at most ten listeners (https://developer.paypal.com/docs/api/webhooks/v1/) and PayPal
// delivers only over https on port 443 (https://developer.paypal.com/api/rest/webhooks/rest/), so an
// app already full or an address that is not https is an outcome naming the fix, read before any
// create is sent rather than off an issue code the create might answer with.
//
// **nothing is written until the listener is settled.** a pair written with no listener behind it is
// a deployment whose approved orders are never captured (packages/app/src/routes/api.paypal.webhook.ts),
// so every stop in front of the write leaves the deployment holding exactly what it held.
//
// **no credential is in a value this returns.** neither half of the pair and no token reaches an
// answer, an error sentence or a log line; the one write is ../deployment's var door, which keeps
// every value out of an argument list. the listener's id does reach the facts, because it is public.
//
// every failure is a value: nothing here returns an error.

// Stage is which part of the chain is running.
type Stage string

const (
	// Authorizing is minting a token with the pair that was pasted, at the address that was.
	Authorizing Stage = "authorizing"
	// Registering is deriving the address, reading the app's listeners, and settling the one here.
	Registering Stage = "registering"
	// Storing is writing the pair, its address and the listener's id onto the deployment, as vars.
	Storing Stage = "storing"
	// Repeating is asking the deployment to put what a repeating gift is collected against on the
	// PayPal account.
	Repeating Stage = "repeating"
)

// Registration is what the press did about the listener.
type Registration struct {
	// Kind is `created` where nothing listened at this address, `kept` where a listener did and was
	// subscribed to exactly the list, and `resubscribed` where one did and was brought to it.
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Facts is what the chain found out along the way, which the screen states beside the lines.
type Facts struct {
	Registration *Registration `json:"registration"`
	// Elsewhere is the listeners on this app carrying this deployment's path at some other address.
	// Named rather than touched — one may be another fork of this repository.
	Elsewhere []Listener `json:"elsewhere"`
}

// OutcomeKind is how the chain ended.
type OutcomeKind string

const (
	// Done is every step landing.
	Done OutcomeKind = "done"
	// Unauthorized is the pair minting no token, so nothing was read, registered or stored.
	Unauthorized OutcomeKind = "unauthorized"
	// Nowhere is there being nowhere to register against, and Address says why.
	Nowhere OutcomeKind = "nowhere"
	// Insecure is the deployment's address not being https, which PayPal delivers to nothing but.
	// Origin is the address, so the sentence can name it.
	Insecure OutcomeKind = "insecure"
	// Unlisted is the app's listeners not being readable, so nothing was registered or stored.
	Unlisted OutcomeKind = "unlisted"
	// Full is the app already holding PayPal's ten listeners, none of them here. Listeners is all ten,
	// so the screen can name the one to delete in PayPal's dashboard.
	Full OutcomeKind = "full"
	// Uncreated is PayPal refusing the create. Nothing listens here and nothing was stored.
	Uncreated OutcomeKind = "uncreated"
	// Unresubscribed is PayPal refusing to bring the listener here to the list. ListenerID is that
	// listener, still subscribed as it was, and nothing was stored.
	Unresubscribed OutcomeKind = "unresubscribed"
	// Unstored is the listener settled and the write not landing. ListenerID is the listener, which
	// the next press finds and keeps, and Written is the write.
	Unstored OutcomeKind = "unstored"
	// Unrepeating is the deployment not putting the repeating-gift plan on the account. Everything in
	// front of it landed, so what it leaves is a deployment taking one-time gifts on PayPal, with the
	// repeating-gifts press on the same fold to finish it.
	Unrepeating OutcomeKind = "unrepeating"
	// ConsoleStopped is the chain dying on this console's own goroutine, which says the press failed
	// part way through and never what the app now holds. It carries no member, ./run.go states why.
	ConsoleStopped OutcomeKind = "console-stopped"
)

// Outcome is how the chain ended, and what the step that stopped it answered.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Outcome struct {
	Kind OutcomeKind `json:"kind"`
	// Failure is PayPal's own answer, on Unauthorized, Unlisted, Uncreated and Unresubscribed.
	Failure *Failure `json:"failure"`
	// Address is why there was nowhere to register, on Nowhere alone.
	Address *deployment.AddressRead `json:"address"`
	// Origin is the address that is not https, on Insecure alone.
	Origin string `json:"origin"`
	// Listeners is the app's listeners, on Full alone.
	Listeners []Listener `json:"listeners"`
	// ListenerID is the listener at this address, on Unresubscribed and Unstored.
	ListenerID string `json:"listenerId"`
	// Written is the write that did not land, on Unstored alone.
	Written *deployment.Written `json:"written"`
	// Setup is what the deployment said about the repeating-gift plan, on Unrepeating alone.
	Setup *deployment.RecurringSetup `json:"setup"`
	// AwaitingKey is that refusal being the deployment not serving the pair yet, on Unrepeating. The
	// write landed seconds earlier and its edge has not caught up, so what the screen has to say is
	// that this finishes itself on the next press — and never the deployment's own sentence, which
	// names a value this press has already set.
	AwaitingKey bool `json:"awaitingKey"`
}

// Asked is what a press asked for. Both halves are values for the length of the run and reach no
// answer: they are bound into Effects before the chain is reached, and written in one request body.
type Asked struct {
	ClientID string
	Secret   string
	// Address is what ../cf's Base made of the typed one, DefaultAPIURL where it was blank.
	Address string
}

// Effects is every effect the chain has, handed in, so every stage and failure above is reachable in
// ./setup_test.go with no PayPal app, no cloudflare account and no network.
type Effects struct {
	// Authorize and Bearer are ./paypal.go's BindAt, bound to the pair at the address.
	Authorize func(ctx context.Context) cf.Answer
	Bearer    func(accessToken string) Call
	Address   func(ctx context.Context) deployment.Address
	// Publish writes vars, which is a read of the worker's bindings and one patch back; a name mapped
	// to nil is taken off.
	Publish func(ctx context.Context, values map[string]*string) deployment.Written
	// Repeating is the step the deployment makes rather than this console, and the one that can be
	// answered by a deployment whose edge has not caught up with the write in front of it. It takes
	// the account it is about, which the call site below names.
	Repeating func(ctx context.Context, processor string) deployment.RecurringSetup
	// At and Found are how the chain says where it is and what it has found out. Both are called on
	// the goroutine the run is on, so a call that blocks holds the run up.
	At    func(stage Stage)
	Found func(facts Facts)
}

// how many listeners PayPal lets one app hold (https://developer.paypal.com/docs/api/webhooks/v1/).
// it is also why the list is read whole and nothing here pages.
const listenerCap = 10

const listenersPath = "/v1/notifications/webhooks"

// Chain is the whole press, from the effects and what was asked.
//
// the order is not interchangeable: a pair that mints no token can list nothing, a listener cannot be
// matched without the address, the write carries the id the listener step settled on, and the
// deployment builds its PayPal client out of the pair and the address that write put there.
//
// a stop at that last step leaves a deployment that works: it takes one-time gifts on PayPal, and
// the repeating-gifts press on the same fold finishes it without the pair being pasted again.
func Chain(ctx context.Context, asked Asked, effects Effects) Outcome {
	facts := Facts{Elsewhere: []Listener{}}
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

	minted := Read(effects.Authorize(ctx))
	if minted.Kind == Refused {
		refused := minted.Turned()
		// a pair is refused at every address but the one it was made at, so where it went is half of
		// what the operator has to check.
		refused.Detail += ". PayPal refused the pair at " + asked.Address +
			"; a pair made at another PayPal address is set up with that address in the address box."
		return Outcome{Kind: Unauthorized, Failure: refused}
	}
	if minted.Kind != Value {
		return Outcome{Kind: Unauthorized, Failure: minted.Turned()}
	}
	token := text(minted.Value["access_token"])
	if token == "" {
		return Outcome{Kind: Unauthorized, Failure: &Failure{
			Kind: Unreadable, Detail: "PayPal minted no token for this pair.",
		}}
	}
	call := effects.Bearer(token)

	at(Registering)
	address := effects.Address(ctx)
	origin := address.Origin()
	if origin == "" {
		read := address.Read()
		return Outcome{Kind: Nowhere, Address: &read}
	}
	if !strings.HasPrefix(origin, "https://") {
		return Outcome{Kind: Insecure, Origin: origin}
	}
	endpoint := origin + release.PaypalWebhookPath

	listed := Read(call(ctx, Request{Method: http.MethodGet, Path: listenersPath}))
	if listed.Kind != Value {
		return Outcome{Kind: Unlisted, Failure: listed.Turned()}
	}
	rows, read := ReadListeners(listed.Value)
	if !read {
		return Outcome{Kind: Unlisted, Failure: &Failure{
			Kind:   Unreadable,
			Detail: "PayPal listed this app’s listeners in a shape this console was not written against.",
		}}
	}

	var here *Listener
	for at := range rows {
		if rows[at].URL == endpoint {
			here = &rows[at]
			break
		}
	}
	for at := range rows {
		if &rows[at] != here && strings.HasSuffix(rows[at].URL, release.PaypalWebhookPath) {
			facts.Elsewhere = append(facts.Elsewhere, rows[at])
		}
	}
	found()

	registration, stopped := settle(ctx, call, endpoint, here, rows)
	if stopped != nil {
		return *stopped
	}
	facts.Registration = registration
	found()

	at(Storing)
	// the pair, its address and the id in one write: a deployment holding the pair and another
	// listener's id verifies nothing, one holding the id and no pair captures nothing, and one holding
	// the pair at another address calls where the pair is refused.
	values := map[string]*string{
		"PAYPAL_CLIENT_ID":     &asked.ClientID,
		"PAYPAL_CLIENT_SECRET": &asked.Secret,
		"PAYPAL_WEBHOOK_ID":    &registration.ID,
		// the default is what a deployment holding no address calls, so it is stored as no address: an
		// address left from an earlier press would otherwise send this pair somewhere else.
		APIURLVar: nil,
	}
	if asked.Address != DefaultAPIURL {
		values[APIURLVar] = &asked.Address
	}
	written := effects.Publish(ctx, values)
	if written.Kind != deployment.WriteSet && written.Kind != deployment.WriteUnchanged {
		return Outcome{Kind: Unstored, ListenerID: registration.ID, Written: &written}
	}

	at(Repeating)
	// the account this run has just stored a pair for, named: which accounts the deployment counts as
	// configured is read off the values it is serving, and this pair is not among them until the edge
	// catches up — so a press naming none would act on every account but this one.
	repeated := effects.Repeating(ctx, release.PaypalProcessor)
	if repeated.Kind != deployment.RecurringSetupReported ||
		repeated.Report == nil || repeated.Report.Outcome == "failed" {
		held := repeated
		return Outcome{Kind: Unrepeating, Setup: &held, AwaitingKey: held.AwaitsKey()}
	}
	return Outcome{Kind: Done}
}

// the listener at this address, subscribed to exactly the list — or the outcome that stopped it.
func settle(
	ctx context.Context, call Call, endpoint string, here *Listener, rows []Listener,
) (*Registration, *Outcome) {
	if here != nil {
		if subscribedExactly(here.EventTypes) {
			return &Registration{Kind: "kept", ID: here.ID}, nil
		}
		// a replace of the whole list rather than an add of what is missing: an event this deployment
		// does not read is a delivery answered and discarded, and "exactly" is what the deployment
		// reads back as complete.
		patched := Read(call(ctx, Request{
			Method: http.MethodPatch,
			Path:   listenersPath + "/" + here.ID,
			Body: []map[string]any{
				{"op": "replace", "path": "/event_types", "value": eventTypes()},
			},
		}))
		if patched.Kind != Value {
			return nil, &Outcome{Kind: Unresubscribed, ListenerID: here.ID, Failure: patched.Turned()}
		}
		return &Registration{Kind: "resubscribed", ID: here.ID}, nil
	}

	if len(rows) >= listenerCap {
		return nil, &Outcome{Kind: Full, Listeners: rows}
	}
	made := Read(call(ctx, Request{
		Method: http.MethodPost,
		Path:   listenersPath,
		Body:   map[string]any{"url": endpoint, "event_types": eventTypes()},
	}))
	if made.Kind != Value {
		return nil, &Outcome{Kind: Uncreated, Failure: made.Turned()}
	}
	created := ReadListener(made.Value)
	if created == nil {
		return nil, &Outcome{Kind: Uncreated, Failure: &Failure{
			Kind:   Unreadable,
			Detail: "PayPal answered the create in a shape this console was not written against.",
		}}
	}
	return &Registration{Kind: "created", ID: created.ID}, nil
}

// whether a listener is subscribed to every event the deployment reads and to nothing else, in any
// order.
func subscribedExactly(types []string) bool {
	held := slices.Clone(types)
	slices.Sort(held)
	held = slices.Compact(held)
	wanted := slices.Clone(release.PaypalEventTypes)
	slices.Sort(wanted)
	return slices.Equal(held, wanted)
}

// the subscription as PayPal takes it: one object per event, named.
func eventTypes() []map[string]string {
	types := make([]map[string]string, 0, len(release.PaypalEventTypes))
	for _, name := range release.PaypalEventTypes {
		types = append(types, map[string]string{"name": name})
	}
	return types
}
