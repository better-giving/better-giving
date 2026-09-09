package cf

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// the one json client, looked at from the far end of a real connection.
//
// every case here is served by httptest rather than by a stubbed transport, because what is being
// asserted is what goes onto the wire: which header the credential is in, whether a request without
// a body declares one, and what a body that is not json comes back as.

// what one served request carried, recorded by the handler for the case to read.
type carried struct {
	method      string
	url         string
	authorizing string
	contentType string
	body        string
}

// a server that records the one request it is sent and answers with `answer`.
func recording(t *testing.T, status int, answer string) (*httptest.Server, *carried) {
	t.Helper()
	held := &carried{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read, _ := io.ReadAll(r.Body)
		*held = carried{
			method:      r.Method,
			url:         r.URL.String(),
			authorizing: r.Header.Get("Authorization"),
			contentType: r.Header.Get("Content-Type"),
			body:        string(read),
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, answer)
	}))
	t.Cleanup(server.Close)
	return server, held
}

func TestCredentialTravelsInAHeaderAndNeverOnAUrl(t *testing.T) {
	server, held := recording(t, 200, `{"result":{}}`)
	send := JSONSend(server.URL, apiHeaders(BearerCredential("abc.def")))

	answer := send(context.Background(), "GET", "/accounts?page=1", nil)

	if answer.Kind != Answered {
		t.Fatalf("kind = %q, want %q", answer.Kind, Answered)
	}
	if held.authorizing != "Bearer abc.def" {
		t.Errorf("Authorization = %q, want the bearer token", held.authorizing)
	}
	if strings.Contains(held.url, "abc.def") {
		t.Errorf("url = %q, carries the credential", held.url)
	}
}

func TestAReadDeclaresNoBodyAndSendsNoBytes(t *testing.T) {
	server, held := recording(t, 200, `{"result":[]}`)
	get := JSONGet(server.URL, map[string]string{})

	get(context.Background(), "/accounts")

	if held.contentType != "" {
		t.Errorf("Content-Type = %q, want none on a call made without a body", held.contentType)
	}
	if held.body != "" {
		t.Errorf("body = %q, want none", held.body)
	}
}

func TestAWriteDeclaresJsonAndCarriesIt(t *testing.T) {
	server, held := recording(t, 200, `{"result":{}}`)
	post := JSONPost(server.URL, map[string]string{})

	post(context.Background(), "/accounts", map[string]string{"name": "better-giving"})

	if held.method != "POST" {
		t.Errorf("method = %q, want POST", held.method)
	}
	if held.contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", held.contentType)
	}
	if held.body != `{"name":"better-giving"}` {
		t.Errorf("body = %q, want the json the caller handed over", held.body)
	}
}

func TestABoundContentTypeWinsOverTheJsonDefault(t *testing.T) {
	// the merge patch is the one binding that names the header, and it has to survive a call that
	// carries a body — which is the only call that sets one of its own.
	server, held := recording(t, 200, `{"result":{}}`)
	send := JSONSend(server.URL, MergePatchHeaders(BearerCredential("abc.def")))

	send(context.Background(), "PATCH", "/secrets", map[string]any{"A": "b"})

	if held.contentType != "application/merge-patch+json" {
		t.Errorf("Content-Type = %q, want the bound merge patch", held.contentType)
	}
}

func TestABodyThatIsNotJsonIsAnAnsweredStatusAndNoValue(t *testing.T) {
	// cloudflare answers html through a proxy often enough that this is the ordinary shape of a bad
	// gateway, and a throw here would be a 500 in place of the state that explains it.
	server, _ := recording(t, 502, "<html>bad gateway</html>")
	get := JSONGet(server.URL, map[string]string{})

	answer := get(context.Background(), "/accounts")

	if answer.Kind != Answered || answer.Status != 502 {
		t.Fatalf("answer = %+v, want an answered 502", answer)
	}
	if answer.Body != nil {
		t.Errorf("body = %v, want nothing read out of a body that is not json", answer.Body)
	}
}

func TestAHostThatIsNotThereIsAValueAndNotAThrow(t *testing.T) {
	server, _ := recording(t, 200, `{}`)
	base := server.URL
	server.Close()
	get := JSONGet(base, map[string]string{})

	answer := get(context.Background(), "/accounts")

	if answer.Kind != Unreachable {
		t.Fatalf("kind = %q, want %q", answer.Kind, Unreachable)
	}
	if answer.Detail == "" {
		t.Error("detail is empty, and it is the whole of what a screen has to say")
	}
}

func TestACallThatRanOutOfTimeIsUnreachableRatherThanAHungPromise(t *testing.T) {
	// the bound the client puts on a call is ten seconds, which is too long to sit through here —
	// what this asserts instead is that the caller's own deadline reaches the request, which is the
	// same path out and the one a cancelled press takes.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(300 * time.Millisecond)
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	answer := JSONGet(server.URL, map[string]string{})(ctx, "/accounts")

	if answer.Kind != Unreachable {
		t.Fatalf("kind = %q, want %q", answer.Kind, Unreachable)
	}
}

func TestTheBodyIsReadAsTheJsonCloudflareSent(t *testing.T) {
	server, _ := recording(t, 200, `{"result":{"id":"a1"},"success":true}`)

	answer := JSONGet(server.URL, map[string]string{})(context.Background(), "/accounts")

	body, ok := answer.Body.(map[string]any)
	if !ok {
		t.Fatalf("body = %#v, want an object", answer.Body)
	}
	if _, held := body["result"]; !held {
		t.Errorf("body = %v, names no result", body)
	}
}

func TestAMultipartCallCarriesItsPartsAndItsBoundHeaders(t *testing.T) {
	// the two writes this console makes that are not json: the script upload, whose modules are one
	// part each, and the assets upload, whose parts are the files themselves.
	var got struct {
		method string
		auth   string
		names  []string
		types  []string
		bodies []string
		filed  []string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.auth = r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		for _, name := range []string{"metadata", "index.js"} {
			parts := r.MultipartForm.File[name]
			if len(parts) == 0 {
				got.names = append(got.names, name)
				got.types = append(got.types, "")
				got.filed = append(got.filed, "")
				got.bodies = append(got.bodies, strings.Join(r.MultipartForm.Value[name], ""))
				continue
			}
			opened, err := parts[0].Open()
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			body, _ := io.ReadAll(opened)
			got.names = append(got.names, name)
			got.types = append(got.types, parts[0].Header.Get("Content-Type"))
			got.filed = append(got.filed, parts[0].Filename)
			got.bodies = append(got.bodies, string(body))
		}
		w.Write([]byte(`{"success":true,"result":{"id":"a-worker"}}`))
	}))
	defer server.Close()

	send := MultipartSend(server.URL, map[string]string{"Authorization": "Bearer a-token"})
	answer := send(context.Background(), http.MethodPut, "/workers/scripts/a-worker", []Part{
		{Name: "metadata", Body: []byte(`{"main_module":"index.js"}`)},
		{Name: "index.js", Filename: "index.js", ContentType: "application/javascript+module", Body: []byte("export default {};")},
	}, nil)

	if answer.Kind != Answered || answer.Status != http.StatusOK {
		t.Fatalf("answer = %+v", answer)
	}
	if got.method != http.MethodPut || got.auth != "Bearer a-token" {
		t.Errorf("%s carrying %q, want the method stated and the bound credential", got.method, got.auth)
	}
	if got.bodies[0] != `{"main_module":"index.js"}` {
		t.Errorf("metadata = %q", got.bodies[0])
	}
	if got.filed[1] != "index.js" || got.types[1] != "application/javascript+module" {
		t.Errorf("the module part is %q as %q, want the specifier and the module type", got.filed[1], got.types[1])
	}
	if got.bodies[1] != "export default {};" {
		t.Errorf("the module part holds %q", got.bodies[1])
	}
}

func TestAMultipartCallThatReachedNothingIsAnAnswerRatherThanAnError(t *testing.T) {
	send := MultipartSend("http://127.0.0.1:0", nil)

	answer := send(context.Background(), http.MethodPost, "/anything", []Part{{Name: "a", Body: []byte("b")}}, nil)

	if answer.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", answer.Kind, Unreachable)
	}
}

func TestACallMayBeBoundToADeadlineOfItsOwn(t *testing.T) {
	// applying a migration file is the one call this console makes that the bound a read is made
	// with cuts part way through, and d1 has committed what it got through by the time it does.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(120 * time.Millisecond)
		_, _ = io.WriteString(w, `{"success":true,"result":[]}`)
	}))
	t.Cleanup(server.Close)
	sql := map[string]string{"sql": "select 1;"}

	cut := JSONSendWithin(server.URL, nil, 20*time.Millisecond)(context.Background(), http.MethodPost, "/query", sql)
	if cut.Kind != Unreachable {
		t.Errorf("kind = %q, want %q on a call bound shorter than the answer takes", cut.Kind, Unreachable)
	}

	held := JSONSendWithin(server.URL, nil, time.Minute)(context.Background(), http.MethodPost, "/query", sql)
	if held.Kind != Answered {
		t.Errorf("kind = %q (%s), want an answer on a call bound past it", held.Kind, held.Detail)
	}
}

func TestAFormCallWithNoFormDeclaresNoBodyAndSendsNoBytes(t *testing.T) {
	server, held := recording(t, 200, `{"id":"we_1"}`)
	call := FormSender(server.URL, map[string]string{"Authorization": "Bearer sk"})

	call(context.Background(), http.MethodDelete, "/webhook_endpoints/we_1", nil)

	if held.method != http.MethodDelete {
		t.Errorf("method = %q, want DELETE", held.method)
	}
	if held.contentType != "" {
		t.Errorf("content type = %q, want none on a call carrying no form", held.contentType)
	}
	if held.body != "" {
		t.Errorf("body = %q, want none", held.body)
	}
}

func TestAFormCallEncodesEveryRepeatedNameStripeReadsAsAList(t *testing.T) {
	server, held := recording(t, 200, `{"id":"we_1"}`)
	call := FormSender(server.URL, nil)

	form := url.Values{}
	form.Set("url", "https://x.example/api/stripe/webhook")
	form.Add("enabled_events[0]", "invoice.paid")
	form.Add("enabled_events[1]", "invoice.payment_failed")
	call(context.Background(), http.MethodPost, "/webhook_endpoints", form)

	if held.contentType != "application/x-www-form-urlencoded" {
		t.Errorf("content type = %q", held.contentType)
	}
	for _, want := range []string{
		"enabled_events%5B0%5D=invoice.paid",
		"enabled_events%5B1%5D=invoice.payment_failed",
	} {
		if !strings.Contains(held.body, want) {
			t.Errorf("body %q carries no %q", held.body, want)
		}
	}
}

func TestAWatchedMultipartCallStatesTheLengthOfTheBodyItSends(t *testing.T) {
	// **the failure this holds off is silent.** http.NewRequestWithContext works the length out for
	// a *bytes.Buffer and for nothing else, so a body wrapped in a counting reader goes up chunked —
	// which a workers script PUT may turn down for a reason that says nothing about the script.
	held := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		held <- r
		w.Write([]byte(`{"success":true,"result":{"id":"a-worker"}}`))
	}))
	defer server.Close()

	sent := int64(0)
	answer := MultipartSend(server.URL, nil)(context.Background(), http.MethodPut, "/workers/scripts/a-worker",
		[]Part{{Name: "index.js", Filename: "index.js", Body: bytes.Repeat([]byte("x"), 4096)}},
		func(gone, of int64) { sent = of })

	if answer.Kind != Answered {
		t.Fatalf("answer = %+v", answer)
	}
	got := <-held
	if got.ContentLength != sent || sent == 0 {
		t.Errorf("the request declared %d bytes, want the %d the watcher was told of", got.ContentLength, sent)
	}
	if len(got.TransferEncoding) != 0 {
		t.Errorf("the request went up as %v, want a stated length", got.TransferEncoding)
	}
}

func TestAWatchedMultipartCallCountsTheBytesItHandsToTheConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Write([]byte(`{"success":true,"result":{"id":"a-worker"}}`))
	}))
	defer server.Close()

	watched := make(chan [2]int64, 64)
	answer := MultipartSend(server.URL, nil)(context.Background(), http.MethodPut, "/workers/scripts/a-worker",
		[]Part{{Name: "index.js", Filename: "index.js", Body: bytes.Repeat([]byte("x"), 1<<20)}},
		func(sent, of int64) { watched <- [2]int64{sent, of} })
	if answer.Kind != Answered {
		t.Fatalf("answer = %+v", answer)
	}
	close(watched)

	counted := [][2]int64{}
	for one := range watched {
		counted = append(counted, one)
	}
	if len(counted) == 0 {
		t.Fatal("nothing was counted on its way up")
	}
	last := counted[len(counted)-1]
	if last[0] != last[1] {
		t.Errorf("the body ended at %d of %d, want every byte counted", last[0], last[1])
	}
	for at, one := range counted {
		if at > 0 && one[0] <= counted[at-1][0] {
			t.Errorf("the count went from %d to %d, want it climbing", counted[at-1][0], one[0])
		}
	}
}

func TestAMultipartCallWatchedByNothingReportsNothing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Write([]byte(`{"success":true,"result":{"id":"a-worker"}}`))
	}))
	defer server.Close()

	answer := MultipartSend(server.URL, nil)(context.Background(), http.MethodPut, "/workers/scripts/a-worker",
		[]Part{{Name: "index.js", Filename: "index.js", Body: []byte("export default {};")}}, nil)

	if answer.Kind != Answered || answer.Status != http.StatusOK {
		t.Errorf("answer = %+v", answer)
	}
}
