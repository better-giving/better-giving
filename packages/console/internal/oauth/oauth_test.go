package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
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

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/state"
)

// the sign-in this binary runs, which is cloudflare's own browser "allow" and nothing else.
//
// what every case here is really about is that the credential stays in this process: it is written
// 0600 into the state directory, it is refreshed without anybody being asked again, and no address,
// no phase and no page it draws ever carries it.

// a cloudflare that answers the two oauth calls, recording every form it was sent.
type dash struct {
	mutex sync.Mutex
	// forms is the body of every token or revoke call, in order.
	forms []url.Values
	// paths is which of them each was.
	paths []string

	// holds is an exchange the test releases, so a case about two callbacks can send the second
	// one while the first is still in flight. nil is a dashboard that answers straight away.
	holds chan struct{}

	// refuses is an exchange or refresh cloudflare turns down.
	refuses bool
	// access is what the next exchange or refresh hands back.
	access string
	// expires is how long that one lasts.
	expires int
}

func (held *dash) serve(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		held.mutex.Lock()
		held.forms = append(held.forms, form)
		held.paths = append(held.paths, r.URL.Path)
		refuses, access, expires := held.refuses, held.access, held.expires
		held.mutex.Unlock()

		if r.URL.Path == "/oauth2/revoke" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if held.holds != nil {
			<-held.holds
		}
		if refuses {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"expired"}`))
			return
		}
		if access == "" {
			access = "an-access-token"
		}
		if expires == 0 {
			expires = 3600
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  access,
			"refresh_token": "a-refresh-token",
			"expires_in":    expires,
			"token_type":    "bearer",
			"scope":         strings.Join(Scopes, " "),
		})
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func (held *dash) sent(path string) []url.Values {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	found := []url.Values{}
	for at, one := range held.paths {
		if one == path {
			found = append(found, held.forms[at])
		}
	}
	return found
}

// where a browser was opened, guarded because the flow opens it from a press's own goroutine.
type opened struct {
	mutex sync.Mutex
	at    []string
}

func (one *opened) open(address string) {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	one.at = append(one.at, address)
}

func (one *opened) count() int {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return len(one.at)
}

// this machine's clock, movable, because what a stored credential's expiry is read against is the
// one thing a case about refreshing cannot wait for.
type clock struct {
	mutex sync.Mutex
	past  time.Duration
}

func (one *clock) now() time.Time {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return time.Now().Add(one.past)
}

func (one *clock) skip(past time.Duration) {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	one.past = past
}

// the flow under test, and the callback its listener bound.
//
// **the port is the operating system's to choose here and the registered one in production.** the
// cases in this file run alongside each other and alongside whatever the contributor has open, and
// a fixed port makes any two of those the same failure. What the redirect_uri states is asserted
// separately, and is the registered address whatever this binds.
type running struct {
	*Flow
	mutex sync.Mutex
	at    string
}

func (one *running) bind() (net.Listener, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	one.mutex.Lock()
	one.at = "http://" + listener.Addr().String() + callbackPath
	one.mutex.Unlock()
	return listener, nil
}

func (one *running) callbackAt() string {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return one.at
}

// one flow over the options a case states, on a callback of this test's own.
func opening(t *testing.T, options Options) *running {
	t.Helper()
	one := &running{}
	options.Listen = one.bind
	one.Flow = New(options)
	t.Cleanup(one.Stop)
	return one
}

// one flow, against a fake dashboard and a state directory of this test's own.
func flowing(t *testing.T, held *dash) (*running, *opened, state.Store, *clock) {
	t.Helper()
	dir := t.TempDir()
	browser := &opened{}
	ticking := &clock{}
	flow := opening(t, Options{
		Store: state.At(dir),
		Base:  held.serve(t),
		Open:  browser.open,
		Waits: 5 * time.Second,
		Now:   ticking.now,
	})
	return flow, browser, state.At(dir), ticking
}

// the flow, waiting, with the address it opened.
func started(t *testing.T, flow *running) string {
	t.Helper()
	phase, opened, err := flow.Start()
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !opened {
		t.Fatal("the press did not open a flow of its own")
	}
	if phase.Name != Waiting {
		t.Fatalf("phase = %q, want %q", phase.Name, Waiting)
	}
	return phase.Address
}

// what cloudflare redirects the browser back with, under the state the allow page carried.
func back(t *testing.T, address string, over url.Values) url.Values {
	t.Helper()
	stated, err := url.Parse(address)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	sent := url.Values{"code": {"a-code"}, "state": {stated.Query().Get("state")}}
	for name, value := range over {
		sent[name] = value
	}
	return sent
}

// what cloudflare redirects the browser to once the operator has allowed it.
func allow(t *testing.T, flow *running, address string, over url.Values) *http.Response {
	t.Helper()
	answer, err := http.Get(flow.callbackAt() + "?" + back(t, address, over).Encode())
	if err != nil {
		t.Fatalf("the callback was not listening: %v", err)
	}
	t.Cleanup(func() { answer.Body.Close() })
	return answer
}

// the phase, once it has stopped being `waiting`, or the one it was stuck at.
func settled(t *testing.T, flow *running) Phase {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if phase := flow.Phase(); phase.Name != Waiting {
			return phase
		}
		time.Sleep(5 * time.Millisecond)
	}
	return flow.Phase()
}

func TestTheAddressIsCloudflaresOwnAllowPageWithThisFlowsChallengeOnIt(t *testing.T) {
	flow, _, _, _ := flowing(t, &dash{})
	address := started(t, flow)

	stated, err := url.Parse(address)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	asked := stated.Query()
	if want := AuthorizeURL; !strings.HasPrefix(address, want) {
		t.Errorf("address = %q, want it to open %q", address, want)
	}
	// the callback the client id is registered for, and no other: cloudflare refuses a redirect
	// uri it was not registered with, so this is the one string here that cannot be chosen — and it
	// is the registered address even though this flow's listener is on a port of this test's own.
	if asked.Get("redirect_uri") != CallbackURL {
		t.Errorf("redirect_uri = %q, want %q", asked.Get("redirect_uri"), CallbackURL)
	}
	if asked.Get("client_id") != ClientID {
		t.Errorf("client_id = %q, want %q", asked.Get("client_id"), ClientID)
	}
	if asked.Get("response_type") != "code" || asked.Get("code_challenge_method") != "S256" {
		t.Errorf("asked = %v, want an authorization code under pkce", asked)
	}
	if asked.Get("code_challenge") == "" || asked.Get("state") == "" {
		t.Errorf("asked = %v, want a challenge and a state on it", asked)
	}
	if got := strings.Fields(asked.Get("scope")); len(got) != len(Scopes) {
		t.Errorf("scope = %q, want %q", asked.Get("scope"), strings.Join(Scopes, " "))
	}
}

func TestTheBrowserIsOpenedOnceAndASecondPressOpensNoSecondOne(t *testing.T) {
	// a second flow would bind the same loopback callback and fail, so what the refusal prevents is
	// not a duplicate but an error the operator did nothing to cause.
	flow, browser, _, _ := flowing(t, &dash{})
	address := started(t, flow)

	again, opened, err := flow.Start()
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if opened {
		t.Error("the second press opened a flow of its own")
	}
	if again.Name != Waiting || again.Address != address {
		t.Errorf("phase = %+v, want the flow already open", again)
	}
	if browser.count() != 1 {
		t.Errorf("the browser was opened %d times, want once", browser.count())
	}
}

func TestAllowingItInTheBrowserExchangesTheCodeForTheVerifierThisFlowKept(t *testing.T) {
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	address := started(t, flow)

	allow(t, flow, address, nil)

	if phase := settled(t, flow); phase.Name != Idle {
		t.Errorf("phase = %+v, want a flow that finished", phase)
	}
	sent := held.sent("/oauth2/token")
	if len(sent) != 1 {
		t.Fatalf("the token endpoint was called %d times, want once", len(sent))
	}
	form := sent[0]
	if form.Get("grant_type") != "authorization_code" || form.Get("code") != "a-code" {
		t.Errorf("form = %v, want the code this flow was handed", form)
	}
	if form.Get("redirect_uri") != CallbackURL || form.Get("client_id") != ClientID {
		t.Errorf("form = %v, want the registered client and callback", form)
	}
	// the whole of pkce: the verifier never left this process until now, and it is what proves the
	// exchange is being made by whoever opened the browser.
	stated, _ := url.Parse(address)
	sum := sha256.Sum256([]byte(form.Get("code_verifier")))
	if got := base64.RawURLEncoding.EncodeToString(sum[:]); got != stated.Query().Get("code_challenge") {
		t.Errorf("code_verifier does not hash to the challenge the address carried")
	}

	credential := flow.Credential(context.Background())
	if credential.Kind != cf.BearerToken || credential.Token != "an-access-token" {
		t.Errorf("credential = %+v, want the access token cloudflare handed back", credential.Kind)
	}
	if read, err := store.Read(Record); err != nil || len(read) == 0 {
		t.Errorf("nothing was written to the state directory: %v", err)
	}
}

func TestTheStoredCredentialIsReadableByNobodyElseOnThisMachine(t *testing.T) {
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	info, err := os.Stat(filepath.Join(store.Dir(), Record))
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode = %04o, want 0600", mode)
	}
}

func TestNothingTheCallbackAnswersWithCarriesTheCredential(t *testing.T) {
	held := &dash{}
	flow, _, _, _ := flowing(t, held)
	answer := allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	body, _ := io.ReadAll(answer.Body)
	if strings.Contains(string(body), "an-access-token") ||
		strings.Contains(string(body), "a-refresh-token") {
		t.Error("the page cloudflare redirects to carries the credential")
	}
}

func TestACallbackCarryingAnotherFlowsStateIsRefused(t *testing.T) {
	// the state is what ties the browser cloudflare sent back to the press that opened it: without
	// it any page could hand this listener a code of its own.
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	address := started(t, flow)

	allow(t, flow, address, url.Values{"state": {"somebody-elses-state"}})

	if phase := flow.Phase(); phase.Name != Waiting {
		t.Errorf("phase = %+v, want the flow still waiting on its own callback", phase)
	}
	if len(held.sent("/oauth2/token")) != 0 {
		t.Error("a code arriving under another state was exchanged")
	}
	if read, _ := store.Read(Record); len(read) != 0 {
		t.Error("a credential was written for a callback this flow did not open")
	}
}

func TestTurningItDownInTheBrowserLeavesTheScreenSayingSo(t *testing.T) {
	held := &dash{}
	flow, _, _, _ := flowing(t, held)
	address := started(t, flow)

	allow(t, flow, address, url.Values{
		"code":              {""},
		"error":             {"access_denied"},
		"error_description": {"The user denied the request"},
	})

	phase := settled(t, flow)
	if phase.Name != Unfinished || phase.Why != Refused {
		t.Errorf("phase = %+v, want a sign-in that was turned down", phase)
	}
}

func TestAFlowNobodyFinishesGivesUpAndSaysWhichOfTheThreeHappened(t *testing.T) {
	flow := opening(t, Options{
		Store: state.At(t.TempDir()),
		Base:  (&dash{}).serve(t),
		Waits: 20 * time.Millisecond,
	})
	started(t, flow)

	phase := settled(t, flow)
	if phase.Name != Unfinished || phase.Why != TimedOut {
		t.Errorf("phase = %+v, want a flow that gave up waiting", phase)
	}
}

func TestStoppingWaitingLeavesNothingToReport(t *testing.T) {
	flow, _, _, _ := flowing(t, &dash{})
	started(t, flow)

	flow.Stop()

	if phase := flow.Phase(); phase.Name != Idle {
		t.Errorf("phase = %+v, want nothing on screen about a sign-in nobody asked for", phase)
	}
}

func TestTheNextPressAfterAnUnfinishedFlowStartsAFreshOne(t *testing.T) {
	held := &dash{}
	flow, browser, _, _ := flowing(t, held)
	first := started(t, flow)
	flow.Stop()

	second := started(t, flow)

	if second == first {
		t.Error("the second press reopened the first flow's address")
	}
	if browser.count() != 2 {
		t.Errorf("the browser was opened %d times, want one per press", browser.count())
	}
}

func TestAnExpiredAccessTokenIsRefreshedWithoutTheOperatorNoticing(t *testing.T) {
	held := &dash{expires: 1}
	flow, _, store, ticking := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	held.mutex.Lock()
	held.access, held.expires = "a-second-access-token", 3600
	held.mutex.Unlock()
	// past what cloudflare said it lasts, which is the state the console meets whenever it is
	// opened again the next day.
	ticking.skip(time.Hour)

	credential := flow.Credential(context.Background())

	if credential.Token != "a-second-access-token" {
		t.Error("the expired token was used rather than refreshed")
	}
	refreshed := held.sent("/oauth2/token")
	if len(refreshed) != 2 || refreshed[1].Get("grant_type") != "refresh_token" {
		t.Errorf("calls = %v, want a refresh on the stored refresh token", refreshed)
	}
	if refreshed[1].Get("refresh_token") != "a-refresh-token" {
		t.Errorf("form = %v, want the refresh token that was stored", refreshed[1])
	}
	// the new pair is what a later run reads, so a refresh that was not written down is a refresh
	// paid for again every time the console is opened.
	read, _ := store.Read(Record)
	if !strings.Contains(string(read), "a-second-access-token") {
		t.Error("the refreshed credential was not written down")
	}
}

func TestACredentialThatHasNotExpiredIsNotRefreshed(t *testing.T) {
	held := &dash{}
	flow, _, _, _ := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	flow.Credential(context.Background())

	if len(held.sent("/oauth2/token")) != 1 {
		t.Error("a credential that is still good was refreshed anyway")
	}
}

func TestARefreshCloudflareTurnsDownLeavesCloudflareToSayWhatIsWrong(t *testing.T) {
	// the stored access token is carried on rather than dropped: cloudflare's own refusal is what
	// tells an expired sign-in from a network that is down, and dropping it here would draw the
	// second as the first.
	held := &dash{expires: 1}
	flow, _, _, ticking := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	held.mutex.Lock()
	held.refuses = true
	held.mutex.Unlock()
	ticking.skip(time.Hour)

	credential := flow.Credential(context.Background())

	if credential.Kind != cf.BearerToken || credential.Token != "an-access-token" {
		t.Errorf("credential = %q, want the stored token left for cloudflare to classify", credential.Kind)
	}
}

func TestARefreshThatCouldNotBeWrittenDownIsReportedRatherThanSwallowed(t *testing.T) {
	// the token that came back is good for the call being made now and is used; what is gone is the
	// pair the next run reads, so a console that said nothing here is one whose operator meets a
	// sign-out at the next launch with nothing on screen naming the folder to repair.
	held := &dash{expires: 1}
	flow, _, store, ticking := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	held.mutex.Lock()
	held.access, held.expires = "a-second-access-token", 3600
	held.mutex.Unlock()
	// the state directory as it stands on a machine whose config home has gone read-only.
	if err := os.Chmod(store.Dir(), 0o500); err != nil {
		t.Fatalf("Chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(store.Dir(), 0o700) })
	ticking.skip(time.Hour)

	credential := flow.Credential(context.Background())

	if credential.Token != "a-second-access-token" {
		t.Error("the refreshed token was dropped, so the call being made now pays for the write that failed")
	}
	if phase := flow.Phase(); phase.Why != NotKept {
		t.Errorf("phase = %+v, want the sign-in saying it could not be kept", phase)
	}
}

func TestASignInThatCouldNotBeWrittenDownIsNotASignIn(t *testing.T) {
	// every read of the credential goes through the record, so a write that failed leaves this
	// machine holding nothing — and a run that said "signed in" would be the only copy of a token
	// nobody can ask for again.
	held := &dash{}
	nowhere := filepath.Join(t.TempDir(), "in-the-way")
	if err := os.WriteFile(nowhere, []byte("a file where the directory would go"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	flow := opening(t, Options{
		Store: state.At(nowhere),
		Base:  held.serve(t),
		Waits: 5 * time.Second,
	})

	allow(t, flow, started(t, flow), nil)

	phase := settled(t, flow)
	if phase.Name != Unfinished || phase.Why != NotKept {
		t.Errorf("phase = %+v, want a sign-in that could not be kept", phase)
	}
	if credential := flow.Credential(context.Background()); credential.Kind != cf.NoCredential {
		t.Errorf("credential = %q, want a machine holding none", credential.Kind)
	}
}

func TestTheSameCodeArrivingTwiceIsExchangedOnce(t *testing.T) {
	// a reloaded redirect is a second callback under the state this flow minted, and an exchange
	// per arrival is a second round trip cloudflare answers for a code it has already spent.
	held := &dash{holds: make(chan struct{})}
	flow, _, _, _ := flowing(t, held)
	address := started(t, flow)

	first := allow(t, flow, address, nil)
	second := allow(t, flow, address, nil)
	close(held.holds)
	settled(t, flow)

	if first.StatusCode != http.StatusOK {
		t.Errorf("the first callback answered %d, want it taken", first.StatusCode)
	}
	if second.StatusCode != http.StatusBadRequest {
		t.Errorf("the second callback answered %d, want it dropped", second.StatusCode)
	}
	if sent := held.sent("/oauth2/token"); len(sent) != 1 {
		t.Errorf("the token endpoint was called %d times, want once", len(sent))
	}
}

func TestSigningOutEndsASignInStillOpenInABrowser(t *testing.T) {
	// what the operator asked for is that this machine hold no sign-in, and a wait left running
	// would answer the callback afterwards and write one.
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	address := started(t, flow)

	if err := flow.Out(context.Background()); err != nil {
		t.Fatalf("Out: %v", err)
	}
	// the listener went down with the flow, so this is a browser coming back to nothing — which is
	// the whole of what it costs.
	if answer, err := http.Get(flow.callbackAt() + "?" + back(t, address, nil).Encode()); err == nil {
		answer.Body.Close()
	}

	if phase := flow.Phase(); phase.Name != Idle {
		t.Errorf("phase = %+v, want nothing waiting after signing out", phase)
	}
	if sent := held.sent("/oauth2/token"); len(sent) != 0 {
		t.Error("a code arriving after signing out was exchanged")
	}
	if read, _ := store.Read(Record); len(read) != 0 {
		t.Error("a credential was written after signing out")
	}
}

func TestAMachineWithNothingStoredHoldsNoCredential(t *testing.T) {
	flow, _, _, _ := flowing(t, &dash{})

	credential := flow.Credential(context.Background())

	if credential.Kind != cf.NoCredential {
		t.Errorf("credential = %q, want %q", credential.Kind, cf.NoCredential)
	}
	if flow.TokenSet() {
		t.Error("an environment token was reported on a machine that has none")
	}
}

func TestATokenSetInTheEnvironmentOverridesWhateverIsStored(t *testing.T) {
	held := &dash{}
	flow, _, _, _ := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)
	t.Setenv(TokenVar, "an-inherited-token")

	credential := flow.Credential(context.Background())

	if credential.Kind != cf.BearerToken || credential.Token != "an-inherited-token" {
		t.Errorf("credential = %+v, want the environment's own token", credential.Kind)
	}
	if !flow.TokenSet() {
		t.Error("the environment token was not reported as one")
	}
}

func TestSigningOutIsRefusedWhileTheEnvironmentHoldsTheToken(t *testing.T) {
	// there is nothing on this machine to forget: what is in use came from the terminal the console
	// was started in, and the control is not drawn at all.
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)
	t.Setenv(TokenVar, "an-inherited-token")

	if err := flow.Out(context.Background()); err == nil {
		t.Error("signing out was allowed against a token this console did not store")
	}
	if read, _ := store.Read(Record); len(read) == 0 {
		t.Error("the stored credential was forgotten anyway")
	}
}

func TestSigningOutRevokesTheSignInAndForgetsIt(t *testing.T) {
	held := &dash{}
	flow, _, store, _ := flowing(t, held)
	allow(t, flow, started(t, flow), nil)
	settled(t, flow)

	if err := flow.Out(context.Background()); err != nil {
		t.Fatalf("Out: %v", err)
	}

	// both halves: the refresh token is what another access token would be taken on, and the access
	// token already in hand outlives it by up to its own hour.
	revoked := held.sent("/oauth2/revoke")
	if len(revoked) != 2 {
		t.Fatalf("revoked = %v, want both halves of the pair handed back to cloudflare", revoked)
	}
	if revoked[0].Get("token") != "a-refresh-token" || revoked[1].Get("token") != "an-access-token" {
		t.Errorf("revoked = %v, want both halves of the pair handed back to cloudflare", revoked)
	}
	if read, _ := store.Read(Record); len(read) != 0 {
		t.Error("the credential is still on this machine after signing out")
	}
	if flow.Credential(context.Background()).Kind != cf.NoCredential {
		t.Error("the credential is still held after signing out")
	}
}

func TestAFailureAtCloudflareIsNotTheOperatorTurningTheSignInDown(t *testing.T) {
	// ../terminal's Refused sentence tells the operator they turned the sign-in down and the
	// command it reaches ends cleanly on it, so a failure at cloudflare's end reported as a cancel
	// is a press the operator never made, said back to them as one they did.
	for _, refusal := range []string{"server_error", "temporarily_unavailable", "invalid_request"} {
		flow, _, _, _ := flowing(t, &dash{})
		address := started(t, flow)

		allow(t, flow, address, url.Values{"code": {""}, "error": {refusal}})

		phase := settled(t, flow)
		if phase.Name != Unfinished || phase.Why != NothingBack {
			t.Errorf("%q = %+v, want a flow that ended some other way", refusal, phase)
		}
	}
}
