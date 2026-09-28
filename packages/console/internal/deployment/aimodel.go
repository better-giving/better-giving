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
// other one — so it reads back as what was stored, and taking it off is the free model. the ids a
// write may carry are internal/release's AIModels, which the handler holds a write to.
//
// **credits are a hint, read only for a choice that spends them.** the models beside the free one
// are billed to the account's Cloudflare credits through AI Gateway, and no binding call reads what
// is left: the account-level read below does, on AI Gateway Read. a call is billed after it is made,
// so the balance can go below zero, and anything at or under zero is an account the deployment's
// credit-billed calls fail on — each of which the deployment answers with the free model instead
// (`generate` in packages/app/src/lib/server/ai/generate.ts). a read that did not land is unknown,
// never a balance of nothing: this console's own sign-in asks for no AI Gateway scope
// (internal/oauth's Scopes), so on it the read is refused, and an environment token carrying that
// permission is what gets a number.

// AIModelName is the configuration value the choice is held under.
const AIModelName = "AI_MODEL"

// CreditsKind is what a choice's credits read as.
type CreditsKind string

const (
	// CreditsNotAsked is a choice that spends no credits this console knows of — the free model, no
	// choice at all, an id off the list, a value it cannot read — or a choice it could not read.
	CreditsNotAsked CreditsKind = "not-asked"
	// CreditsHeld is a balance above zero.
	CreditsHeld CreditsKind = "held"
	// CreditsMissing is a balance at or under zero.
	CreditsMissing CreditsKind = "missing"
	// CreditsUnknown is a credit-billed choice whose balance could not be read.
	CreditsUnknown CreditsKind = "unknown"
)

// Credits is the account's balance as the choice needs it.
type Credits struct {
	Kind CreditsKind `json:"kind"`
	// Balance is what cloudflare reported, on held and missing alone.
	Balance *float64 `json:"balance"`
	// Detail is cloudflare's own words, on unknown alone.
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
// that choice spends them.
func ReadModelChoice(ctx context.Context, get cf.Get, accountID, workerName string) ModelChoice {
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
	if model, listed := release.ModelByID(row.Value); row.Kind == VarValue && listed && model.CreditBilled {
		choice.Credits = creditBalance(ctx, get, accountID)
	}
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
