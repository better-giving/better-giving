package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/hangup/hanguptest"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the press that opens this console's session on the deployment.

// a cloudflare answering for a worker that is deployed and answers on its own workers.dev address,
// and counting every write of a credential it was sent.
func connectable(t *testing.T, writes *atomic.Int64) *httptest.Server {
	t.Helper()
	base := "/accounts/an-account/workers"
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result := map[string]any{}
		switch r.URL.Path {
		case base + "/scripts/" + release.Baked.Name + "/subdomain":
			result = map[string]any{"enabled": true}
		case base + "/domains":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true, "errors": []any{}, "result": []any{},
			})
			return
		case base + "/subdomain":
			result = map[string]any{"subdomain": "hound-haven"}
		case base + "/scripts/" + release.Baked.Name + "/secrets-bulk":
			writes.Add(1)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "errors": []any{}, "result": result,
		})
	}))
	t.Cleanup(api.Close)
	return api
}

func connecting(t *testing.T, chosen string, api *httptest.Server) (http.Handler, state.Store) {
	t.Helper()
	records, flow, accounts := machine(t, chosen)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Surface:  func(string, string) cf.Send { return cf.JSONSend(api.URL, nil) },
	}), records
}

// what the press leaves behind is a session on this machine that the deployment will read back.
func TestAConnectPressMintsAndStoresASession(t *testing.T) {
	var writes atomic.Int64
	handler, records := connecting(t, "an-account", connectable(t, &writes))

	status, answer := press(t, handler, "/api/session", `{}`)
	if status != http.StatusOK || answer["kind"] != "connected" {
		t.Fatalf("%d %v", status, answer)
	}
	if answer["origin"] != "https://"+release.Baked.Name+".hound-haven.workers.dev" {
		t.Fatalf("connected at %v", answer["origin"])
	}
	if answer["expiresAt"] == "" {
		t.Fatal("the answer says nothing about when the session ends")
	}
	// the credential itself reaches no answer: what a screen may know is when the session ends and
	// where it was written.
	for name, held := range answer {
		said, isText := held.(string)
		if !isText {
			continue
		}
		if _, isToken := session.Parse(said); isToken {
			t.Fatalf("%s carries the credential", name)
		}
	}
	if session.Held(records, release.Baked.Name, time.Now()) == nil {
		t.Fatal("nothing was recorded on this machine")
	}
}

// the press answers once the deployment reads the session it recorded back, so the reading the page
// takes after it is not refused by a worker still holding the value before it.
func TestAConnectPressWaitsOnTheDeploymentTakingTheSession(t *testing.T) {
	var writes atomic.Int64
	api := connectable(t, &writes)
	records, flow, accounts := machine(t, "an-account")
	var asked atomic.Int64
	var bearer atomic.Value
	handler := New(Options{
		UI: http.NotFoundHandler(), Flow: flow, Accounts: accounts, Records: records,
		Reads:   func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches: func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Surface: func(_, token string) cf.Send {
			return func(context.Context, string, string, any) cf.Answer {
				bearer.Store(token)
				if asked.Add(1) < 2 {
					return cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{}}
				}
				return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{}}
			}
		},
	})

	status, _ := press(t, handler, "/api/session", `{}`)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	held := session.Held(records, release.Baked.Name, time.Now())
	if held == nil {
		t.Fatal("nothing was recorded on this machine")
	}
	if asked.Load() != 2 || bearer.Load() != held.Token {
		t.Fatalf("asked the deployment %d times, not until it took the recorded session", asked.Load())
	}
}

// two presses in flight are one session: two writes would leave this console holding whichever
// token it recorded last while the deployment holds whichever was written last.
func TestTwoConnectPressesInFlightProduceOneSession(t *testing.T) {
	var writes atomic.Int64
	// the second press is made while the first is inside the write, so the fake holds every call
	// until both requests are under way.
	holding := make(chan struct{})
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result := map[string]any{}
		base := "/accounts/an-account/workers"
		switch r.URL.Path {
		case base + "/scripts/" + release.Baked.Name + "/subdomain":
			result = map[string]any{"enabled": true}
		case base + "/subdomain":
			result = map[string]any{"subdomain": "hound-haven"}
		case base + "/scripts/" + release.Baked.Name + "/secrets-bulk":
			<-holding
			writes.Add(1)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "errors": []any{}, "result": result,
		})
	}))
	t.Cleanup(api.Close)

	records, flow, accounts := machine(t, "an-account")
	handler := New(Options{
		UI: http.NotFoundHandler(), Flow: flow, Accounts: accounts, Records: records,
		Reads:   func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches: func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Surface: func(string, string) cf.Send { return cf.JSONSend(api.URL, nil) },
	})

	answers := make([]map[string]any, 2)
	var pressing sync.WaitGroup
	pressing.Add(2)
	for at := range answers {
		go func() {
			defer pressing.Done()
			request := httptest.NewRequest(http.MethodPost, "/api/session", nil)
			request.Host = loopback
			recorded := httptest.NewRecorder()
			handler.ServeHTTP(recorded, request)
			var body map[string]any
			_ = json.Unmarshal(recorded.Body.Bytes(), &body)
			answers[at] = body
		}()
	}
	close(holding)
	pressing.Wait()

	if writes.Load() != 1 {
		t.Fatalf("%d sessions were written", writes.Load())
	}
	if answers[0]["kind"] != "connected" || answers[1]["kind"] != "connected" {
		t.Fatalf("answered %v and %v", answers[0], answers[1])
	}
}

// a press that panicked must not leave the next one waiting on it.
func TestAConnectPressThatPanickedLeavesTheNextPressFreeToRun(t *testing.T) {
	presses := &connectPresses{}
	presses.joined(context.Background(), func(context.Context) deployment.Connection {
		panic("the press broke")
	})

	answered := make(chan deployment.Connection, 1)
	go func() {
		answered <- presses.joined(context.Background(), func(context.Context) deployment.Connection {
			return deployment.Connection{Kind: deployment.Connected}
		})
	}()
	select {
	case got := <-answered:
		if got.Kind != deployment.Connected {
			t.Fatalf("kind = %q, want the next press's own outcome", got.Kind)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the next press is still waiting on the one that panicked")
	}
}

// a request that joined a press that panicked was never told how it went, and an empty kind is a
// state no screen draws.
func TestARequestThatJoinedAPressThatPanickedIsAnsweredUnreachable(t *testing.T) {
	waiting := make(chan struct{})
	presses := &connectPresses{joining: func() { close(waiting) }}
	started, release := make(chan struct{}), make(chan struct{})
	go func() {
		presses.joined(context.Background(), func(context.Context) deployment.Connection {
			close(started)
			<-release
			panic("the press broke")
		})
	}()
	<-started

	answered := make(chan deployment.Connection, 1)
	go func() {
		answered <- presses.joined(context.Background(), func(context.Context) deployment.Connection {
			t.Error("the request ran a press of its own rather than joining the one running")
			return deployment.Connection{Kind: deployment.Connected}
		})
	}()
	// the joiner has to be waiting on the press before it breaks.
	<-waiting
	close(release)

	select {
	case got := <-answered:
		if got.Kind != deployment.ConnectUnreachable {
			t.Fatalf("kind = %q, want %q", got.Kind, deployment.ConnectUnreachable)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the request that joined is still waiting on the press that panicked")
	}
}

// the request that started a press that panicked is told what every request that joined it is,
// rather than having its connection dropped mid-answer.
func TestTheRequestWhosePressPanickedIsAnsweredUnreachable(t *testing.T) {
	presses := &connectPresses{}
	answered := make(chan deployment.Connection, 1)
	go func() {
		defer func() {
			if broke := recover(); broke != nil {
				t.Errorf("the panic reached the request that pressed: %v", broke)
				close(answered)
			}
		}()
		answered <- presses.joined(context.Background(), func(context.Context) deployment.Connection {
			panic("the press broke")
		})
	}()
	if got := <-answered; got.Kind != deployment.ConnectUnreachable {
		t.Fatalf("kind = %q, want %q", got.Kind, deployment.ConnectUnreachable)
	}
}

// the write is scoped to an account, so there is nowhere to write rather than a write that failed.
func TestAConnectPressIsRefusedForAMachineThatHasChosenNoAccount(t *testing.T) {
	var writes atomic.Int64
	handler, _ := connecting(t, "", connectable(t, &writes))

	status, body := press(t, handler, "/api/session", `{}`)
	if status != http.StatusConflict || body["error"] == nil {
		t.Fatalf("%d %v", status, body)
	}
	if writes.Load() != 0 {
		t.Fatal("a session was written for a machine that has chosen no account")
	}
}

// a stop waits out a connect press as it waits out the payments setup: torn mid-write, the press
// leaves a session live on the deployment that this machine never recorded.
func TestAStopWaitsForTheConnectPressInFlightToRecordItsSession(t *testing.T) {
	writing, holding := make(chan struct{}), make(chan struct{})
	var released sync.Once
	letGo := func() { released.Do(func() { close(holding) }) }
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result := map[string]any{}
		base := "/accounts/an-account/workers"
		switch r.URL.Path {
		case base + "/scripts/" + release.Baked.Name + "/subdomain":
			result = map[string]any{"enabled": true}
		case base + "/subdomain":
			result = map[string]any{"subdomain": "hound-haven"}
		case base + "/scripts/" + release.Baked.Name + "/secrets-bulk":
			close(writing)
			<-holding
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "errors": []any{}, "result": result,
		})
	}))
	t.Cleanup(api.Close)
	// registered after api.Close so it runs first: a failure before the release would otherwise
	// leave the fake's handler held and the close waiting on it.
	t.Cleanup(letGo)

	records, flow, accounts := machine(t, "an-account")
	presses := &Presses{}
	handler := New(Options{
		UI: http.NotFoundHandler(), Flow: flow, Accounts: accounts, Records: records,
		Reads:   func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches: func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Surface: func(string, string) cf.Send { return cf.JSONSend(api.URL, nil) },
		Presses: presses,
	})

	answered := pressedAway(handler, "/api/session")
	<-writing
	presses.Stop()

	said, going := presses.Going()
	if !going || said == "" {
		t.Fatal("the stop reads no press going while a connect press is inside its write")
	}

	letGo()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, going := presses.Going(); !going {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the connect press still reads as going after its write was answered")
		}
		time.Sleep(time.Millisecond)
	}
	if session.Held(records, release.Baked.Name, time.Now()) == nil {
		t.Fatal("the stop read the press as ended before it recorded the session it wrote")
	}
	if recorded := <-answered; recorded.Code != http.StatusOK {
		t.Fatalf("status %d: %s", recorded.Code, recorded.Body.String())
	}
}

// a press made off the test goroutine, whose answer is read back on it: press's t.Fatalf may only
// run on the goroutine the test is on.
func pressedAway(handler http.Handler, path string) <-chan *httptest.ResponseRecorder {
	answered := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		request.Host = loopback
		request.Header.Set("Content-Type", "application/json")
		recorded := httptest.NewRecorder()
		handler.ServeHTTP(recorded, request)
		answered <- recorded
	}()
	return answered
}

// a stop cuts short the wait for the deployment's edge to take a session this machine has already
// recorded: nothing is left to tear, and the terminal would otherwise sit out
// deployment.SessionBound.
func TestAStopDuringTheEdgeWaitAfterTheRecordEndsThePress(t *testing.T) {
	var writes atomic.Int64
	api := connectable(t, &writes)
	records, flow, accounts := machine(t, "an-account")
	asking := make(chan struct{})
	var asked sync.Once
	presses := &Presses{}
	handler := New(Options{
		UI: http.NotFoundHandler(), Flow: flow, Accounts: accounts, Records: records,
		Reads:   func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches: func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		// an edge that never takes the session, so the press waits until something ends the wait.
		Surface: func(string, string) cf.Send {
			return func(context.Context, string, string, any) cf.Answer {
				asked.Do(func() { close(asking) })
				return cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{}}
			}
		},
		Presses: presses,
	})

	answered := pressedAway(handler, "/api/session")
	<-asking
	if session.Held(records, release.Baked.Name, time.Now()) == nil {
		t.Fatal("the edge was asked before the session was recorded")
	}
	presses.Stop()

	select {
	case recorded := <-answered:
		var answer map[string]any
		if err := json.Unmarshal(recorded.Body.Bytes(), &answer); err != nil {
			t.Fatalf("answered %q", recorded.Body.String())
		}
		if recorded.Code != http.StatusOK || answer["kind"] != string(deployment.Connected) {
			t.Fatalf("%d %v, want the press to end connected as the bound running out would",
				recorded.Code, answer)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the press is still waiting on the edge after the stop")
	}
	if _, going := presses.Going(); going {
		t.Fatal("the press reads as going after it answered")
	}
}

// a closed terminal ends this process only once the connect press has ended, so the session it
// wrote on the deployment is recorded on this machine first.
func TestAHangUpDuringAConnectPressIsHeldUntilThePressEnds(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		presses := &connectPresses{}
		presses.joined(context.Background(), func(context.Context) deployment.Connection {
			hanguptest.HangUp()
			fmt.Println("the press recorded its session")
			return deployment.Connection{Kind: deployment.Connected}
		})
		fmt.Println("the process went on")
	})
	if !strings.Contains(said, "the press recorded its session") {
		t.Errorf("printed %q, want the press to outlive a hang-up", said)
	}
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want the hang-up to end the process at the press's end",
			said, ended)
	}
}
