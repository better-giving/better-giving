package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

func TestHomeIsTheAccountAndTheTwoNamesTheScreensAreAbout(t *testing.T) {
	_, flow, accounts := machine(t, "an-account")
	handler := New(Options{Flow: flow, Accounts: accounts, UI: http.NotFoundHandler()})

	status, body := ask(t, handler, "/api/home")
	if status != http.StatusOK || body["remembered"] != true {
		t.Fatalf("%d %v", status, body)
	}
	held, ok := body["account"].(map[string]any)
	if !ok || held["id"] != "an-account" {
		t.Fatalf("read %v", body["account"])
	}
	if body["workerName"] != release.Baked.Name || body["databaseName"] != release.Baked.DatabaseName {
		t.Fatalf("read %v", body)
	}
	if note, stated := body["notKept"]; !stated || note != nil {
		t.Fatalf("notKept = %v (stated %v), want null on a sign-in nothing failed to keep", note, stated)
	}
}

// `better-giving start` records the account before this server is built, so a server holding none
// is one built some other way, and it answers that rather than an account it does not have.
func TestNothingIsAnsweredForAMachineThatHasChosenNoAccount(t *testing.T) {
	_, flow, accounts := machine(t, "")
	handler := New(Options{Flow: flow, Accounts: accounts, UI: http.NotFoundHandler()})

	for _, path := range []string{"/api/home", "/api/home/reading"} {
		status, body := ask(t, handler, path)
		if status != http.StatusConflict || body["error"] == nil {
			t.Errorf("%s: %d %v", path, status, body)
		}
	}
}

// a sign-in cloudflare allowed and this machine could not write down leaves nothing for the next
// launch, and the head note sends the operator to make that folder writable — so the folder is
// named: it is the operating system's own config home and not somewhere they have been.
func TestASignInThatCouldNotBeKeptNamesTheFolderItWouldHaveGoneIn(t *testing.T) {
	dash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "an-access-token",
			"refresh_token": "a-refresh-token",
			"expires_in":    3600,
			"token_type":    "bearer",
		})
	}))
	t.Cleanup(dash.Close)
	// a path with a file in the middle of it, so creating the directory fails however the machine
	// is set up.
	blocked := filepath.Join(t.TempDir(), "not-a-directory", "records")
	if err := os.WriteFile(filepath.Dir(blocked), []byte("taken"), 0o600); err != nil {
		t.Fatal(err)
	}
	records := state.At(blocked)
	accounts := account.New(records)
	accounts.Choose(account.Account{ID: "an-account", Name: "hound-haven"})

	callback := make(chan string, 1)
	flow := oauth.New(oauth.Options{
		Store: records,
		Base:  dash.URL,
		Waits: 5 * time.Second,
		// the registered callback on a port this test did not choose, so parallel runs never share one.
		Listen: func() (net.Listener, error) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				return nil, err
			}
			stated, err := url.Parse(oauth.CallbackURL)
			if err != nil {
				return nil, err
			}
			stated.Host = listener.Addr().String()
			callback <- stated.String()
			return listener, nil
		},
	})
	t.Cleanup(flow.Stop)
	handler := New(Options{Flow: flow, Accounts: accounts, Records: records, UI: http.NotFoundHandler()})

	phase, _, err := flow.Start()
	if err != nil {
		t.Fatal(err)
	}
	stated := strings.SplitN(phase.Address, "?", 2)
	if len(stated) != 2 {
		t.Fatalf("address = %q, want the allow page with this flow's state on it", phase.Address)
	}
	answer, err := http.Get(<-callback + "?" + stated[1] + "&code=a-code")
	if err != nil {
		t.Fatalf("the callback was not listening: %v", err)
	}
	answer.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, body := ask(t, handler, "/api/home"); body["notKept"] != nil {
			if body["notKept"] != blocked {
				t.Errorf("notKept = %v, want the folder the record would have gone in", body["notKept"])
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("home never said the sign-in could not be kept")
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
