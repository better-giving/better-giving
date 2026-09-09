package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
)

// choosing the account this deployment is in, and what the page is told about the choice.
//
// **the posted id is never trusted.** the account list is read again on every press and an id that
// is not on it is refused, so a list that changed while the panel was open, a stale tab and an
// edited request all land on the same named refusal beside the list. the account-scoped read before
// the write is the refusal after that: without it the operator meets the same one at the first
// thing the deploy press tries to create, where nothing on the screen can repair it.

// the two accounts the fake sign-in carries, and the one it may administer.
const (
	administered = "an-account"
	watched      = "another-account"
)

// a cloudflare answering the three reads a sign-in is made of, and the account-scoped read the
// choice is checked with.
func accountAPI(t *testing.T, administers string) (string, func(cf.Credential) cf.Get) {
	t.Helper()
	dash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  held,
			"refresh_token": "a-refresh-token",
			"expires_in":    3600,
			"token_type":    "bearer",
		})
	}))
	t.Cleanup(dash.Close)

	rows := []any{
		map[string]any{"id": administered, "name": "hound-haven"},
		map[string]any{"id": watched, "name": "sea-shelter"},
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{"success": true, "errors": []any{}, "messages": []any{}}
		switch {
		case r.URL.Path == "/accounts":
			body["result"] = rows
		case r.URL.Path == "/memberships":
			body["result"] = []any{
				map[string]any{"status": "accepted", "account": map[string]any{"id": administered}},
				map[string]any{"status": "accepted", "account": map[string]any{"id": watched}},
			}
		case r.URL.Path == "/user":
			body["result"] = map[string]any{"email": "operator@example.org"}
		case r.URL.Path == "/accounts/"+administers+"/d1/database":
			body["result"] = []any{}
		case strings.HasSuffix(r.URL.Path, "/d1/database"):
			// "member, not administrator": the account is on this sign-in's list and holds nothing
			// it may look at.
			w.WriteHeader(http.StatusForbidden)
			body["success"] = false
			body["errors"] = []any{map[string]any{"code": 10000, "message": "Authentication error"}}
		default:
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(api.Close)

	return dash.URL, func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) }
}

// one console over a stated state directory, with a sign-in that may administer one account.
func chooser(t *testing.T, records state.Store, administers string) (http.Handler, *callback) {
	t.Helper()
	base, reads := accountAPI(t, administers)
	bound := &callback{}
	flow := oauth.New(oauth.Options{
		Store:  state.At(t.TempDir()),
		Base:   base,
		Open:   func(string) {},
		Waits:  5 * time.Second,
		Listen: bound.bind,
	})
	t.Cleanup(flow.Stop)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Reads:    reads,
		Accounts: account.New(records),
	}), bound
}

// one press, as the page makes it.
func post(t *testing.T, console http.Handler, path, body string) (int, map[string]any, string) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Host = loopback
	request.Header.Set("Content-Type", "application/json")
	answer := httptest.NewRecorder()
	console.ServeHTTP(answer, request)

	var read map[string]any
	if err := json.Unmarshal(answer.Body.Bytes(), &read); err != nil {
		t.Fatalf("POST %s answered something that is not json: %v", path, err)
	}
	return answer.Code, read, answer.Body.String()
}

// the account this console says it is in, read the way the page reads it.
func inAccount(t *testing.T, console http.Handler) map[string]any {
	t.Helper()
	status, body, _ := call(t, console, http.MethodGet, "/api/account")
	if status != http.StatusOK {
		t.Fatalf("reading the account answered %d", status)
	}
	return body
}

func TestAFirstRunIsInNoAccountAndHasClaimedNothing(t *testing.T) {
	console, _ := chooser(t, state.At(t.TempDir()), administered)

	body := inAccount(t, console)

	if body["account"] != nil {
		t.Errorf("account = %v, want nothing chosen", body["account"])
	}
	if body["remembered"] != false {
		t.Errorf("remembered = %v, want false", body["remembered"])
	}
	claims, _ := body["claims"].(map[string]any)
	if claims == nil || claims["database"] != nil || claims["widget"] != nil {
		t.Errorf("claims = %v, want both halves answered and unclaimed", body["claims"])
	}
}

func TestChoosingAnAccountRecordsItAndTheNextReadAnswersIt(t *testing.T) {
	console, bound := chooser(t, state.At(t.TempDir()), administered)
	allowed(t, console, bound)

	status, body, _ := post(t, console, "/api/account", `{"account":"`+administered+`"}`)

	if status != http.StatusOK || body["remembered"] != true {
		t.Fatalf("status = %d, body = %v, want the choice recorded", status, body)
	}
	read, _ := inAccount(t, console)["account"].(map[string]any)
	if read["id"] != administered || read["name"] != "hound-haven" {
		t.Errorf("account = %v, want the one just chosen", read)
	}
}

func TestAPressCarryingNoAccountIsRefusedAndRecordsNothing(t *testing.T) {
	console, bound := chooser(t, state.At(t.TempDir()), administered)
	allowed(t, console, bound)

	status, body, _ := post(t, console, "/api/account", `{"account":""}`)

	if status != http.StatusBadRequest || body["refusal"] != "nothing" {
		t.Fatalf("status = %d, body = %v, want the empty choice named", status, body)
	}
	if inAccount(t, console)["account"] != nil {
		t.Error("a press naming no account recorded one")
	}
}

func TestAnIdThatIsNotOnThisSignInsListIsRefusedAsStale(t *testing.T) {
	console, bound := chooser(t, state.At(t.TempDir()), administered)
	allowed(t, console, bound)

	status, body, _ := post(t, console, "/api/account", `{"account":"an-account-of-somebody-elses"}`)

	if status != http.StatusConflict || body["refusal"] != "stale" {
		t.Fatalf("status = %d, body = %v, want a posted id refused against a fresh list", status, body)
	}
	if body["account"] != "an-account-of-somebody-elses" {
		t.Errorf("account = %v, want the id the sentence names", body["account"])
	}
	if inAccount(t, console)["account"] != nil {
		t.Error("an id nothing on the list matched was recorded")
	}
}

func TestAPressFromAMachineHoldingNoSignInIsRefused(t *testing.T) {
	console, _ := chooser(t, state.At(t.TempDir()), administered)

	status, body, _ := post(t, console, "/api/account", `{"account":"`+administered+`"}`)

	if status != http.StatusConflict || body["refusal"] != "signin" {
		t.Fatalf("status = %d, body = %v, want the sign-in named", status, body)
	}
	if inAccount(t, console)["account"] != nil {
		t.Error("an account was recorded with nothing to reach it with")
	}
}

func TestAnAccountThisSignInCannotAdministerIsRefusedBesideTheList(t *testing.T) {
	console, bound := chooser(t, state.At(t.TempDir()), administered)
	allowed(t, console, bound)

	status, body, _ := post(t, console, "/api/account", `{"account":"`+watched+`"}`)

	if status != http.StatusForbidden || body["refusal"] != "refused" {
		t.Fatalf("status = %d, body = %v, want the account-scoped refusal", status, body)
	}
	if body["account"] != "sea-shelter" {
		t.Errorf("account = %v, want the name the sentence reads", body["account"])
	}
	if inAccount(t, console)["account"] != nil {
		t.Error("an account this sign-in cannot work in was recorded")
	}
}

func TestAMachineThatCannotBeWrittenOnSaysTheChoiceWasNotRemembered(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "in-the-way")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	console, bound := chooser(t, state.At(filepath.Join(blocked, "better-giving")), administered)
	allowed(t, console, bound)

	_, body, _ := post(t, console, "/api/account", `{"account":"`+administered+`"}`)

	if body["remembered"] != false {
		t.Fatalf("remembered = %v, want the note the screen draws", body["remembered"])
	}
	// the operator carries on in the account they just chose: the choice happened, the remembering
	// did not.
	read, _ := inAccount(t, console)["account"].(map[string]any)
	if read["id"] != administered {
		t.Errorf("account = %v, want the session to hold the choice", read)
	}
}

func TestTheClaimsAnsweredAreTheChosenAccountsOwn(t *testing.T) {
	dir := t.TempDir()
	written := `{"accountId":"` + watched + `","database":{"name":"donations","uuid":"a-uuid"},` +
		`"widget":null}`
	if err := os.WriteFile(filepath.Join(dir, "claimed.json"), []byte(written), 0o600); err != nil {
		t.Fatal(err)
	}
	console, bound := chooser(t, state.At(dir), administered)
	allowed(t, console, bound)
	post(t, console, "/api/account", `{"account":"`+administered+`"}`)

	claims, _ := inAccount(t, console)["claims"].(map[string]any)

	if claims["database"] != nil {
		t.Errorf("claims = %v, want a claim made in another account carried nowhere", claims)
	}
}

func TestNoAnswerAboutTheAccountCarriesTheCredential(t *testing.T) {
	console, bound := chooser(t, state.At(t.TempDir()), administered)
	allowed(t, console, bound)

	_, _, chose := post(t, console, "/api/account", `{"account":"`+administered+`"}`)
	_, _, read := call(t, console, http.MethodGet, "/api/account")

	for _, body := range []string{chose, read} {
		if strings.Contains(body, held) {
			t.Fatalf("an answer the browser reads carried the credential: %s", body)
		}
	}
}
