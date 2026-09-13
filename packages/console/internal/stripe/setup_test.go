package stripe

import (
	"context"
	"encoding/json"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the chain, with the processor, cloudflare and the deployment all handed in.
//
// every stage and every way one ends is reachable here with no processor account, no cloudflare
// account, no network and no child process — which is the arrangement ../deployment's own cases
// take, and what makes the ordering decisions below assertable rather than described.

const address = "https://w.acct.workers.dev"

var endpointURL = address + release.StripeWebhookPath

// a processor that answers each path from a script and records the order it was called in.
type processor struct {
	answers map[string]cf.Answer
	calls   []string
	forms   []url.Values
}

func (one *processor) call(_ context.Context, request Request) cf.Answer {
	key := request.Method + " " + strings.Split(request.Path, "?")[0]
	one.calls = append(one.calls, key)
	one.forms = append(one.forms, request.Form)
	answer, held := one.answers[key]
	if !held {
		return cf.Answer{Kind: cf.Answered, Status: 200, Body: map[string]any{"id": "unscripted"}}
	}
	return answer
}

func answered(body map[string]any) cf.Answer {
	return cf.Answer{Kind: cf.Answered, Status: 200, Body: body}
}

// one account's sentence, as the deployment's payment port writes it and the report carries it.
func refusal(one string) *string { return &one }

func turnedDown(status int, message string) cf.Answer {
	return cf.Answer{Kind: cf.Answered, Status: status, Body: map[string]any{
		"error": map[string]any{"message": message},
	}}
}

// the whole errand's effects, every one of them landing, which each case then spoils one of.
type effects struct {
	processor *processor
	address   deployment.Address
	// addresses, where set, is what each successive address read answers, the last one repeating;
	// addressReads counts them.
	addresses    []deployment.Address
	addressReads int
	repeating    deployment.RecurringSetup
	// repeatings is what each press of the deployment's own step was named, in order: the run is
	// about one account and the step says which.
	repeatings []string
	// covering is what the deployment says the wallet levelling did, and coverings counts the times
	// it was asked — a step behind a stop is one nothing may reach.
	covering  deployment.WalletsLevel
	coverings int
	// published is each payload the var door was handed, in the order they were written: the two
	// credentials, then the publishable key. store is how the first of those goes and publish the
	// second, so a case can spoil either one on its own.
	published []map[string]string
	store     deployment.Written
	publish   deployment.Written
	stages    []Stage
	facts     []Facts
}

func working() *effects {
	return &effects{
		processor: &processor{answers: map[string]cf.Answer{
			"GET /account":           answered(map[string]any{"id": "acct_1"}),
			"GET /webhook_endpoints": answered(map[string]any{"data": []any{}}),
			"POST /webhook_endpoints": answered(map[string]any{
				"id": "we_new", "secret": "whsec_new", "livemode": false,
			}),
		}},
		address: deployment.Address{Kind: deployment.Deployed, WorkersDev: address},
		store:   deployment.Written{Kind: deployment.WriteSet},
		// one account, because the press this step makes names the one the run is about: a deployment
		// holding PayPal's keys too answers about that account and no other, and the word over the
		// press is taken across it alone.
		repeating: deployment.RecurringSetup{
			Kind:  deployment.RecurringSetupReported,
			Named: release.StripeProcessor,
			Report: &deployment.RecurringSetupReport{
				Outcome: "set_up",
				Processors: []deployment.ProcessorRecurringSetup{
					{Processor: "stripe", Label: "Stripe", Outcome: "set_up"},
				},
			},
		},
		covering: deployment.WalletsLevel{
			Kind:   deployment.WalletsLevelReported,
			Report: &deployment.WalletLevellingReport{State: "levelled"},
		},
		publish: deployment.Written{Kind: deployment.WriteSet},
	}
}

func (one *effects) bound() Effects {
	return Effects{
		Call: one.processor.call,
		Address: func(context.Context) deployment.Address {
			one.addressReads++
			if len(one.addresses) == 0 {
				return one.address
			}
			return one.addresses[min(one.addressReads, len(one.addresses))-1]
		},
		Repeating: func(_ context.Context, processor string) deployment.RecurringSetup {
			one.repeatings = append(one.repeatings, processor)
			return one.repeating
		},
		Covering: func(context.Context) deployment.WalletsLevel {
			one.coverings++
			return one.covering
		},
		Publish: func(_ context.Context, values map[string]string) deployment.Written {
			one.published = append(one.published, values)
			// which write this is, read off what it carries rather than off a count: the cheap press
			// makes the second one alone.
			if _, named := values["STRIPE_SECRET_KEY"]; named {
				return one.store
			}
			return one.publish
		},
		At:    func(stage Stage) { one.stages = append(one.stages, stage) },
		Found: func(facts Facts) { one.facts = append(one.facts, facts) },
	}
}

func errand() Asked {
	return Asked{
		Act: ActErrand, SecretKey: "sk_test_secret", PublishableKey: "pk_test_published",
	}
}

func TestTheWholeErrandLandsAndReportsEveryStepAsItGoes(t *testing.T) {
	held := working()
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	// the order is not interchangeable and every step is decided by the one above it: the account
	// names the key, the address is what an endpoint is registered at, the store is what keeps the
	// one copy of the signing secret, and the publish is a settings patch that waits on nothing the
	// deployment has observed. the deployment's own step is last, because it is the only one that
	// reads a value the store has to have reached the edge for.
	if want := []Stage{Registering, Storing, Publishing, Repeating, Covering}; !slices.Equal(held.stages, want) {
		t.Errorf("stages = %v, want %v after the naming the run starts at", held.stages, want)
	}
	if want := []string{
		"GET /account", "GET /webhook_endpoints", "POST /webhook_endpoints",
		"POST /webhook_endpoints/we_new",
	}; !slices.Equal(held.processor.calls, want) {
		t.Errorf("calls = %v, want %v", held.processor.calls, want)
	}
}

func TestTheStoreCarriesBothCredentialsInOneCallAndComesBeforeTheStamp(t *testing.T) {
	held := working()
	Chain(context.Background(), errand(), held.bound())

	if len(held.published) == 0 {
		t.Fatal("nothing was written to the deployment")
	}
	payload := held.published[0]
	if len(payload) != 2 {
		t.Fatalf("the credentials went up as %v, want one write — a deployment holding the key and not the signing secret charges and books nothing", payload)
	}
	if payload["STRIPE_SECRET_KEY"] != "sk_test_secret" {
		t.Errorf("the secret key was not written")
	}
	if payload["STRIPE_WEBHOOK_SECRET"] != "whsec_new" {
		t.Errorf("the signing secret the create returned was not written")
	}
	// between the create answering and the store landing, the only copy of that secret is in this
	// process's memory — so nothing that can be killed halfway goes in that gap.
	if at := slices.Index(held.processor.calls, "POST /webhook_endpoints"); at != 2 {
		t.Fatalf("the create was call %d", at)
	}
	if len(held.processor.forms) != 4 || held.processor.forms[3] == nil {
		t.Fatal("nothing was stamped after the store")
	}
	stamped := held.processor.forms[3].Get("metadata[" + release.FingerprintMetadataKey + "]")
	if stamped != Fingerprint("whsec_new") {
		t.Errorf("stamp = %q, want the digest the deployment reads back", stamped)
	}
}

func TestTheEndpointIsRegisteredAtTheDerivedAddressAndSubscribedToTheWholeList(t *testing.T) {
	held := working()
	Chain(context.Background(), errand(), held.bound())

	form := held.processor.forms[2]
	if form.Get("url") != endpointURL {
		t.Errorf("url = %q, want %q", form.Get("url"), endpointURL)
	}
	if form.Get("api_version") != release.StripeAPIVersion {
		t.Errorf("api_version = %q, want it pinned", form.Get("api_version"))
	}
	for at, want := range release.SubscribedEventTypes {
		if got := form.Get("enabled_events[" + strconv.Itoa(at) + "]"); got != want {
			t.Errorf("enabled_events[%d] = %q, want %q", at, got, want)
		}
	}
}

func TestThePublishableKeyIsWrittenAsAVarAndTheChainReachesNoDeploy(t *testing.T) {
	held := working()
	Chain(context.Background(), errand(), held.bound())

	if len(held.published) != 2 {
		t.Fatalf("published %d times, want the credentials and then the publishable key", len(held.published))
	}
	if held.published[1]["STRIPE_PUBLISHABLE_KEY"] != "pk_test_published" {
		t.Errorf("published = %v", held.published[1])
	}
}

func TestAPressThatLeftTheSecretKeyAloneStartsAtThePublishAndReachesTheProcessorNotAtAll(t *testing.T) {
	held := working()
	outcome := Chain(context.Background(), Asked{Act: ActPublish, PublishableKey: "pk_live_x"}, held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	// nothing can read a stored credential back, so a press that left that box alone has no key to
	// make a single call with.
	if len(held.processor.calls) != 0 {
		t.Errorf("calls = %v, want none", held.processor.calls)
	}
	if len(held.published) != 1 {
		t.Errorf("published %v, want the publishable key alone", held.published)
	}
}

func TestAValueTheDeploymentAlreadyHoldsIsTheSameFinishedStateAsAWrite(t *testing.T) {
	held := working()
	held.publish = deployment.Written{Kind: deployment.WriteUnchanged}

	if outcome := Chain(context.Background(), errand(), held.bound()); outcome.Kind != Done {
		t.Errorf("outcome = %+v, want done — the box already held what it asked for", outcome)
	}
}

func TestNoCredentialReachesAnythingThisRunAnswersWith(t *testing.T) {
	held := working()
	held.processor.answers["POST /webhook_endpoints"] = answered(map[string]any{
		"id": "we_new", "secret": "whsec_never_drawn", "livemode": false,
	})
	outcome := Chain(context.Background(), errand(), held.bound())

	written, err := json.Marshal(Run{
		Kind: "ended", Act: ActErrand, Stage: Repeating, Facts: held.facts[len(held.facts)-1],
		Outcome: &outcome,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, credential := range []string{"sk_test_secret", "whsec_never_drawn"} {
		if strings.Contains(string(written), credential) {
			t.Errorf("the run answers with %q in it", credential)
		}
	}
}

func TestAKeyThatCanNameNoAccountStopsBeforeAnythingIsReadOrCreated(t *testing.T) {
	held := working()
	held.processor.answers["GET /account"] = turnedDown(401, "Invalid API Key provided")
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Unnamed || outcome.Failure == nil || outcome.Failure.Kind != Refused {
		t.Fatalf("outcome = %+v, want unnamed carrying a refused key", outcome)
	}
	if len(held.processor.calls) != 1 {
		t.Errorf("calls = %v, want the account read alone", held.processor.calls)
	}
}

func TestAnAccountAnsweredInAnUnknownShapeIsUnnamedRatherThanNamedNothing(t *testing.T) {
	held := working()
	held.processor.answers["GET /account"] = answered(map[string]any{"object": "account"})
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Unnamed || outcome.Failure == nil || outcome.Failure.Kind != Unreadable {
		t.Errorf("outcome = %+v", outcome)
	}
}

func TestADeploymentAnsweringOnNoAddressIsNowhereToRegisterRatherThanAGuess(t *testing.T) {
	held := working()
	held.address = deployment.Address{Kind: deployment.Deployed, Why: deployment.TurnedOff}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Nowhere || outcome.Address == nil || outcome.Address.Kind != "deployed" {
		t.Fatalf("outcome = %+v, want nowhere carrying the read that says why", outcome)
	}
	if len(held.processor.calls) != 1 {
		t.Errorf("calls = %v, want nothing registered", held.processor.calls)
	}
}

func TestAnAddressReadThatDidNotLandIsAskedOnceMoreAndTheChainGoesOn(t *testing.T) {
	held := working()
	held.addresses = []deployment.Address{
		{Kind: deployment.AddressUnreachable, Detail: "context deadline exceeded"},
		{Kind: deployment.Deployed, WorkersDev: address},
	}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done past a stall on the first address read", outcome)
	}
	if held.addressReads != 2 {
		t.Errorf("address reads = %d, want 2", held.addressReads)
	}
	if slices.Index(held.processor.calls, "POST /webhook_endpoints") < 0 {
		t.Errorf("calls = %v, want the endpoint registered", held.processor.calls)
	}
}

func TestTwoAddressReadsThatDidNotLandAreNowhereCarryingTheSecond(t *testing.T) {
	held := working()
	held.addresses = []deployment.Address{
		{Kind: deployment.AddressUnreachable, Detail: "first"},
		{Kind: deployment.AddressUnreachable, Detail: "second"},
	}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Nowhere || outcome.Address == nil ||
		outcome.Address.Kind != "unreachable" || outcome.Address.Detail != "second" {
		t.Fatalf("outcome = %+v, want nowhere carrying the second unreachable read", outcome)
	}
	if held.addressReads != 2 {
		t.Errorf("address reads = %d, want 2", held.addressReads)
	}
	if len(held.processor.calls) != 1 {
		t.Errorf("calls = %v, want nothing registered", held.processor.calls)
	}
}

func TestAnAddressReadThatAnsweredIsNotAskedAgain(t *testing.T) {
	held := working()
	held.address = deployment.Address{Kind: deployment.NotDeployed}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Nowhere || outcome.Address == nil || outcome.Address.Kind != "not-deployed" {
		t.Fatalf("outcome = %+v, want nowhere carrying the answer", outcome)
	}
	if held.addressReads != 1 {
		t.Errorf("address reads = %d, want 1: an answer is not asked again", held.addressReads)
	}
}

func TestAnAccountWhoseEndpointsCouldNotBeReadHasNothingDeletedOrCreated(t *testing.T) {
	for _, one := range []struct {
		name   string
		answer cf.Answer
		wants  ResultKind
	}{
		{"turned down", turnedDown(403, "not permitted"), Refused},
		{"in a shape nothing was written against", answered(map[string]any{"object": "list"}), Unreadable},
	} {
		t.Run(one.name, func(t *testing.T) {
			held := working()
			held.processor.answers["GET /webhook_endpoints"] = one.answer
			outcome := Chain(context.Background(), errand(), held.bound())

			if outcome.Kind != Unlisted || outcome.Failure == nil || outcome.Failure.Kind != one.wants {
				t.Fatalf("outcome = %+v", outcome)
			}
			if len(held.processor.calls) != 2 {
				t.Errorf("calls = %v, want nothing after the list", held.processor.calls)
			}
		})
	}
}

// the account as it stands with an endpoint at this address and one at another.
func standing() map[string]any {
	return map[string]any{"data": []any{
		map[string]any{"id": "we_here", "url": endpointURL, "status": "enabled"},
		map[string]any{
			"id": "we_fork", "url": "https://other.example" + release.StripeWebhookPath,
			"status": "enabled",
		},
		map[string]any{"id": "we_other", "url": "https://other.example/somewhere", "status": "enabled"},
	}}
}

func TestAnEndpointAtThisAddressIsDeletedAndMadeAgainAndTheOnesElsewhereAreOnlyNamed(t *testing.T) {
	held := working()
	held.processor.answers["GET /webhook_endpoints"] = answered(standing())
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	if slices.Index(held.processor.calls, "DELETE /webhook_endpoints/we_here") != 2 {
		t.Errorf("calls = %v, want the endpoint at this address deleted before the create", held.processor.calls)
	}
	facts := held.facts[len(held.facts)-1]
	if facts.Registration == nil || facts.Registration.Kind != "replaced" ||
		facts.Registration.Replaced == nil || facts.Registration.Replaced.ID != "we_here" {
		t.Errorf("registration = %+v, want the one it replaced", facts.Registration)
	}
	// a fork of this repository, or a rehearsal copy: deliveries go there and nothing this
	// deployment serves is at the other end, so it is named rather than touched.
	if len(facts.Elsewhere) != 1 || facts.Elsewhere[0].ID != "we_fork" {
		t.Errorf("elsewhere = %+v, want the one carrying this path at another address", facts.Elsewhere)
	}
	for _, call := range held.processor.calls {
		if strings.Contains(call, "we_fork") || strings.Contains(call, "we_other") {
			t.Errorf("%q acts on an endpoint this press does not own", call)
		}
	}
}

func TestAnEndpointThatCouldNotBeDeletedLeavesTheAccountExactlyAsItWas(t *testing.T) {
	held := working()
	held.processor.answers["GET /webhook_endpoints"] = answered(standing())
	held.processor.answers["DELETE /webhook_endpoints/we_here"] = turnedDown(403, "not permitted")
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Undeleted || outcome.Endpoint == nil || outcome.Endpoint.ID != "we_here" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if slices.Index(held.processor.calls, "POST /webhook_endpoints") != -1 {
		t.Errorf("calls = %v, want no create over an endpoint still registered", held.processor.calls)
	}
}

func TestACreateThatFailedAfterADeleteSaysTheDeploymentNowReceivesNothing(t *testing.T) {
	held := working()
	held.processor.answers["GET /webhook_endpoints"] = answered(standing())
	held.processor.answers["POST /webhook_endpoints"] = turnedDown(400, "Invalid URL")
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Uncreated || outcome.Gone == nil || outcome.Gone.ID != "we_here" {
		t.Fatalf("outcome = %+v, want the endpoint this press had already deleted", outcome)
	}
	if len(held.published) != 0 {
		t.Errorf("published %v, want nothing", held.published)
	}
}

func TestACreateWithNothingDeletedCarriesNoGone(t *testing.T) {
	held := working()
	held.processor.answers["POST /webhook_endpoints"] = turnedDown(400, "Invalid URL")
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Uncreated || outcome.Gone != nil {
		t.Errorf("outcome = %+v, want nothing named as deleted", outcome)
	}
}

func TestAnEndpointCreatedWithNoSecretIsAnEndpointNothingCanVerify(t *testing.T) {
	held := working()
	held.processor.answers["POST /webhook_endpoints"] = answered(map[string]any{"id": "we_new"})
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Unkept || outcome.EndpointID != "we_new" || outcome.Why != "no-secret" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(held.published) != 0 {
		t.Errorf("published %v, want nothing — there was no secret to keep", held.published)
	}
}

func TestASecretTheDeploymentWouldNotTakeIsTheSameLostSecret(t *testing.T) {
	held := working()
	held.store = deployment.Written{Kind: deployment.WriteRefused, Detail: "no access"}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Unkept || outcome.Why != "not-stored" || outcome.Written == nil {
		t.Fatalf("outcome = %+v", outcome)
	}
	if outcome.Written.Kind != deployment.WriteRefused {
		t.Errorf("written = %+v, want the write's own vocabulary", outcome.Written)
	}
	// nothing after the store runs: the item and the publishable key are both about a setup whose
	// signing secret is already gone.
	if len(held.published) != 1 {
		t.Errorf("published %v, want the credentials alone", held.published)
	}
}

func TestARefusedStampDoesNotTurnAFinishedSetupIntoAFailure(t *testing.T) {
	held := working()
	held.processor.answers["POST /webhook_endpoints/we_new"] = turnedDown(400, "no")
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done — the secret is safely stored by the time this runs", outcome)
	}
	facts := held.facts[len(held.facts)-1]
	if facts.Registration == nil || facts.Registration.Stamped {
		t.Errorf("registration = %+v, want an endpoint nothing can confirm", facts.Registration)
	}
}

func TestARepeatingItemTheDeploymentCouldNotAddLeavesTheKeyPublished(t *testing.T) {
	for _, one := range []struct {
		name  string
		setup deployment.RecurringSetup
	}{
		{"the deployment answering nothing that says", deployment.RecurringSetup{
			Kind: deployment.RecurringSetupUnanswered,
			Read: &deployment.NoReport{Kind: deployment.NoSession},
		}},
		{"this account refusing it for something else", deployment.RecurringSetup{
			Kind:  deployment.RecurringSetupReported,
			Named: release.StripeProcessor,
			Report: &deployment.RecurringSetupReport{
				Outcome: "failed",
				Processors: []deployment.ProcessorRecurringSetup{
					{
						Processor: "stripe", Label: "Stripe", Outcome: "failed",
						Reason: reasoned("failed"),
						Detail: refusal("Stripe holds an archived one, which cannot be charged against."),
					},
				},
			},
		}},
	} {
		t.Run(one.name, func(t *testing.T) {
			held := working()
			held.repeating = one.setup
			outcome := Chain(context.Background(), errand(), held.bound())

			if outcome.Kind != Unrepeating || outcome.Setup == nil {
				t.Fatalf("outcome = %+v", outcome)
			}
			// none of these is the Stripe account saying it has no key, so the screen draws what the
			// deployment said rather than telling an operator to wait.
			if outcome.AwaitingKey {
				t.Errorf("outcome = %+v, want the deployment's own refusal reported as itself", outcome)
			}
			// the publish stands in front of this and depends on nothing the deployment observed, so
			// what is left is a deployment that serves a form and takes one-time gifts.
			if len(held.published) != 2 {
				t.Errorf("published %v, want the key written before the deployment was asked", held.published)
			}
			// the levelling is the step after this one, and a step behind a stop is one nothing
			// reaches.
			if held.coverings != 0 {
				t.Errorf("the wallets were levelled %d times over a run that stopped in front of them", held.coverings)
			}
		})
	}
}

func TestADeploymentThatHasNotPickedTheKeyUpYetIsNotTheSameAsARefusal(t *testing.T) {
	held := working()
	// the write landed seconds earlier and has not reached the edge, so the deployment built its
	// payment provider without the key and answered the press with `no_key` beside its sentence.
	said := "This deployment cannot take a payment through Stripe: `STRIPE_SECRET_KEY` is not " +
		"set. Open the console (`better-giving open`) and set it under Donation processor."
	held.repeating = deployment.RecurringSetup{
		Kind:  deployment.RecurringSetupReported,
		Named: release.StripeProcessor,
		Report: &deployment.RecurringSetupReport{
			Outcome: "failed",
			Processors: []deployment.ProcessorRecurringSetup{
				{
					Processor: "stripe", Label: "Stripe", Outcome: "failed",
					Reason: reasoned("no_key"), Detail: &said,
				},
			},
		},
	}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Unrepeating || !outcome.AwaitingKey {
		t.Fatalf("outcome = %+v, want unrepeating over a deployment that has not picked the key up", outcome)
	}
	if len(held.published) != 2 || held.published[1]["STRIPE_PUBLISHABLE_KEY"] != "pk_test_published" {
		t.Errorf("published = %v, want the key written whatever the deployment answered", held.published)
	}
}

func TestAnAccountAlreadyHoldingTheItemIsTheSameFinishedStateAsOneJustAdded(t *testing.T) {
	held := working()
	held.repeating = deployment.RecurringSetup{
		Kind: deployment.RecurringSetupReported,
		Report: &deployment.RecurringSetupReport{
			Outcome: "already_set_up",
			Processors: []deployment.ProcessorRecurringSetup{
				{Processor: "stripe", Label: "Stripe", Outcome: "already_set_up"},
				{Processor: "paypal", Label: "PayPal", Outcome: "already_set_up"},
			},
		},
	}

	if outcome := Chain(context.Background(), errand(), held.bound()); outcome.Kind != Done {
		t.Errorf("outcome = %+v, want done", outcome)
	}
}

func TestAPublishableKeyTheDeploymentHoldsAsACredentialStopsTheRunAtTheWrite(t *testing.T) {
	held := working()
	held.publish = deployment.Written{
		Kind: deployment.WriteWithheld, Names: []string{"STRIPE_PUBLISHABLE_KEY"},
	}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != NotPublished || outcome.Published == nil {
		t.Fatalf("outcome = %+v", outcome)
	}
	if outcome.Published.Kind != deployment.WriteWithheld {
		t.Errorf("published = %+v, want the write's own vocabulary", outcome.Published)
	}
}

// the levelling is the last step and stands behind the deployment's own: it is a call made with the
// key the store put there, so it waits on the same edge the step in front of it does.
func TestTheWalletsAreLevelledOnlyOnceTheRepeatingItemIsOnTheAccount(t *testing.T) {
	held := working()

	if outcome := Chain(context.Background(), errand(), held.bound()); outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	if held.coverings != 1 {
		t.Errorf("the wallets were levelled %d times, want once at the end of the run", held.coverings)
	}
}

// a hostname Stripe would not take is drawn per line off the payments reading, and a run reported as
// failed over one site's registration would be a press an operator repeats over a setup that worked.
func TestAHostnameTheProcessorRefusedIsNotARunThatFailed(t *testing.T) {
	held := working()
	refused := "Stripe would not take this hostname."
	held.covering = deployment.WalletsLevel{
		Kind: deployment.WalletsLevelReported,
		Report: &deployment.WalletLevellingReport{
			State: "levelled",
			Hosts: []deployment.LevelledWalletHost{
				{Line: deployment.WalletHostLine{Host: "w.acct.workers.dev"}, Changed: true},
				{Line: deployment.WalletHostLine{Host: "hound-haven.org"}, Detail: &refused},
			},
		},
	}

	if outcome := Chain(context.Background(), errand(), held.bound()); outcome.Kind != Done {
		t.Errorf("outcome = %+v, want done — one site's registration is not the run", outcome)
	}
}

// the run stops here only where the deployment did not answer the press at all, or answered that it
// could not open it — the two facts that say nothing was attempted.
func TestALevellingTheDeploymentDidNotMakeStopsTheRunAtTheLastStep(t *testing.T) {
	for _, one := range []struct {
		name  string
		level deployment.WalletsLevel
	}{
		{"the deployment answering nothing that says", deployment.WalletsLevel{
			Kind: deployment.WalletsLevelUnanswered,
			Read: &deployment.NoReport{Kind: deployment.NoSession},
		}},
		{"the account read that opens the press not landing", deployment.WalletsLevel{
			Kind: deployment.WalletsLevelReported,
			Report: &deployment.WalletLevellingReport{
				State: "unreadable", Reason: "failed", Detail: "Stripe refused the key.",
			},
		}},
	} {
		t.Run(one.name, func(t *testing.T) {
			held := working()
			held.covering = one.level
			outcome := Chain(context.Background(), errand(), held.bound())

			if outcome.Kind != Uncovered || outcome.Levelled == nil {
				t.Fatalf("outcome = %+v", outcome)
			}
			// neither of these is the deployment saying it has no key, so the screen draws what the
			// deployment said rather than telling an operator to wait.
			if outcome.AwaitingKey {
				t.Errorf("outcome = %+v, want the deployment's own answer reported as itself", outcome)
			}
			// everything in front of it landed, which is what the stage the run stopped at says.
			if len(held.published) != 2 {
				t.Errorf("published %v, want every step in front of the levelling landed", held.published)
			}
		})
	}
}

func TestADeploymentThatHasNotPickedTheKeyUpYetStopsTheLevellingTheSameWay(t *testing.T) {
	held := working()
	held.covering = deployment.WalletsLevel{
		Kind: deployment.WalletsLevelReported,
		Report: &deployment.WalletLevellingReport{
			State: "unreadable", Reason: "no_key", Detail: "Set `STRIPE_SECRET_KEY`.",
		},
	}
	outcome := Chain(context.Background(), errand(), held.bound())

	if outcome.Kind != Uncovered || !outcome.AwaitingKey {
		t.Fatalf("outcome = %+v, want uncovered over a deployment that has not picked the key up", outcome)
	}
}

// the step the deployment makes is about the account this run has just stored a key for, and names
// it: which accounts a deployment counts as configured is read off the values it is serving, and
// the key stored seconds earlier is not among them yet — so a press naming none would act on every
// account but this one and report a run that never asked about it.
func TestTheDeploymentsOwnStepNamesTheAccountTheRunIsAbout(t *testing.T) {
	held := working()

	if outcome := Chain(context.Background(), errand(), held.bound()); outcome.Kind != Done {
		t.Fatalf("outcome = %+v, want done", outcome)
	}
	if want := []string{release.StripeProcessor}; !slices.Equal(held.repeatings, want) {
		t.Errorf("the deployment was pressed about %v, want %v", held.repeatings, want)
	}
}

// a reason as the deployment states it beside its sentence.
func reasoned(said string) *string { return &said }
