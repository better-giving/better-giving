package paypal

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// what goes on the wire, against a host that records it.
func TestTheTokenIsMintedWithThePairAndEveryLaterCallCarriesTheTokenAlone(t *testing.T) {
	type seen struct{ method, path, authorization, body string }
	calls := []seen{}
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, seen{r.Method, r.URL.Path, r.Header.Get("Authorization"), string(body)})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"A21AA-token"}`))
	}))
	defer host.Close()

	binding := BindAt(host.URL, "client", "secret")
	minted := Read(binding.Authorize(context.Background()))
	binding.Bearer(text(minted.Value["access_token"]))(context.Background(), Request{
		Method: http.MethodGet, Path: "/v1/notifications/webhooks",
	})

	if len(calls) != 2 {
		t.Fatalf("calls = %+v", calls)
	}
	// base64 of `client:secret`.
	if want := "Basic Y2xpZW50OnNlY3JldA=="; calls[0].authorization != want {
		t.Errorf("the mint carried %q, want %q", calls[0].authorization, want)
	}
	if calls[0].path != "/v1/oauth2/token" || calls[0].body != "grant_type=client_credentials" {
		t.Errorf("the mint was %+v", calls[0])
	}
	if want := "Bearer A21AA-token"; calls[1].authorization != want {
		t.Errorf("the read carried %q, want %q", calls[1].authorization, want)
	}
}

func TestAnAnswerIsSortedByItsStatus(t *testing.T) {
	for _, one := range []struct {
		status int
		want   ResultKind
	}{
		{200, Value}, {401, Refused}, {403, Refused}, {422, Rejected}, {500, Unreachable},
	} {
		got := Read(cf.Answer{Kind: cf.Answered, Status: one.status, Body: map[string]any{}})
		if got.Kind != one.want {
			t.Errorf("%d read as %s, want %s", one.status, got.Kind, one.want)
		}
	}
}

func TestAListWithNoMemberIsAnAppHoldingNoListeners(t *testing.T) {
	rows, read := ReadListeners(map[string]any{})
	if !read || len(rows) != 0 {
		t.Errorf("rows = %v, read = %v, want an empty list read", rows, read)
	}
}
