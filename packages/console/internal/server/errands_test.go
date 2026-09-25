package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the errands this console proxies to the deployment, and the session they all ride.

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

// the accounts press the page sends names every role, a holding nobody chose as null, and reaches
// the deployment that way: a body this console refused at its own door, or one it passed on short
// of a role, is a press the deployment never takes.
func TestTheAccountsPressThePageSendsReachesTheDeploymentWithEveryRole(t *testing.T) {
	handler, asked := errands(t, map[string]any{
		"POST /console/quickbooks": map[string]any{"press": "accounts"},
	}, "here")

	status, answer := press(t, handler, "/api/deployment/quickbooks", `{
		"press":"accounts","income":"42","fee":"7","stripeBalance":"31","paypalBalance":null,
		"chariotBalance":null,"nowpaymentsBalance":null,"undepositedFunds":null
	}`)
	if status != http.StatusOK || answer["kind"] != "reported" {
		t.Fatalf("%d %v", status, answer)
	}
	want := map[string]any{
		"press": "accounts", "income": "42", "fee": "7", "stripeBalance": "31",
		"paypalBalance": nil, "chariotBalance": nil, "nowpaymentsBalance": nil,
		"undepositedFunds": nil,
	}
	calls := asked()
	if len(calls) != 1 || !reflect.DeepEqual(calls[0].body, want) {
		t.Fatalf("the deployment was asked %v", calls)
	}
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
		"/api/deployment/quickbooks": `{"press":"connect"}`,
		"/api/deployment/zapier":     `{"press":"make"}`,
		"/api/deployment/sites":      `{"sites":[]}`,

		"/api/deployment/wallet-domains": `{}`,
		"/api/deployment/webhook-repair": `{}`,
	} {
		status, answer := press(t, handler, path, body)
		read, _ := answer["read"].(map[string]any)
		if status != http.StatusOK || read["kind"] != "no-session" {
			t.Errorf("%s answered %d %v", path, status, answer)
		}
	}
	for _, path := range []string{
		"/api/deployment/payments", "/api/deployment/recurring", "/api/deployment/quickbooks",
		"/api/deployment/zapier",
	} {
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

func TestTheOtherErrandsReachTheirOwnAddress(t *testing.T) {
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
			map[string]any{
				"processor": "chariot", "label": "Chariot", "state": "unconfigured",
				"unset": []any{"CHARIOT_API_KEY", "CHARIOT_CONNECT_ID"},
			},
			map[string]any{
				"processor": "nowpayments", "label": "NOWPayments", "state": "unconfigured",
				"unset": []any{"NOWPAYMENTS_API_KEY", "NOWPAYMENTS_OUTCOME_CURRENCY"},
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
		// the books, carried whole: nothing in this binary branches on a line of either report.
		// what the lines are called is packages/operator/src/console/quickbooks.ts's, and
		// ../deployment/quickbooks_test.go is what holds a fixture of one to it.
		"GET /console/quickbooks": map[string]any{
			"connection": map[string]any{
				"state": "connected", "realmId": "9341454792073042",
				"companyName":        "Hope Springs",
				"income":             map[string]any{"id": "42", "name": "Donations"},
				"fee":                map[string]any{"id": "7", "name": "Merchant fees"},
				"stripeBalance":      map[string]any{"id": "31", "name": "Stripe balance"},
				"paypalBalance":      nil,
				"chariotBalance":     nil,
				"nowpaymentsBalance": nil,
				"undepositedFunds":   map[string]any{"id": "9", "name": "Undeposited funds"},
				"awaitingAccounts":   false,
				"startAt":            "2026-01-01T00:00:00.000Z",
			},
			"accounts":        map[string]any{"state": "read", "accounts": []any{}},
			"backlog":         map[string]any{"failed": float64(0), "oldestWaitingAt": nil},
			"callbackAddress": "https://give.example.org/quickbooks/callback",
		},
		"POST /console/quickbooks":     map[string]any{"press": "connect", "url": "https://intuit.example"},
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
	if _, answer := ask(t, handler, "/api/deployment/quickbooks"); answer["kind"] != "read" {
		t.Errorf("the quickbooks read answered %v", answer)
	}
	if _, answer := press(t, handler, "/api/deployment/quickbooks", `{"press":"connect"}`); answer["kind"] != "reported" {
		t.Errorf("the quickbooks press answered %v", answer)
	}
	// only what the press carries travels: a box it has no use for is a value the deployment is
	// never told about.
	for _, call := range asked() {
		if call.path == deployment.QuickbooksPath && call.method == http.MethodPost {
			if len(call.body) != 1 || call.body["press"] != "connect" {
				t.Errorf("the quickbooks press posted %v", call.body)
			}
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

// the press reaches the deployment's repair naming Stripe and nothing else, and answers its report.
func TestTheWebhookRepairAnswersTheDeploymentsReport(t *testing.T) {
	handler, asked := errands(t, map[string]any{
		"POST /console/webhook-repair": map[string]any{"outcome": "repaired", "detail": nil},
	}, "here")

	status, answer := press(t, handler, "/api/deployment/webhook-repair", `{}`)
	report, _ := answer["report"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "reported" || report["outcome"] != "repaired" {
		t.Fatalf("%d %v", status, answer)
	}
	calls := asked()
	if len(calls) != 1 || calls[0].method != http.MethodPost ||
		calls[0].path != deployment.WebhookRepairPath || calls[0].bearer != "Bearer "+errandToken {
		t.Fatalf("the deployment was asked %v", calls)
	}
	if len(calls[0].body) != 1 || calls[0].body["processor"] != "stripe" {
		t.Fatalf("the repair posted %v", calls[0].body)
	}
}

// a refusal is drawn at the button that was pressed, so it answers 200 carrying the deployment's own
// words, like every errand here.
func TestARefusedWebhookRepairCarriesTheDeploymentsWords(t *testing.T) {
	handler, _ := errands(t, map[string]any{
		"POST /console/webhook-repair": refusal{http.StatusUnauthorized, map[string]any{
			"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
		}},
	}, "here")

	status, answer := press(t, handler, "/api/deployment/webhook-repair", `{}`)
	read, _ := answer["read"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "unanswered" || read["kind"] != "refused" ||
		read["message"] != "Another console." || read["fix"] != "Connect again." {
		t.Fatalf("%d %v", status, answer)
	}
}

// which presses the deployment answers only once Intuit has, which is what decides the door they go
// through.
//
// the two of them are the two that reach a third party before the deployment answers at all: the
// accounts press fetches the company's chart to settle the three ids against, and the disconnect
// revokes the credential at Intuit before it deletes the row. every other press is answered out of
// the deployment's own rows and is held to a read's own deadline.
func TestThePressesIntuitIsBehindAreTheOnesTheLongDoorIsFor(t *testing.T) {
	for press, waits := range map[string]bool{
		"accounts": true, "disconnect": true,
		"connect": false, "retry": false, "start-date": false, "start-date-preview": false,
	} {
		if held := waitsOnIntuit(press); held != waits {
			t.Errorf("the %s press waits on Intuit: %v", press, held)
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
		"/api/deployment/quickbooks": `{"whatever":1}`,
		"/api/deployment/zapier":     `{"press":"make","key":"bgz_x"}`,
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

// the key crosses this binary in every zapier reading and in the answer to the press that made it:
// both reach the page unchanged and nothing else — no log line, no file among this machine's records.
//
// a refused press is the deployment's 200 carrying why, and reaches the page as reported too.
func TestTheZapierKeyReachesThePageAndNothingElse(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	restoring := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, nil)))
	t.Cleanup(func() {
		log.SetOutput(os.Stderr)
		slog.SetDefault(restoring)
	})

	const key = "bgz_q7Rk3vYh0cXw9LmN2pAe5sTu8jBf1gHd4iKo6lZyC0M"
	records, flow, accounts := machine(t, "an-account")
	surface, asked := deployed(t, map[string]any{
		"GET /console/zapier": map[string]any{
			"key":       map[string]any{"madeAt": "2026-09-22T10:00:00.000Z", "key": key},
			"listening": map[string]any{"newGift": float64(1), "newDonor": float64(0)},
			"deliveries": map[string]any{
				"waiting": float64(0), "failed": float64(0), "oldestWaitingAt": nil,
			},
		},
		"POST /console/zapier": map[string]any{
			"ok": true, "press": "replace", "key": key,
			"madeAt": "2026-09-22T10:00:00.000Z", "disconnected": float64(1),
			"paused": float64(1), "notPaused": float64(0),
		},
	})
	connected(t, records, surface.URL)
	handler := New(Options{UI: http.NotFoundHandler(), Flow: flow, Accounts: accounts, Records: records})

	status, answer := ask(t, handler, "/api/deployment/zapier")
	read, _ := answer["report"].(map[string]any)
	standing, _ := read["key"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "read" || standing["key"] != key {
		t.Fatalf("the zapier read answered %d %v", status, answer)
	}
	status, answer = press(t, handler, "/api/deployment/zapier", `{"press":"replace"}`)
	report, _ := answer["report"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "reported" || report["key"] != key {
		t.Fatalf("the zapier press answered %d %v", status, answer)
	}
	for _, call := range asked() {
		if call.path == deployment.ZapierPath && call.method == http.MethodPost {
			if len(call.body) != 1 || call.body["press"] != "replace" {
				t.Errorf("the zapier press posted %v", call.body)
			}
		}
	}

	if strings.Contains(logged.String(), "bgz_") {
		t.Errorf("a log line carries a zapier key: %s", logged.String())
	}
	err := filepath.WalkDir(records.Dir(), func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		held, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(held, []byte("bgz_")) {
			t.Errorf("%s holds a zapier key", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// a body carrying the key is kept by no cache between this binary and the page.
func TestAZapierAnswerIsNeverStored(t *testing.T) {
	const key = "bgz_q7Rk3vYh0cXw9LmN2pAe5sTu8jBf1gHd4iKo6lZyC0M"
	handler, _ := errands(t, map[string]any{
		"GET /console/zapier": map[string]any{
			"key":       map[string]any{"madeAt": "2026-09-22T10:00:00.000Z", "key": key},
			"listening": map[string]any{"newGift": float64(0), "newDonor": float64(0)},
			"deliveries": map[string]any{
				"waiting": float64(0), "failed": float64(0), "oldestWaitingAt": nil,
			},
		},
		"POST /console/zapier": map[string]any{
			"ok": true, "press": "make", "key": key,
			"madeAt": "2026-09-22T10:00:00.000Z", "disconnected": float64(0),
			"paused": float64(0), "notPaused": float64(0),
		},
	}, "here")
	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/deployment/zapier", nil),
		httptest.NewRequest(http.MethodPost, "/api/deployment/zapier", strings.NewReader(`{"press":"make"}`)),
	} {
		request.Host = loopback
		request.Header.Set("Content-Type", "application/json")
		recorded := httptest.NewRecorder()
		handler.ServeHTTP(recorded, request)
		if recorded.Code != http.StatusOK || recorded.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s answered %d with Cache-Control %q", request.Method, recorded.Code,
				recorded.Header().Get("Cache-Control"))
		}
	}
}

// a make over a key that exists is the deployment's refusal, answered 200 and drawn at the control.
func TestARefusedZapierPressIsReported(t *testing.T) {
	refused := map[string]any{
		"ok": false, "press": "make",
		"detail": "This deployment already has a Zapier key. Press replace to make a new one.",
	}
	handler, _ := errands(t, map[string]any{"POST /console/zapier": refused}, "here")
	status, answer := press(t, handler, "/api/deployment/zapier", `{"press":"make"}`)
	report, _ := answer["report"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "reported" || report["ok"] != false ||
		report["detail"] != refused["detail"] {
		t.Fatalf("answered %d %v", status, answer)
	}
}
