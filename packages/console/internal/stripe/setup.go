package stripe

import (
	"context"
	"net/http"
	"strings"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// setting the processor up from the screen: two keys handed in, and one chain that leaves the
// account and the deployment in the state that pair implies.
//
// **one press provisions everything, because by the time the two keys are in hand nothing is left
// to ask.** the account is named, the webhook endpoint is registered and subscribed, the secret key
// and the signing secret the create returns are written as vars, the publishable key is written as
// one, and the item a repeating gift is collected against is put on the account. a screen with a
// control per step would be a sequence stated as an interface.
//
// **a different key pair re-establishes everything, and nothing is carried over.** two keys are
// very likely a second processor account or a second mode, so an endpoint, a subscription list or a
// product already there belongs to whatever the last pair was. so the endpoint at this deployment's
// address is deleted and made again on every press rather than kept. nothing here reads the mode to
// decide that and nothing may: this repository holds no test-versus-live handling anywhere.
//
// **the signing secret exists exactly once.** it is returned only in the response that creates the
// endpoint, and no read on either of the processor's APIs hands it back
// (https://docs.stripe.com/api/webhook_endpoints/create). so it is taken out of that response and
// written straight to the deployment, and a press that creates an endpoint and then fails to write
// its secret is a failure loud enough to say so: the endpoint exists, the processor is delivering
// to it, and the value that verifies those deliveries is gone. Unkept is that state, and
// the way out of it is the same press again — which registers afresh and mints one.
//
// **no credential is in a value this returns.** neither key and no signing secret reaches an
// answer, an error sentence or a log line — what comes back is which stage the chain is at and, on
// the arms that have one, the processor's own words about a refusal. the two writes are
// ../deployment's var door, which keeps every value out of an argument list.
//
// **the address is derived and never typed.** ../deployment/address.go is what reads it out of the
// cloudflare account, and the path is ../release's — the same one the deployment serves, so an
// endpoint this registers is one the deployment recognises.
//
// **it is asked rather than awaited, which is the whole reason the stage is a value.** the chain is
// several round trips and a request held open for them is a page that cannot say which part is
// running. so the press starts the run and answers; the page asks again and reads the stage off
// ./run.go.
//
// every failure is a value: nothing here returns an error.

// Act is which of the two presses that are a run this is.
//
// A removal is neither: it is one write of the deployment's own credentials and seconds, so it is
// made through ../deployment's own door and answered where it was pressed.
type Act string

const (
	// ActErrand is the whole chain, made afresh against the pair that was pasted.
	ActErrand Act = "errand"
	// ActPublish is the var alone, which is every press that left the secret key where it is: no
	// call to the processor can be made with a credential nothing can read back.
	ActPublish Act = "publish"
)

// Stage is which part of the chain is running.
//
// Every one of them is the chain arriving at a call it makes itself, which is observed by having
// made it — nothing is animated or timed to stand in for a step this console cannot see.
type Stage string

const (
	// Naming is asking the processor which account the secret key belongs to.
	Naming Stage = "naming"
	// Registering is deriving the address, reading the account's endpoints, and registering this
	// one afresh.
	Registering Stage = "registering"
	// Storing is writing the secret key and the signing secret the create returned onto the
	// deployment, as vars.
	Storing Stage = "storing"
	// Publishing is the publishable key written as a var, which is a settings patch and seconds.
	Publishing Stage = "publishing"
	// Repeating is asking the deployment to put what a repeating gift is collected against on the
	// account.
	Repeating Stage = "repeating"
	// Covering is asking the deployment to register the hostnames a donor is drawn wallet buttons
	// on, which is its own address and every site it lists.
	Covering Stage = "covering"
)

// Named is who the secret key belongs to — what the screen says back.
type Named struct {
	Account Account `json:"account"`
}

// Registration is what the press did about the endpoint.
//
// There is no arm for leaving one alone, and that is the decision this chain turns on: the press
// re-establishes the endpoint against the pair of keys it was given, because an endpoint already at
// this address belongs to whatever pair came before it — and because the processor hands a signing
// secret over once, so an endpoint that is kept is one this console can never store a secret for.
type Registration struct {
	// Kind is `created` where nothing was registered at this address, and `replaced` where one was
	// and has been deleted and made again.
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Stamped bool   `json:"stamped"`
	// Replaced is the endpoint that was there, on `replaced` alone.
	Replaced *Endpoint `json:"replaced"`
}

// Facts is what the chain found out along the way, which the screen states beside the lines.
//
// It is written into as the chain goes rather than returned, for the reason the stage is: the page
// reads it while the run is still going, and an account named at the first step is what the first
// line has to say for the rest of the run.
type Facts struct {
	Named        *Named        `json:"named"`
	Registration *Registration `json:"registration"`
	// Elsewhere is the endpoints on this account carrying this deployment's path at some other
	// address. Named rather than touched — one may be another fork of this repository.
	Elsewhere []Endpoint `json:"elsewhere"`
}

// OutcomeKind is how the chain ended.
type OutcomeKind string

const (
	// Done is every step landing.
	Done OutcomeKind = "done"
	// Unnamed is the secret key naming no account, so nothing was read, created or stored.
	Unnamed OutcomeKind = "unnamed"
	// Nowhere is there being nowhere to register against, and Address says why.
	Nowhere OutcomeKind = "nowhere"
	// Unlisted is the account's endpoints not being readable, so nothing was deleted or created.
	Unlisted OutcomeKind = "unlisted"
	// Undeleted is the endpoint being replaced not being deletable, so the account is exactly as it
	// was.
	Undeleted OutcomeKind = "undeleted"
	// Uncreated is the processor refusing the create. Gone is the endpoint this press had already
	// deleted, and is the whole reason this arm carries anything: the deployment now receives
	// nothing at all.
	Uncreated OutcomeKind = "uncreated"
	// Unkept is the endpoint existing on the account with its signing secret stored nowhere.
	Unkept OutcomeKind = "unkept"
	// Unrepeating is the deployment not putting the repeating-gift item on the account. Everything
	// in front of it landed, so what it leaves is a deployment that serves a donation form and takes
	// one-time gifts, with the repeating-gifts press on the same fold to finish it.
	Unrepeating OutcomeKind = "unrepeating"
	// Uncovered is the deployment not registering the hostnames wallet buttons are drawn on — the
	// press not answered at all, or answered with the account read that opens it not landing.
	// Everything in front of it landed, so what it leaves is a deployment taking gifts on every rail
	// but Apple Pay, Google Pay and Link, with the press on the same fold to finish it. A hostname
	// the processor refused is not this: that is one line of a levelling that worked, drawn where
	// the hostnames are.
	Uncovered OutcomeKind = "uncovered"
	// NotPublished is everything on the processor account landing and the publishable key not being
	// written.
	NotPublished OutcomeKind = "not-published"
	// ConsoleStopped is the chain dying on this console's own goroutine, which is a claim about this
	// process and never about the account: it says the press failed part way through and that how
	// far it got is not known. It carries no member, ../run states why.
	ConsoleStopped OutcomeKind = "console-stopped"
)

// Outcome is how the chain ended, and what the step that stopped it answered.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it. Every arm but Done carries
// the answer of the step that stopped it, whole — each of those answers already tells a refused key
// from a processor nothing could reach, and the screen draws it at the line the stage belongs to
// rather than as one sentence about a press that failed.
type Outcome struct {
	Kind OutcomeKind `json:"kind"`
	// Failure is the processor's own answer, on the four arms it turned down.
	Failure *Failure `json:"failure"`
	// Address is why there was nowhere to register, on Nowhere alone.
	Address *deployment.AddressRead `json:"address"`
	// Endpoint is the one still registered exactly as it was, on Undeleted alone.
	Endpoint *Endpoint `json:"endpoint"`
	// Gone is the endpoint this press deleted and did not replace, on Uncreated.
	Gone *Endpoint `json:"gone"`
	// EndpointID is the endpoint whose signing secret is stored nowhere, on Unkept.
	EndpointID string `json:"endpointId"`
	// Why is `no-secret` or `not-stored`, on Unkept: which way the one copy was lost.
	Why string `json:"why"`
	// Written is the write that would not take it, on Unkept's `not-stored`.
	Written *deployment.Written `json:"written"`
	// Setup is what the deployment said about the repeating-gift item, on Unrepeating.
	Setup *deployment.RecurringSetup `json:"setup"`
	// Levelled is what the deployment said about the wallet registrations, on Uncovered.
	Levelled *deployment.WalletsLevel `json:"levelled"`
	// AwaitingKey is that refusal being the deployment not holding the secret key yet, on
	// Unrepeating and Uncovered. The write landed seconds earlier and its edge has not caught up, so
	// what the screen has to say is that this finishes itself on the next press — and never the
	// deployment's own sentence, which names a value this press has already set.
	AwaitingKey bool `json:"awaitingKey"`
	// Published is the var write that did not land, on NotPublished.
	Published *deployment.Written `json:"published"`
}

// Asked is what a press asked for, in the shape a run is started from.
//
// The keys are values for the length of the run and reach no answer: SecretKey is bound to the
// caller at the first step and PublishableKey travels into one request body.
type Asked struct {
	Act            Act
	SecretKey      string
	PublishableKey string
}

// Effects is every effect the chain has, handed in.
//
// The arrangement ../deployment's own writers take: every stage and every failure above is
// reachable in ./setup_test.go with no processor account, no cloudflare account and no network, and
// what a step is asked is visible at the one call site that binds it.
type Effects struct {
	Call    Call
	Address func(ctx context.Context) deployment.Address
	// Repeating and Covering are the two steps the deployment makes rather than this console, and the
	// only ones that can be answered by a deployment whose edge has not caught up with the write
	// below.
	//
	// Repeating takes the account it is about, because the deployment's press may be about one: the
	// run names its own, and the call site below is where that is said.
	Repeating func(ctx context.Context, processor string) deployment.RecurringSetup
	Covering  func(ctx context.Context) deployment.WalletsLevel
	// Publish writes vars, which is a read of the worker's bindings and one patch back. It is made
	// twice on the whole errand: the two credentials, and then the publishable key.
	Publish func(ctx context.Context, values map[string]string) deployment.Written
	// At and Found are how the chain says where it is and what it has found out. Both are called on
	// the goroutine the run is on, so a call that blocks holds the run up.
	At    func(stage Stage)
	Found func(facts Facts)
}

// how many endpoints one read of the account asks for.
//
// The whole account in one answer, deliberately. The processor caps an account at sixteen
// registered endpoints (https://docs.stripe.com/webhooks#register-your-endpoint) and this is the
// API's own maximum page, so `has_more` cannot be true and nothing here paginates. That matters
// beyond tidiness: this read is what decides what to delete, and a second page left unread would be
// an endpoint at this address surviving a press that was supposed to replace it.
const endpointPage = "100"

// what a registered endpoint is described as on the dashboard it appears on.
//
// An operator opening the processor's own webhooks screen finds a URL and a list of events, and
// nothing saying which of the things they set up that morning made it. This is that sentence. It is
// not matched on — an endpoint is identified by its URL — so it is safe to reword.
const endpointDescription = "Donation and repeating-gift events for this better-giving deployment."

// Chain is the whole press, from the effects and what was asked.
//
// **the order is not interchangeable, and every step is decided by the one above it.**
//
//  1. the account, because a key that cannot name one cannot register anything — and because the
//     name is what this screen exists to say back.
//  2. the address, derived. an endpoint registered at an invented host is a signing secret spent on
//     somebody else's server.
//  3. the account's endpoints, then the delete and the create. reading first is also what stands in
//     for an idempotency key: a key derived from the URL would replay the answer to the last create
//     for the same URL, so a replacement made inside that window would come back carrying the
//     deleted endpoint's dead secret, reported as a success.
//  4. the two credentials, which is a read of the worker's bindings and one patch back.
//  5. the publishable key, which is another.
//  6. the repeating-gift item, asked of the deployment.
//  7. the hostnames wallet buttons are drawn on, asked of the same deployment over the same key.
//
// **the credentials go up before the stamp, and that is the whole ordering decision.** between the
// create answering and that write landing, the only copy of the signing secret there will ever be
// is in this process's memory — so nothing that can be killed halfway goes in that gap. the stamp is
// best-effort metadata about a value that is safely stored by the time it runs.
//
// **the publish stands in front of the deployment's own step, because it waits on nothing.** the
// var is a cloudflare settings write decided by the pair that was pasted, and the repeating-gift
// item is a call to the deployment made with the key the write before it put there seconds earlier
// — which a worker builds its payment provider out of per request, from whatever its edge is
// holding. so that call can be answered by a deployment that does not have the key yet, and behind
// the publish that lag cost the publishable key as well and left a deployment serving no donation
// form at all.
//
// **what an operator is left holding when the fast half lands and the publish does not** is a
// deployment that holds both credentials and a correctly registered endpoint, and no publishable
// key — so it serves no donation form at all and nobody can give. no money is at risk, and pressing
// again is cheap and safe: the endpoint is registered afresh, the credentials are re-stored as they
// are, and the var is written again.
//
// **what a stop at either of the last two steps leaves is a deployment that works**: it serves a
// form and takes gifts, and what it is missing is finished by that step's own press on the same
// fold rather than by pasting the keys again.
func Chain(ctx context.Context, asked Asked, effects Effects) Outcome {
	facts := Facts{Elsewhere: []Endpoint{}}
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

	if asked.Act == ActPublish {
		return publish(ctx, asked.PublishableKey, effects, at)
	}

	account := Read(effects.Call(ctx, Request{Method: http.MethodGet, Path: "/account"}))
	if account.Kind != Value {
		return Outcome{Kind: Unnamed, Failure: account.Turned()}
	}
	named := ReadAccount(account.Value)
	if named == nil {
		return Outcome{Kind: Unnamed, Failure: &Failure{
			Kind: Unreadable, Detail: "Stripe named no account for this key.",
		}}
	}
	facts.Named = &Named{Account: *named}
	found()

	at(Registering)
	address := addressed(ctx, effects.Address)
	origin := address.Origin()
	if origin == "" {
		read := address.Read()
		return Outcome{Kind: Nowhere, Address: &read}
	}
	endpoint := origin + release.StripeWebhookPath

	listed := Read(effects.Call(ctx, Request{
		Method: http.MethodGet, Path: "/webhook_endpoints?limit=" + endpointPage,
	}))
	if listed.Kind != Value {
		return Outcome{Kind: Unlisted, Failure: listed.Turned()}
	}
	rows, read := ReadEndpoints(listed.Value)
	if !read {
		return Outcome{Kind: Unlisted, Failure: &Failure{
			Kind:   Unreadable,
			Detail: "Stripe listed this account’s endpoints in a shape this console was not written against.",
		}}
	}

	// matched on the URL and on nothing else, because that is the only fact this console holds
	// about this deployment's endpoint. an account may carry a second deployment's or a rehearsal
	// copy's, and acting on one of those would be a press that changes somebody else's setup.
	var here *Endpoint
	for at := range rows {
		if rows[at].URL == endpoint {
			here = &rows[at]
			break
		}
	}
	// the same path at another address: deliveries go there, and nothing this deployment serves is
	// at the other end.
	for at := range rows {
		if &rows[at] != here && strings.HasSuffix(rows[at].URL, release.StripeWebhookPath) {
			facts.Elsewhere = append(facts.Elsewhere, rows[at])
		}
	}
	found()

	var deleted *Endpoint
	if here != nil {
		removed := Read(effects.Call(ctx, Request{
			Method: http.MethodDelete, Path: "/webhook_endpoints/" + here.ID,
		}))
		if removed.Kind != Value {
			// nothing on the account has changed, so the failure is reported as it arrived.
			return Outcome{Kind: Undeleted, Endpoint: here, Failure: removed.Turned()}
		}
		deleted = here
	}

	made := Read(effects.Call(ctx, Request{
		Method: http.MethodPost,
		Path:   "/webhook_endpoints",
		Form: Form(map[string]string{
			"url": endpoint,
			// pinned, so deliveries are serialised in the version the deployment reads them against
			// rather than in whatever version this account happens to be set to.
			"api_version": release.StripeAPIVersion,
			"description": endpointDescription,
			// exactly what the deployment acts on, and nothing else. every other delivery would be a
			// request it answers and discards.
		}, "enabled_events", release.SubscribedEventTypes),
	}))
	if made.Kind != Value {
		return Outcome{Kind: Uncreated, Gone: deleted, Failure: made.Turned()}
	}
	created := ReadCreated(made.Value)
	if created == nil {
		return Outcome{Kind: Uncreated, Gone: deleted, Failure: &Failure{
			Kind:   Unreadable,
			Detail: "Stripe answered the create in a shape this console was not written against.",
		}}
	}
	if created.SigningSecret == "" {
		return Outcome{Kind: Unkept, EndpointID: created.ID, Why: "no-secret"}
	}

	at(Storing)
	// the two credentials in one call, because one press is one request: a deployment holding the
	// secret key and not the signing secret is a deployment that charges and books nothing.
	written := effects.Publish(ctx, map[string]string{
		"STRIPE_SECRET_KEY":     asked.SecretKey,
		"STRIPE_WEBHOOK_SECRET": created.SigningSecret,
	})
	if written.Kind != deployment.WriteSet {
		held := written
		return Outcome{Kind: Unkept, EndpointID: created.ID, Why: "not-stored", Written: &held}
	}

	facts.Registration = &Registration{
		Kind:     "created",
		ID:       created.ID,
		Stamped:  stamped(ctx, effects.Call, created.ID, created.SigningSecret),
		Replaced: deleted,
	}
	if deleted != nil {
		facts.Registration.Kind = "replaced"
	}
	found()

	if published := publish(ctx, asked.PublishableKey, effects, at); published.Kind != Done {
		return published
	}

	at(Repeating)
	// the account this run has just stored a key for, named: which accounts the deployment counts as
	// configured is read off the values it is serving, and this key is not among them until the edge
	// catches up — so a press naming none would act on every account but this one and report a run
	// that never asked about it. named, the answer is about this account alone, so another
	// processor an operator has never set up cannot end a run that is about this one.
	repeated := effects.Repeating(ctx, release.StripeProcessor)
	if repeated.Kind != deployment.RecurringSetupReported ||
		repeated.Report == nil || repeated.Report.Outcome == "failed" {
		held := repeated
		return Outcome{Kind: Unrepeating, Setup: &held, AwaitingKey: held.AwaitsKey()}
	}

	at(Covering)
	// the wallets last, behind the step that already waited on the same edge: this is another call
	// made with the key the store put there, and a hostname's own failure is one line of a levelling
	// that worked rather than a run that stopped.
	covered := effects.Covering(ctx)
	if covered.Kind != deployment.WalletsLevelReported || covered.Report == nil ||
		covered.Report.State != "levelled" {
		held := covered
		return Outcome{Kind: Uncovered, Levelled: &held, AwaitingKey: held.AwaitsKey()}
	}

	/* no payment-method configuration is provisioned here, and what keeps it out is the processor's
	   API rather than a decision left open.

	   **the configuration this deployment reads is the account's default one.**
	   `readRailSwitchboard` in packages/app/src/lib/server/payments/stripe.ts selects on
	   `is_default`, and that is the object the payments fold reports and
	   packages/app/src/lib/server/payments/rail-chargeability.ts honours.

	   **`is_default` is on the object and on neither the create nor the update**
	   (https://docs.stripe.com/api/payment_method_configurations/create,
	   https://docs.stripe.com/api/payment_method_configurations/update), so nothing holding a secret
	   key can move it. a configuration created here would carry this product's name and be read by
	   nothing.

	   **it would be charged against by nothing either.** a configuration decides what is offered
	   only where the payment method types are not named
	   (https://docs.stripe.com/api/payment_method_configurations), and both write arms name them:
	   `payment_method_types` on the intent and `payment_settings.payment_method_types` on the
	   commitment, because the fee a donor was quoted was priced for the one rail they picked.

	   so the step would leave the processor's dashboard more necessary rather than less — an
	   operator would have to go there to make the new configuration the default. which configuration
	   the switches live on is a change to the read on the payment port, and it is the decision this
	   chain is waiting on rather than a stage missing from it. */

	return Outcome{Kind: Done}
}

// reads where the deployment answers, asking once more where the first read found out nothing.
//
// an unreachable read is one cloudflare call spending its whole deadline without answering, and
// that is a fact about one round trip rather than about the deployment — the same read lands on
// the next home reading. so it alone is asked again, straight away: the first attempt has already
// waited a deadline, and a pause in front of the second would be a press held up twice for one
// stall. every other non-deployed kind is cloudflare's answer, and asking again would be asking it
// to change its mind, so those come back as they arrived. two unreachable reads in a row are what
// Nowhere carries.
func addressed(
	ctx context.Context, read func(ctx context.Context) deployment.Address,
) deployment.Address {
	address := read(ctx)
	if address.Kind == deployment.AddressUnreachable {
		return read(ctx)
	}
	return address
}

// the var that carries the key a donor's browser is handed, which is the whole of the cheap press
// and the step of the expensive one that waits on nothing the deployment has observed.
//
// It is the same function on both paths rather than the same lines twice: the two acts differ in
// what stands in front of this and in nothing about it, and a second copy is how they would come to
// report a write two ways.
func publish(
	ctx context.Context, publishableKey string, effects Effects, at func(Stage),
) Outcome {
	at(Publishing)
	written := effects.Publish(ctx, map[string]string{"STRIPE_PUBLISHABLE_KEY": publishableKey})
	// nothing to write is the same finished state as a write: the deployment already held what the
	// box asked for, which is every press whose publishable key did not change.
	if written.Kind == deployment.WriteSet || written.Kind == deployment.WriteUnchanged {
		return Outcome{Kind: Done}
	}
	return Outcome{Kind: NotPublished, Published: &written}
}

// writes the stored secret's fingerprint onto the endpoint it belongs to.
//
// After the store rather than before it, and swallowed rather than reported as a failure. The value
// it writes is what later tells a deployment's stored secret from the endpoint the processor is
// signing with — but it is a convenience about a value that is already safely stored by the time
// this runs, and a refusal here is not worth turning a finished setup into a failure. Unstamped,
// the endpoint reads as one nothing can confirm, which is where every hand-registered endpoint
// already sits.
//
// The metadata is sent as one key rather than as a replacement map, which is the processor's own
// merge behaviour for the field — an endpoint carrying something an operator put there keeps it.
func stamped(ctx context.Context, call Call, id, secret string) bool {
	fingerprint := Fingerprint(secret)
	if fingerprint == "" {
		return false
	}
	answer := Read(call(ctx, Request{
		Method: http.MethodPost,
		Path:   "/webhook_endpoints/" + id,
		Form: Form(map[string]string{
			"metadata[" + release.FingerprintMetadataKey + "]": fingerprint,
		}, "", nil),
	}))
	return answer.Kind == Value
}
