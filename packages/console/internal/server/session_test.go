package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
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
