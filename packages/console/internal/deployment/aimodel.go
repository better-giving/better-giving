package deployment

import (
	"context"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the model this deployment answers generated text with, and whether the account can pay for it.
//
// **the choice is one of the configuration values and nothing more.** it is `AI_MODEL`, a plain var
// read off the worker's settings by ./values.go and written through ./write.go's SetVars like every
// other one — so it reads back as what was stored, and taking it off is the default model. the ids a
// write may carry are internal/release's AIModels, which internal/server's values.go holds a write
// to.
//
// **credits are a hint, read only for a choice that spends them, and only on an api token.** the
// read is AI Gateway's account-level balance, on AI Gateway Read; the balance can go below zero, so
// anything at or under zero is missing, and what the deployment does on an empty account is
// `generate`'s header in packages/app/src/lib/server/ai/generate.ts. this console's own browser
// sign-in asks for no AI Gateway scope (internal/oauth's Scopes), so on it the read is never made
// and the choice's credits are unknown in CreditsUnreadOnSignIn's words; an environment token
// carrying that permission is what gets a number. a read that did not land is unknown too, never a
// balance of nothing.

// AIModelName is the configuration value the choice is held under.
const AIModelName = "AI_MODEL"

// CreditsKind is what a choice's credits read as.
type CreditsKind string

const (
	// CreditsNotAsked is a choice that spends no credits this console knows of — the default model, no
	// choice at all, an id off the list, a value held as a secret — or a values read that did not
	// land.
	CreditsNotAsked CreditsKind = "not-asked"
	// CreditsHeld is a balance above zero.
	CreditsHeld CreditsKind = "held"
	// CreditsMissing is a balance at or under zero.
	CreditsMissing CreditsKind = "missing"
	// CreditsUnknown is a credit-billed choice whose balance could not be read.
	CreditsUnknown CreditsKind = "unknown"
)

// CreditsUnreadOnSignIn is what a credit-billed choice's credits say on the browser sign-in, which
// cannot read them.
const CreditsUnreadOnSignIn = "This console's Cloudflare sign-in cannot read the account's credits. " +
	"If they run out, the chat answers from the default model and says so."

// Credits is the account's balance as the choice needs it.
type Credits struct {
	Kind CreditsKind `json:"kind"`
	// Balance is what cloudflare reported, on held and missing alone.
	Balance *float64 `json:"balance"`
	// Detail is why the balance is not known, on unknown alone: cloudflare's own words, or
	// CreditsUnreadOnSignIn.
	Detail string `json:"detail"`
}

// ModelChoice is `AI_MODEL` as the deployment holds it, and the credits that choice spends.
//
// Flat, the way VarsRead is: Model is the row on ValuesRead alone and Detail is on the kinds that
// did not land.
type ModelChoice struct {
	Kind    ValuesKind  `json:"kind"`
	Model   DeployedVar `json:"model"`
	Credits Credits     `json:"credits"`
	Detail  string      `json:"detail"`
}

// ReadModelChoice is the choice `workerName` in `accountID` holds, with the account's credits where
// that choice spends them. `apiToken` is whether `get` carries the environment's api token
// (internal/oauth's TokenVar) rather than the browser sign-in, and a balance read is made on it alone.
func ReadModelChoice(ctx context.Context, get cf.Get, accountID, workerName string, apiToken bool) ModelChoice {
	notAsked := Credits{Kind: CreditsNotAsked}
	read := DeployedVars(ctx, get, accountID, workerName)
	if read.Kind != ValuesRead {
		return ModelChoice{Kind: read.Kind, Credits: notAsked, Detail: read.Detail}
	}
	row := DeployedVar{Name: AIModelName, Kind: VarAbsent}
	for _, one := range read.Vars {
		if one.Name == AIModelName {
			row = one
		}
	}
	choice := ModelChoice{Kind: ValuesRead, Model: row, Credits: notAsked}
	if model, listed := release.ModelByID(row.Value); row.Kind != VarValue || !listed || !model.CreditBilled {
		return choice
	}
	if !apiToken {
		choice.Credits = Credits{Kind: CreditsUnknown, Detail: CreditsUnreadOnSignIn}
		return choice
	}
	choice.Credits = creditBalance(ctx, get, accountID)
	return choice
}

// the account's AI Gateway credit balance.
// https://developers.cloudflare.com/ai-gateway/features/unified-billing/
func creditBalance(ctx context.Context, get cf.Get, accountID string) Credits {
	answer := get(ctx, "/accounts/"+accountID+"/ai-gateway/billing/credit-balance")
	read := cf.ReadShaped(answer, func(value any) (float64, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return 0, false
		}
		balance, ok := held["balance"].(float64)
		return balance, ok
	})
	if read.Kind != cf.ResultValue {
		detail := read.Detail
		if detail == "" {
			detail = cf.Said(answer)
		}
		return Credits{Kind: CreditsUnknown, Detail: detail}
	}
	kind := CreditsHeld
	if read.Value <= 0 {
		kind = CreditsMissing
	}
	return Credits{Kind: kind, Balance: &read.Value}
}
