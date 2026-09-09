package account

import (
	"context"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// one account-scoped read, taken before the choice is recorded.
//
// what it exists to catch is "member, not administrator": a sign-in can see an account in its own
// list and be refused everything inside it, and nothing in that list says which.

// a cloudflare answering one body, and the path it was asked for.
func answering(body any, status int) (cf.Get, *string) {
	asked := new(string)
	return func(_ context.Context, path string) cf.Answer {
		*asked = path
		return cf.Answer{Kind: cf.Answered, Status: status, Body: body}
	}, asked
}

func listed(rows []any) map[string]any {
	return map[string]any{"success": true, "errors": []any{}, "result": rows}
}

func TestAnAccountThisSignInCanReachIsAYes(t *testing.T) {
	// the empty list is the ordinary first run: what makes it a yes is that cloudflare answered
	// about the account at all, and the rows are not looked at.
	get, asked := answering(listed([]any{}), 200)
	if !Verify(context.Background(), get, "an-account") {
		t.Fatal("an account with no databases in it was read as a refusal")
	}
	if *asked != "/accounts/an-account/d1/database?per_page=10&page=1" {
		t.Fatalf("the read was not scoped to the account: %s", *asked)
	}
}

func TestAnAccountThisSignInMayNotAdministerIsANo(t *testing.T) {
	refused := map[string]any{
		"success": false,
		"errors":  []any{map[string]any{"code": float64(10000), "message": "Authentication error"}},
	}
	get, _ := answering(refused, 403)
	if Verify(context.Background(), get, "an-account") {
		t.Fatal("a member who cannot administer the account was recorded into it")
	}
}

func TestACloudflareNothingWasFoundOutFromIsANo(t *testing.T) {
	// the read was scoped to one account, so a cloudflare that could not be reached leaves the same
	// thing untrue — that this sign-in can work in there — and a choice is not recorded on a fact
	// nobody established.
	get := func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route to host"}
	}
	if Verify(context.Background(), get, "an-account") {
		t.Fatal("an unreachable cloudflare was read as a yes")
	}
}

func TestAnAnswerInAShapeNothingWasWrittenAgainstIsANo(t *testing.T) {
	get, _ := answering("not an object", 200)
	if Verify(context.Background(), get, "an-account") {
		t.Fatal("an unreadable answer was read as a yes")
	}
}
