package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/paypal"
	"github.com/better-giving/console/internal/release"
)

// the press that sets PayPal up, and the poll that watches it.
//
// PayPal and cloudflare are httptest servers here, so what is asserted is the whole press: what the
// door refuses before anything leaves this machine, what goes onto each wire, and that neither half
// of the pair is in anything a page can read.

// PayPal answering a fresh app, and remembering what it was asked and every body it was sent.
func paypalApp(t *testing.T) (*httptest.Server, func() []string) {
	t.Helper()
	asked := []string{}
	var recording sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		recording.Lock()
		asked = append(asked, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization")+" "+string(body))
		recording.Unlock()

		answer := map[string]any{}
		switch {
		case r.URL.Path == "/v1/oauth2/token":
			answer = map[string]any{"access_token": "A21AA-minted"}
		case r.Method == http.MethodGet:
			answer = map[string]any{"webhooks": []any{}}
		case r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			answer = map[string]any{"id": "WH-MINTED", "url": "x", "event_types": []any{}}
		}
		_ = json.NewEncoder(w).Encode(answer)
	}))
	t.Cleanup(server.Close)
	return server, func() []string {
		recording.Lock()
		defer recording.Unlock()
		return append([]string{}, asked...)
	}
}

// a console signed in and holding an account, with PayPal and cloudflare bound to fakes. the third
// return is every cloudflare call and its body.
func settingPaypal(t *testing.T, chosen string) (http.Handler, func() []string, *[]string) {
	t.Helper()
	records, flow, accounts := machine(t, chosen)
	api, cloudflare := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): resulting(map[string]any{"bindings": []any{}}),
		"GET /accounts/an-account/workers/scripts/" + release.Baked.Name + "/subdomain": resulting(
			map[string]any{"enabled": true}),
		"GET /accounts/an-account/workers/subdomain": resulting(map[string]any{"subdomain": "hound"}),
		"GET /accounts/an-account/workers/domains":   resulting([]any{}),
	})
	app, asked := paypalApp(t)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Settings: func(cf.Credential) cf.MultipartUpload { return cf.MultipartSend(api.URL, nil) },
		Paypal: func(clientID, secret string) paypal.Binding {
			return paypal.BindAt(app.URL, clientID, secret)
		},
	}), asked, cloudflare
}

const paypalPressed = `{"clientId":"Aa-client-typed","secret":"EL-secret-typed"}`

func polledPaypal(t *testing.T, handler http.Handler) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status, answer := ask(t, handler, "/api/paypal/run")
		if status != http.StatusOK {
			t.Fatalf("the poll answered %d", status)
		}
		if run, _ := answer["run"].(map[string]any); run != nil && run["kind"] == "ended" {
			return run
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("the run never ended")
	return nil
}

func TestThePaypalPressRegistersTheListenerAndWritesThePairAndItsIdAsVars(t *testing.T) {
	handler, asked, cloudflare := settingPaypal(t, "an-account")

	status, answer := press(t, handler, "/api/paypal/setup", paypalPressed)
	if status != http.StatusOK {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	if run, _ := answer["run"].(map[string]any); run == nil || run["kind"] != "running" {
		t.Fatalf("the press answered %v, want the run under way", answer)
	}

	landed := polledPaypal(t, handler)
	if outcome, _ := landed["outcome"].(map[string]any); outcome == nil || outcome["kind"] != "done" {
		t.Fatalf("the run ended %v", landed)
	}

	calls := asked()
	if len(calls) != 3 || !strings.HasPrefix(calls[2], "POST /v1/notifications/webhooks ") {
		t.Fatalf("PayPal was asked %v", calls)
	}
	listenerAt := "https://" + release.Baked.Name + ".hound.workers.dev" + release.PaypalWebhookPath
	if !strings.Contains(calls[2], `"url":"`+listenerAt+`"`) {
		t.Errorf("the listener was registered as %s, want at %s", calls[2], listenerAt)
	}

	held := strings.Join(*cloudflare, ",")
	if strings.Count(held, "PATCH "+settingsOf(release.Baked.Name)) != 1 {
		t.Errorf("the run made %v, want one settings patch", *cloudflare)
	}
	if strings.Contains(held, "/secrets-bulk") {
		t.Errorf("a configuration value was stored as a credential; the run made %v", *cloudflare)
	}
}

func TestNeitherHalfOfThePairReachesAnythingThePaypalRunAnswersWith(t *testing.T) {
	handler, _, _ := settingPaypal(t, "an-account")
	press(t, handler, "/api/paypal/setup", paypalPressed)

	written, err := json.Marshal(polledPaypal(t, handler))
	if err != nil {
		t.Fatal(err)
	}
	for _, credential := range []string{"Aa-client-typed", "EL-secret-typed", "A21AA-minted"} {
		if strings.Contains(string(written), credential) {
			t.Errorf("the run answers with %q in it", credential)
		}
	}
}

func TestAnEmptyOrPaddedPaypalSlotIsRefusedBeforeAnythingLeavesThisMachine(t *testing.T) {
	for _, body := range []string{
		`{"clientId":"","secret":"EL-b"}`,
		`{"clientId":"Aa-a","secret":""}`,
		`{"clientId":" Aa-a","secret":"EL-b"}`,
		`{"clientId":"Aa-a","secret":"EL-b "}`,
	} {
		t.Run(body, func(t *testing.T) {
			handler, asked, _ := settingPaypal(t, "an-account")
			status, answer := press(t, handler, "/api/paypal/setup", body)

			if status != http.StatusBadRequest {
				t.Fatalf("the press answered %d %v", status, answer)
			}
			if len(asked()) != 0 {
				t.Errorf("PayPal was asked %v", asked())
			}
			for _, typed := range []string{"Aa-a", "EL-b"} {
				if strings.Contains(said(answer), typed) {
					t.Errorf("the refusal %q carries what was typed", said(answer))
				}
			}
		})
	}
}

func TestNothingIsSetUpOnPaypalForAMachineThatHasChosenNoAccount(t *testing.T) {
	handler, asked, _ := settingPaypal(t, "")

	if status, _ := press(t, handler, "/api/paypal/setup", paypalPressed); status != http.StatusConflict {
		t.Fatalf("the press answered %d", status)
	}
	if len(asked()) != 0 {
		t.Errorf("PayPal was asked %v", asked())
	}
}
