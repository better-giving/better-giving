package cf

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// how a cloudflare answer is sorted, shaped and walked.
//
// every reader below is reached through httptest, so the whole of what this console does with an
// answer — the merge patch's own dialect, a credential held across two reads, a refusal, a page
// walked to its end — is looked at without a cloudflare account and without a network.

func TestMergePatchNamesTheDialectBesideABearerToken(t *testing.T) {
	// the one call this console makes that is not plain json. what is pinned is the type sent, which
	// is the whole of what the module claims about it.
	held := MergePatchHeaders(BearerCredential("abc.def"))

	want := map[string]string{
		"Authorization": "Bearer abc.def",
		"Content-Type":  "application/merge-patch+json",
	}
	if !maps.Equal(held, want) {
		t.Errorf("headers = %v, want %v", held, want)
	}
}

func TestMergePatchNamesItBesideAGlobalKeyAndItsEmail(t *testing.T) {
	held := MergePatchHeaders(Credential{Kind: KeyCredential, Key: "k", Email: "a@b.c"})

	want := map[string]string{
		"X-Auth-Key":   "k",
		"X-Auth-Email": "a@b.c",
		"Content-Type": "application/merge-patch+json",
	}
	if !maps.Equal(held, want) {
		t.Errorf("headers = %v, want %v", held, want)
	}
}

func TestMergePatchCarriesNoSignInWhereThereIsNoneToCarry(t *testing.T) {
	// the write is reached holding one: a read in front of it meets an unusable credential first, so
	// what gets here has been found usable already.
	held := MergePatchHeaders(Credential{Kind: NoCredential, Detail: "nothing is signed in"})

	want := map[string]string{"Content-Type": "application/merge-patch+json"}
	if !maps.Equal(held, want) {
		t.Errorf("headers = %v, want %v", held, want)
	}
}

func TestTheCredentialOneScreensReadsShareIsAskedForOnce(t *testing.T) {
	asks := 0
	var guard sync.Mutex
	held := Held(readerFunc(func(context.Context) Credential {
		guard.Lock()
		defer guard.Unlock()
		asks++
		return BearerCredential("abc.def")
	}))

	var wait sync.WaitGroup
	answers := make([]Credential, 3)
	for i := range answers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			answers[i] = held.Credential(context.Background())
		}()
	}
	wait.Wait()

	if asks != 1 {
		t.Errorf("asks = %d, want the one reading three readers share", asks)
	}
	for _, answer := range answers {
		if answer != BearerCredential("abc.def") {
			t.Errorf("answer = %+v, want the held credential", answer)
		}
	}
}

func TestNothingIsAskedForUntilAReaderWantsOne(t *testing.T) {
	// a screen whose reads all fail before they need a credential reads no token file for one.
	asks := 0
	Held(readerFunc(func(context.Context) Credential {
		asks++
		return Credential{Kind: NoCredential, Detail: "x"}
	}))

	if asks != 0 {
		t.Errorf("asks = %d, want none until one is wanted", asks)
	}
}

func TestARefusedCredentialIsToldFromACloudflareThatAnsweredSomethingElse(t *testing.T) {
	for _, one := range []struct {
		name   string
		status int
		body   string
		want   ResultKind
	}{
		{"a 401", 401, `{"errors":[{"code":9109,"message":"invalid"}]}`, ResultRefused},
		{"a 403", 403, `{"errors":[{"code":9109,"message":"forbidden"}]}`, ResultRefused},
		// the refusal cloudflare carries no status of its own for.
		{"a 10000 under any status", 200, `{"errors":[{"code":10000,"message":"auth error"}]}`, ResultRefused},
		// the ordinary state of every run before a first deploy, and never a failure.
		{"a 10007", 404, `{"errors":[{"code":10007,"message":"not found"}]}`, ResultMissing},
		{"a 500", 500, `{"errors":[{"code":1,"message":"oops"}]}`, ResultUnreachable},
		{"a 200 naming no result", 200, `{"success":true}`, ResultUnreadable},
		{"a 200 carrying one", 200, `{"result":{"id":"a1"}}`, ResultValue},
	} {
		t.Run(one.name, func(t *testing.T) {
			read := ReadResult(answering(t, one.status, one.body))
			if read.Kind != one.want {
				t.Errorf("kind = %q, want %q", read.Kind, one.want)
			}
		})
	}
}

func TestACloudflareNothingWasFoundOutFromStaysUnreachable(t *testing.T) {
	read := ReadResult(Answer{Kind: Unreachable, Detail: "connection refused"})

	if read.Kind != ResultUnreachable || read.Detail != "connection refused" {
		t.Errorf("read = %+v, want the unreachable detail carried through", read)
	}
}

func TestAnAnswerInAShapeNothingWasWrittenAgainstIsUnreadableInCloudflaresWords(t *testing.T) {
	answer := answering(t, 200, `{"result":{"id":"a1"},"errors":[{"message":"deprecated"}]}`)

	read := ReadShaped(answer, func(value any) ([]any, bool) {
		rows, ok := value.([]any)
		return rows, ok
	})

	if read.Kind != ResultUnreadable {
		t.Fatalf("kind = %q, want %q", read.Kind, ResultUnreadable)
	}
	if read.Detail != "deprecated" {
		t.Errorf("detail = %q, want what cloudflare itself said", read.Detail)
	}
}

func TestWhatIsNotFoundIsPassedThroughRatherThanDecidedHere(t *testing.T) {
	answer := answering(t, 404, `{"errors":[{"code":10007,"message":"not found"}]}`)

	read := ReadShaped(answer, func(value any) (string, bool) {
		held, ok := value.(string)
		return held, ok
	})

	if read.Kind != ResultMissing {
		t.Errorf("kind = %q, want the caller's own sentence to be left to say", read.Kind)
	}
}

func TestALisIsFollowedToItsLastPage(t *testing.T) {
	pages := [][]string{{"a", "b"}, {"c"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := 1
		fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
		rows := pages[page-1]
		names := make([]string, 0, len(rows))
		for _, row := range rows {
			names = append(names, fmt.Sprintf(`{"name":%q}`, row))
		}
		fmt.Fprintf(
			w,
			`{"result":[%s],"result_info":{"page":%d,"per_page":2,"total_count":3}}`,
			strings.Join(names, ","), page,
		)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if walked.Failure != "" {
		t.Fatalf("failure = %q, want a walk that finished", walked.Failure)
	}
	if len(walked.Rows) != 3 {
		t.Errorf("rows = %d, want the three across both pages", len(walked.Rows))
	}
}

func TestAPageThatCameBackEmptyEndsTheWalkWhateverTheCountsSay(t *testing.T) {
	// the counts are the account's to state, and a wrong one would otherwise be a loop with no end
	// to it inside one read.
	served := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served++
		fmt.Fprint(w, `{"result":[],"result_info":{"page":1,"per_page":2,"total_count":900}}`)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if served != 1 {
		t.Errorf("served = %d pages, want the walk to stop at the empty one", served)
	}
	if len(walked.Rows) != 0 || walked.Failure != "" {
		t.Errorf("walked = %+v, want an empty list that finished", walked)
	}
}

func TestAListThatNeverEndsIsAFailureRatherThanAWalkWithNoEnd(t *testing.T) {
	// a host answering the same non-empty page for every `page=N` satisfies both ordinary stop
	// conditions forever, inside a handler a browser is waiting on.
	served := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served++
		fmt.Fprint(w, `{"result":[{"name":"a"}],"result_info":{"page":1,"per_page":1,"total_count":999999}}`)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if walked.Failure != ResultUnreachable {
		t.Fatalf("failure = %q, want a walk that gave up rather than a short list", walked.Failure)
	}
	if walked.Rows != nil {
		t.Errorf("rows = %v, want none — a short list is drawn as a fact about the account", walked.Rows)
	}
	if served != maxPages {
		t.Errorf("served = %d pages, want the walk bounded at %d", served, maxPages)
	}
}

func TestAWalkStopsOnceItHoldsAsManyRowsAsTheCountClaims(t *testing.T) {
	// `per_page: 0` beside a real count leaves hasMorePages saying yes forever; the rows this walk
	// already holds are what answer it instead.
	served := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served++
		fmt.Fprint(w, `{"result":[{"name":"a"},{"name":"b"}],"result_info":{"page":1,"per_page":0,"total_count":2}}`)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if walked.Failure != "" || len(walked.Rows) != 2 {
		t.Fatalf("walked = %+v, want the two rows the count claims", walked)
	}
	if served != 1 {
		t.Errorf("served = %d pages, want the walk to stop at the count", served)
	}
}

func TestAStatedPageSizeReachesTheRequest(t *testing.T) {
	var asked string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.RawQuery
		fmt.Fprint(w, `{"result":[]}`)
	}))
	t.Cleanup(server.Close)

	PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 50)

	if !strings.Contains(asked, "per_page=50") {
		t.Errorf("query = %q, want the size the caller stated", asked)
	}
}

func TestAFilterOnThePathIsKeptOnEveryPageAskedFor(t *testing.T) {
	// a read that narrows its own list states the filter on the path, and the paging is asked for
	// alongside it rather than in place of it.
	asked := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.RawQuery)
		fmt.Fprint(w, `{"result":[]}`)
	}))
	t.Cleanup(server.Close)

	PagedList(context.Background(), JSONGet(server.URL, nil), "/memberships?status=accepted", 0)

	if len(asked) != 1 || asked[0] != "status=accepted&page=1" {
		t.Errorf("query = %q, want the filter and the page both on it", asked)
	}
}

func TestAFailedWalkCollapsesToTwoStatesAndCarriesTheCodes(t *testing.T) {
	// the codes travel alongside for the read that has to tell two refusals apart.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(403)
		fmt.Fprint(w, `{"errors":[{"code":10000,"message":"auth error"}]}`)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if walked.Failure != ResultRefused {
		t.Fatalf("failure = %q, want %q", walked.Failure, ResultRefused)
	}
	if len(walked.Codes) != 1 || walked.Codes[0] != 10000 {
		t.Errorf("codes = %v, want the 10000 that says which refusal it was", walked.Codes)
	}
	if walked.Detail != "auth error" {
		t.Errorf("detail = %q, want cloudflare's own words", walked.Detail)
	}
}

func TestAListThatCameBackMissingIsLookedAtAgainRatherThanSignedInForAgain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(404)
		fmt.Fprint(w, `{"errors":[{"code":10007,"message":"not found"}]}`)
	}))
	t.Cleanup(server.Close)

	walked := PagedList(context.Background(), JSONGet(server.URL, nil), "/accounts", 0)

	if walked.Failure != ResultUnreachable {
		t.Errorf("failure = %q, want the state whose way out is looking again", walked.Failure)
	}
}

func TestWhatCloudflareSaidIsItsOwnWordsWhereItWroteAny(t *testing.T) {
	answer := answering(t, 400, `{"errors":[{"message":"one"},{"message":"two"}]}`)

	if said := Said(answer); said != "one; two" {
		t.Errorf("said = %q, want both sentences", said)
	}
}

func TestWhatCloudflareSaidFallsBackToTheStatusItAnsweredWith(t *testing.T) {
	answer := answering(t, 418, `{}`)

	if said := Said(answer); said != "Cloudflare answered 418" {
		t.Errorf("said = %q, want the status where there are no words", said)
	}
}

func TestEveryErrorCodeABodyNamesIsRead(t *testing.T) {
	body := answering(t, 400, `{"errors":[{"code":10000},{"message":"no code"},{"code":10007}]}`).Body

	codes := ErrorCodes(body)

	if len(codes) != 2 || codes[0] != 10000 || codes[1] != 10007 {
		t.Errorf("codes = %v, want the two the body names", codes)
	}
}

// one answer off a real server, which is how every case here gets a body cloudflare's own decoder
// would have produced.
func answering(t *testing.T, status int, body string) Answer {
	t.Helper()
	server, _ := recording(t, status, body)
	return JSONGet(server.URL, nil)(context.Background(), "/")
}

// a credential reader written as a function, for the cases that count how often one is asked.
type readerFunc func(context.Context) Credential

func (read readerFunc) Credential(ctx context.Context) Credential { return read(ctx) }
