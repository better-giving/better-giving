package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the two reads the home screen is drawn from: whether a shell is drawn at all, and the whole
// slower reading under it.
//
// **they are two calls because they answer at two speeds.** the first is this machine's own memory
// and the baked names, and the second is every cloudflare round trip and the deployment's own
// answer — so the page draws its bar the moment it can, and shows one checking state under it.

// the token every fake answers on, so a case can assert the credential travelled.
const homeToken = "a-cloudflare-token"

// a machine holding a sign-in and, where `chosen` is set, an account.
func machine(t *testing.T, chosen string) (state.Store, *oauth.Flow, *account.Store) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv(state.HomeVar, dir)
	t.Setenv(oauth.TokenVar, homeToken)
	records := state.At(dir)
	accounts := account.New(records)
	if chosen != "" {
		accounts.Choose(account.Account{ID: chosen, Name: "hound-haven"})
	}
	return records, oauth.New(oauth.Options{Store: records}), accounts
}

func ask(t *testing.T, handler http.Handler, path string) (int, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = loopback
	recorded := httptest.NewRecorder()
	handler.ServeHTTP(recorded, request)
	var body map[string]any
	if err := json.Unmarshal(recorded.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s answered %q", path, recorded.Body.String())
	}
	return recorded.Code, body
}

func TestTheShapeIsWhetherThereIsAnAccountToDrawAShellUnder(t *testing.T) {
	_, flow, accounts := machine(t, "")
	handler := New(Options{Flow: flow, Accounts: accounts, UI: http.NotFoundHandler()})

	status, body := ask(t, handler, "/api/home")
	if status != http.StatusOK || body["shape"] != "connect" {
		t.Fatalf("%d %v", status, body)
	}
	// the two names are the baked release's and are stated whatever the shape: the connect panel
	// names the deployment it is about before there is an account to scope anything to.
	if body["workerName"] == "" || body["databaseName"] == "" {
		t.Fatalf("read %v", body)
	}
	if body["account"] != nil {
		t.Fatalf("an account was named on a machine that has chosen none: %v", body["account"])
	}
}

func TestAShellIsDrawnTheMomentAnAccountIsRecorded(t *testing.T) {
	_, flow, accounts := machine(t, "an-account")
	handler := New(Options{Flow: flow, Accounts: accounts, UI: http.NotFoundHandler()})

	_, body := ask(t, handler, "/api/home")
	if body["shape"] != "shell" || body["remembered"] != true {
		t.Fatalf("read %v", body)
	}
	held, ok := body["account"].(map[string]any)
	if !ok || held["id"] != "an-account" {
		t.Fatalf("read %v", body["account"])
	}
}

// the reading is scoped to an account, so there is nothing to read before one is chosen.
func TestNothingIsReadForAMachineThatHasChosenNoAccount(t *testing.T) {
	_, flow, accounts := machine(t, "")
	handler := New(Options{Flow: flow, Accounts: accounts, UI: http.NotFoundHandler()})

	status, body := ask(t, handler, "/api/home/reading")
	if status != http.StatusConflict || body["error"] == nil {
		t.Fatalf("%d %v", status, body)
	}
}

// the whole reading is one answer, so the page shows one checking state rather than resolving
// three times under the reader.
func TestTheReadingIsOneAnswerCarryingEveryReadThePageDraws(t *testing.T) {
	records, flow, accounts := machine(t, "an-account")

	deployed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("the deployment was asked without the session")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sites":   []any{"https://hound-haven.org"},
			"org":     map[string]any{"legal_name": "Hound Haven"},
			"mail":    map[string]any{"SMTP_HOST": "smtp.example", "SMTP_USERNAME": "post", "MAIL_FROM": "post@example"},
			"session": map[string]any{"expiresAt": "2026-09-01T00:00:00.000Z"},
		})
	}))
	t.Cleanup(deployed.Close)

	token := "bg1.99999999999.0123456789012345678901234567890123456789012"
	record, _ := json.Marshal(map[string]string{
		"workerName": release.Baked.Name, "origin": deployed.URL, "token": token,
	})
	if err := os.WriteFile(filepath.Join(records.Dir(), session.File), record, 0o600); err != nil {
		t.Fatal(err)
	}

	handler := New(Options{
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		UI:       http.NotFoundHandler(),
		Reads:    func(cf.Credential) cf.Get { return homeAPI(t) },
	})

	status, body := ask(t, handler, "/api/home/reading")
	if status != http.StatusOK {
		t.Fatalf("%d %v", status, body)
	}
	face, _ := body["face"].(map[string]any)
	if face["kind"] != string(deployment.FaceReady) {
		t.Fatalf("face %v", face)
	}
	if body["sites"] == nil || body["org"] == nil || body["values"] == nil {
		t.Fatalf("read %v", body)
	}
	// the donor-facing page is a route on this deployment's own worker (CLAUDE.md → Product
	// surface), so where it answers is where the deployment answers.
	if body["donatePage"] != "https://"+release.Baked.Name+".hound-haven.workers.dev" {
		t.Fatalf("donation page %v", body["donatePage"])
	}
}

// the account is not asked twice about one thing, and neither is the deployment: a page load that
// found no session draws the gate rather than a refusal from the deployment.
func TestAMachineHoldingNoSessionDrawsTheGate(t *testing.T) {
	records, flow, accounts := machine(t, "an-account")
	handler := New(Options{
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		UI:       http.NotFoundHandler(),
		Reads:    func(cf.Credential) cf.Get { return homeAPI(t) },
	})

	_, body := ask(t, handler, "/api/home/reading")
	face, _ := body["face"].(map[string]any)
	read, _ := face["read"].(map[string]any)
	if face["kind"] != string(deployment.FaceUnreachable) || read["kind"] != string(deployment.NoSession) {
		t.Fatalf("face %v", face)
	}
}

// an account holding this deployment, answering every read the ready face needs.
func homeAPI(t *testing.T) cf.Get {
	t.Helper()
	worker := "/accounts/an-account/workers/scripts/" + release.Baked.Name
	answers := map[string]any{
		"/accounts/an-account/d1/database": []any{
			map[string]any{"name": release.Baked.DatabaseName, "uuid": "one"},
		},
		worker + "/subdomain":                    map[string]any{"enabled": true},
		"/accounts/an-account/workers/subdomain": map[string]any{"subdomain": "hound-haven"},
		"/accounts/an-account/workers/domains":   []any{},
		worker + "/settings":                     map[string]any{"bindings": []any{}},
		worker + "/secrets":                      []any{},
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result, named := answers[r.URL.Path]
		if !named {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "errors": []any{}, "messages": []any{}, "result": result,
		})
	}))
	t.Cleanup(api.Close)
	return cf.JSONGet(api.URL, map[string]string{})
}
