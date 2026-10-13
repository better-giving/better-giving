package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/release"
)

var balancePath = "/accounts/" + account + "/ai-gateway/billing/credit-balance"

func chosen(t *testing.T, answers map[string]any) ModelChoice {
	t.Helper()
	return ReadModelChoice(context.Background(), fake(t, answers), account, worker, true)
}

func holding(model string) map[string]any {
	return varsHeld(map[string]any{"name": "AI_MODEL", "type": "plain_text", "text": model})
}

// the choice goes up through the vars door as plain text, so it is a value this console reads back
// rather than a mask over one.
func TestAModelChoiceIsWrittenAsAPlainVarAndReadBack(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall:        varsHeld(),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
	})
	written := SetVars(context.Background(), open, map[string]*string{"AI_MODEL": value("openai/gpt-5-mini")})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	sent := binding(patched(t, (*made)[1]), "AI_MODEL")
	if sent == nil || sent["type"] != "plain_text" || sent["text"] != "openai/gpt-5-mini" {
		t.Fatalf("the choice went up as %+v", sent)
	}

	read := chosen(t, map[string]any{
		settings:    varsHeld(sent),
		balancePath: envelope(map[string]any{"balance": 12.5}),
	})
	if read.Kind != ValuesRead || read.Model.Kind != VarValue || read.Model.Value != "openai/gpt-5-mini" {
		t.Fatalf("read back %+v", read)
	}
}

// a choice that spends no credits — unset, a model not credit-billed, an id off the list, a value held as a
// secret — asks nothing about what is left of them.
func TestTheDefaultModelAsksNothingAboutCredits(t *testing.T) {
	for what, bindings := range map[string]map[string]any{
		"unset":     varsHeld(),
		"default":   holding(release.AIModels[0].ID),
		"llama":     holding("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
		"off-list":  holding("anthropic/claude-opus-9"),
		"as secret": varsHeld(map[string]any{"name": "AI_MODEL", "type": "secret_text"}),
	} {
		// no answer is bound for the balance, so a read of it would come back unknown and fail here.
		read := chosen(t, map[string]any{settings: bindings})
		if read.Credits.Kind != CreditsNotAsked || read.Credits.Balance != nil {
			t.Errorf("%s: credits %+v", what, read.Credits)
		}
	}
}

// the balance can go negative (a call is billed after it is made), so anything at or under zero
// is a choice that is answered by the default model instead.
func TestACreditBilledChoiceReportsWhetherTheAccountHoldsCredits(t *testing.T) {
	for _, one := range []struct {
		balance float64
		want    CreditsKind
	}{
		{balance: 12.5, want: CreditsHeld},
		{balance: 0, want: CreditsMissing},
		{balance: -0.42, want: CreditsMissing},
	} {
		read := chosen(t, map[string]any{
			settings:    holding("anthropic/claude-sonnet-4.6"),
			balancePath: envelope(map[string]any{"balance": one.balance}),
		})
		if read.Credits.Kind != one.want || read.Credits.Balance == nil || *read.Credits.Balance != one.balance {
			t.Errorf("a balance of %v read as %+v", one.balance, read.Credits)
		}
	}
}

// an api token without AI Gateway Read is refused the read, and a refusal, or an answer carrying no
// balance, is unknown rather than a balance of nothing.
func TestABalanceThatCouldNotBeReadIsUnknownInCloudflaresWords(t *testing.T) {
	for what, answer := range map[string]any{
		"refused":    failed(10000, "Authentication error"),
		"forbidden":  http.StatusForbidden,
		"no balance": envelope(map[string]any{"currency": "usd"}),
	} {
		read := chosen(t, map[string]any{
			settings:    holding("openai/gpt-5-mini"),
			balancePath: answer,
		})
		if read.Credits.Kind != CreditsUnknown || read.Credits.Balance != nil {
			t.Errorf("%s: credits %+v", what, read.Credits)
		}
	}
	read := chosen(t, map[string]any{
		settings:    holding("openai/gpt-5-mini"),
		balancePath: failed(10000, "Authentication error"),
	})
	if read.Credits.Detail != "Authentication error" {
		t.Errorf("detail = %q, want cloudflare's own words", read.Credits.Detail)
	}
}

// a values read that did not land says nothing about the choice, and asks nothing about credits.
func TestAChoiceReadThatDidNotLandCarriesItsOwnKind(t *testing.T) {
	read := chosen(t, map[string]any{settings: failed(10007, "workers.api.error.script_not_found")})
	if read.Kind != ValuesNotDeployed || read.Credits.Kind != CreditsNotAsked {
		t.Fatalf("read %+v", read)
	}
}

// the console's own sign-in carries no AI Gateway scope (internal/oauth's Scopes), so a balance read
// on it is one cloudflare is certain to refuse: it is never made, and what the operator is told is
// what running out costs rather than cloudflare's refusal.
func TestASignInThatCannotReadCreditsAsksNothingAndSaysWhatRunningOutCosts(t *testing.T) {
	read := ReadModelChoice(context.Background(), fake(t, map[string]any{
		settings:    holding("anthropic/claude-sonnet-4.6"),
		balancePath: envelope(map[string]any{"balance": 12.5}),
	}), account, worker, false)
	if read.Credits.Kind != CreditsUnknown || read.Credits.Balance != nil ||
		read.Credits.Detail != CreditsUnreadOnSignIn {
		t.Fatalf("credits %+v", read.Credits)
	}
}
