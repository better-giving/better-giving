package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the errands this console proxies to the deployment, and the session they all ride.

// a token minted against the clock the server reads, so a case meets a live session and not one
// ending further out than a deployment accepts.
var errandToken = func() string {
	token, _, err := session.Mint(time.Now())
	if err != nil {
		panic(err)
	}
	return token
}()

// one call the deployment was asked, as the fake below recorded it.
type errand struct {
	method string
	path   string
	bearer string
	body   map[string]any
	// raw and kind are the body as it arrived and the type it arrived under, for the one errand
	// that forwards a body this console did not write.
	raw  []byte
	kind string
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
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		recording.Lock()
		asked = append(asked, errand{
			method: r.Method, path: r.URL.Path,
			bearer: r.Header.Get("Authorization"), body: body,
			raw: raw, kind: r.Header.Get("Content-Type"),
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

// the social links travel beside the values as the addresses typed, and the words and colour the
// organisation is presented in travel among the values.
func TestTheSocialLinksAndThePresentationTravelWithTheProfile(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org": reported()}, "here")

	status, answer := press(t, handler, "/api/deployment/org", `{
		"values":{"legal_name":"Hound Haven","mission":"Every hound homed.","vision":"",
			"brand_colour":"#AA3300"},
		"social_links":["https://instagram.com/houndhaven",""]
	}`)
	if status != http.StatusOK || answer["kind"] != "saved" {
		t.Fatalf("%d %v", status, answer)
	}
	want := map[string]any{
		"org": map[string]any{
			"legal_name": "Hound Haven", "mission": "Every hound homed.", "vision": "",
			"brand_colour": "#AA3300",
		},
		"social_links": []any{"https://instagram.com/houndhaven", ""},
	}
	calls := asked()
	if len(calls) != 1 || !reflect.DeepEqual(calls[0].body, want) {
		t.Fatalf("the deployment was asked %v", calls)
	}
}

// a press naming no links states the list empty rather than null, because the profile is posted
// whole and the deployment reads a list it was not handed as cleared.
func TestAPressNamingNoLinksStatesTheListEmpty(t *testing.T) {
	for _, body := range []string{`{"values":{}}`, `{"values":{},"social_links":null}`} {
		handler, asked := errands(t, map[string]any{"POST /console/org": reported()}, "here")
		press(t, handler, "/api/deployment/org", body)
		calls := asked()
		if len(calls) != 1 || !reflect.DeepEqual(calls[0].body["social_links"], []any{}) {
			t.Fatalf("%s reached the deployment as %v", body, calls)
		}
	}
}

// a logo posted the way the browser posts one: the photo in `file`, under the boundary the body's
// own type names.
func logoBody(t *testing.T, photo []byte) (string, []byte) {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "logo.webp")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(photo); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	return form.FormDataContentType(), body.Bytes()
}

// one call to the logo errand, the way the page makes it.
func logoPress(t *testing.T, handler http.Handler, method, kind string, body io.Reader) (int, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(method, "/api/deployment/org/logo", body)
	request.Host = loopback
	if kind != "" {
		request.Header.Set("Content-Type", kind)
	}
	recorded := httptest.NewRecorder()
	handler.ServeHTTP(recorded, request)
	var answer map[string]any
	if err := json.Unmarshal(recorded.Body.Bytes(), &answer); err != nil {
		t.Fatalf("answered %q", recorded.Body.String())
	}
	return recorded.Code, answer
}

// the logo goes up as the bytes the browser sent under the type it sent them with, over the session:
// the boundary is named in that type, so a body re-spelled here is one the deployment cannot split.
func TestTheLogoIsForwardedByteForByteUnderItsOwnType(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org/logo": reported()}, "here")
	kind, body := logoBody(t, []byte("RIFF\x00\x00\x00\x00WEBPVP8 "))

	status, answer := logoPress(t, handler, http.MethodPost, kind, bytes.NewReader(body))
	if status != http.StatusOK || answer["kind"] != "saved" || answer["org"] == nil {
		t.Fatalf("%d %v", status, answer)
	}
	calls := asked()
	if len(calls) != 1 || calls[0].method != http.MethodPost || calls[0].path != "/console/org/logo" {
		t.Fatalf("the deployment was asked %v", calls)
	}
	if calls[0].kind != kind || !bytes.Equal(calls[0].raw, body) {
		t.Fatalf("forwarded %q under %q", calls[0].raw, calls[0].kind)
	}
	if calls[0].bearer != "Bearer "+errandToken {
		t.Fatalf("the session did not travel: %q", calls[0].bearer)
	}
}

// a body up to the deployment's own cap is forwarded, and one byte past it is refused here, whether
// the request declared its length or not, so a photo the deployment would refuse is never carried.
func TestALogoPastTheDeploymentsCapIsRefusedBeforeItIsAsked(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org/logo": reported()}, "here")
	kind := "multipart/form-data; boundary=b"

	if status, answer := logoPress(t, handler, http.MethodPost, kind,
		bytes.NewReader(make([]byte, release.LogoUploadMax))); status != http.StatusOK {
		t.Fatalf("a body at the cap answered %d %v", status, answer)
	}
	for name, past := range map[string]io.Reader{
		"declared":   bytes.NewReader(make([]byte, release.LogoUploadMax+1)),
		"undeclared": io.MultiReader(bytes.NewReader(make([]byte, release.LogoUploadMax+1))),
	} {
		status, answer := logoPress(t, handler, http.MethodPost, kind, past)
		if status != http.StatusRequestEntityTooLarge || answer["error"] == nil {
			t.Errorf("a body past the cap, %s, answered %d %v", name, status, answer)
		}
	}
	if calls := asked(); len(calls) != 1 {
		t.Fatalf("the deployment was asked %d times", len(calls))
	}
}

// a body that is not a form is no logo press, and the deployment is not asked about it.
func TestALogoPressThatIsNotAFormIsRefused(t *testing.T) {
	handler, asked := errands(t, map[string]any{"POST /console/org/logo": reported()}, "here")
	for _, kind := range []string{"", "application/json", "multipart/form-data"} {
		status, answer := logoPress(t, handler, http.MethodPost, kind, strings.NewReader(`{}`))
		if status != http.StatusBadRequest || answer["error"] == nil {
			t.Errorf("%q answered %d %v", kind, status, answer)
		}
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
	}
}

// taking the logo off is its own address, carrying nothing, and answers the same write a save does.
func TestTheLogoIsTakenOffAtItsOwnAddress(t *testing.T) {
	handler, asked := errands(t, map[string]any{"DELETE /console/org/logo": reported()}, "here")

	status, answer := logoPress(t, handler, http.MethodDelete, "", nil)
	if status != http.StatusOK || answer["kind"] != "saved" {
		t.Fatalf("%d %v", status, answer)
	}
	calls := asked()
	if len(calls) != 1 || calls[0].method != http.MethodDelete || calls[0].path != "/console/org/logo" ||
		len(calls[0].raw) != 0 || calls[0].bearer != "Bearer "+errandToken {
		t.Fatalf("the deployment was asked %v", calls)
	}
}

// a photo the deployment turned down comes back as a refusal keyed at the logo, carrying its words.
func TestARefusedLogoComesBackAtTheLogo(t *testing.T) {
	handler, _ := errands(t, map[string]any{
		"POST /console/org/logo": refusal{http.StatusUnprocessableEntity, map[string]any{
			"error": "org_refused", "message": "The logo was not stored.", "fix": "Choose a photo.",
			"errors": map[string]any{"logo": "That file is not a photo."},
		}},
	}, "here")
	kind, body := logoBody(t, []byte("not a photo"))

	status, answer := logoPress(t, handler, http.MethodPost, kind, bytes.NewReader(body))
	keyed, _ := answer["errors"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "refused" || keyed["logo"] != "That file is not a photo." {
		t.Fatalf("%d %v", status, answer)
	}
}

// with no session, neither logo errand makes a request at all.
func TestTheLogoErrandsWithNoSessionMakeNoRequest(t *testing.T) {
	handler, asked := errands(t, map[string]any{}, "")
	kind, body := logoBody(t, []byte("RIFF"))

	for method, sent := range map[string]io.Reader{
		http.MethodPost: bytes.NewReader(body), http.MethodDelete: nil,
	} {
		status, answer := logoPress(t, handler, method, kind, sent)
		read, _ := answer["read"].(map[string]any)
		if status != http.StatusOK || read["kind"] != "no-session" {
			t.Errorf("%s answered %d %v", method, status, answer)
		}
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
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
			"backlog":         map[string]any{"failed": float64(0), "oldestWaitingAt": nil, "heldBehindFailed": []any{}},
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

// zapier is the dashboard's, and no errand here reads its key or presses it: both spellings fall to
// the `/api/` catch-all even with a session a zapier errand could ride and a deployment that would
// answer one.
func TestNoErrandReachesZapier(t *testing.T) {
	handler, asked := errands(t, map[string]any{
		"GET /console/zapier":  map[string]any{"key": "zk_live"},
		"POST /console/zapier": map[string]any{"key": "zk_live"},
	}, "here")

	getStatus, got := ask(t, handler, "/api/deployment/zapier")
	postStatus, posted := press(t, handler, "/api/deployment/zapier", `{"press":"mint"}`)
	for method, answered := range map[string]struct {
		status int
		body   map[string]any
	}{http.MethodGet: {getStatus, got}, http.MethodPost: {postStatus, posted}} {
		if answered.status != http.StatusNotFound || answered.body["error"] != "no such endpoint" {
			t.Errorf("%s /api/deployment/zapier answered %d %v", method, answered.status, answered.body)
		}
	}
	if len(asked()) != 0 {
		t.Fatalf("the deployment was asked %v", asked())
	}
}

// nothing about the deployment reaches this file's own answers, and a body naming something else is
// refused rather than sent on.
func TestABodyThisConsoleWillNotActOnIsRefused(t *testing.T) {
	handler, asked := errands(t, map[string]any{}, "here")
	for _, pressed := range []struct{ path, body string }{
		{"/api/deployment/org", `{"whatever":1}`},
		{"/api/deployment/org", `{"values":{},"social_links":"https://x.com/houndhaven"}`},
		{"/api/deployment/org", `{"values":{},"social_links":["https://x.com/houndhaven",1]}`},
		{"/api/deployment/sites", `{"sites":"one"}`},
		{"/api/deployment/test-email", `not json`},
		{"/api/deployment/quickbooks", `{"whatever":1}`},
	} {
		if status, _ := press(t, handler, pressed.path, pressed.body); status != http.StatusBadRequest {
			t.Errorf("%s %s answered %d", pressed.path, pressed.body, status)
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
