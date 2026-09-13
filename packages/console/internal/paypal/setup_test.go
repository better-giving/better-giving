package paypal

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the chain, with PayPal, cloudflare and the deployment all handed in.
//
// every stage and every way one ends is reachable here with no PayPal app, no cloudflare account and
// no network — the arrangement ../stripe's own cases take.

const address = "https://w.acct.workers.dev"

var listenerURL = address + release.PaypalWebhookPath

// one call PayPal was asked, as the assertions read it.
type asked struct {
	key  string
	body any
}

// PayPal answering each call from a script, and remembering the order it was asked in.
type app struct {
	token   cf.Answer
	answers map[string]cf.Answer
	// bearer is the token every call past the mint was bound to.
	bearer []string
	calls  []asked
}

func (one *app) authorize(context.Context) cf.Answer {
	one.calls = append(one.calls, asked{key: "POST /v1/oauth2/token"})
	return one.token
}

func (one *app) bound(token string) Call {
	return func(_ context.Context, request Request) cf.Answer {
		key := request.Method + " " + request.Path
		one.bearer = append(one.bearer, token)
		one.calls = append(one.calls, asked{key: key, body: request.Body})
		answer, held := one.answers[key]
		if !held {
			return cf.Answer{Kind: cf.Answered, Status: 500, Body: map[string]any{"name": "UNSCRIPTED"}}
		}
		return answer
	}
}

func (one *app) keys() []string {
	keys := []string{}
	for _, call := range one.calls {
		keys = append(keys, call.key)
	}
	return keys
}

func answered(status int, body any) cf.Answer {
	return cf.Answer{Kind: cf.Answered, Status: status, Body: body}
}

// a listener as PayPal lists one.
func listener(id, url string, types ...string) map[string]any {
	named := []any{}
	for _, name := range types {
		named = append(named, map[string]any{"name": name, "status": "ENABLED"})
	}
	return map[string]any{"id": id, "url": url, "event_types": named}
}

func listed(listeners ...map[string]any) cf.Answer {
	rows := []any{}
	for _, one := range listeners {
		rows = append(rows, one)
	}
	return answered(200, map[string]any{"webhooks": rows})
}

// the whole press's effects, every one of them landing, which each case then spoils one of.
type effects struct {
	app       *app
	address   deployment.Address
	store     deployment.Written
	published []map[string]string
	stages    []Stage
	facts     []Facts
}

func working() *effects {
	return &effects{
		app: &app{
			token: answered(200, map[string]any{"access_token": "A21AA-token", "app_id": "APP-1"}),
			answers: map[string]cf.Answer{
				"GET /v1/notifications/webhooks":  listed(),
				"POST /v1/notifications/webhooks": answered(201, listener("WH-NEW", listenerURL)),
			},
		},
		address: deployment.Address{Kind: deployment.Deployed, WorkersDev: address},
		store:   deployment.Written{Kind: deployment.WriteSet},
	}
}

func (one *effects) bound() Effects {
	return Effects{
		Authorize: one.app.authorize,
		Bearer:    one.app.bound,
		Address:   func(context.Context) deployment.Address { return one.address },
		Publish: func(_ context.Context, values map[string]string) deployment.Written {
			one.published = append(one.published, values)
			return one.store
		},
		At:    func(stage Stage) { one.stages = append(one.stages, stage) },
		Found: func(facts Facts) { one.facts = append(one.facts, facts) },
	}
}

func pressed() Asked {
	return Asked{ClientID: "Aa-client", Secret: "EL-secret"}
}

func TestAnAppWithNoListenerHereGetsOneAndTheDeploymentStoresAllThreeValues(t *testing.T) {
	held := working()
	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	if want := []string{
		"POST /v1/oauth2/token", "GET /v1/notifications/webhooks", "POST /v1/notifications/webhooks",
	}; !slices.Equal(held.app.keys(), want) {
		t.Errorf("calls = %v, want %v", held.app.keys(), want)
	}
	for _, token := range held.app.bearer {
		if token != "A21AA-token" {
			t.Errorf("a call was bound to %q rather than the minted token", token)
		}
	}
	if want := []Stage{Registering, Storing}; !slices.Equal(held.stages, want) {
		t.Errorf("stages = %v, want %v after the authorizing the run starts at", held.stages, want)
	}
	if len(held.published) != 1 {
		t.Fatalf("the deployment was written %d times, want once", len(held.published))
	}
	want := map[string]string{
		"PAYPAL_CLIENT_ID":     "Aa-client",
		"PAYPAL_CLIENT_SECRET": "EL-secret",
		"PAYPAL_WEBHOOK_ID":    "WH-NEW",
	}
	for name, value := range want {
		if held.published[0][name] != value {
			t.Errorf("%s went up as %q, want %q", name, held.published[0][name], value)
		}
	}
	if len(held.published[0]) != len(want) {
		t.Errorf("the write carried %d values, want %d", len(held.published[0]), len(want))
	}
}

// the names one subscription body carries, in order.
func namesIn(t *testing.T, body any) []string {
	t.Helper()
	held, ok := body.(map[string]any)
	if !ok {
		t.Fatalf("the body is %T, want an object", body)
	}
	types, ok := held["event_types"].([]map[string]string)
	if !ok {
		t.Fatalf("event_types is %T", held["event_types"])
	}
	names := []string{}
	for _, one := range types {
		names = append(names, one["name"])
	}
	return names
}

func TestACreatedListenerIsAtThisAddressAndSubscribedToExactlyWhatTheDeploymentReads(t *testing.T) {
	held := working()
	Chain(context.Background(), pressed(), held.bound())

	create := held.app.calls[2]
	if create.body.(map[string]any)["url"] != listenerURL {
		t.Errorf("the listener was registered at %v, want %s", create.body.(map[string]any)["url"], listenerURL)
	}
	if names := namesIn(t, create.body); !slices.Equal(names, release.PaypalEventTypes) {
		t.Errorf("the listener was subscribed to %v, want %v", names, release.PaypalEventTypes)
	}
}

func TestAListenerAlreadyHereAndSubscribedToEverythingIsKeptAsItIs(t *testing.T) {
	held := working()
	// the subscription in another order is the same subscription.
	reversed := slices.Clone(release.PaypalEventTypes)
	slices.Reverse(reversed)
	held.app.answers["GET /v1/notifications/webhooks"] = listed(listener("WH-HERE", listenerURL, reversed...))

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	if want := []string{"POST /v1/oauth2/token", "GET /v1/notifications/webhooks"}; !slices.Equal(held.app.keys(), want) {
		t.Errorf("calls = %v, want %v — a listener that is right is touched by nothing", held.app.keys(), want)
	}
	if held.published[0]["PAYPAL_WEBHOOK_ID"] != "WH-HERE" {
		t.Errorf("the stored id is %q, want the listener already here", held.published[0]["PAYPAL_WEBHOOK_ID"])
	}
	last := held.facts[len(held.facts)-1]
	if last.Registration == nil || last.Registration.Kind != "kept" || last.Registration.ID != "WH-HERE" {
		t.Errorf("registration = %+v, want kept WH-HERE", last.Registration)
	}
	if len(last.Elsewhere) != 0 {
		t.Errorf("elsewhere = %+v, want none — the listener here is not somewhere else", last.Elsewhere)
	}
}

func TestAListenerHereSubscribedToSomethingElseIsBroughtToExactlyTheList(t *testing.T) {
	held := working()
	held.app.answers["GET /v1/notifications/webhooks"] = listed(
		listener("WH-HERE", listenerURL, "CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.REFUNDED"),
	)
	held.app.answers["PATCH /v1/notifications/webhooks/WH-HERE"] = answered(200, listener("WH-HERE", listenerURL))

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	if want := []string{
		"POST /v1/oauth2/token", "GET /v1/notifications/webhooks", "PATCH /v1/notifications/webhooks/WH-HERE",
	}; !slices.Equal(held.app.keys(), want) {
		t.Fatalf("calls = %v, want %v", held.app.keys(), want)
	}
	patch, ok := held.app.calls[2].body.([]map[string]any)
	if !ok || len(patch) != 1 || patch[0]["op"] != "replace" || patch[0]["path"] != "/event_types" {
		t.Fatalf("the patch is %#v, want one replace of /event_types", held.app.calls[2].body)
	}
	if names := namesIn(t, map[string]any{"event_types": patch[0]["value"]}); !slices.Equal(names, release.PaypalEventTypes) {
		t.Errorf("the listener was brought to %v, want %v", names, release.PaypalEventTypes)
	}
	if held.published[0]["PAYPAL_WEBHOOK_ID"] != "WH-HERE" {
		t.Errorf("the stored id is %q, want WH-HERE", held.published[0]["PAYPAL_WEBHOOK_ID"])
	}
	last := held.facts[len(held.facts)-1]
	if last.Registration == nil || last.Registration.Kind != "resubscribed" {
		t.Errorf("registration = %+v, want resubscribed", last.Registration)
	}
}

// every stop in front of the write leaves the deployment holding exactly what it held.
func assertNothingStored(t *testing.T, held *effects) {
	t.Helper()
	if len(held.published) != 0 {
		t.Errorf("the deployment was written %v", held.published)
	}
}

func TestAPairPayPalMintsNoTokenForReadsNothingAndStoresNothing(t *testing.T) {
	held := working()
	held.app.token = answered(401, map[string]any{
		"error": "invalid_client", "error_description": "Client Authentication failed",
	})

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Unauthorized || outcome.Failure == nil || outcome.Failure.Kind != Refused {
		t.Fatalf("outcome = %+v, want unauthorized and refused", outcome)
	}
	if want := "PayPal said: Client Authentication failed"; outcome.Failure.Detail != want {
		t.Errorf("detail = %q, want %q", outcome.Failure.Detail, want)
	}
	if want := []string{"POST /v1/oauth2/token"}; !slices.Equal(held.app.keys(), want) {
		t.Errorf("calls = %v, want %v", held.app.keys(), want)
	}
	assertNothingStored(t, held)
}

func TestADeploymentWithNoAddressRegistersNothing(t *testing.T) {
	held := working()
	held.address = deployment.Address{Kind: deployment.AddressUnreachable, Detail: "cloudflare did not answer"}

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Nowhere || outcome.Address == nil {
		t.Fatalf("outcome = %+v, want nowhere carrying the read", outcome)
	}
	if want := []string{"POST /v1/oauth2/token"}; !slices.Equal(held.app.keys(), want) {
		t.Errorf("calls = %v, want %v", held.app.keys(), want)
	}
	assertNothingStored(t, held)
}

func TestAnAddressThatIsNotHttpsIsNamedBeforeAnythingIsRegistered(t *testing.T) {
	held := working()
	held.address = deployment.Address{Kind: deployment.Deployed, WorkersDev: "http://w.acct.workers.dev"}

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Insecure || outcome.Origin != "http://w.acct.workers.dev" {
		t.Fatalf("outcome = %+v, want insecure naming the address", outcome)
	}
	if slices.Contains(held.app.keys(), "POST /v1/notifications/webhooks") {
		t.Errorf("a listener PayPal delivers nothing to was registered")
	}
	assertNothingStored(t, held)
}

func TestAnAppWhoseListenersCannotBeReadRegistersNothing(t *testing.T) {
	held := working()
	held.app.answers["GET /v1/notifications/webhooks"] = answered(200, map[string]any{"webhooks": "nope"})

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Unlisted || outcome.Failure == nil || outcome.Failure.Kind != Unreadable {
		t.Fatalf("outcome = %+v, want unlisted and unreadable", outcome)
	}
	if slices.Contains(held.app.keys(), "POST /v1/notifications/webhooks") {
		t.Errorf("a second listener could have been registered beside one nobody read")
	}
	assertNothingStored(t, held)
}

func TestAnAppAlreadyHoldingTenListenersElsewhereIsNamedAndNothingIsCreated(t *testing.T) {
	held := working()
	others := []map[string]any{}
	for at := range listenerCap {
		others = append(others, listener("WH-"+string(rune('A'+at)), "https://other.example.org/hook"))
	}
	held.app.answers["GET /v1/notifications/webhooks"] = listed(others...)

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Full || len(outcome.Listeners) != listenerCap {
		t.Fatalf("outcome = %+v, want full carrying all ten", outcome)
	}
	if slices.Contains(held.app.keys(), "POST /v1/notifications/webhooks") {
		t.Errorf("a create PayPal refuses was sent")
	}
	assertNothingStored(t, held)
}

func TestAListenerAlreadyHereIsKeptOnAnAppThatIsFull(t *testing.T) {
	held := working()
	rows := []map[string]any{listener("WH-HERE", listenerURL, release.PaypalEventTypes...)}
	for at := range listenerCap - 1 {
		rows = append(rows, listener("WH-"+string(rune('A'+at)), "https://other.example.org/hook"))
	}
	held.app.answers["GET /v1/notifications/webhooks"] = listed(rows...)

	if outcome := Chain(context.Background(), pressed(), held.bound()); outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done — the cap is about a create, and none is needed", outcome)
	}
}

func TestACreatePayPalRefusesStoresNothingAndCarriesWhatItSaid(t *testing.T) {
	held := working()
	held.app.answers["POST /v1/notifications/webhooks"] = answered(400, map[string]any{
		"name": "VALIDATION_ERROR", "details": []any{map[string]any{"issue": "INVALID_PARAMETER_SYNTAX"}},
	})

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Uncreated || outcome.Failure == nil || outcome.Failure.Kind != Rejected {
		t.Fatalf("outcome = %+v, want uncreated and rejected", outcome)
	}
	if want := "PayPal said: VALIDATION_ERROR, INVALID_PARAMETER_SYNTAX"; outcome.Failure.Detail != want {
		t.Errorf("detail = %q, want %q", outcome.Failure.Detail, want)
	}
	assertNothingStored(t, held)
}

func TestAResubscribePayPalRefusesStoresNothingAndNamesTheListener(t *testing.T) {
	held := working()
	held.app.answers["GET /v1/notifications/webhooks"] = listed(listener("WH-HERE", listenerURL))
	held.app.answers["PATCH /v1/notifications/webhooks/WH-HERE"] = answered(503, nil)

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Unresubscribed || outcome.ListenerID != "WH-HERE" || outcome.Failure == nil ||
		outcome.Failure.Kind != Unreachable {
		t.Fatalf("outcome = %+v, want unresubscribed WH-HERE and unreachable", outcome)
	}
	assertNothingStored(t, held)
}

func TestAWriteThatDoesNotLandNamesTheListenerTheNextPressKeeps(t *testing.T) {
	held := working()
	held.store = deployment.Written{Kind: deployment.WriteRefused}

	outcome := Chain(context.Background(), pressed(), held.bound())

	if outcome.Kind != Unstored || outcome.ListenerID != "WH-NEW" || outcome.Written == nil ||
		outcome.Written.Kind != deployment.WriteRefused {
		t.Fatalf("outcome = %+v, want unstored WH-NEW carrying the write", outcome)
	}
}

func TestAWriteThatChangesNothingIsAPressThatLanded(t *testing.T) {
	held := working()
	held.store = deployment.Written{Kind: deployment.WriteUnchanged}

	if outcome := Chain(context.Background(), pressed(), held.bound()); outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
}

func TestAListenerOnThisPathAtAnotherAddressIsNamedAndLeftAlone(t *testing.T) {
	held := working()
	held.app.answers["GET /v1/notifications/webhooks"] = listed(
		listener("WH-FORK", "https://fork.example.org"+release.PaypalWebhookPath),
	)

	Chain(context.Background(), pressed(), held.bound())

	last := held.facts[len(held.facts)-1]
	if len(last.Elsewhere) != 1 || last.Elsewhere[0].ID != "WH-FORK" {
		t.Errorf("elsewhere = %+v, want WH-FORK", last.Elsewhere)
	}
	for _, key := range held.app.keys() {
		if strings.Contains(key, "WH-FORK") {
			t.Errorf("another deployment's listener was acted on: %s", key)
		}
	}
}
