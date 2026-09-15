package chariot

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the chain against a Chariot answering over http, with cloudflare and the deployment handed in.
//
// every stage and every way one ends is reachable here with no Chariot account, no cloudflare
// account and no network.

const (
	origin   = "https://w.acct.workers.dev"
	key      = "ck_live_do_not_show"
	minted   = "5ec2e7-minted-do-not-show"
	ein      = "530196605"
	orgID    = "org_abc"
	connect  = "live_0123"
	endpoint = origin + release.ChariotWebhookPath
)

// one call Chariot was asked, as the assertions read it.
type seen struct {
	method, path string
	query        map[string][]string
	body         map[string]any
}

// Chariot, answering from state a case sets up, and remembering what it was asked alongside what the
// deployment was asked.
type host struct {
	mutex sync.Mutex
	log   *[]string
	calls []seen

	// fail answers `METHOD path` with this status and a problem body.
	fail          map[string]int
	orgs          []any
	connectStatus int
	connect       map[string]any
	subs          []map[string]any
	page          int
	// listFails answers every read of the list but the key's check with a gateway error.
	listFails bool
	// unwrappedCreate answers a create in the reference's shape, a bare subscription, rather than the
	// `event_subscription` wrapper the sandbox answers with.
	unwrappedCreate bool
}

func (one *host) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	body := map[string]any{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	one.calls = append(one.calls, seen{r.Method, r.URL.Path, r.URL.Query(), body})
	*one.log = append(*one.log, r.Method+" "+r.URL.Path)

	w.Header().Set("Content-Type", "application/json")
	reply := func(status int, value any) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(value)
	}
	if status, failing := one.fail[r.Method+" "+r.URL.Path]; failing {
		reply(status, map[string]any{"type": "about:blank", "title": "API Error", "detail": "Unauthorized"})
		return
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/event_subscriptions":
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if one.listFails && limit != 1 {
			w.WriteHeader(504)
			return
		}
		limit = min(limit, one.page)
		from, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
		to := min(from+limit, len(one.subs))
		page := map[string]any{"results": one.subs[from:to]}
		if to < len(one.subs) {
			page["nextPageToken"] = strconv.Itoa(to)
		}
		reply(200, page)
	case r.Method == http.MethodGet && r.URL.Path == "/v1/organizations/search":
		reply(200, map[string]any{"results": one.orgs})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/connects":
		reply(one.connectStatus, one.connect)
	case r.Method == http.MethodPost && r.URL.Path == "/v1/event_subscriptions":
		made := map[string]any{
			"id": "sub-new", "url": body["url"], "category": body["category"], "status": "active",
		}
		one.subs = append(one.subs, made)
		if one.unwrappedCreate {
			reply(201, made)
			return
		}
		reply(200, map[string]any{"event_subscription": made})
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/v1/event_subscriptions/"):
		id := strings.TrimPrefix(r.URL.Path, "/v1/event_subscriptions/")
		for _, sub := range one.subs {
			if sub["id"] == id {
				sub["status"] = body["status"]
				reply(200, sub)
				return
			}
		}
		reply(500, map[string]any{"detail": "Failed to get event webhook subscription"})
	default:
		reply(404, map[string]any{"detail": "unscripted"})
	}
}

func (one *host) asked(method, path string) []seen {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	found := []seen{}
	for _, call := range one.calls {
		if call.method == method && call.path == path {
			found = append(found, call)
		}
	}
	return found
}

func sub(id, url, status string) map[string]any {
	return map[string]any{
		"id": id, "url": url, "category": release.ChariotEventCategory, "status": status,
		"created_at": "2026-09-01T00:00:00Z",
	}
}

func org(id, taxID string, eligible bool) map[string]any {
	return map[string]any{
		"id": id, "ein": taxID, "name": "Red Cross", "daf_eligible": eligible,
		"city": "Washington", "state": "DC",
	}
}

// the whole press's effects, every one of them landing, which each case then spoils one of.
type press struct {
	t         *testing.T
	log       []string
	chariot   *host
	profile   deployment.ReportRead
	address   deployment.Address
	store     deployment.Written
	published []map[string]*string
	stages    []Stage
	facts     []Facts
	asked     Asked
}

func working(t *testing.T) *press {
	one := &press{
		t: t,
		profile: deployment.ReportRead{
			NoReport: deployment.NoReport{Kind: deployment.Reported},
			Org: map[string]any{
				"legal_name": "Red Cross", "tax_id": "53-0196605", "notification_email": "alerts@example.org",
			},
		},
		address: deployment.Address{Kind: deployment.Deployed, WorkersDev: origin},
		store:   deployment.Written{Kind: deployment.WriteSet},
		asked:   Asked{APIKey: key, Address: API},
	}
	one.chariot = &host{
		log:           &one.log,
		fail:          map[string]int{},
		orgs:          []any{org(orgID, ein, true)},
		connectStatus: 201,
		connect: map[string]any{
			"id": connect, "apiKey": "connect-token-do-not-show", "active": true, "archived": false,
		},
		subs: []map[string]any{},
		page: 100,
	}
	return one
}

func (one *press) run() Outcome {
	server := httptest.NewServer(one.chariot)
	one.t.Cleanup(server.Close)
	return Chain(context.Background(), one.asked, Effects{
		Call:    BindAt(server.URL, key),
		Profile: func(context.Context) deployment.ReportRead { return one.profile },
		Address: func(context.Context) deployment.Address { return one.address },
		Publish: func(_ context.Context, values map[string]*string) deployment.Written {
			one.published = append(one.published, values)
			one.log = append(one.log, "publish")
			return one.store
		},
		Mint:  func() string { return minted },
		At:    func(stage Stage) { one.stages = append(one.stages, stage) },
		Found: func(facts Facts) { one.facts = append(one.facts, facts) },
	})
}

func (one *press) lastFacts() Facts {
	if len(one.facts) == 0 {
		return Facts{}
	}
	return one.facts[len(one.facts)-1]
}

// what one publish carried, with a removal read as the absent value it is.
func values(published map[string]*string) map[string]string {
	flat := map[string]string{}
	for name, value := range published {
		if value == nil {
			flat[name] = "<removed>"
			continue
		}
		flat[name] = *value
	}
	return flat
}

func same(t *testing.T, got, want map[string]string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("published %v, want %v", got, want)
	}
	for name, value := range want {
		if got[name] != value {
			t.Errorf("%s = %q, want %q", name, got[name], value)
		}
	}
}

func TestAPressWithNothingHereCreatesTheSubscriptionAndWritesAllFour(t *testing.T) {
	one := working(t)
	one.chariot.subs = []map[string]any{sub("elsewhere", "https://other.example"+release.ChariotWebhookPath, "active")}

	outcome := one.run()

	if outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	if want := []Stage{Finding, Connecting, Subscribing, Storing}; !slices.Equal(one.stages, want) {
		t.Errorf("stages = %v, want %v", one.stages, want)
	}
	checks := one.chariot.asked(http.MethodGet, "/v1/event_subscriptions")
	if len(checks) < 1 || checks[0].query["limit"][0] != "1" {
		t.Errorf("the key was not checked first: %+v", checks)
	}
	searched := one.chariot.asked(http.MethodGet, "/v1/organizations/search")
	if len(searched) != 1 || searched[0].query["q"][0] != ein {
		t.Errorf("searched %+v, want q=%s", searched, ein)
	}
	connects := one.chariot.asked(http.MethodPost, "/v1/connects")
	if len(connects) != 1 {
		t.Fatalf("connects = %+v", connects)
	}
	contact, _ := connects[0].body["contact"].(map[string]any)
	if connects[0].body["organization_id"] != orgID || contact["email"] != "alerts@example.org" || len(connects[0].body) != 2 {
		t.Errorf("the Connect was asked for with %v", connects[0].body)
	}
	made := one.chariot.asked(http.MethodPost, "/v1/event_subscriptions")
	if len(made) != 1 {
		t.Fatalf("creates = %+v", made)
	}
	if made[0].body["url"] != endpoint || made[0].body["category"] != "grant.updated" ||
		made[0].body["signing_secret"] != minted {
		t.Errorf("the subscription was made with %v", made[0].body)
	}
	if len(one.published) != 1 {
		t.Fatalf("published %d times", len(one.published))
	}
	same(t, values(one.published[0]), map[string]string{
		"CHARIOT_API_KEY":        key,
		"CHARIOT_API_URL":        "<removed>",
		"CHARIOT_CONNECT_ID":     connect,
		"CHARIOT_WEBHOOK_SECRET": minted,
	})
	if len(one.chariot.asked(http.MethodPatch, "/v1/event_subscriptions/elsewhere")) != 0 {
		t.Error("another deployment's subscription was touched")
	}
	facts := one.lastFacts()
	if facts.Organisation == nil || facts.Organisation.ID != orgID || facts.Organisation.City != "Washington" {
		t.Errorf("organisation = %+v", facts.Organisation)
	}
	if facts.Connect == nil || *facts.Connect != (Connect{ID: connect, Active: true}) {
		t.Errorf("connect = %+v", facts.Connect)
	}
	if facts.Subscription == nil || *facts.Subscription != (Subscription{Kind: "created", ID: "sub-new"}) {
		t.Errorf("subscription = %+v", facts.Subscription)
	}
}

func TestASubscriptionAnsweredInTheReferenceShapeReadsAsWellAsTheWrappedOne(t *testing.T) {
	one := working(t)
	one.chariot.unwrappedCreate = true
	if outcome := one.run(); outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	if facts := one.lastFacts(); facts.Subscription == nil || facts.Subscription.ID != "sub-new" {
		t.Errorf("subscription = %+v", facts.Subscription)
	}
}

func TestASandboxAddressIsStoredAndLiveIsStoredAsNone(t *testing.T) {
	one := working(t)
	one.asked.Address = "https://sandboxapi.givechariot.com"
	if outcome := one.run(); outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	if got := values(one.published[0])["CHARIOT_API_URL"]; got != "https://sandboxapi.givechariot.com" {
		t.Errorf("CHARIOT_API_URL = %q", got)
	}
}

func TestAKeyThatDoesNotAnswerStopsBeforeAnythingIsRead(t *testing.T) {
	for _, one := range []struct {
		status int
		want   ResultKind
	}{{401, Refused}, {403, Forbidden}, {503, Unreachable}} {
		press := working(t)
		press.chariot.fail["GET /v1/event_subscriptions"] = one.status
		outcome := press.run()
		if outcome.Kind != Unauthorized || outcome.Failure == nil || outcome.Failure.Kind != one.want {
			t.Errorf("%d: outcome = %+v", one.status, outcome)
		}
		if len(press.chariot.calls) != 1 || len(press.published) != 0 || len(press.stages) != 0 {
			t.Errorf("%d: calls %d, published %d, stages %v", one.status,
				len(press.chariot.calls), len(press.published), press.stages)
		}
	}
}

func TestAProfileThatWasNotReadStopsTheSearch(t *testing.T) {
	one := working(t)
	one.profile = deployment.ReportRead{NoReport: deployment.NoReport{Kind: deployment.NoSession}}
	outcome := one.run()
	if outcome.Kind != Unprofiled || outcome.Read == nil || outcome.Read.Kind != deployment.NoSession {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.chariot.asked(http.MethodGet, "/v1/organizations/search")) != 0 || len(one.published) != 0 {
		t.Error("the chain went on past a profile it could not read")
	}
}

func TestAProfileWithNoEINStopsTheSearch(t *testing.T) {
	for _, profile := range []any{
		nil,
		map[string]any{"legal_name": "Red Cross"},
		map[string]any{"tax_id": "12-34"},
		map[string]any{"tax_id": "53-01966AB"},
	} {
		one := working(t)
		one.profile.Org = profile
		if outcome := one.run(); outcome.Kind != NoEIN {
			t.Errorf("%v: outcome = %+v", profile, outcome)
		}
		if len(one.chariot.asked(http.MethodGet, "/v1/organizations/search")) != 0 {
			t.Errorf("%v: a malformed EIN was searched as a name", profile)
		}
	}
}

func TestAProfileWithNoNotificationEmailStopsTheSearch(t *testing.T) {
	for _, email := range []any{nil, "", " ", 7} {
		one := working(t)
		profile := one.profile.Org.(map[string]any)
		delete(profile, "notification_email")
		if email != nil {
			profile["notification_email"] = email
		}
		if outcome := one.run(); outcome.Kind != NoContact {
			t.Errorf("%v: outcome = %+v", email, outcome)
		}
		if len(one.chariot.calls) != 1 || len(one.published) != 0 {
			t.Errorf("%v: Chariot was asked %d times past the key's check", email, len(one.chariot.calls)-1)
		}
	}
}

func TestAnEINChariotDoesNotListStopsBeforeAConnect(t *testing.T) {
	one := working(t)
	one.chariot.orgs = []any{org("org_other", "999999998", true)}
	outcome := one.run()
	if outcome.Kind != Unlisted || outcome.EIN != ein {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.chariot.asked(http.MethodPost, "/v1/connects")) != 0 || len(one.published) != 0 {
		t.Error("the chain went on past an organisation it did not find")
	}
}

func TestAnOrganisationNotTakingDAFGrantsStopsBeforeAConnect(t *testing.T) {
	one := working(t)
	one.chariot.orgs = []any{org(orgID, ein, false)}
	outcome := one.run()
	if outcome.Kind != Ineligible {
		t.Fatalf("outcome = %+v", outcome)
	}
	if facts := one.lastFacts(); facts.Organisation == nil || facts.Organisation.Eligible {
		t.Errorf("the organisation was not named: %+v", facts.Organisation)
	}
	if len(one.chariot.asked(http.MethodPost, "/v1/connects")) != 0 || len(one.published) != 0 {
		t.Error("a Connect was made for an organisation that takes no DAF grants")
	}
}

func TestMoreThanOneOrganisationCarryingTheEINIsNamedAndNoneIsPicked(t *testing.T) {
	one := working(t)
	one.chariot.orgs = []any{org("org_a", ein, true), org("org_b", ein, true)}
	outcome := one.run()
	if outcome.Kind != Ambiguous || len(outcome.Candidates) != 2 ||
		outcome.Candidates[0].ID != "org_a" || outcome.Candidates[1].ID != "org_b" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.chariot.asked(http.MethodPost, "/v1/connects")) != 0 {
		t.Error("a Connect was made for an organisation nobody chose")
	}
}

func TestASearchAnswerInAnotherShapeIsUnreadable(t *testing.T) {
	one := working(t)
	one.chariot.orgs = []any{map[string]any{"id": orgID, "ein": ein}}
	outcome := one.run()
	if outcome.Kind != Unsearched || outcome.Failure == nil || outcome.Failure.Kind != Unreadable {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestARepeatedPressStoresTheConnectChariotAlreadyHolds(t *testing.T) {
	one := working(t)
	one.chariot.connectStatus = 200
	one.chariot.connect["active"] = false
	if outcome := one.run(); outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	if got := values(one.published[0])["CHARIOT_CONNECT_ID"]; got != connect {
		t.Errorf("CHARIOT_CONNECT_ID = %q", got)
	}
	if facts := one.lastFacts(); facts.Connect == nil || facts.Connect.Active {
		t.Errorf("an inactive Connect was not reported: %+v", facts.Connect)
	}
}

func TestARefusedConnectStopsBeforeTheSubscription(t *testing.T) {
	one := working(t)
	one.chariot.fail["POST /v1/connects"] = 403
	outcome := one.run()
	if outcome.Kind != Unconnected || outcome.Failure.Kind != Forbidden {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.chariot.asked(http.MethodPost, "/v1/event_subscriptions")) != 0 || len(one.published) != 0 {
		t.Error("the chain went on past a Connect Chariot refused")
	}
}

func TestTheOneActiveSubscriptionIsReplacedAndTakenDownAfterTheWrite(t *testing.T) {
	one := working(t)
	// the match sits on the second page, beside a deleted one at the same address.
	one.chariot.page = 1
	one.chariot.subs = []map[string]any{
		sub("gone", endpoint, "deleted"),
		sub("here", endpoint, "active"),
	}

	if outcome := one.run(); outcome.Kind != Done {
		t.Fatalf("outcome = %+v", outcome)
	}
	created := slices.Index(one.log, "POST /v1/event_subscriptions")
	published := slices.Index(one.log, "publish")
	retired := slices.Index(one.log, "PATCH /v1/event_subscriptions/here")
	if created < 0 || published < created || retired < published {
		t.Errorf("order = %v, want create, publish, then the old one deleted", one.log)
	}
	if len(one.chariot.asked(http.MethodPatch, "/v1/event_subscriptions/gone")) != 0 {
		t.Error("a subscription already deleted was deleted again")
	}
	same(t, values(one.published[0]), map[string]string{
		"CHARIOT_API_KEY":        key,
		"CHARIOT_API_URL":        "<removed>",
		"CHARIOT_CONNECT_ID":     connect,
		"CHARIOT_WEBHOOK_SECRET": minted,
	})
	if facts := one.lastFacts(); facts.Subscription == nil || *facts.Subscription != (Subscription{Kind: "replaced", ID: "sub-new"}) {
		t.Errorf("subscription = %+v", facts.Subscription)
	}
}

func TestEveryOtherMatchIsReplacedAndTakenDownAfterTheWrite(t *testing.T) {
	for name, spoil := range map[string]func(*press){
		"subscription disabled": func(one *press) {
			one.chariot.subs[0]["status"] = "requires_attention"
		},
		"two matches": func(one *press) {
			one.chariot.subs = append(one.chariot.subs, sub("older", endpoint, "active"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			one := working(t)
			one.chariot.subs = []map[string]any{sub("old", endpoint, "active")}
			spoil(one)

			if outcome := one.run(); outcome.Kind != Done {
				t.Fatalf("outcome = %+v", outcome)
			}
			if got := values(one.published[0])["CHARIOT_WEBHOOK_SECRET"]; got != minted {
				t.Errorf("CHARIOT_WEBHOOK_SECRET = %q", got)
			}
			created := slices.Index(one.log, "POST /v1/event_subscriptions")
			published := slices.Index(one.log, "publish")
			retired := slices.Index(one.log, "PATCH /v1/event_subscriptions/old")
			if created < 0 || published < created || retired < published {
				t.Errorf("order = %v, want create, publish, then the old one deleted", one.log)
			}
			for _, sub := range one.chariot.subs {
				if sub["id"] != "sub-new" && sub["status"] != "deleted" {
					t.Errorf("%v still delivers", sub)
				}
			}
			if facts := one.lastFacts(); facts.Subscription == nil || facts.Subscription.Kind != "replaced" {
				t.Errorf("subscription = %+v", facts.Subscription)
			}
		})
	}
}

func TestAWriteThatDoesNotLandTakesTheNewSubscriptionDownAndLeavesTheOldOne(t *testing.T) {
	one := working(t)
	one.chariot.subs = []map[string]any{sub("old", endpoint, "active")}
	one.store = deployment.Written{Kind: deployment.WriteFailed, Detail: "cloudflare said no"}

	outcome := one.run()

	if outcome.Kind != Unstored || outcome.Written == nil || outcome.Written.Kind != deployment.WriteFailed ||
		len(outcome.Left) != 0 {
		t.Fatalf("outcome = %+v", outcome)
	}
	patched := one.chariot.asked(http.MethodPatch, "/v1/event_subscriptions/sub-new")
	if len(patched) != 1 || patched[0].body["status"] != "deleted" {
		t.Errorf("the new subscription was not taken down: %+v", patched)
	}
	if len(one.chariot.asked(http.MethodPatch, "/v1/event_subscriptions/old")) != 0 {
		t.Error("the subscription the deployment still verifies was taken down")
	}
	if one.chariot.subs[0]["status"] != "active" {
		t.Errorf("old = %v, want still active", one.chariot.subs[0])
	}
}

func TestANewSubscriptionThatWouldNotComeDownIsNamed(t *testing.T) {
	one := working(t)
	one.store = deployment.Written{Kind: deployment.WriteFailed}
	one.chariot.fail["PATCH /v1/event_subscriptions/sub-new"] = 500
	outcome := one.run()
	if outcome.Kind != Unstored || !slices.Equal(outcome.Left, []string{"sub-new"}) {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestAnOlderSubscriptionThatWouldNotComeDownIsNamedAfterTheWrite(t *testing.T) {
	one := working(t)
	one.chariot.subs = []map[string]any{sub("old", endpoint, "active")}
	one.chariot.fail["PATCH /v1/event_subscriptions/old"] = 500
	outcome := one.run()
	if outcome.Kind != Unretired || !slices.Equal(outcome.Left, []string{"old"}) {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.published) != 1 {
		t.Errorf("published %d times", len(one.published))
	}
}

func TestSubscriptionsThatCannotBeReadOrMadeWriteNothing(t *testing.T) {
	unread := working(t)
	unread.chariot.listFails = true
	outcome := unread.run()
	if outcome.Kind != Unread || outcome.Failure.Kind != Unreachable || len(unread.published) != 0 {
		t.Errorf("outcome = %+v, published %d", outcome, len(unread.published))
	}
	if len(unread.chariot.asked(http.MethodPost, "/v1/event_subscriptions")) != 0 {
		t.Error("a subscription was made beside a list nobody read")
	}

	refused := working(t)
	refused.chariot.fail["POST /v1/event_subscriptions"] = 400
	outcome = refused.run()
	if outcome.Kind != Unsubscribed || outcome.Failure.Kind != Rejected || len(refused.published) != 0 {
		t.Errorf("outcome = %+v, published %d", outcome, len(refused.published))
	}
}

func TestAnAddressThatIsNotHttpsIsNamedBeforeAnySubscription(t *testing.T) {
	one := working(t)
	one.address = deployment.Address{Kind: deployment.Deployed, WorkersDev: "http://w.example"}
	outcome := one.run()
	if outcome.Kind != Insecure || outcome.Origin != "http://w.example" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.chariot.asked(http.MethodPost, "/v1/event_subscriptions")) != 0 || len(one.published) != 0 {
		t.Error("a subscription was made for an address Chariot delivers to nothing at")
	}
}

func TestNoCredentialReachesAnythingTheChainHandsBack(t *testing.T) {
	for name, spoil := range map[string]func(*press){
		"done":         func(*press) {},
		"unauthorized": func(one *press) { one.chariot.fail["GET /v1/event_subscriptions"] = 401 },
		"unconnected":  func(one *press) { one.chariot.fail["POST /v1/connects"] = 400 },
		"unstored":     func(one *press) { one.store = deployment.Written{Kind: deployment.WriteFailed} },
	} {
		one := working(t)
		spoil(one)
		outcome := one.run()
		wire, err := json.Marshal(map[string]any{"outcome": outcome, "facts": one.facts})
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{key, minted, "connect-token-do-not-show"} {
			if strings.Contains(string(wire), secret) {
				t.Errorf("%s: %q reached %s", name, secret, wire)
			}
		}
	}
}
