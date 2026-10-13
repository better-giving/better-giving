package nonprofits

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// an upstream answering every request with `answer`, and every path and query that reached it.
func upstream(t *testing.T, answer http.HandlerFunc) (*Client, func() []string) {
	t.Helper()
	var held sync.Mutex
	asked := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		held.Lock()
		asked = append(asked, r.URL.RequestURI())
		held.Unlock()
		answer(w, r)
	}))
	t.Cleanup(server.Close)
	return At(server.URL), func() []string {
		held.Lock()
		defer held.Unlock()
		return slices.Clone(asked)
	}
}

// one body at one status.
func says(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

// GET /v1/orgs/530196605 as the API answers it, provenance and finances included.
const redCross = `{
	"ein": "530196605",
	"name": "American National Red Cross",
	"address": {"street": "431 18th St NW", "city": "Washington", "state": "DC", "zip": "20006-5310"},
	"is501c3": true,
	"deductible": true,
	"revoked": false,
	"revocationDate": null,
	"reinstatementDate": null,
	"mission": "\n  Prevents and alleviates human suffering in the face of emergencies.  ",
	"activitySummary": "Disaster relief, blood services and training.",
	"programs": [{"description": "Disaster cycle services", "expense": 1200000000, "grants": null, "revenue": null}],
	"finances": {"revenue": 3200000000, "expenses": 3100000000, "assets": 4100000000, "taxYear": 2023},
	"website": "https://www.redcross.org",
	"notes": [],
	"provenance": {
		"name": {"file": "https://www.irs.gov/pub/irs-soi/eo1.csv", "releasedAt": "2026-08-12T00:00:00Z", "fetchedAt": "2026-08-14T03:00:00Z"},
		"mission": {"file": "https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_01A.zip", "releasedAt": "2026-01-10T00:00:00Z", "fetchedAt": "2026-08-14T03:00:00Z", "objectId": "202500119349300100", "taxYear": 2023, "formType": "990"}
	}
}`

// a transport that counts what reached it and answers nothing, for a client that must make no call.
type counted struct{ calls int }

func (c *counted) RoundTrip(*http.Request) (*http.Response, error) {
	c.calls++
	return nil, http.ErrHandlerTimeout
}

func TestAClientWithNoAddressAnswersUnavailableAndAsksNothing(t *testing.T) {
	transport := &counted{}
	client := At("")
	client.http = &http.Client{Transport: transport}

	looked := client.LookUp(t.Context(), "12-3456789")
	searched := client.Search(t.Context(), "red cross")

	if looked.State != Unavailable || searched.State != SearchUnavailable {
		t.Errorf("lookup = %q, search = %q, want both unavailable", looked.State, searched.State)
	}
	if transport.calls != 0 {
		t.Errorf("%d requests were made, want none", transport.calls)
	}
	if New().base != API {
		t.Errorf("New is built on %q, want the fixed address", New().base)
	}
}

func TestAFoundOrganisationIsAnsweredWithItsLegalDetails(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, redCross))

	looked := client.LookUp(t.Context(), "53-0196605")

	if got := asked(); !slices.Equal(got, []string{"/v1/orgs/530196605"}) {
		t.Errorf("asked %q, want the EIN's digits under /v1/orgs", got)
	}
	want := Lookup{State: Found, Organisation: Organisation{
		EIN:          "530196605",
		Name:         "American National Red Cross",
		AddressLine1: "431 18th St NW",
		City:         "Washington",
		Region:       "DC",
		PostalCode:   "20006-5310",
		Deductible:   true,
		RevokedOn:    "",
		Website:      "https://www.redcross.org",
		Mission:      "Prevents and alleviates human suffering in the face of emergencies.",
	}}
	if looked != want {
		t.Errorf("looked up %+v, want %+v", looked, want)
	}
}

// a filing that states no mission, or states one blank, fills the box with nothing rather than with
// whitespace an operator would have to find and clear.
func TestAFilingWithNoMissionAnswersAnEmptyOne(t *testing.T) {
	for _, mission := range []string{`null`, `" \n\t "`} {
		body := strings.Replace(redCross,
			`"\n  Prevents and alleviates human suffering in the face of emergencies.  "`, mission, 1)
		client, _ := upstream(t, says(http.StatusOK, body))

		looked := client.LookUp(t.Context(), "53-0196605")

		if looked.State != Found || looked.Organisation.Mission != "" {
			t.Errorf("a mission of %s looked up %+v, want found with no mission", mission, looked)
		}
	}
}

// a filing's mission past the profile's cap is cut to it, so the box it fills saves: the cap is
// counted in UTF-16 code units, as the profile rule's `.max` counts a string, and a cut never
// leaves half of a character that takes two.
func TestAMissionOverTheCapIsCutToIt(t *testing.T) {
	for _, one := range []struct {
		said string
		want string
	}{
		{strings.Repeat("a", 2000), strings.Repeat("a", 2000)},
		{strings.Repeat("a", 2001), strings.Repeat("a", 2000)},
		// two bytes each and one code unit each: two thousand of them are at the cap, not past it.
		{strings.Repeat("é", 2000), strings.Repeat("é", 2000)},
		// two code units each: the thousandth ends at the cap and the next does not fit.
		{strings.Repeat("😀", 1001), strings.Repeat("😀", 1000)},
		{strings.Repeat("a", 1999) + "😀", strings.Repeat("a", 1999)},
		{strings.Repeat("a", 1999) + " b", strings.Repeat("a", 1999)},
	} {
		said, _ := json.Marshal(one.said)
		body := strings.Replace(redCross,
			`"\n  Prevents and alleviates human suffering in the face of emergencies.  "`, string(said), 1)
		client, _ := upstream(t, says(http.StatusOK, body))

		looked := client.LookUp(t.Context(), "53-0196605")

		if looked.State != Found || looked.Organisation.Mission != one.want {
			t.Errorf("a mission of %d characters looked up as %d, want %d",
				len([]rune(one.said)), len([]rune(looked.Organisation.Mission)), len([]rune(one.want)))
		}
	}
}

func TestAnEINIsNineDigitsWithOneOptionalDashAfterTheSecond(t *testing.T) {
	for _, one := range []struct {
		typed string
		want  string
		ok    bool
	}{
		{"530196605", "530196605", true},
		{"53-0196605", "530196605", true},
		{"  53-0196605 ", "530196605", true},
		{"5301966", "", false},
		{"5301966050", "", false},
		{"530-196605", "", false},
		{"53--0196605", "", false},
		{"53 0196605", "", false},
		{"53019660x", "", false},
		{"５30196605", "", false},
		{"", "", false},
	} {
		got, ok := EIN(one.typed)
		if got != one.want || ok != one.ok {
			t.Errorf("EIN(%q) = %q %v, want %q %v", one.typed, got, ok, one.want, one.ok)
		}
	}
}

func TestALookupOfSomethingThatIsNotAnEINAsksNothing(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, redCross))

	looked := client.LookUp(t.Context(), "53-01966")

	if looked.State != Unavailable || len(asked()) != 0 {
		t.Errorf("looked up %q and asked %q, want unavailable and nothing asked", looked.State, asked())
	}
}

// a refusal as the API answers one: problem json with its code, and a 429's `Retry-After` of 37s.
func refused(status int, code string) http.HandlerFunc {
	if status == http.StatusTooManyRequests {
		return limited(code, "37")
	}
	return problem(status, code)
}

// a 429 of `code` with `Retry-After` as given, or with none where it is empty.
func limited(code, retryAfter string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if retryAfter != "" {
			w.Header().Set("Retry-After", retryAfter)
		}
		problem(http.StatusTooManyRequests, code)(w, r)
	}
}

func problem(status int, code string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"type": "about:blank", "title": %q, "status": %d, "detail": "what to do", "code": %q}`,
			http.StatusText(status), status, code)
	}
}

func TestALookupThatFoundNothingIsSortedFromOneThatCouldNotBeMade(t *testing.T) {
	for _, one := range []struct {
		name   string
		answer http.HandlerFunc
		want   LookupState
	}{
		{"unknown", refused(http.StatusNotFound, "not_found"), NotFound},
		// a 404 with no such code is a path the API does not serve, which says nothing of the EIN.
		{"unknown path", says(http.StatusNotFound, `{"error": "no route"}`), Unavailable},
		{"no name", says(http.StatusOK, strings.Replace(redCross, `"American National Red Cross"`, `""`, 1)), NotFound},
		{"null name", says(http.StatusOK, strings.Replace(redCross, `"American National Red Cross"`, `null`, 1)), NotFound},
		{"refused as invalid", refused(http.StatusBadRequest, "invalid_ein"), Unavailable},
		{"refused a key", refused(http.StatusUnauthorized, "invalid_api_key"), Unavailable},
		{"day used up", refused(http.StatusTooManyRequests, "daily_quota_exceeded"), Unavailable},
		{"service day used up", refused(http.StatusTooManyRequests, "service_daily_limit_reached"), Unavailable},
		{"no data", refused(http.StatusServiceUnavailable, "data_unavailable"), Unavailable},
		{"no auth", refused(http.StatusServiceUnavailable, "auth_unavailable"), Unavailable},
		{"failing", says(http.StatusInternalServerError, `{"error":"boom"}`), Unavailable},
		{"not json", says(http.StatusOK, `<html>a captive portal</html>`), Unavailable},
		{"another shape", says(http.StatusOK, `{"ein": 530196605, "name": ["x"]}`), Unavailable},
		{"another organisation", says(http.StatusOK, strings.Replace(redCross, "530196605", "131624241", 1)), Unavailable},
		{"oversize", says(http.StatusOK, `{"ein":"530196605","name":"`+strings.Repeat("x", answerBytes)+`"}`), Unavailable},
	} {
		t.Run(one.name, func(t *testing.T) {
			client, asked := upstream(t, one.answer)

			looked := client.LookUp(t.Context(), "530196605")

			if looked != (Lookup{State: one.want}) {
				t.Errorf("looked up %+v, want %q with every field empty", looked, one.want)
			}
			if got := asked(); len(got) != 1 {
				t.Errorf("asked %q, want one request and no retry", got)
			}
		})
	}
}

func TestALookupTheAPITakesTooLongOverIsUnavailable(t *testing.T) {
	release := make(chan struct{})
	client, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	defer close(release)
	client.within = 50 * time.Millisecond

	looked := client.LookUp(t.Context(), "530196605")

	if looked.State != Unavailable {
		t.Errorf("looked up %q, want unavailable", looked.State)
	}
}

// `revoked` is the API's own reading — revoked and not reinstated since — so the date is shown
// where it says so and nowhere else.
func TestRevokedOnIsTheRevocationDateWhereTheAPISaysRevoked(t *testing.T) {
	for _, one := range []struct {
		name   string
		status string
		want   string
	}{
		{"never revoked", `"revoked": false, "revocationDate": null, "reinstatementDate": null`, ""},
		{"revoked", `"revoked": true, "revocationDate": "2019-05-15", "reinstatementDate": null`, "2019-05-15"},
		{"reinstated since", `"revoked": false, "revocationDate": "2019-05-15", "reinstatementDate": "2021-02-01"`, ""},
		{"revocation list not yet read", `"revoked": null, "revocationDate": null, "reinstatementDate": null`, ""},
		{"revoked with no date to show", `"revoked": true, "revocationDate": null, "reinstatementDate": null`, ""},
		{"revoked on a date in another spelling", `"revoked": true, "revocationDate": "05/15/2019", "reinstatementDate": null`, ""},
	} {
		t.Run(one.name, func(t *testing.T) {
			body := strings.Replace(redCross,
				`"revoked": false,
	"revocationDate": null,
	"reinstatementDate": null`, one.status, 1)
			client, _ := upstream(t, says(http.StatusOK, body))

			looked := client.LookUp(t.Context(), "530196605")

			if looked.State != Found || looked.Organisation.RevokedOn != one.want {
				t.Errorf("looked up %q revoked on %q, want found revoked on %q",
					looked.State, looked.Organisation.RevokedOn, one.want)
			}
		})
	}
}

func TestAnEINLookedUpOnceIsNotAskedForAgainHoweverItIsTyped(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, redCross))

	first := client.LookUp(t.Context(), "530196605")
	second := client.LookUp(t.Context(), " 53-0196605")

	if first != second || first.State != Found {
		t.Errorf("first = %+v, second = %+v, want the same found answer twice", first, second)
	}
	if got := asked(); len(got) != 1 {
		t.Errorf("asked %q, want one request", got)
	}
}

func TestAnEINNobodyHoldsIsRememberedAsUnknown(t *testing.T) {
	client, asked := upstream(t, refused(http.StatusNotFound, "not_found"))

	client.LookUp(t.Context(), "530196605")
	again := client.LookUp(t.Context(), "530196605")

	if again.State != NotFound || len(asked()) != 1 {
		t.Errorf("looked up %q and asked %q, want not_found from one request", again.State, asked())
	}
}

func TestALookupThatCouldNotBeMadeIsMadeAgainNextTime(t *testing.T) {
	var held sync.Mutex
	failing := true
	client, asked := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		held.Lock()
		down := failing
		failing = false
		held.Unlock()
		if down {
			says(http.StatusBadGateway, `{}`)(w, r)
			return
		}
		says(http.StatusOK, redCross)(w, r)
	})

	first := client.LookUp(t.Context(), "530196605")
	second := client.LookUp(t.Context(), "530196605")

	if first.State != Unavailable || second.State != Found || len(asked()) != 2 {
		t.Errorf("first = %q, second = %q, asked %q, want unavailable then found over two requests",
			first.State, second.State, asked())
	}
}

func TestLookupsOfOneEINInFlightTogetherAskOnce(t *testing.T) {
	release := make(chan struct{})
	client, asked := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
		says(http.StatusOK, redCross)(w, r)
	})

	answers := make(chan Lookup, 4)
	for range cap(answers) {
		go func() { answers <- client.LookUp(t.Context(), "53-0196605") }()
	}
	// every caller is either the one asking or waiting on it before the answer is let out.
	for len(asked()) == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)

	for range cap(answers) {
		if one := <-answers; one.State != Found {
			t.Errorf("a caller got %q, want found", one.State)
		}
	}
	if got := asked(); len(got) != 1 {
		t.Errorf("asked %q, want one request", got)
	}
}

// one result of GET /v1/search as the API lists it.
func entry(ein, name string) string {
	return `{"ein": "` + ein + `", "name": "` + name + `", "city": "Washington", "state": "DC",
		"is501c3": true, "deductible": true, "provenance": {"is501c3": null, "deductible": null}}`
}

func TestASearchIsAnsweredWithTheMatchesTheAPIListed(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, `{"query": "red cross", "limit": 10, "results": [
		`+entry("530196605", "American National Red Cross")+`,
		{"ein": "131624241", "name": "Red Crescent", "city": null, "state": null, "is501c3": null,
			"deductible": null, "provenance": {"is501c3": null, "deductible": null}}
	]}`))

	searched := client.Search(t.Context(), "  Red   CROSS ")

	if got := asked(); !slices.Equal(got, []string{"/v1/search?q=red+cross&limit=10"}) {
		t.Errorf("asked %q, want the query trimmed, folded and lowercased, for ten", got)
	}
	// search carries no revocation: a revoked organisation says so once it is looked up.
	want := []Match{
		{EIN: "530196605", Name: "American National Red Cross", City: "Washington", State: "DC",
			Deductible: true},
		{EIN: "131624241", Name: "Red Crescent"},
	}
	if searched.State != Listed || !slices.Equal(searched.Matches, want) {
		t.Errorf("searched %+v, want ok with %+v", searched, want)
	}
}

func TestASearchKeepsTenMatchesAndNoneItCannotFillFrom(t *testing.T) {
	entries := []string{
		`{"ein": "12-345", "name": "not an EIN"}`,
		`{"ein": "999999999", "name": ""}`,
	}
	for n := range 12 {
		entries = append(entries, entry(strings.Repeat(string(rune('0'+n%10)), 9), "Org"))
	}
	client, _ := upstream(t, says(http.StatusOK, `{"results": [`+strings.Join(entries, ",")+`]}`))

	searched := client.Search(t.Context(), "org")

	if searched.State != Listed || len(searched.Matches) != 10 || searched.Matches[0].EIN != "000000000" {
		t.Errorf("searched %q with %d matches starting %+v, want ok with the first ten fillable",
			searched.State, len(searched.Matches), searched.Matches)
	}
}

func TestASearchNothingMatchedListsNothingRatherThanNull(t *testing.T) {
	client, _ := upstream(t, says(http.StatusOK, `{"results": []}`))

	searched := client.Search(t.Context(), "zzzz")

	if searched.State != Listed || searched.Matches == nil || len(searched.Matches) != 0 {
		t.Errorf("searched %+v, want ok with an empty, non-nil list", searched)
	}
}

func TestASearchThatCouldNotBeMadeIsUnavailableWithNoMatches(t *testing.T) {
	for _, one := range []struct {
		name   string
		answer http.HandlerFunc
	}{
		{"failing", says(http.StatusInternalServerError, `{}`)},
		{"unknown path", says(http.StatusNotFound, `{"code": "not_found"}`)},
		{"not json", says(http.StatusOK, `nope`)},
		{"no list", says(http.StatusOK, `{"results": null}`)},
		{"another shape", says(http.StatusOK, `{"results": {"ein": "530196605"}}`)},
		{"oversize", says(http.StatusOK, `{"results": [], "pad": "`+strings.Repeat("x", answerBytes)+`"}`)},
	} {
		t.Run(one.name, func(t *testing.T) {
			client, _ := upstream(t, one.answer)

			searched := client.Search(t.Context(), "red cross")

			if searched.State != SearchUnavailable || searched.Matches == nil || len(searched.Matches) != 0 {
				t.Errorf("searched %+v, want unavailable with an empty, non-nil list", searched)
			}
		})
	}
}

func TestASearchMadeOnceIsNotAskedForAgainHoweverItIsSpaced(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, `{"results": [`+entry("530196605", "Red Cross")+`]}`))

	first := client.Search(t.Context(), "red cross")
	second := client.Search(t.Context(), " Red\tCross  ")

	if !slices.Equal(first.Matches, second.Matches) || len(first.Matches) != 1 {
		t.Errorf("first = %+v, second = %+v, want the same one match twice", first, second)
	}
	if got := asked(); len(got) != 1 {
		t.Errorf("asked %q, want one request", got)
	}
}

func TestASearchThatCouldNotBeMadeIsMadeAgainNextTime(t *testing.T) {
	client, asked := upstream(t, says(http.StatusServiceUnavailable, `{}`))

	client.Search(t.Context(), "red cross")
	client.Search(t.Context(), "red cross")

	if got := asked(); len(got) != 2 {
		t.Errorf("asked %q, want both searches asked", got)
	}
}

func TestASearchForAnEINIsALookupAnsweredAsAList(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		client, asked := upstream(t, says(http.StatusOK, redCross))

		searched := client.Search(t.Context(), "53-0196605")
		looked := client.LookUp(t.Context(), "530196605")

		want := []Match{{EIN: "530196605", Name: "American National Red Cross", City: "Washington",
			State: "DC", Deductible: true}}
		if searched.State != Listed || !slices.Equal(searched.Matches, want) {
			t.Errorf("searched %+v, want ok with %+v", searched, want)
		}
		// the lookup that fills the details after a pick is the one the search already made.
		if got := asked(); !slices.Equal(got, []string{"/v1/orgs/530196605"}) || looked.State != Found {
			t.Errorf("asked %q, then looked up %q, want one lookup by EIN serving both", got, looked.State)
		}
	})
	t.Run("unknown", func(t *testing.T) {
		client, _ := upstream(t, refused(http.StatusNotFound, "not_found"))

		searched := client.Search(t.Context(), "530196605")

		if searched.State != Listed || searched.Matches == nil || len(searched.Matches) != 0 {
			t.Errorf("searched %+v, want ok with an empty list", searched)
		}
	})
	t.Run("unavailable", func(t *testing.T) {
		client, _ := upstream(t, says(http.StatusInternalServerError, `{}`))

		searched := client.Search(t.Context(), "530196605")

		if searched.State != SearchUnavailable || searched.Matches == nil {
			t.Errorf("searched %+v, want unavailable with an empty list", searched)
		}
	})
}

// an upstream that holds every request until `release` is closed, then answers `body`.
func held(t *testing.T, body string) (*Client, func() []string, chan struct{}) {
	t.Helper()
	release := make(chan struct{})
	client, asked := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
		says(http.StatusOK, body)(w, r)
	})
	return client, asked, release
}

// blocks until the upstream has been asked once.
func reached(asked func() []string) {
	for len(asked()) == 0 {
		time.Sleep(time.Millisecond)
	}
}

func TestACallerThatGivesUpStillLeavesTheAnswerRemembered(t *testing.T) {
	client, asked, release := held(t, redCross)
	ctx, cancel := context.WithCancel(t.Context())
	first := make(chan Lookup, 1)
	go func() { first <- client.LookUp(ctx, "530196605") }()
	reached(asked)

	cancel()
	if gave := <-first; gave.State != Unavailable {
		t.Errorf("the caller that gave up got %q, want unavailable", gave.State)
	}
	close(release)
	second := client.LookUp(t.Context(), "530196605")

	if second.State != Found || len(asked()) != 1 {
		t.Errorf("then looked up %q over %q, want found from the one request already made",
			second.State, asked())
	}
}

func TestAWaiterThatGivesUpReturnsWhileAnotherGetsTheAnswer(t *testing.T) {
	client, asked, release := held(t, `{"results": [`+entry("530196605", "Red Cross")+`]}`)
	first := make(chan Search, 1)
	go func() { first <- client.Search(t.Context(), "red cross") }()
	reached(asked)

	gone, cancel := context.WithCancel(t.Context())
	cancel()
	if gave := client.Search(gone, "Red Cross"); gave.State != SearchUnavailable || gave.Matches == nil {
		t.Errorf("the waiter that gave up got %+v, want unavailable with an empty list", gave)
	}
	close(release)

	if got := <-first; got.State != Listed || len(got.Matches) != 1 {
		t.Errorf("the caller still waiting got %+v, want ok with its match", got)
	}
	if again := client.Search(t.Context(), "red cross"); again.State != Listed || len(asked()) != 1 {
		t.Errorf("then searched %q over %q, want ok from the one request", again.State, asked())
	}
}

// an upstream answering each request with the next of `answers`, the last one again once they run
// out, and a client on it whose waits are recorded rather than slept.
func turns(t *testing.T, answers ...http.HandlerFunc) (*Client, func() []string, *[]time.Duration) {
	t.Helper()
	var held sync.Mutex
	next := 0
	client, asked := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		held.Lock()
		one := answers[min(next, len(answers)-1)]
		next++
		held.Unlock()
		one(w, r)
	})
	waited := &[]time.Duration{}
	client.wait = func(_ context.Context, d time.Duration) bool {
		*waited = append(*waited, d)
		return true
	}
	return client, asked, waited
}

func TestAPerMinuteRefusalIsWaitedOutOnceAndAskedAgain(t *testing.T) {
	client, asked, waited := turns(t,
		refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"), says(http.StatusOK, redCross))

	looked := client.LookUp(t.Context(), "530196605")

	if looked.State != Found {
		t.Errorf("looked up %q, want found on the second ask", looked.State)
	}
	if got := asked(); len(got) != 2 {
		t.Errorf("asked %q, want two requests", got)
	}
	if !slices.Equal(*waited, []time.Duration{37 * time.Second}) {
		t.Errorf("waited %v, want the 37s Retry-After named", *waited)
	}
}

func TestASecondPerMinuteRefusalIsUnavailableAndForgotten(t *testing.T) {
	client, asked, waited := turns(t, refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"))

	looked := client.LookUp(t.Context(), "530196605")

	if looked != (Lookup{State: Unavailable}) || len(asked()) != 2 || len(*waited) != 1 {
		t.Errorf("looked up %+v over %q after waiting %v, want unavailable over two requests and one wait",
			looked, asked(), *waited)
	}
	client.LookUp(t.Context(), "530196605")
	if got := asked(); len(got) != 4 {
		t.Errorf("asked %q, want the next lookup to ask again", got)
	}
}

func TestTheWaitIsTheRetryAfterNamedUpToAMinute(t *testing.T) {
	for _, one := range []struct {
		retryAfter string
		want       time.Duration
	}{
		{"0", 0},
		{"59", 59 * time.Second},
		{"60", time.Minute},
	} {
		client, asked, waited := turns(t, limited("per_minute_limit_exceeded", one.retryAfter),
			says(http.StatusOK, redCross))

		looked := client.LookUp(t.Context(), "530196605")

		if !slices.Equal(*waited, []time.Duration{one.want}) || looked.State != Found || len(asked()) != 2 {
			t.Errorf("Retry-After %q waited %v and looked up %q over %q, want %v and found on the second ask",
				one.retryAfter, *waited, looked.State, asked(), one.want)
		}
	}
}

// a minute's refusal that names a longer wait, or none this client can read, says the retry would be
// refused too: it is answered rather than waited on.
func TestARetryAfterPastAMinuteOrUnreadableIsUnavailableAtOnce(t *testing.T) {
	for _, retryAfter := range []string{
		"61", "99999999999999999", "-1", "", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT",
	} {
		client, asked, waited := turns(t, limited("per_minute_limit_exceeded", retryAfter),
			says(http.StatusOK, redCross))

		looked := client.LookUp(t.Context(), "530196605")

		if looked != (Lookup{State: Unavailable}) || len(asked()) != 1 || len(*waited) != 0 {
			t.Errorf("Retry-After %q: looked up %q over %q after waiting %v, want unavailable over one "+
				"request and no wait", retryAfter, looked.State, asked(), *waited)
		}
	}
}

// a wait is the ask's, so it ends with the ask's deadline rather than outliving it.
func TestAWaitPastTheAsksDeadlineIsUnavailableWithNoSecondRequest(t *testing.T) {
	client, asked := upstream(t, refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"))
	client.askWithin = 50 * time.Millisecond

	began := time.Now()
	looked := client.LookUp(t.Context(), "530196605")

	if looked.State != Unavailable || len(asked()) != 1 {
		t.Errorf("looked up %q over %q, want unavailable over one request", looked.State, asked())
	}
	if took := time.Since(began); took > 10*time.Second {
		t.Errorf("took %v, want the wait cut at the deadline", took)
	}
}

func TestASearchRefusedForTheMinuteIsWaitedOutOnceToo(t *testing.T) {
	client, asked, waited := turns(t, refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"),
		says(http.StatusOK, `{"query": "red cross", "limit": 10, "results": [`+entry("530196605", "Red Cross")+`]}`))

	searched := client.Search(t.Context(), "red cross")

	if searched.State != Listed || len(searched.Matches) != 1 || len(asked()) != 2 || len(*waited) != 1 {
		t.Errorf("searched %+v over %q after waiting %v, want ok over two requests and one wait",
			searched, asked(), *waited)
	}
}

func TestASearchTheAPIRefusesIsUnavailableAndNotRetried(t *testing.T) {
	for _, code := range []string{"daily_quota_exceeded", "service_daily_limit_reached"} {
		client, asked, waited := turns(t, refused(http.StatusTooManyRequests, code))

		searched := client.Search(t.Context(), "red cross")

		if searched.State != SearchUnavailable || len(asked()) != 1 || len(*waited) != 0 {
			t.Errorf("%s: searched %q over %q after waiting %v, want unavailable over one request",
				code, searched.State, asked(), *waited)
		}
	}
}

// keyless: the API is asked on the allowance it keeps per calling address, and no key is sent.
func TestNoKeyIsSent(t *testing.T) {
	var held sync.Mutex
	sent := []string{}
	client, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		held.Lock()
		sent = append(sent, r.Header.Values("Authorization")...)
		held.Unlock()
		if strings.HasPrefix(r.URL.Path, "/v1/search") {
			says(http.StatusOK, `{"results": []}`)(w, r)
			return
		}
		says(http.StatusOK, redCross)(w, r)
	})

	client.LookUp(t.Context(), "530196605")
	client.Search(t.Context(), "red cross")

	held.Lock()
	defer held.Unlock()
	if len(sent) != 0 {
		t.Errorf("sent Authorization %q, want none", sent)
	}
}

func TestARedirectIsUnavailableAndItsTargetIsNeverAsked(t *testing.T) {
	elsewhere, reachedElsewhere := upstream(t, says(http.StatusOK, redCross))
	client, asked := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.base+r.URL.RequestURI(), http.StatusFound)
	})

	looked := client.LookUp(t.Context(), "530196605")

	if looked != (Lookup{State: Unavailable}) || len(asked()) != 1 {
		t.Errorf("looked up %+v over %q, want unavailable over one request", looked, asked())
	}
	if got := reachedElsewhere(); len(got) != 0 {
		t.Errorf("the redirect's target was asked %q, want nothing", got)
	}
}

// a client on `answers` whose per-minute waits are held: each says it began on `began` and ends
// when the test sends on `ends`.
func heldWaits(t *testing.T, answers ...http.HandlerFunc) (*Client, func() []string, chan struct{}, chan struct{}) {
	t.Helper()
	client, asked, _ := turns(t, answers...)
	began, ends := make(chan struct{}), make(chan struct{})
	client.wait = func(context.Context, time.Duration) bool {
		began <- struct{}{}
		<-ends
		return true
	}
	return client, asked, began, ends
}

func TestAnAskEveryCallerLeftDuringItsWaitSendsNoRetry(t *testing.T) {
	client, asked, began, ends := heldWaits(t,
		refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"), says(http.StatusOK, redCross))
	ctx, cancel := context.WithCancel(t.Context())
	first := make(chan Lookup, 1)
	go func() { first <- client.LookUp(ctx, "530196605") }()
	<-began
	one := client.lookups.inFlight("530196605")

	cancel()
	if gave := <-first; gave.State != Unavailable {
		t.Errorf("the caller that left got %q, want unavailable", gave.State)
	}
	ends <- struct{}{}
	<-one.done

	if got := asked(); len(got) != 1 {
		t.Errorf("asked %q, want the one request made before the wait and no retry", got)
	}
	if client.lookups.inFlight("530196605") != nil {
		t.Error("the ask nobody waited on is remembered, want it forgotten")
	}
}

func TestAnAskOneCallerStillWaitsOnIsRetriedForIt(t *testing.T) {
	client, asked, began, ends := heldWaits(t,
		refused(http.StatusTooManyRequests, "per_minute_limit_exceeded"), says(http.StatusOK, redCross))
	gone, cancel := context.WithCancel(t.Context())
	first := make(chan Lookup, 1)
	go func() { first <- client.LookUp(gone, "530196605") }()
	<-began
	second := make(chan Lookup, 1)
	go func() { second <- client.LookUp(t.Context(), "53-0196605") }()
	for client.lookups.callers("530196605") != 2 {
		time.Sleep(time.Millisecond)
	}

	cancel()
	<-first
	ends <- struct{}{}

	if got := <-second; got.State != Found || len(asked()) != 2 {
		t.Errorf("the caller still waiting got %q over %q, want found from the retry", got.State, asked())
	}
}

// the ask in flight for key, as recall left it.
func (m *memory[T]) inFlight(key string) *recalled[T] {
	m.held.Lock()
	defer m.held.Unlock()
	return m.kept[key]
}

// how many callers wait on the ask in flight for key.
func (m *memory[T]) callers(key string) int {
	m.held.Lock()
	defer m.held.Unlock()
	return m.kept[key].waiting
}

func TestARefusalForTheDayClosesTheClientUntilItsRetryAfter(t *testing.T) {
	for _, code := range []string{"daily_quota_exceeded", "service_daily_limit_reached"} {
		t.Run(code, func(t *testing.T) {
			client, asked, waited := turns(t, limited(code, "3600"),
				says(http.StatusOK, `{"results": [`+entry("530196605", "Red Cross")+`]}`))
			now := time.Date(2026, 10, 9, 23, 0, 0, 0, time.UTC)
			client.now = func() time.Time { return now }

			first := client.Search(t.Context(), "red cross")
			looked := client.LookUp(t.Context(), "131624241")
			searched := client.Search(t.Context(), "food bank")

			if first.State != SearchUnavailable || looked != (Lookup{State: Unavailable}) ||
				searched.State != SearchUnavailable || searched.Matches == nil {
				t.Errorf("answered %q, %+v and %+v, want every one unavailable", first.State, looked, searched)
			}
			if got := asked(); len(got) != 1 || len(*waited) != 0 {
				t.Errorf("asked %q after waiting %v, want the one refused request and no wait", got, *waited)
			}

			now = now.Add(time.Hour - time.Second)
			client.Search(t.Context(), "red cross")
			if got := asked(); len(got) != 1 {
				t.Errorf("asked %q a second before the refusal lifts, want nothing more", got)
			}

			now = now.Add(time.Second)
			if again := client.Search(t.Context(), "red cross"); again.State != Listed || len(asked()) != 2 {
				t.Errorf("searched %q over %q once it lifted, want ok over a second request",
					again.State, asked())
			}
		})
	}
}
