package stripe

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// the door to the processor, looked at from the far end of a real connection.
//
// what is asserted is what goes onto the wire and what comes back off it: which header the key is
// in, that no url carries it, and that each way an answer did not arrive is the kind a screen has a
// different sentence for.

// a processor that records the one request it is sent and answers with `answer`.
func recording(t *testing.T, status int, answer string) (*httptest.Server, *http.Request, *string) {
	t.Helper()
	held := &http.Request{}
	body := new(string)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read, _ := io.ReadAll(r.Body)
		*body = string(read)
		*held = *r
		w.WriteHeader(status)
		_, _ = io.WriteString(w, answer)
	}))
	t.Cleanup(server.Close)
	return server, held, body
}

func through(server *httptest.Server, secretKey string) Call {
	return Calls(cf.FormSender(server.URL, headers(secretKey)))
}

func TestTheKeyTravelsInAHeaderAndTheVersionIsPinnedOnEveryCall(t *testing.T) {
	server, held, _ := recording(t, 200, `{"id":"acct_1"}`)

	through(server, "sk_test_secret")(context.Background(), Request{Method: http.MethodGet, Path: "/account"})

	if held.Header.Get("Authorization") != "Bearer sk_test_secret" {
		t.Errorf("authorization = %q", held.Header.Get("Authorization"))
	}
	if held.Header.Get("Stripe-Version") == "" {
		t.Error("no Stripe-Version was pinned, so deliveries would be serialised in the account's own")
	}
	if strings.Contains(held.URL.String(), "sk_") {
		t.Errorf("the url %q carries the key", held.URL.String())
	}
}

func TestAListGoesUpIndexedRatherThanJoined(t *testing.T) {
	server, _, body := recording(t, 200, `{"id":"we_1"}`)

	through(server, "sk_test_secret")(context.Background(), Request{
		Method: http.MethodPost,
		Path:   "/webhook_endpoints",
		Form:   Form(map[string]string{"url": "https://x.example"}, "enabled_events", []string{"a.b", "c.d"}),
	})

	for _, want := range []string{"enabled_events%5B0%5D=a.b", "enabled_events%5B1%5D=c.d"} {
		if !strings.Contains(*body, want) {
			t.Errorf("body %q carries no %q", *body, want)
		}
	}
}

func TestAKeyTheProcessorWillNotAcceptIsRefusedAndNotRejected(t *testing.T) {
	for _, status := range []int{401, 403} {
		server, _, _ := recording(t, status, `{"error":{"message":"Invalid API Key provided"}}`)
		read := Read(through(server, "sk_test_secret")(
			context.Background(), Request{Method: http.MethodGet, Path: "/account"}))

		if read.Kind != Refused {
			t.Errorf("%d read as %q, want refused — the way out is the box the key was typed in", status, read.Kind)
		}
		if read.Detail != "Invalid API Key provided" {
			t.Errorf("detail = %q, want the processor's own words", read.Detail)
		}
	}
}

func TestAnUnderstoodRequestTheProcessorWillNotCarryOutIsRejected(t *testing.T) {
	server, _, _ := recording(t, 400, `{"error":{"message":"Invalid URL"}}`)
	read := Read(through(server, "sk_test_secret")(
		context.Background(), Request{Method: http.MethodPost, Path: "/webhook_endpoints"}))

	if read.Kind != Rejected {
		t.Errorf("kind = %q, want rejected — a different key is not the way out of this one", read.Kind)
	}
}

func TestA5xxIsNothingFoundOutEitherWay(t *testing.T) {
	server, _, _ := recording(t, 503, `{}`)
	read := Read(through(server, "sk_test_secret")(
		context.Background(), Request{Method: http.MethodPost, Path: "/webhook_endpoints"}))

	if read.Kind != Unreachable {
		t.Errorf("kind = %q, want unreachable — the endpoint may or may not be there", read.Kind)
	}
}

func TestAProcessorThatIsNotThereIsAValueAndNotAThrow(t *testing.T) {
	read := Read(Calls(cf.FormSender("http://127.0.0.1:1", nil))(
		context.Background(), Request{Method: http.MethodGet, Path: "/account"}))

	if read.Kind != Unreachable || read.Detail == "" {
		t.Errorf("read = %+v, want unreachable carrying what went wrong", read)
	}
}

func TestAnAnswerWithNoWordsOfItsOwnIsNamedByItsStatus(t *testing.T) {
	server, _, _ := recording(t, 402, `"not an object"`)
	read := Read(through(server, "sk_test_secret")(
		context.Background(), Request{Method: http.MethodGet, Path: "/account"}))

	if !strings.Contains(read.Detail, "402") {
		t.Errorf("detail = %q, want the status where the processor wrote no message", read.Detail)
	}
}

func TestA200InAShapeNothingWasWrittenAgainstIsUnreadable(t *testing.T) {
	server, _, _ := recording(t, 200, `[1,2,3]`)
	read := Read(through(server, "sk_test_secret")(
		context.Background(), Request{Method: http.MethodGet, Path: "/account"}))

	if read.Kind != Unreadable {
		t.Errorf("kind = %q, want unreadable", read.Kind)
	}
}

func TestAnAccountIsNamedByTheFirstOfFourThatIsThere(t *testing.T) {
	for _, one := range []struct {
		name  string
		body  map[string]any
		wants string
	}{
		{
			name: "the dashboard's own name",
			body: map[string]any{
				"id":               "acct_1",
				"settings":         map[string]any{"dashboard": map[string]any{"display_name": "Bright Trust"}},
				"business_profile": map[string]any{"name": "Bright Trust Ltd"},
				"email":            "ops@bright.example",
			},
			wants: "Bright Trust",
		},
		{
			name:  "the business name where the dashboard has none",
			body:  map[string]any{"id": "acct_1", "business_profile": map[string]any{"name": "Bright Trust Ltd"}},
			wants: "Bright Trust Ltd",
		},
		{
			name:  "the address it is reached at",
			body:  map[string]any{"id": "acct_1", "email": "ops@bright.example"},
			wants: "ops@bright.example",
		},
		{
			name:  "the id, which a brand-new account is all it has",
			body:  map[string]any{"id": "acct_1"},
			wants: "acct_1",
		},
	} {
		t.Run(one.name, func(t *testing.T) {
			account := ReadAccount(one.body)
			if account == nil || account.Name != one.wants {
				t.Errorf("account = %+v, want %q", account, one.wants)
			}
		})
	}
}

func TestAnAccountWithNoIdIsNotAnAccount(t *testing.T) {
	if ReadAccount(map[string]any{"email": "ops@bright.example"}) != nil {
		t.Error("an account with no id was named, and nothing could be acted on afterwards")
	}
}

func TestAnEndpointListCarriesNoSigningSecretWhateverIsInIt(t *testing.T) {
	rows, ok := ReadEndpoints(map[string]any{"data": []any{
		map[string]any{
			"id":             "we_1",
			"url":            "https://x.example/api/stripe/webhook",
			"status":         "enabled",
			"secret":         "whsec_should_never_be_read",
			"enabled_events": []any{"invoice.paid", 7},
			"metadata":       map[string]any{"signing_secret_fingerprint": "abcdef0123456789"},
		},
	}})

	if !ok || len(rows) != 1 {
		t.Fatalf("rows = %+v, ok = %v", rows, ok)
	}
	row := rows[0]
	if !row.Delivering {
		t.Error("an enabled endpoint read as not delivering")
	}
	if len(row.EventTypes) != 1 || row.EventTypes[0] != "invoice.paid" {
		t.Errorf("eventTypes = %v, want the strings alone", row.EventTypes)
	}
	if row.Fingerprint == nil || *row.Fingerprint != "abcdef0123456789" {
		t.Errorf("fingerprint = %v", row.Fingerprint)
	}
	// the secret is populated only on a create's own answer, so a mapper that copied whatever was
	// there would put a credential into the value a list is drawn from.
	if strings.Contains(row.URL, "whsec_") || row.ID == "whsec_should_never_be_read" {
		t.Error("a signing secret reached a listed row")
	}
}

func TestAnEndpointWithNoStampIsCarriedAsHavingNoneRatherThanAnEmptyOne(t *testing.T) {
	rows, _ := ReadEndpoints(map[string]any{"data": []any{
		map[string]any{"id": "we_1", "url": "https://x.example", "metadata": map[string]any{
			"signing_secret_fingerprint": "",
		}},
	}})
	if len(rows) != 1 || rows[0].Fingerprint != nil {
		t.Errorf("rows = %+v, want a stamp of nil over a value that is not one", rows)
	}
}

func TestARowWithNoIdOrNoUrlIsDroppedRatherThanActedOn(t *testing.T) {
	rows, ok := ReadEndpoints(map[string]any{"data": []any{
		map[string]any{"url": "https://x.example"},
		map[string]any{"id": "we_2"},
		"not a row",
	}})
	if !ok || len(rows) != 0 {
		t.Errorf("rows = %+v, ok = %v, want none of the three acted on", rows, ok)
	}
}

func TestAListInAShapeNothingWasWrittenAgainstIsNotAnEmptyAccount(t *testing.T) {
	// an empty list would delete nothing and register beside whatever is already there.
	if _, ok := ReadEndpoints(map[string]any{"object": "list"}); ok {
		t.Error("an answer carrying no data list read as an account holding no endpoints")
	}
}

func TestACreateCarriesTheOneCopyOfItsSigningSecret(t *testing.T) {
	made := ReadCreated(map[string]any{"id": "we_1", "secret": "whsec_x", "livemode": true})
	if made == nil || made.ID != "we_1" || made.SigningSecret != "whsec_x" || !made.LiveMode {
		t.Errorf("created = %+v", made)
	}
}

func TestACreateWithNoSecretIsStillAnEndpointThatExists(t *testing.T) {
	made := ReadCreated(map[string]any{"id": "we_1"})
	if made == nil || made.SigningSecret != "" {
		t.Errorf("created = %+v, want the endpoint and no secret", made)
	}
}

func TestTheStampIsTheDigestBothEndsCompute(t *testing.T) {
	// the vector packages/operator/src/stripe/secret-fingerprint.ts computes for the same string:
	// sha-256, hex, the first sixteen characters.
	if held := Fingerprint("whsec_test"); held != "609b97b03239401b" {
		t.Errorf("Fingerprint = %q, want the digest the deployment reads back off the endpoint", held)
	}
}

func TestAValueThatIsNotASecretIsStampedWithNothing(t *testing.T) {
	// an unset value and a set one must not produce comparable stamps: two deployments holding
	// nothing would otherwise agree, and a console would report a match over one that verifies
	// nothing.
	for _, one := range []string{"", "   "} {
		if held := Fingerprint(one); held != "" {
			t.Errorf("Fingerprint(%q) = %q, want none", one, held)
		}
	}
}
