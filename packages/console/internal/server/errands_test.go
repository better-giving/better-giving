package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the seven errands this console proxies to the deployment, and the session they all ride.

// a token far enough out that a case never meets an expired session.
const errandToken = "bg1.99999999999.0123456789012345678901234567890123456789012"

// one call the deployment was asked, as the fake below recorded it.
type errand struct {
	method string
	path   string
	bearer string
	body   map[string]any
}

// an answer the deployment sends under a status of its own, where the status is what decides the
// arm a console draws.
type refusal struct {
	status int
	body   map[string]any
}

// a deployment answering each path whatever a case bound it to, and remembering what it was asked.
func deployed(t *testing.T, answers map[string]any) (*httptest.Server, func() []errand) {
	t.Helper()
	asked := []errand{}
	var recording sync.Mutex
	surface := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		recording.Lock()
		asked = append(asked, errand{
			method: r.Method, path: r.URL.Path,
			bearer: r.Header.Get("Authorization"), body: body,
		})
		recording.Unlock()

		held, named := answers[r.Method+" "+r.URL.Path]
		if !named {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if under, coded := held.(refusal); coded {
			w.WriteHeader(under.status)
			_ = json.NewEncoder(w).Encode(under.body)
			return
		}
		_ = json.NewEncoder(w).Encode(held)
	}))
	t.Cleanup(surface.Close)
	return surface, func() []errand {
		recording.Lock()
		defer recording.Unlock()
		return append([]errand{}, asked...)
	}
}

// a console holding a session on `origin`, or holding none where it is empty.
func connected(t *testing.T, records state.Store, origin string) {
	t.Helper()
	if origin == "" {
		return
	}
	record, err := json.Marshal(map[string]string{
		"workerName": release.Baked.Name, "origin": origin, "token": errandToken,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(records.Dir(), session.File), record, 0o600); err != nil {
		t.Fatal(err)
	}
}

// what the deployment answers a write with, which is its own report.
func reported() map[string]any {
	return map[string]any{
		"sites":   []any{"https://hound-haven.org"},
		"org":     map[string]any{"legal_name": "Hound Haven"},
		"session": map[string]any{"expiresAt": "2026-09-01T00:00:00.000Z"},
	}
}

// a console signed in, holding an account and a session on the fake deployment.
func errands(t *testing.T, answers map[string]any, origin string) (http.Handler, func() []errand) {
	t.Helper()
	records, flow, accounts := machine(t, "an-account")
	surface, asked := deployed(t, answers)
	if origin == "here" {
		origin = surface.URL
	}
	connected(t, records, origin)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
	}), asked
}

// the profile goes whole, at the address that stores one, over the session this console holds.
func TestTheProfileIsPostedWholeOverTheSession(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org": reported()}, "here")

	status, answer := press(t, handler, "/api/deployment/org",
		`{"values":{"legal_name":"Hound Haven","city":"Leeds"}}`)
	if status != http.StatusOK || answer["kind"] != "saved" {
		t.Fatalf("%d %v", status, answer)
	}
	calls := asked()
	if len(calls) != 1 || calls[0].path != "/console/org" || calls[0].method != http.MethodPost {
		t.Fatalf("the deployment was asked %v", calls)
	}
	if calls[0].bearer != "Bearer "+errandToken {
		t.Fatalf("the session did not travel: %q", calls[0].bearer)
	}
	held, _ := calls[0].body["org"].(map[string]any)
	if held["legal_name"] != "Hound Haven" || held["city"] != "Leeds" {
		t.Fatalf("posted %v", calls[0].body)
	}
}

// a field this console draws no box for is refused before the deployment is asked: the sentence
// that comes back is drawn under the box its key names, and a key naming none is drawn nowhere.
func TestAFieldThisConsoleDrawsNoBoxForIsRefusedBeforeTheDeploymentIsAsked(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org": reported()}, "here")

	status, answer := press(t, handler, "/api/deployment/org", `{"values":{"favourite_colour":"blue"}}`)
	if status != http.StatusBadRequest || answer["error"] == nil {
		t.Fatalf("%d %v", status, answer)
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
	}
}

// a console holding no session says so in its own words rather than making a request with a bearer
// nobody filled in.
func TestEveryErrandWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	handler, asked := errands(t, map[string]any{}, "")

	for path, body := range map[string]string{
		"/api/deployment/org":        `{"values":{}}`,
		"/api/deployment/test-email": `{"to":"you@example.org"}`,
		"/api/deployment/recurring":  `{}`,
		"/api/deployment/sites":      `{"sites":[]}`,

		"/api/deployment/wallet-domains": `{}`,
	} {
		status, answer := press(t, handler, path, body)
		read, _ := answer["read"].(map[string]any)
		if status != http.StatusOK || read["kind"] != "no-session" {
			t.Errorf("%s answered %d %v", path, status, answer)
		}
	}
	for _, path := range []string{"/api/deployment/payments", "/api/deployment/recurring"} {
		status, answer := ask(t, handler, path)
		read, _ := answer["read"].(map[string]any)
		if status != http.StatusOK || read["kind"] != "no-session" {
			t.Errorf("%s answered %d %v", path, status, answer)
		}
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
	}
}

// a deployment that turned a value down and a deployment nobody could read are not the same answer,
// and each keeps the status it carries.
func TestARefusedProfileAndAnUnreachableDeploymentStayApart(t *testing.T) {
	handler, _ := errands(t, map[string]any{
		"POST /console/org": refusal{http.StatusUnprocessableEntity, map[string]any{
			"error": "org_refused", "message": "Not stored.", "fix": "Fix the fields named.",
			"errors": map[string]any{"legal_name": "Give the legal name."},
		}},
	}, "here")
	status, answer := press(t, handler, "/api/deployment/org", `{"values":{"legal_name":""}}`)
	if status != http.StatusOK || answer["kind"] != "refused" {
		t.Fatalf("%d %v", status, answer)
	}
	// the sentence lands at the box its key names, and the way out is carried beside it.
	keyed, _ := answer["errors"].(map[string]any)
	if keyed["legal_name"] == nil || answer["fix"] == nil {
		t.Fatalf("refusal %v", answer)
	}

	nowhere, _ := errands(t, map[string]any{}, "http://127.0.0.1:1")
	status, unreachable := press(t, nowhere, "/api/deployment/org", `{"values":{}}`)
	read, _ := unreachable["read"].(map[string]any)
	if status != http.StatusOK || read["kind"] != "unreachable" {
		t.Fatalf("%d %v", status, unreachable)
	}
}

func TestTheFiveOtherErrandsReachTheirOwnAddress(t *testing.T) {
	handler, asked := errands(t, map[string]any{
		"POST /console/test-email": map[string]any{"outcome": "sent", "to": "you@example.org"},
		// one entry per processor and always all of them, whether or not the deployment holds a
		// processor's credentials.
		"GET /console/payments": map[string]any{"processors": []any{
			map[string]any{
				"processor": "stripe", "label": "Stripe", "state": "configured",
				"rails": map[string]any{
					"state": "read", "chargesEnabled": true,
					"evidence": "per_rail_approval", "rails": []any{},
				},
				"webhook":      map[string]any{"state": "verifying"},
				"subscription": map[string]any{"state": "complete"},
				"wallets":      map[string]any{"state": "read", "hosts": []any{}},
			},
			map[string]any{
				"processor": "paypal", "label": "PayPal", "state": "unconfigured",
				"unset": []any{"PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"},
			},
		}},
		// one entry per processor the deployment holds the credentials for and none for one it does
		// not, which is where this parts company with the report above it.
		"GET /console/recurring": map[string]any{"processors": []any{
			map[string]any{
				"processor": "stripe", "label": "Stripe",
				"reading": map[string]any{"state": "ready"},
			},
			map[string]any{
				"processor": "paypal", "label": "PayPal",
				"reading": map[string]any{"state": "absent"},
			},
		}},
		// one press over every one of them, and the word over the whole is the worst of them.
		"POST /console/recurring": map[string]any{
			"outcome": "set_up",
			"processors": []any{
				map[string]any{
					"processor": "stripe", "label": "Stripe", "outcome": "already_set_up",
				},
				map[string]any{"processor": "paypal", "label": "PayPal", "outcome": "set_up"},
			},
		},
		"POST /console/sites":          reported(),
		"POST /console/wallet-domains": map[string]any{"state": "levelled", "hosts": []any{}},
	}, "here")

	if _, answer := press(t, handler, "/api/deployment/test-email", `{"to":"you@example.org"}`); answer["kind"] != "reported" {
		t.Errorf("the test send answered %v", answer)
	}
	if _, answer := ask(t, handler, "/api/deployment/payments"); answer["kind"] != "read" {
		t.Errorf("the payments read answered %v", answer)
	}
	if _, answer := ask(t, handler, "/api/deployment/recurring"); answer["kind"] != "read" {
		t.Errorf("the recurring read answered %v", answer)
	}
	if _, answer := press(t, handler, "/api/deployment/recurring", `{}`); answer["kind"] != "reported" {
		t.Errorf("the recurring press answered %v", answer)
	}
	// the operator's own press names no account and posts nothing: it is about every account the
	// deployment holds credentials for. What names one is the Stripe run's own step, seconds after
	// it stored that account's key (internal/stripe/setup.go).
	for _, call := range asked() {
		if call.path == deployment.RecurringPath && len(call.body) != 0 {
			t.Errorf("the recurring press posted %v", call.body)
		}
	}
	if _, answer := press(t, handler, "/api/deployment/sites", `{"sites":["https://hound-haven.org"]}`); answer["kind"] != "saved" {
		t.Errorf("the sites write answered %v", answer)
	}
	// no body: the hostnames are the deployment's own rows and its own address, and one that
	// travelled through a page would be a registration made against whatever the page said.
	if _, answer := press(t, handler, "/api/deployment/wallet-domains", `{}`); answer["kind"] != "reported" {
		t.Errorf("the wallet levelling answered %v", answer)
	}
	for _, call := range asked() {
		if call.path == "/console/wallet-domains" && len(call.body) != 0 {
			t.Errorf("the levelling posted %v", call.body)
		}
	}

	for _, call := range asked() {
		if call.bearer != "Bearer "+errandToken {
			t.Errorf("%s %s was asked without the session", call.method, call.path)
		}
	}
}

// the credential travels in a header and the url carries none, which is what makes a failure's own
// sentence safe to draw.
func TestNoErrandCarriesTheSessionOnTheAddress(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/sites": reported()}, "here")
	_, _ = press(t, handler, "/api/deployment/sites", `{"sites":[]}`)
	for _, call := range asked() {
		if call.path != "/console/sites" {
			t.Errorf("asked %q", call.path)
		}
	}
}

// nothing about the deployment reaches this file's own answers, and a body naming something else is
// refused rather than sent on.
func TestABodyThisConsoleWillNotActOnIsRefused(t *testing.T) {
	handler, asked := errands(t, map[string]any{}, "here")
	for path, body := range map[string]string{
		"/api/deployment/org":        `{"whatever":1}`,
		"/api/deployment/sites":      `{"sites":"one"}`,
		"/api/deployment/test-email": `not json`,
	} {
		if status, _ := press(t, handler, path, body); status != http.StatusBadRequest {
			t.Errorf("%s answered %d", path, status)
		}
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
	}
}

// the seam a case binds a deployment through, so that one can be answered for without a network.
func TestTheSurfaceIsTheSeamACaseBinds(t *testing.T) {
	records, flow, accounts := machine(t, "an-account")
	connected(t, records, "https://hound-haven.org")
	bound := ""
	handler := New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		Surface: func(origin, token string) cf.Send {
			bound = origin
			return func(_ context.Context, _, _ string, _ any) cf.Answer {
				return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
					"outcome": "sent", "to": "you@example.org",
				}}
			}
		},
	})

	if _, answer := press(t, handler, "/api/deployment/test-email", `{"to":"you@example.org"}`); answer["kind"] != "reported" {
		t.Fatalf("answered %v", answer)
	}
	if bound != "https://hound-haven.org" {
		t.Fatalf("the deployment was reached at %q", bound)
	}
}
