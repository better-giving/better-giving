package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the half of a site-list save that reaches cloudflare.
//
// cloudflare is an httptest server here, so what is asserted is the whole press: the host list that
// goes onto the wire, this deployment's own address in front of it, and the widget's name never
// being one a page chose.

const worker = "/accounts/an-account/workers/scripts/"

// a cloudflare answering every call the levelling makes, and remembering each of them.
type standing struct {
	mutex sync.Mutex
	calls []string
	// bodies is the json body of every write, by `METHOD /path`, in the order they were made: one
	// path takes several bodies over a press, and which of them carried what is the assertion.
	bodies map[string][]map[string]any
	// widgets is whether the account holds one of this deployment's name.
	widgets bool
}

func (held *standing) called(at string, body map[string]any) {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	held.calls = append(held.calls, at)
	if body != nil {
		if held.bodies == nil {
			held.bodies = map[string][]map[string]any{}
		}
		held.bodies[at] = append(held.bodies[at], body)
	}
}

func (held *standing) saw(at string) bool {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	for _, one := range held.calls {
		if one == at {
			return true
		}
	}
	return false
}

func (held *standing) made() []string {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return append([]string{}, held.calls...)
}

func (held *standing) wrote(at string) []map[string]any {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return append([]map[string]any{}, held.bodies[at]...)
}

func (held *standing) serve(t *testing.T) *httptest.Server {
	t.Helper()
	name := release.Baked.Name
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		at := r.Method + " " + r.URL.Path
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		held.called(at, body)

		switch {
		case at == "GET /accounts/an-account/challenges/widgets":
			held.mutex.Lock()
			rows := []any{}
			if held.widgets {
				rows = append(rows, map[string]any{
					"name": release.Baked.TurnstileWidgetName, "sitekey": "0x4",
					"mode": "managed", "domains": []any{"example.org"},
				})
			}
			held.mutex.Unlock()
			_ = json.NewEncoder(w).Encode(paged(rows))
		case strings.HasPrefix(at, "GET /accounts/an-account/challenges/widgets/"),
			strings.HasPrefix(at, "PUT /accounts/an-account/challenges/widgets/"):
			_ = json.NewEncoder(w).Encode(resulting(map[string]any{
				"name": release.Baked.TurnstileWidgetName, "sitekey": "0x4",
				"secret": "0x0secret", "mode": "managed", "domains": []any{"example.org"},
			}))
		// the three the deployment's own address is read off, which is the host that goes up in
		// front of every ticked site.
		case at == "GET "+worker+name+"/subdomain":
			_ = json.NewEncoder(w).Encode(resulting(map[string]any{"enabled": true}))
		case at == "GET /accounts/an-account/workers/subdomain":
			_ = json.NewEncoder(w).Encode(resulting(map[string]any{"subdomain": "hound"}))
		case at == "GET /accounts/an-account/workers/domains":
			_ = json.NewEncoder(w).Encode(resulting([]any{}))
		default:
			_ = json.NewEncoder(w).Encode(resulting(map[string]any{"id": name}))
		}
	}))
	t.Cleanup(api.Close)
	return api
}

func paged(rows []any) map[string]any {
	return map[string]any{
		"success": true, "errors": []any{}, "result": rows,
		"result_info": map[string]any{
			"page": 1.0, "per_page": 100.0, "total_count": float64(len(rows)),
		},
	}
}

// a console signed in and holding an account, with cloudflare faked.
//
// the levelling spends the operator's own cloudflare credential and asks no deployment anything, so
// there is no deployment here and no session on one.
func covering(t *testing.T, held *standing) http.Handler {
	t.Helper()
	records, flow, accounts := machine(t, "an-account")
	api := held.serve(t)

	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Records:  records,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Sends:    func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
	})
}

// the account holds a widget already, so a levelling is a read of its domains and one PUT over
// them — which is where a case reads what this console decided to cover.
func levelled(t *testing.T, handler http.Handler, held *standing, posted string) []any {
	t.Helper()
	status, answer := press(t, handler, "/api/widget/level", posted)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %v", status, answer)
	}
	wrote := held.wrote("PUT /accounts/an-account/challenges/widgets/0x4")
	if len(wrote) != 1 {
		t.Fatalf("%d writes were made to the widget; the press called %v", len(wrote), held.made())
	}
	domains, _ := wrote[0]["domains"].([]any)
	return domains
}

func TestALevellingCoversThisDeploymentsOwnHostWhateverIsTicked(t *testing.T) {
	// the donation page is a route on this deployment and is on no site row, so an operator who
	// unticks every site would otherwise leave their own page challenging nobody.
	held := &standing{widgets: true}
	handler := covering(t, held)

	domains := levelled(t, handler, held, `{"sites":[]}`)
	if len(domains) != 1 || domains[0] != release.Baked.Name+".hound.workers.dev" {
		t.Errorf("the widget went up covering %v, want this deployment's own host", domains)
	}
}

func TestALevellingPutsThisDeploymentsOwnHostInFrontOfTheTickedSites(t *testing.T) {
	held := &standing{widgets: true}
	handler := covering(t, held)

	domains := levelled(t, handler, held, `{"sites":["https://give.example.org"]}`)
	if len(domains) != 2 || domains[0] != release.Baked.Name+".hound.workers.dev" ||
		domains[1] != "give.example.org" {
		t.Errorf("the widget went up covering %v, want this deployment's own host first", domains)
	}
}

func TestTheLevellingBringsCloudflaresCopyOfTheListBehindWhatTheDeploymentStored(t *testing.T) {
	held := &standing{widgets: true}
	handler := covering(t, held)

	status, answer := press(t, handler, "/api/widget/level",
		`{"sites":["https://example.org","https://give.example.org"]}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %v", status, answer)
	}
	if answer["kind"] != "levelled" {
		t.Fatalf("answer = %v", answer)
	}
	if !held.saw("PUT /accounts/an-account/challenges/widgets/0x4") {
		t.Errorf("the widget was never written to; the press called %v", held.made())
	}
}

func TestALevellingNamesNoWidgetThePageChose(t *testing.T) {
	// a name that travelled through a page is a widget somebody else's account is levelled against,
	// so the press carries the list and the widget's name is the baked release's.
	held := &standing{}
	handler := covering(t, held)

	status, answer := press(t, handler, "/api/widget/level",
		`{"sites":["https://example.org"],"name":"somebody-elses"}`)
	if status != http.StatusBadRequest {
		t.Errorf("status = %d: %v", status, answer)
	}
	if len(held.made()) != 0 {
		t.Errorf("cloudflare was asked %v", held.made())
	}
}
