package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
)

// what the local server refuses, and what it answers.
//
// the refusal is the whole of the door: this server binds the loopback address and holds a
// cloudflare credential, so any page in the operator's browser can reach it by name. what stops one
// acting on their account is that a request carrying another page's origin is refused before a
// handler sees it, and that no cors header ever invites one to try.

// the host every case that is not about the host itself arrives under: httptest's own default is
// `example.com`, which the guard refuses, and rightly.
const loopback = "127.0.0.1:5320"

// a server built around a handler that says it was reached.
func reachable(t *testing.T) http.Handler {
	t.Helper()
	flow := oauth.New(oauth.Options{Store: state.At(t.TempDir())})
	t.Cleanup(flow.Stop)
	return New(Options{
		UI: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("the ui"))
		}),
		Flow:     flow,
		Accounts: account.New(state.At(t.TempDir())),
	})
}

func sent(t *testing.T, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.Host = loopback
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	answer := httptest.NewRecorder()
	reachable(t).ServeHTTP(answer, request)
	return answer
}

func TestARequestThatReachedThisServerUnderAnotherNameIsRefused(t *testing.T) {
	// the dns rebinding case, and the one the other two readings cannot see: a page on
	// `http://evil.test:5320/` whose name resolves here is same-origin as far as the browser is
	// concerned, so it sends `Sec-Fetch-Site: same-origin` and a GET of its own carries no `Origin`
	// to compare against anything.
	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.Host = "evil.test:5320"
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	answer := httptest.NewRecorder()
	reachable(t).ServeHTTP(answer, request)

	if answer.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", answer.Code, http.StatusForbidden)
	}
}

func TestTheLoopbackNamesThisServerAnswersOnAreTheThreeSpellingsOfItself(t *testing.T) {
	for _, one := range []struct {
		host string
		want int
	}{
		{loopback, http.StatusOK},
		// what the dev proxy forwards, and what an operator types.
		{"localhost:5320", http.StatusOK},
		{"[::1]:5320", http.StatusOK},
		{"evil.test:5320", http.StatusForbidden},
		// a name that merely resolves here is still not a name that means here.
		{"console.evil.test", http.StatusForbidden},
		{"", http.StatusForbidden},
	} {
		t.Run(one.host, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
			request.Host = one.host
			answer := httptest.NewRecorder()
			reachable(t).ServeHTTP(answer, request)
			if answer.Code != one.want {
				t.Errorf("status = %d, want %d", answer.Code, one.want)
			}
		})
	}
}

func TestARequestCarryingNoOriginAtAllIsServed(t *testing.T) {
	// what a page this server itself drew sends: a same-origin GET carries no `Origin`, and an
	// address typed into a bar carries neither header.
	if code := sent(t, nil).Code; code != http.StatusOK {
		t.Errorf("status = %d, want %d", code, http.StatusOK)
	}
}

func TestARequestWhoseOriginIsThisServerIsServed(t *testing.T) {
	answer := sent(t, map[string]string{"Origin": "http://127.0.0.1:5320"})

	if answer.Code != http.StatusOK {
		t.Errorf("status = %d, want the page this server drew to reach it", answer.Code)
	}
}

func TestARequestCarryingAnotherPagesOriginIsRefused(t *testing.T) {
	answer := sent(t, map[string]string{"Origin": "https://example.org"})

	if answer.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", answer.Code, http.StatusForbidden)
	}
}

func TestARequestFromAnotherPortOnThisMachineIsRefused(t *testing.T) {
	// a page on 5321 is a different origin, whatever else is true of the machine it is served from.
	answer := sent(t, map[string]string{"Origin": "http://127.0.0.1:5321"})

	if answer.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", answer.Code, http.StatusForbidden)
	}
}

func TestTheSiteAFetchSaysItCameFromIsReadWhereTheBrowserStatesIt(t *testing.T) {
	for _, one := range []struct {
		site string
		want int
	}{
		{"cross-site", http.StatusForbidden},
		// a sibling subdomain is not this origin either, and it is the one an attacker can get.
		{"same-site", http.StatusForbidden},
		{"same-origin", http.StatusOK},
		// a top-level navigation the operator typed or opened themselves.
		{"none", http.StatusOK},
	} {
		t.Run(one.site, func(t *testing.T) {
			answer := sent(t, map[string]string{"Sec-Fetch-Site": one.site})
			if answer.Code != one.want {
				t.Errorf("status = %d, want %d", answer.Code, one.want)
			}
		})
	}
}

func TestNothingHereInvitesABrowserToTryAgainWithCors(t *testing.T) {
	// the refusal is only worth as much as the absent header: a permissive one would let a page read
	// what it got back.
	for _, headers := range []map[string]string{
		nil,
		{"Origin": "https://example.org"},
	} {
		answer := sent(t, headers)
		if allowed := answer.Header().Get("Access-Control-Allow-Origin"); allowed != "" {
			t.Errorf("Access-Control-Allow-Origin = %q, want none", allowed)
		}
	}
}

func TestEveryAnswerSaysItsTypeIsNotToBeGuessedAndCarriesNoAddressAway(t *testing.T) {
	// both of them are true of a refusal as well as of an answer, so they are set outside the guard:
	// a 403 is a body a browser sniffs and a page whose address is a loopback port either way.
	for _, headers := range []map[string]string{
		nil,
		{"Origin": "https://example.org"},
	} {
		answer := sent(t, headers)
		if said := answer.Header().Get("X-Content-Type-Options"); said != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q, want nosniff", said)
		}
		if said := answer.Header().Get("Referrer-Policy"); said != "strict-origin-when-cross-origin" {
			t.Errorf("Referrer-Policy = %q, want strict-origin-when-cross-origin", said)
		}
	}
}

func TestARefusalSaysWhatIsWrongInJson(t *testing.T) {
	// a 4xx body under /api is read by whatever called it, and an html page would say nothing it can
	// act on.
	answer := sent(t, map[string]string{"Origin": "https://example.org"})

	if kind := answer.Header().Get("Content-Type"); !strings.HasPrefix(kind, "application/json") {
		t.Errorf("Content-Type = %q, want json", kind)
	}
	var body map[string]string
	if err := json.Unmarshal(answer.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not json: %v", err)
	}
	if body["error"] == "" {
		t.Errorf("body = %v, names nothing", body)
	}
}

func TestTheVersionThisBinaryWasBuiltAtIsAnswered(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.Host = loopback
	answer := httptest.NewRecorder()
	flow := oauth.New(oauth.Options{Store: state.At(t.TempDir())})
	t.Cleanup(flow.Stop)
	New(Options{Version: "1.2.3", Commit: "abc1234", UI: http.NotFoundHandler(), Flow: flow}).
		ServeHTTP(answer, request)

	var body map[string]any
	if err := json.Unmarshal(answer.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not json: %v", err)
	}
	if body["version"] != "1.2.3" || body["commit"] != "abc1234" {
		t.Errorf("body = %v, want the version and commit this binary was built at", body)
	}
}

func TestAnApiPathNothingAnswersIsAJson404AndNeverThePage(t *testing.T) {
	// the ui is served for every path the router does not know, because a client route is a path
	// only the browser resolves — but an `/api` path that fell through is a call to something that
	// is not there, and answering it with a page would be read as a success by whatever called it.
	request := httptest.NewRequest(http.MethodGet, "/api/nothing", nil)
	request.Host = loopback
	answer := httptest.NewRecorder()
	reachable(t).ServeHTTP(answer, request)

	if answer.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", answer.Code, http.StatusNotFound)
	}
	if strings.Contains(answer.Body.String(), "the ui") {
		t.Error("an unknown /api path was answered with the page")
	}
}

func TestEveryOtherPathIsThePage(t *testing.T) {
	// a deep-linked client route is a path only the browser resolves, so the document is what
	// answers it.
	request := httptest.NewRequest(http.MethodGet, "/cloudflare", nil)
	request.Host = loopback
	answer := httptest.NewRecorder()
	reachable(t).ServeHTTP(answer, request)

	if answer.Body.String() != "the ui" {
		t.Errorf("body = %q, want the page", answer.Body.String())
	}
}

func TestTheHeadersARequestArrivesWithAreBoundedLikeItsBodyIs(t *testing.T) {
	// the body cap is stated per handler and covers no part of this: headers are read before any
	// handler runs, and an http.Server that states none takes a megabyte of them.
	if listening := Listen(http.NotFoundHandler(), 5320); listening.MaxHeaderBytes == 0 {
		t.Error("the header surface is whatever net/http defaults to, which this server never chose")
	}
}
