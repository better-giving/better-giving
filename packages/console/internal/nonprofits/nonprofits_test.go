package nonprofits

import (
	"context"
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

const redCross = `{
	"ein": "530196605",
	"name": "American National Red Cross",
	"address": {"street": "431 18th St NW", "city": "Washington", "state": "DC", "zip": "20006-5310"},
	"status": {"deductible": true, "revoked": false, "revocation_date": null, "reinstatement_date": null},
	"filing": {"website": "https://www.redcross.org", "mission": "not read by this console"},
	"notes": []
}`

// a transport that counts what reached it and answers nothing, for a client that must make no call.
type counted struct{ calls int }

func (c *counted) RoundTrip(*http.Request) (*http.Response, error) {
	c.calls++
	return nil, http.ErrHandlerTimeout
}

func TestAConsoleBuiltWithNoAddressAnswersUnavailableAndAsksNothing(t *testing.T) {
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

	if got := asked(); !slices.Equal(got, []string{"/v1/organizations/530196605"}) {
		t.Errorf("asked %q, want the EIN's digits under /v1/organizations", got)
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
	}}
	if looked != want {
		t.Errorf("looked up %+v, want %+v", looked, want)
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

func TestALookupThatFoundNothingIsSortedFromOneThatCouldNotBeMade(t *testing.T) {
	for _, one := range []struct {
		name   string
		answer http.HandlerFunc
		want   LookupState
	}{
		{"unknown", says(http.StatusNotFound, `{"error":"no such organization"}`), NotFound},
		{"failing", says(http.StatusInternalServerError, `{"error":"boom"}`), Unavailable},
		{"limited", says(http.StatusTooManyRequests, `{}`), Unavailable},
		{"not json", says(http.StatusOK, `<html>a captive portal</html>`), Unavailable},
		{"another shape", says(http.StatusOK, `{"ein": 530196605, "name": ["x"]}`), Unavailable},
		{"no name", says(http.StatusOK, `{"ein": "530196605", "name": ""}`), Unavailable},
		{"another organisation", says(http.StatusOK, strings.Replace(redCross, "530196605", "131624241", 1)), Unavailable},
		{"oversize", says(http.StatusOK, `{"ein":"530196605","name":"`+strings.Repeat("x", answerBytes)+`"}`), Unavailable},
	} {
		t.Run(one.name, func(t *testing.T) {
			client, _ := upstream(t, one.answer)

			looked := client.LookUp(t.Context(), "530196605")

			if looked != (Lookup{State: one.want}) {
				t.Errorf("looked up %+v, want %q with every field empty", looked, one.want)
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

func TestRevokedIsARevocationNoLaterReinstatementUndid(t *testing.T) {
	for _, one := range []struct {
		name   string
		status string
		want   string
	}{
		{"never revoked", `{"revoked": false, "revocation_date": null, "reinstatement_date": null}`, ""},
		{"revoked", `{"revoked": true, "revocation_date": "2019-05-15", "reinstatement_date": null}`, "2019-05-15"},
		{"reinstated after", `{"revoked": false, "revocation_date": "2019-05-15", "reinstatement_date": "2021-02-01"}`, ""},
		// the flag is the API's, and a reinstatement after the revocation is what the contract
		// reads as no longer revoked whichever way the flag was left.
		{"reinstated, flag left set", `{"revoked": true, "revocation_date": "2019-05-15", "reinstatement_date": "2021-02-01"}`, ""},
		{"reinstated before a second revocation", `{"revoked": true, "revocation_date": "2022-05-15", "reinstatement_date": "2021-02-01"}`, "2022-05-15"},
		{"revoked with no date to show", `{"revoked": true, "revocation_date": null, "reinstatement_date": null}`, ""},
		{"revoked on a date in another spelling", `{"revoked": true, "revocation_date": "05/15/2019", "reinstatement_date": null}`, ""},
	} {
		t.Run(one.name, func(t *testing.T) {
			body := `{"ein": "530196605", "name": "A", "status": ` + one.status + `}`
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
	client, asked := upstream(t, says(http.StatusNotFound, `{}`))

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

// one upstream search entry.
func entry(ein, name string) string {
	return `{"ein": "` + ein + `", "name": "` + name + `", "city": "Washington", "state": "DC",
		"status": {"deductible": true, "revoked": false, "revocation_date": null, "reinstatement_date": null}}`
}

func TestASearchIsAnsweredWithTheMatchesTheAPIListed(t *testing.T) {
	client, asked := upstream(t, says(http.StatusOK, `{"results": [
		`+entry("530196605", "American National Red Cross")+`,
		{"ein": "131624241", "name": "Red Crescent", "city": "New York", "state": "NY", "ntee": "Q33",
			"status": {"deductible": false, "revoked": true, "revocation_date": "2019-05-15", "reinstatement_date": null}}
	]}`))

	searched := client.Search(t.Context(), "  Red   CROSS ")

	if got := asked(); !slices.Equal(got, []string{"/v1/organizations?q=red+cross"}) {
		t.Errorf("asked %q, want the query trimmed, folded and lowercased", got)
	}
	want := []Match{
		{EIN: "530196605", Name: "American National Red Cross", City: "Washington", State: "DC",
			Deductible: true},
		{EIN: "131624241", Name: "Red Crescent", City: "New York", State: "NY", RevokedOn: "2019-05-15"},
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
		{"unknown path", says(http.StatusNotFound, `{}`)},
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
		if got := asked(); !slices.Equal(got, []string{"/v1/organizations/530196605"}) || looked.State != Found {
			t.Errorf("asked %q, then looked up %q, want one lookup by EIN serving both", got, looked.State)
		}
	})
	t.Run("unknown", func(t *testing.T) {
		client, _ := upstream(t, says(http.StatusNotFound, `{}`))

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
