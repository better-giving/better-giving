package server

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
)

// what the page asks about the sign-in, and what it is told.
//
// **the property under all of it is that the credential never reaches the page.** every one of
// these four answers is read by a browser, so what they may carry is a phase, an address the
// operator is being sent to, an email and a list of accounts — and never a token.

// the token the fake dashboard hands back, which must appear in no answer any of these cases reads.
const held = "an-access-token-that-must-not-be-drawn"

// a cloudflare that answers the oauth exchange and the three reads a sign-in is made of.
func cloudflare(t *testing.T) (base string, reads func(cf.Credential) cf.Get) {
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

	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{"success": true, "errors": []any{}, "messages": []any{}}
		switch r.URL.Path {
		case "/accounts":
			body["result"] = []any{map[string]any{"id": "an-account", "name": "hound-haven"}}
		case "/memberships":
			body["result"] = []any{map[string]any{
				"id":      "m-1",
				"status":  "accepted",
				"account": map[string]any{"id": "an-account", "name": "hound-haven"},
			}}
		case "/user":
			body["result"] = map[string]any{"email": "operator@example.org"}
		default:
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(api.Close)

	return dash.URL, func(credential cf.Credential) cf.Get {
		return cf.JSONGet(api.URL, nil)
	}
}

// where a browser was opened, guarded because the flow opens it from a press's own goroutine.
type browser struct {
	mutex sync.Mutex
	at    []string
}

func (one *browser) open(address string) {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	one.at = append(one.at, address)
}

func (one *browser) count() int {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return len(one.at)
}

// the callback one flow bound, which is the registered address on a port this test did not choose.
//
// The cases here run alongside each other and alongside whatever the contributor has open, so a
// fixed port would make any two of those the same failure. What a sign-in states as its
// `redirect_uri` is the registered address whatever this binds.
type callback struct {
	mutex sync.Mutex
	url   string
}

func (one *callback) bind() (net.Listener, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	stated, err := url.Parse(oauth.CallbackURL)
	if err != nil {
		return nil, err
	}
	stated.Host = listener.Addr().String()
	one.mutex.Lock()
	one.url = stated.String()
	one.mutex.Unlock()
	return listener, nil
}

func (one *callback) at() string {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return one.url
}

// one console, against a fake dashboard and a state directory of this test's own.
func serving(t *testing.T) (http.Handler, *browser, *callback) {
	t.Helper()
	base, reads := cloudflare(t)
	opener := &browser{}
	bound := &callback{}
	flow := oauth.New(oauth.Options{
		Store:  state.At(t.TempDir()),
		Base:   base,
		Open:   opener.open,
		Waits:  5 * time.Second,
		Listen: bound.bind,
	})
	t.Cleanup(flow.Stop)
	return console(t, flow, reads), opener, bound
}

// the console this file drives, over the sign-in a case states.
func console(t *testing.T, flow *oauth.Flow, reads func(cf.Credential) cf.Get) http.Handler {
	t.Helper()
	return consoleRecording(t, flow, reads, state.At(t.TempDir()))
}

// the same console over a stated directory of records, for the case about a sign-in that could not
// be written into one.
func consoleRecording(
	t *testing.T,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	records state.Store,
) http.Handler {
	t.Helper()
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Reads:    reads,
		Accounts: account.New(records),
		Records:  records,
	})
}

// one call to this console, as its own page makes one.
func call(t *testing.T, console http.Handler, method, path string) (int, map[string]any, string) {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	request.Host = loopback
	answer := httptest.NewRecorder()
	console.ServeHTTP(answer, request)

	var body map[string]any
	if err := json.Unmarshal(answer.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s %s answered something that is not json: %v", method, path, err)
	}
	return answer.Code, body, answer.Body.String()
}

// the whole sign-in, driven the way the operator's browser drives it.
func allowed(t *testing.T, console http.Handler, bound *callback) {
	t.Helper()
	status, started, _ := call(t, console, http.MethodPost, "/api/sign-in")
	if status != http.StatusOK {
		t.Fatalf("starting the sign-in answered %d", status)
	}
	address, _ := started["address"].(string)
	stated := strings.SplitN(address, "?", 2)
	if len(stated) != 2 {
		t.Fatalf("address = %q, want the allow page with this flow's state on it", address)
	}
	answer, err := http.Get(bound.at() + "?" + stated[1] + "&code=a-code")
	if err != nil {
		t.Fatalf("the callback was not listening: %v", err)
	}
	answer.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, body, _ := call(t, console, http.MethodGet, "/api/sign-in"); body["phase"] == "signed-in" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the console never reported itself signed in")
}

func TestAMachineHoldingNoSignInIsAskedToSignIn(t *testing.T) {
	console, _, _ := serving(t)

	status, body, _ := call(t, console, http.MethodGet, "/api/sign-in")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if body["phase"] != "idle" {
		t.Errorf("phase = %v, want idle", body["phase"])
	}
	signIn, _ := body["signIn"].(map[string]any)
	if signIn["kind"] != "signed-out" {
		t.Errorf("signIn = %v, want a machine holding none", signIn)
	}
	if body["tokenSet"] != false {
		t.Errorf("tokenSet = %v, want false", body["tokenSet"])
	}
}

func TestPressingSignInOpensTheBrowserAndTheConsoleWaits(t *testing.T) {
	console, opener, _ := serving(t)

	status, body, _ := call(t, console, http.MethodPost, "/api/sign-in")

	if status != http.StatusOK || body["phase"] != "waiting" {
		t.Fatalf("status = %d, body = %v, want a flow now open", status, body)
	}
	if opener.count() != 1 {
		t.Errorf("the browser was opened %d times, want once", opener.count())
	}
	if address, _ := body["address"].(string); !strings.HasPrefix(address, oauth.AuthorizeURL) {
		t.Errorf("address = %q, want cloudflare's own allow page", address)
	}
}

func TestASecondPressWhileOneIsOpenIsRefusedRatherThanOpeningASecondBrowser(t *testing.T) {
	console, opener, _ := serving(t)
	call(t, console, http.MethodPost, "/api/sign-in")

	status, body, _ := call(t, console, http.MethodPost, "/api/sign-in")

	if status != http.StatusConflict {
		t.Errorf("status = %d, want %d", status, http.StatusConflict)
	}
	if body["error"] == "" {
		t.Errorf("body = %v, names nothing the page can report", body)
	}
	if opener.count() != 1 {
		t.Errorf("the browser was opened %d times, want once", opener.count())
	}
}

func TestAllowingItInTheBrowserLeavesTheConsoleSignedInWithItsAccountList(t *testing.T) {
	console, _, bound := serving(t)

	allowed(t, console, bound)

	_, body, _ := call(t, console, http.MethodGet, "/api/sign-in")
	signIn, _ := body["signIn"].(map[string]any)
	if signIn["kind"] != "oauth" || signIn["email"] != "operator@example.org" {
		t.Errorf("signIn = %v, want the browser sign-in and the address it belongs to", signIn)
	}
	accounts, _ := signIn["accounts"].([]any)
	if len(accounts) != 1 {
		t.Fatalf("accounts = %v, want the one account both lists name", accounts)
	}
	named, _ := accounts[0].(map[string]any)
	if named["id"] != "an-account" || named["name"] != "hound-haven" {
		t.Errorf("account = %v, want the one cloudflare named", named)
	}
}

func TestNoAnswerThePageReadsCarriesTheCredential(t *testing.T) {
	console, _, bound := serving(t)
	allowed(t, console, bound)

	for _, one := range []struct{ method, path string }{
		{http.MethodGet, "/api/sign-in"},
		{http.MethodPost, "/api/sign-in"},
		{http.MethodPost, "/api/sign-in/stop"},
		{http.MethodPost, "/api/sign-out"},
	} {
		t.Run(one.method+" "+one.path, func(t *testing.T) {
			_, _, raw := call(t, console, one.method, one.path)
			if strings.Contains(raw, held) || strings.Contains(raw, "a-refresh-token") {
				t.Errorf("%s carries the credential", one.path)
			}
		})
	}
}

func TestASignInThisMachineCouldNotAnswerNamesWhatStoppedIt(t *testing.T) {
	// the one address cloudflare redirects to is taken by something, and "already answering" would
	// send the operator looking for a second console that may not be what is holding it.
	base, reads := cloudflare(t)
	flow := oauth.New(oauth.Options{
		Store: state.At(t.TempDir()),
		Base:  base,
		Listen: func() (net.Listener, error) {
			return nil, errors.New("something else is on the port")
		},
	})
	t.Cleanup(flow.Stop)

	status, body, _ := call(t, console(t, flow, reads), http.MethodPost, "/api/sign-in")

	if status != http.StatusConflict {
		t.Errorf("status = %d, want %d", status, http.StatusConflict)
	}
	if said, _ := body["error"].(string); !strings.Contains(said, "something else is on the port") {
		t.Errorf("error = %q, names nothing about what stopped it", said)
	}
}

func TestStoppingTheWaitLeavesNothingOnScreenAboutIt(t *testing.T) {
	console, _, _ := serving(t)
	call(t, console, http.MethodPost, "/api/sign-in")

	status, body, _ := call(t, console, http.MethodPost, "/api/sign-in/stop")

	if status != http.StatusOK || body["phase"] != "idle" {
		t.Errorf("status = %d, body = %v, want nothing waiting and nothing to report", status, body)
	}
}

func TestSigningOutLeavesTheMachineHoldingNothing(t *testing.T) {
	console, _, bound := serving(t)
	allowed(t, console, bound)

	status, _, _ := call(t, console, http.MethodPost, "/api/sign-out")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	_, body, _ := call(t, console, http.MethodGet, "/api/sign-in")
	signIn, _ := body["signIn"].(map[string]any)
	if signIn["kind"] != "signed-out" {
		t.Errorf("signIn = %v, want a machine holding none", signIn)
	}
}

func TestSigningOutIsNotEvenAnEndpointWhileTheEnvironmentHoldsTheToken(t *testing.T) {
	// the page hides the control, and this is the other half of the same absence: there is nothing
	// on this machine to forget, and what is in use came from the terminal the console was started
	// in.
	t.Setenv(oauth.TokenVar, "an-inherited-token")
	console, _, _ := serving(t)

	status, body, _ := call(t, console, http.MethodPost, "/api/sign-out")

	if status != http.StatusNotFound {
		t.Errorf("status = %d, want %d", status, http.StatusNotFound)
	}
	if body["error"] == "" {
		t.Errorf("body = %v, names nothing", body)
	}
}

func TestATokenInTheEnvironmentIsWhatTheConsoleIsSignedInWith(t *testing.T) {
	t.Setenv(oauth.TokenVar, "an-inherited-token")
	console, _, _ := serving(t)

	_, body, _ := call(t, console, http.MethodGet, "/api/sign-in")

	if body["tokenSet"] != true {
		t.Errorf("tokenSet = %v, want the environment's own token reported as one", body["tokenSet"])
	}
	signIn, _ := body["signIn"].(map[string]any)
	if signIn["kind"] != "token" {
		t.Errorf("signIn = %v, want a sign-in offering no way out of itself", signIn)
	}
}

// a sign-in cloudflare allowed and this machine could not write down names the folder it could not
// write into.
//
// The sentence the panel draws sends the operator to make that folder writable, and a sentence
// about "the folder it keeps its records in" that does not say which folder is one they cannot act
// on: the directory is the operating system's own config home and is not somewhere they have been.
func TestASignInThatCouldNotBeKeptNamesTheFolderItWouldHaveGoneIn(t *testing.T) {
	base, reads := cloudflare(t)
	// a path with a file in the middle of it, so creating the directory fails however the machine
	// is set up.
	blocked := filepath.Join(t.TempDir(), "not-a-directory", "records")
	if err := os.WriteFile(filepath.Dir(blocked), []byte("taken"), 0o600); err != nil {
		t.Fatal(err)
	}
	records := state.At(blocked)

	bound := &callback{}
	flow := oauth.New(oauth.Options{
		Store:  records,
		Base:   base,
		Open:   (&browser{}).open,
		Waits:  5 * time.Second,
		Listen: bound.bind,
	})
	t.Cleanup(flow.Stop)

	console := consoleRecording(t, flow, reads, records)
	_, started, _ := call(t, console, http.MethodPost, "/api/sign-in")
	address, _ := started["address"].(string)
	stated := strings.SplitN(address, "?", 2)
	if len(stated) != 2 {
		t.Fatalf("address = %q, want the allow page with this flow's state on it", address)
	}
	answer, err := http.Get(bound.at() + "?" + stated[1] + "&code=a-code")
	if err != nil {
		t.Fatalf("the callback was not listening: %v", err)
	}
	answer.Body.Close()

	var body map[string]any
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, read, _ := call(t, console, http.MethodGet, "/api/sign-in"); read["phase"] == "unfinished" {
			body = read
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if body == nil {
		t.Fatal("the console never reported the sign-in as unfinished")
	}
	if body["why"] != "not-kept" {
		t.Fatalf("why = %v, want the sign-in that could not be written down", body["why"])
	}
	if body["detail"] != blocked {
		t.Errorf("detail = %v, want the folder the record would have gone in", body["detail"])
	}
}
