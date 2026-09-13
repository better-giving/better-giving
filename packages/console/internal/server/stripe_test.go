package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/stripe"
)

// the press that sets the processor up, and the poll that watches it.
//
// the processor, cloudflare and the deployment are all httptest servers here, so what is asserted
// is the whole press: what the door refuses before anything leaves this machine, what goes onto
// each of the three wires, and that neither key is in anything a page can read.

// a processor answering every path a whole errand walks, and remembering what it was asked.
//
// `gate` holds the first call until a case lets it go, which is how a run is looked at while it is
// still going.
func processor(t *testing.T, gate chan struct{}) (*httptest.Server, func() []string) {
	t.Helper()
	asked := []string{}
	var recording sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if gate != nil {
			<-gate
		}
		recording.Lock()
		asked = append(asked, r.Method+" "+r.URL.Path)
		recording.Unlock()

		body := map[string]any{"id": "we_new", "secret": "whsec_minted", "livemode": false}
		switch {
		case r.URL.Path == "/account":
			body = map[string]any{"id": "acct_1", "email": "ops@hound.example"}
		case r.Method == http.MethodGet && r.URL.Path == "/webhook_endpoints":
			body = map[string]any{"data": []any{}}
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(server.Close)
	return server, func() []string {
		recording.Lock()
		defer recording.Unlock()
		return append([]string{}, asked...)
	}
}

// a console signed in, holding an account, a session on a deployment that provisions the repeating
// item and levels its wallet hostnames, and every one of its three doors bound to a fake.
//
// The last return is every errand the deployment was sent, bodies and all, which is what says what
// the run's own steps asked it for.
func setting(t *testing.T, chosen string, gate chan struct{}) (http.Handler, *httptest.Server, func() []string, func() []string, func() []errand) {
	t.Helper()
	records, flow, accounts := machine(t, chosen)
	surface, errands := deployed(t, map[string]any{
		// one account, because the press this run makes names the one it has just stored a key for:
		// a deployment holding PayPal's keys as well answers about that account and no other.
		"POST /console/recurring": map[string]any{
			"outcome": "set_up",
			"processors": []any{
				map[string]any{"processor": "stripe", "label": "Stripe", "outcome": "set_up"},
			},
		},
		"POST /console/wallet-domains": map[string]any{"state": "levelled", "hosts": []any{}},
	})
	connected(t, records, surface.URL)

	api, cloudflare := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): resulting(map[string]any{"bindings": []any{
			map[string]any{"name": "DB", "type": "d1"},
		}}),
		// what the address is derived from: the worker answering on the account's own subdomain,
		// which is what an endpoint is registered at.
		"GET /accounts/an-account/workers/scripts/" + release.Baked.Name + "/subdomain": resulting(
			map[string]any{"enabled": true}),
		"GET /accounts/an-account/workers/subdomain": resulting(map[string]any{"subdomain": "hound"}),
		"GET /accounts/an-account/workers/domains":   resulting([]any{}),
	})
	stripes, asked := processor(t, gate)

	return New(Options{
			UI:       http.NotFoundHandler(),
			Flow:     flow,
			Accounts: accounts,
			Records:  records,
			Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
			Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
			Settings: func(cf.Credential) cf.MultipartUpload { return cf.MultipartSend(api.URL, nil) },
			Processor: func(string) stripe.Call {
				return stripe.Calls(cf.FormSender(stripes.URL, nil))
			},
		}), surface, asked, func() []string {
			read := []string{}
			for _, one := range errands() {
				read = append(read, one.method+" "+one.path)
			}
			return append(read, *cloudflare...)
		}, errands
}

// one answer cloudflare's api wraps a result in.
func resulting(result any) map[string]any {
	return map[string]any{"success": true, "errors": []any{}, "result": result}
}

const pressed = `{"secret":"sk_test_secret","publishable":"pk_test_published"}`

// where the endpoint is registered, derived from the account the fakes above answer for.
var registeredAt = "https://" + release.Baked.Name + ".hound.workers.dev" + release.StripeWebhookPath

// the run read until `until` holds, which is what the fold's own poll does.
func polled(t *testing.T, handler http.Handler, until func(map[string]any) bool) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status, answer := ask(t, handler, "/api/stripe/run")
		if status != http.StatusOK {
			t.Fatalf("the poll answered %d", status)
		}
		run, _ := answer["run"].(map[string]any)
		if until(run) {
			return run
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("the run never reached what the case waited for")
	return nil
}

func TestNothingIsSetUpForAMachineThatHasChosenNoAccount(t *testing.T) {
	handler, _, asked, _, _ := setting(t, "", nil)

	status, _ := press(t, handler, "/api/stripe/setup", pressed)
	if status != http.StatusConflict {
		t.Fatalf("the press answered %d", status)
	}
	if len(asked()) != 0 {
		t.Errorf("the processor was asked %v", asked())
	}
}

// **no shape is read at the door.** whether a value is a key Stripe takes is Stripe's answer, so a
// value of any shape in either slot goes through to the chain; what is refused before anything
// leaves this machine is a slot holding nothing or a value with space around it.
func TestAnEmptyOrPaddedSlotIsRefusedBeforeAnythingLeavesThisMachine(t *testing.T) {
	for _, one := range []struct {
		name string
		body string
	}{
		{"nothing in the published slot", `{"secret":"sk_test_a","publishable":""}`},
		{"spaces in the published slot", `{"secret":"sk_test_a","publishable":"   "}`},
		{"a padded publishable key", `{"secret":"sk_test_a","publishable":"pk_test_b "}`},
		{"a padded secret key", `{"secret":" sk_test_a","publishable":"pk_test_b"}`},
	} {
		t.Run(one.name, func(t *testing.T) {
			handler, _, asked, _, _ := setting(t, "an-account", nil)
			status, answer := press(t, handler, "/api/stripe/setup", one.body)

			if status != http.StatusBadRequest {
				t.Fatalf("the press answered %d %v", status, answer)
			}
			if len(asked()) != 0 {
				t.Errorf("the processor was asked %v", asked())
			}
			// what came back names the value and never carries it.
			for _, key := range []string{"sk_test_a", "pk_test_b"} {
				if strings.Contains(said(answer), key) {
					t.Errorf("the refusal %q carries what was typed", said(answer))
				}
			}
		})
	}
}

// a pair of no recognisable shape reaches the chain, because the shape is Stripe's to judge.
func TestAPairOfAnyShapeReachesTheProcessor(t *testing.T) {
	handler, _, asked, _, _ := setting(t, "an-account", nil)

	status, answer := press(t, handler, "/api/stripe/setup", `{"secret":"not-a-key","publishable":"neither"}`)
	if status != http.StatusOK {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	polled(t, handler, func(run map[string]any) bool {
		return run != nil && run["kind"] == "ended"
	})
	if len(asked()) == 0 {
		t.Errorf("the processor was never asked")
	}
}

func TestTheWholeErrandRunsFromTheBinaryAndReachesNoDeploy(t *testing.T) {
	handler, _, asked, wires, _ := setting(t, "an-account", nil)

	status, answer := press(t, handler, "/api/stripe/setup", pressed)
	if status != http.StatusOK {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	// it answers as soon as the chain is under way and never with what the chain did.
	run, _ := answer["run"].(map[string]any)
	if run == nil || run["kind"] != "running" {
		t.Fatalf("the press answered %v", answer)
	}

	landed := polled(t, handler, func(run map[string]any) bool {
		return run != nil && run["kind"] == "ended"
	})
	outcome, _ := landed["outcome"].(map[string]any)
	if outcome == nil || outcome["kind"] != "done" {
		t.Fatalf("the run ended %v", landed)
	}

	if want := []string{
		"GET /account", "GET /webhook_endpoints", "POST /webhook_endpoints",
		"POST /webhook_endpoints/we_new",
	}; strings.Join(asked(), ",") != strings.Join(want, ",") {
		t.Errorf("the processor was asked %v, want %v", asked(), want)
	}
	// every key is a settings patch and seconds: the deployment's own bindings are read and one
	// patch goes back, and nothing is built, migrated or uploaded.
	held := strings.Join(wires(), ",")
	for _, want := range []string{
		"POST /console/recurring", "POST /console/wallet-domains",
		"PATCH " + settingsOf(release.Baked.Name),
	} {
		if !strings.Contains(held, want) {
			t.Errorf("%q was never asked; the run made %v", want, wires())
		}
	}
	// two of them: the two credentials, and then the publishable key.
	if patched := strings.Count(held, "PATCH "+settingsOf(release.Baked.Name)); patched != 2 {
		t.Errorf("the run made %d settings patches; it made %v", patched, wires())
	}
	if strings.Contains(held, "/secrets-bulk") {
		t.Errorf("a configuration value was stored as a credential; the run made %v", wires())
	}
}

func TestNeitherKeyReachesAnythingTheRunAnswersWith(t *testing.T) {
	handler, _, _, _, _ := setting(t, "an-account", nil)
	press(t, handler, "/api/stripe/setup", pressed)

	landed := polled(t, handler, func(run map[string]any) bool {
		return run != nil && run["kind"] == "ended"
	})
	written, err := json.Marshal(landed)
	if err != nil {
		t.Fatal(err)
	}
	// the two the operator typed, and the one the create minted.
	for _, credential := range []string{"sk_test_secret", "pk_test_published", "whsec_minted"} {
		if strings.Contains(string(written), credential) {
			t.Errorf("the run answers with %q in it", credential)
		}
	}
}

func TestASecondPressWhileOneIsGoingIsTurnedDownCarryingTheOneAlreadyGoing(t *testing.T) {
	// the processor holds the first call, so the run is still going for the length of the case.
	gate := make(chan struct{})
	handler, _, _, _, _ := setting(t, "an-account", gate)
	t.Cleanup(func() { close(gate) })

	press(t, handler, "/api/stripe/setup", pressed)
	status, answer := press(t, handler, "/api/stripe/setup", pressed)

	if status != http.StatusConflict {
		t.Fatalf("the second press answered %d %v", status, answer)
	}
	run, _ := answer["run"].(map[string]any)
	if run == nil || run["kind"] != "running" {
		t.Errorf("the second press answered %v, want the run already going", answer)
	}
}

func TestARunThatLandedIsConsumedByThePollThatObservedIt(t *testing.T) {
	handler, _, _, _, _ := setting(t, "an-account", nil)
	press(t, handler, "/api/stripe/setup", pressed)

	polled(t, handler, func(run map[string]any) bool { return run != nil && run["kind"] == "ended" })
	// what says the press worked is the reading the fold is holding when it stops, so a reload
	// afterwards is a clean face rather than the last press reported again.
	_, answer := ask(t, handler, "/api/stripe/run")
	if answer["run"] != nil {
		t.Errorf("the run reports again as %v", answer["run"])
	}
}

func TestARunThatStoppedStaysUntilTheNextPressClearsIt(t *testing.T) {
	handler, surface, _, wires, _ := setting(t, "an-account", nil)
	surface.Close()

	press(t, handler, "/api/stripe/setup", pressed)
	stopped := polled(t, handler, func(run map[string]any) bool {
		return run != nil && run["kind"] == "ended"
	})
	outcome, _ := stopped["outcome"].(map[string]any)
	if outcome == nil || outcome["kind"] != "unrepeating" {
		t.Fatalf("the run ended %v", stopped)
	}
	// the deployment is the last step and the publish stands in front of it, so a deployment that
	// could not be reached at all still leaves one serving a donation form.
	if !strings.Contains(strings.Join(wires(), ","), "PATCH "+settingsOf(release.Baked.Name)) {
		t.Errorf("the publishable key was not written; the run made %v", wires())
	}

	// a failure has to survive a reload.
	_, again := ask(t, handler, "/api/stripe/run")
	if again["run"] == nil {
		t.Error("a run that stopped was dropped by the reading that observed it")
	}
}

func TestAPressCarryingNoSecretKeyIsThePublishAloneAndReachesTheProcessorNotAtAll(t *testing.T) {
	handler, _, asked, wires, _ := setting(t, "an-account", nil)

	status, _ := press(t, handler, "/api/stripe/setup", `{"secret":"","publishable":"pk_live_x"}`)
	if status != http.StatusOK {
		t.Fatalf("the press answered %d", status)
	}
	polled(t, handler, func(run map[string]any) bool { return run != nil && run["kind"] == "ended" })

	if len(asked()) != 0 {
		t.Errorf("the processor was asked %v, and nothing can read a stored key back", asked())
	}
	if strings.Contains(strings.Join(wires(), ","), "secrets-bulk") {
		t.Errorf("a press that stored no credential wrote one: %v", wires())
	}
}

func TestABodyThisConsoleWillNotActOnIsRefusedRatherThanRun(t *testing.T) {
	handler, _, asked, _, _ := setting(t, "an-account", nil)

	for _, body := range []string{
		`{"secret":"sk_test_a","publishable":"pk_test_b","worker":"someone-elses"}`,
		`{`,
	} {
		if status, _ := press(t, handler, "/api/stripe/setup", body); status != http.StatusBadRequest {
			t.Errorf("%s answered %d", body, status)
		}
	}
	if len(asked()) != 0 {
		t.Errorf("the processor was asked %v", asked())
	}
}

func said(answer map[string]any) string {
	held, _ := answer["error"].(string)
	return held
}

// the run's own step asks the deployment about the account it has just stored a key for, and says
// which: the values that deployment is serving do not hold that key yet, so a press naming none
// would act on every account but this one and come back reporting a run that never asked about it.
func TestTheRunPressesTheDeploymentAboutTheAccountItJustStoredAKeyFor(t *testing.T) {
	handler, _, _, _, errands := setting(t, "an-account", nil)
	press(t, handler, "/api/stripe/setup", pressed)

	polled(t, handler, func(run map[string]any) bool { return run != nil && run["kind"] == "ended" })

	pressing := []errand{}
	for _, one := range errands() {
		if one.method == http.MethodPost && one.path == deployment.RecurringPath {
			pressing = append(pressing, one)
		}
	}
	if len(pressing) != 1 {
		t.Fatalf("the deployment was pressed %d times, want once", len(pressing))
	}
	if pressing[0].body["processor"] != release.StripeProcessor {
		t.Errorf("the press asked %v, want the account the run stored a key for", pressing[0].body)
	}
}
