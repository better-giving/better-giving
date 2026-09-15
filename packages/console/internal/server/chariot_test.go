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
	"github.com/better-giving/console/internal/chariot"
	"github.com/better-giving/console/internal/release"
)

// the press that sets Chariot up, and the poll that watches it.
//
// Chariot, cloudflare and the deployment are httptest servers here, so what is asserted is the whole
// press: what the door refuses before anything leaves this machine, what goes onto each wire, and
// that the key is in nothing a page can read.

// Chariot answering an account holding nothing, and remembering what it was asked and where.
func chariotAccount(t *testing.T) (*httptest.Server, func() []string) {
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
		case r.URL.Path == "/v1/organizations/search":
			answer = map[string]any{"results": []any{map[string]any{
				"id": "org_1", "ein": "530196605", "name": "Red Cross", "daf_eligible": true,
			}}}
		case r.URL.Path == "/v1/connects":
			w.WriteHeader(http.StatusCreated)
			answer = map[string]any{"id": "live_connect", "apiKey": "connect-token", "active": true}
		case r.Method == http.MethodGet:
			answer = map[string]any{"results": []any{}}
		case r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			answer = map[string]any{"id": "sub-1", "status": "active"}
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

// a console signed in, holding an account and a session on a deployment whose profile carries an
// EIN and a notification email, with Chariot and cloudflare bound to fakes. `bound` is every address
// the key was bound to.
func settingChariot(t *testing.T, chosen string) (http.Handler, func() []string, *[]string, *[]string) {
	t.Helper()
	records, flow, accounts := machine(t, chosen)
	surface, _ := deployed(t, map[string]any{
		"GET /console": map[string]any{
			"sites":   []any{},
			"session": map[string]any{"expiresAt": "2099-01-01T00:00:00Z"},
			"org": map[string]any{
				"legal_name": "Red Cross", "tax_id": "53-0196605", "notification_email": "alerts@example.org",
			},
		},
	})
	connected(t, records, surface.URL)
	api, cloudflare := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): resulting(map[string]any{"bindings": []any{}}),
		"GET /accounts/an-account/workers/scripts/" + release.Baked.Name + "/subdomain": resulting(
			map[string]any{"enabled": true}),
		"GET /accounts/an-account/workers/subdomain": resulting(map[string]any{"subdomain": "hound"}),
		"GET /accounts/an-account/workers/domains":   resulting([]any{}),
	})
	account, asked := chariotAccount(t)
	bound := []string{}
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Settings: func(cf.Credential) cf.MultipartUpload { return cf.MultipartSend(api.URL, nil) },
		Chariot: func(address, apiKey string) chariot.Call {
			bound = append(bound, address)
			return chariot.BindAt(account.URL, apiKey)
		},
	}), asked, cloudflare, &bound
}

const chariotPressed = `{"apiKey":"ck-typed-key","address":""}`

func polledChariot(t *testing.T, handler http.Handler) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status, answer := ask(t, handler, "/api/chariot/run")
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

func TestTheChariotPressSubscribesAndWritesItsValuesAsVars(t *testing.T) {
	handler, asked, cloudflare, bound := settingChariot(t, "an-account")

	status, answer := press(t, handler, "/api/chariot/setup", chariotPressed)
	if status != http.StatusOK {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	landed := polledChariot(t, handler)
	if outcome, _ := landed["outcome"].(map[string]any); outcome == nil || outcome["kind"] != "done" {
		t.Fatalf("the run ended %v", landed)
	}
	if len(*bound) != 1 || (*bound)[0] != chariot.API {
		t.Errorf("the key was bound to %v, want live", *bound)
	}

	calls := asked()
	created := ""
	for _, call := range calls {
		if strings.HasPrefix(call, "POST /v1/event_subscriptions ") {
			created = call
		}
		if !strings.Contains(call, " Bearer ck-typed-key ") {
			t.Errorf("a call carried no key: %s", call)
		}
	}
	subscribedAt := "https://" + release.Baked.Name + ".hound.workers.dev" + release.ChariotWebhookPath
	if !strings.Contains(created, `"url":"`+subscribedAt+`"`) || !strings.Contains(created, `"signing_secret":"`) {
		t.Errorf("the subscription was made as %q, want at %s with a secret", created, subscribedAt)
	}

	held := strings.Join(*cloudflare, ",")
	if strings.Count(held, "PATCH "+settingsOf(release.Baked.Name)) != 1 {
		t.Errorf("the run made %v, want one settings patch", *cloudflare)
	}
	if strings.Contains(held, "/secrets-bulk") {
		t.Errorf("a configuration value was stored as a credential; the run made %v", *cloudflare)
	}
}

func TestTheKeyReachesNothingTheChariotRunAnswersWith(t *testing.T) {
	handler, _, _, _ := settingChariot(t, "an-account")
	press(t, handler, "/api/chariot/setup", chariotPressed)

	written, err := json.Marshal(polledChariot(t, handler))
	if err != nil {
		t.Fatal(err)
	}
	for _, credential := range []string{"ck-typed-key", "connect-token"} {
		if strings.Contains(string(written), credential) {
			t.Errorf("the run answers with %q in it", credential)
		}
	}
}

func TestAnEmptyOrMalformedChariotSlotIsRefusedBeforeAnythingLeavesThisMachine(t *testing.T) {
	for _, body := range []string{
		`{"apiKey":"","address":""}`,
		`{"apiKey":" ck-a","address":""}`,
		`{"apiKey":"ck-a","address":"http://api.givechariot.com"}`,
		`{"apiKey":"ck-a","address":"https://api.givechariot.com/v1"}`,
	} {
		t.Run(body, func(t *testing.T) {
			handler, asked, _, _ := settingChariot(t, "an-account")
			status, answer := press(t, handler, "/api/chariot/setup", body)

			if status != http.StatusBadRequest {
				t.Fatalf("the press answered %d %v", status, answer)
			}
			if len(asked()) != 0 {
				t.Errorf("Chariot was asked %v", asked())
			}
			if strings.Contains(said(answer), "ck-a") {
				t.Errorf("the refusal %q carries the key", said(answer))
			}
		})
	}
}

func TestATypedSandboxAddressIsWhereTheKeyIsSent(t *testing.T) {
	handler, _, _, bound := settingChariot(t, "an-account")
	press(t, handler, "/api/chariot/setup",
		`{"apiKey":"ck-typed-key","address":"https://sandboxapi.givechariot.com/"}`)
	polledChariot(t, handler)
	if len(*bound) != 1 || (*bound)[0] != "https://sandboxapi.givechariot.com" {
		t.Errorf("the key was bound to %v", *bound)
	}
}

func TestNothingIsSetUpOnChariotForAMachineThatHasChosenNoAccount(t *testing.T) {
	handler, asked, _, _ := settingChariot(t, "")

	if status, _ := press(t, handler, "/api/chariot/setup", chariotPressed); status != http.StatusConflict {
		t.Fatalf("the press answered %d", status)
	}
	if len(asked()) != 0 {
		t.Errorf("Chariot was asked %v", asked())
	}
}
