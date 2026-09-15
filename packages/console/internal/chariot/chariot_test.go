package chariot

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// what goes on the wire, against a host that records it.
func TestEveryCallCarriesTheKeyAsABearerAndNowhereElse(t *testing.T) {
	type seen struct{ method, uri, authorization, body string }
	calls := []seen{}
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, seen{r.Method, r.URL.RequestURI(), r.Header.Get("Authorization"), string(body)})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer host.Close()

	call := BindAt(host.URL+"/", "ck_secret")
	call(context.Background(), Request{Method: http.MethodGet, Path: "/v1/event_subscriptions?limit=1"})

	if len(calls) != 1 {
		t.Fatalf("calls = %+v", calls)
	}
	if want := "Bearer ck_secret"; calls[0].authorization != want {
		t.Errorf("the call carried %q, want %q", calls[0].authorization, want)
	}
	if calls[0].uri != "/v1/event_subscriptions?limit=1" {
		t.Errorf("the call went to %q", calls[0].uri)
	}
}

func TestAnAnswerIsSortedByItsStatus(t *testing.T) {
	for _, one := range []struct {
		status int
		body   any
		want   ResultKind
	}{
		{200, map[string]any{}, Value},
		{201, map[string]any{}, Value},
		{401, map[string]any{"detail": "Unauthorized"}, Refused},
		{403, map[string]any{}, Forbidden},
		{400, map[string]any{}, Rejected},
		{404, map[string]any{}, Rejected},
		{500, map[string]any{}, Unreachable},
		// a gateway's html page decodes to no body at all.
		{504, nil, Unreachable},
		{200, nil, Unreadable},
	} {
		got := Read(cf.Answer{Kind: cf.Answered, Status: one.status, Body: one.body})
		if got.Kind != one.want {
			t.Errorf("%d read as %s, want %s", one.status, got.Kind, one.want)
		}
	}
}

func TestWhatChariotSaidIsTheProblemDetailAlone(t *testing.T) {
	said := Said(cf.Answer{Kind: cf.Answered, Status: 404, Body: map[string]any{
		"type": "about:blank", "title": "API Error", "status": 404, "detail": "Connect not found",
	}})
	if said != "Chariot said: Connect not found" {
		t.Errorf("said %q", said)
	}
	if said := Said(cf.Answer{Kind: cf.Answered, Status: 504}); said != "Chariot answered 504" {
		t.Errorf("said %q", said)
	}
}

func TestATypedAddressIsCheckedAndABlankOneIsLive(t *testing.T) {
	for _, one := range []struct {
		typed string
		want  string
		ok    bool
	}{
		{"", API, true},
		{"  ", API, true},
		{"https://api.givechariot.com", API, true},
		{"https://sandboxapi.givechariot.com/", "https://sandboxapi.givechariot.com", true},
		{"http://sandboxapi.givechariot.com", "", false},
		{"https://sandboxapi.givechariot.com/v1", "", false},
		{"https://sandboxapi.givechariot.com?x=1", "", false},
		{"sandboxapi.givechariot.com", "", false},
		{" https://api.givechariot.com", "", false},
	} {
		got, ok := Address(one.typed)
		if got != one.want || ok != one.ok {
			t.Errorf("Address(%q) = %q, %v, want %q, %v", one.typed, got, ok, one.want, one.ok)
		}
	}
}
