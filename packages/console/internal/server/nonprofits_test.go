package server

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/nonprofits"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
)

// finding an organisation in the IRS nonprofit API, on the operator's behalf.

// an API answering every request with one status and body, and every path and query that reached it.
func nonprofitAPI(t *testing.T, status int, body string) (*nonprofits.Client, func() []string) {
	t.Helper()
	var held sync.Mutex
	asked := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		held.Lock()
		asked = append(asked, r.URL.RequestURI())
		held.Unlock()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(api.Close)
	return nonprofits.At(api.URL), func() []string {
		held.Lock()
		defer held.Unlock()
		return slices.Clone(asked)
	}
}

// a console finding organisations through `lookups`, or through the address it was built with
// where that is nil.
func finding(t *testing.T, lookups *nonprofits.Client) http.Handler {
	t.Helper()
	flow := oauth.New(oauth.Options{Store: state.At(t.TempDir())})
	t.Cleanup(flow.Stop)
	return New(Options{
		UI:         http.NotFoundHandler(),
		Flow:       flow,
		Accounts:   account.New(state.At(t.TempDir())),
		Nonprofits: lookups,
	})
}

// one read as the console's own page makes it, decoded.
func found(t *testing.T, console http.Handler, path string) (int, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = loopback
	answer := httptest.NewRecorder()
	console.ServeHTTP(answer, request)
	var read map[string]any
	if err := json.Unmarshal(answer.Body.Bytes(), &read); err != nil {
		t.Fatalf("GET %s answered something that is not json: %v", path, err)
	}
	return answer.Code, read
}

const redCross = `{
	"ein": "530196605",
	"name": "American National Red Cross",
	"address": {"street": "431 18th St NW", "city": "Washington", "state": "DC", "zip": "20006-5310"},
	"status": {"deductible": true, "revoked": true, "revocation_date": "2019-05-15", "reinstatement_date": null},
	"filing": {"website": null}
}`

// the organisation's members, every one of them written whatever the state.
var organisationFields = []string{
	"address_line1", "city", "deductible", "ein", "name", "postal_code", "region", "revokedOn", "website",
}

func TestALookedUpOrganisationIsAnsweredWithEveryFieldOfTheFill(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, redCross)

	status, body := found(t, finding(t, api), "/api/nonprofits/53-0196605")

	if status != http.StatusOK || body["state"] != "found" {
		t.Fatalf("%d %v, want found", status, body)
	}
	want := map[string]any{
		"ein":           "530196605",
		"name":          "American National Red Cross",
		"address_line1": "431 18th St NW",
		"city":          "Washington",
		"region":        "DC",
		"postal_code":   "20006-5310",
		"deductible":    true,
		"revokedOn":     "2019-05-15",
		"website":       "",
	}
	if got, _ := body["organisation"].(map[string]any); !maps.Equal(got, want) {
		t.Errorf("organisation = %v, want %v", got, want)
	}
	if got := asked(); !slices.Equal(got, []string{"/v1/organizations/530196605"}) {
		t.Errorf("asked %q, want one lookup by the EIN's digits", got)
	}
}

func TestALookupThatFoundNothingStillWritesEveryFieldEmpty(t *testing.T) {
	for _, one := range []struct {
		name   string
		api    *nonprofits.Client
		answer string
	}{
		{"unknown", func() *nonprofits.Client { api, _ := nonprofitAPI(t, http.StatusNotFound, `{}`); return api }(), "not_found"},
		{"failing", func() *nonprofits.Client { api, _ := nonprofitAPI(t, http.StatusBadGateway, ``); return api }(), "unavailable"},
		// a console built with no address, which is every console until the API has one.
		{"no address", nil, "unavailable"},
	} {
		t.Run(one.name, func(t *testing.T) {
			status, body := found(t, finding(t, one.api), "/api/nonprofits/530196605")

			organisation, _ := body["organisation"].(map[string]any)
			if status != http.StatusOK || body["state"] != one.answer {
				t.Fatalf("%d %v, want %s", status, body, one.answer)
			}
			if got := slices.Sorted(maps.Keys(organisation)); !slices.Equal(got, organisationFields) {
				t.Errorf("organisation carries %q, want every field %q", got, organisationFields)
			}
			for field, value := range organisation {
				if value != "" && value != false {
					t.Errorf("%s = %v, want it empty", field, value)
				}
			}
		})
	}
}

func TestALookupOfSomethingThatIsNotAnEINIsRefusedNamingIt(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, redCross)

	status, body := found(t, finding(t, api), "/api/nonprofits/53-01966")

	said, _ := body["error"].(string)
	if status != http.StatusBadRequest || !strings.Contains(said, `"53-01966"`) {
		t.Errorf("%d %v, want 400 naming the value", status, body)
	}
	if got := asked(); len(got) != 0 {
		t.Errorf("asked %q, want nothing", got)
	}
}

func TestASearchIsAnsweredWithItsMatches(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, `{"results": [{"ein": "530196605", "name": "Red Cross",
		"city": "Washington", "state": "DC", "status": {"deductible": true, "revoked": false}}]}`)

	status, body := found(t, finding(t, api), "/api/nonprofits/search?q=Red+Cross")

	want := map[string]any{"state": "ok", "matches": []any{map[string]any{
		"ein": "530196605", "name": "Red Cross", "city": "Washington", "state": "DC",
		"deductible": true, "revokedOn": "",
	}}}
	if status != http.StatusOK || !jsonEqual(body, want) {
		t.Errorf("%d %v, want %v", status, body, want)
	}
	if got := asked(); !slices.Equal(got, []string{"/v1/organizations?q=red+cross"}) {
		t.Errorf("asked %q, want one search", got)
	}
}

func TestASearchThatCouldNotBeMadeListsNothingRatherThanNull(t *testing.T) {
	status, body := found(t, finding(t, nil), "/api/nonprofits/search?q=red+cross")

	want := map[string]any{"state": "unavailable", "matches": []any{}}
	if status != http.StatusOK || !jsonEqual(body, want) {
		t.Errorf("%d %v, want %v", status, body, want)
	}
}

func TestASearchOfFewerThanThreeCharactersIsRefusedNamingTheBox(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, `{"results": []}`)
	console := finding(t, api)

	for _, path := range []string{
		"/api/nonprofits/search?q=ab",
		"/api/nonprofits/search?q=++ab++",
		"/api/nonprofits/search?q=",
		"/api/nonprofits/search",
	} {
		status, body := found(t, console, path)

		said, _ := body["error"].(string)
		if status != http.StatusBadRequest || !strings.Contains(said, "search box") {
			t.Errorf("%s: %d %v, want 400 naming the search box", path, status, body)
		}
	}
	if got := asked(); len(got) != 0 {
		t.Errorf("asked %q, want nothing", got)
	}
}

func TestASearchLongerThanAnyNameIsRefusedNamingTheBox(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, `{"results": []}`)

	status, body := found(t, finding(t, api), "/api/nonprofits/search?q="+strings.Repeat("a", 201))

	said, _ := body["error"].(string)
	if status != http.StatusBadRequest || !strings.Contains(said, "search box") || len(asked()) != 0 {
		t.Errorf("%d %v and asked %q, want 400 naming the search box and nothing asked",
			status, body, asked())
	}
}

func TestASearchForAnEINIsALookupByIt(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, redCross)

	status, body := found(t, finding(t, api), "/api/nonprofits/search?q=53-0196605")

	matches, _ := body["matches"].([]any)
	if status != http.StatusOK || body["state"] != "ok" || len(matches) != 1 {
		t.Fatalf("%d %v, want one match", status, body)
	}
	if got := asked(); !slices.Equal(got, []string{"/v1/organizations/530196605"}) {
		t.Errorf("asked %q, want the lookup by EIN", got)
	}
}

func TestAnotherPageCannotSpendTheLookups(t *testing.T) {
	api, asked := nonprofitAPI(t, http.StatusOK, redCross)
	console := finding(t, api)

	for _, path := range []string{"/api/nonprofits/530196605", "/api/nonprofits/search?q=red+cross"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Host = loopback
		request.Header.Set("Sec-Fetch-Site", "cross-site")
		answer := httptest.NewRecorder()
		console.ServeHTTP(answer, request)

		if answer.Code != http.StatusForbidden {
			t.Errorf("%s answered %d, want %d", path, answer.Code, http.StatusForbidden)
		}
	}
	if got := asked(); len(got) != 0 {
		t.Errorf("asked %q, want nothing", got)
	}
}

// whether two decoded bodies are the same json.
func jsonEqual(a, b any) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return string(left) == string(right)
}
