// Package nowpayments is the console's door to NOWPayments.
//
// **two reads and nothing else.** the press that stores NOWPayments' values asks the account's coin
// selection with the key it was handed, which is what says the key reads the account, and then the
// currency list, which is what says the outcome currency is a coin NOWPayments names. both are the
// reads `acceptedCoins` in packages/app/src/lib/server/payments/nowpayments.ts makes with the key the
// deployment holds, so a key this check passes is one the deployment's own reads accept. no call here
// creates, pays out or converts anything.
//
// **there is no sandbox address.** NOWPayments' sandbox is a separate host with keys of its own, and
// the deployment calls the live API alone, so a key is checked where the deployment will use it.
//
// **the api key is a local value for the length of one press.** it is closed over by BindAt, travels
// in the `x-api-key` header and in no url, and is never logged or put in a sentence a screen draws —
// which is what makes NOWPayments' own words about a failure safe to carry back.
//
// every failure is a value: nothing here returns an error.
package nowpayments

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// API is where NOWPayments answers.
const API = "https://api.nowpayments.io"

const (
	coinsPath      = "/v1/merchant/coins"
	currenciesPath = "/v1/full-currencies"
)

// the three names the press writes, and the press alone (../server/nowpayments.go).
const (
	apiKeyVar          = "NOWPAYMENTS_API_KEY"
	ipnSecretVar       = "NOWPAYMENTS_IPN_SECRET"
	outcomeCurrencyVar = "NOWPAYMENTS_OUTCOME_CURRENCY"
)

// SetUpOnly is every name the press writes.
var SetUpOnly = []string{apiKeyVar, ipnSecretVar, outcomeCurrencyVar}

// Values is the one write a readable check is stored as, the outcome currency in NOWPayments' own
// spelling rather than as it was typed.
func Values(apiKey, ipnSecret string, checked Checked) map[string]*string {
	return map[string]*string{
		apiKeyVar:          &apiKey,
		ipnSecretVar:       &ipnSecret,
		outcomeCurrencyVar: &checked.Currency,
	}
}

// Call is one read bound to a key the caller never sees again.
type Call func(ctx context.Context, path string) cf.Answer

// Bind binds one api key against the live API.
func Bind(apiKey string) Call { return BindAt(API, apiKey) }

// BindAt binds one api key against an address, which is a test host everywhere but Bind.
func BindAt(address, apiKey string) Call {
	send := cf.JSONSend(strings.TrimSuffix(address, "/"), map[string]string{"x-api-key": apiKey})
	return func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}
}

// CheckKind is how one check of the pasted values ended.
type CheckKind string

const (
	// Readable is the key reading the account and the outcome currency a coin NOWPayments names: the
	// only kind a press stores anything on.
	Readable CheckKind = "readable"
	// KeyRefused is NOWPayments turning the key down. The way out is the key box.
	KeyRefused CheckKind = "key_refused"
	// CurrencyUnknown is an outcome currency NOWPayments' list does not name. The way out is that box.
	CurrencyUnknown CheckKind = "currency_unknown"
	// Unanswered is nothing found out about either: no route, a 5xx, a request NOWPayments would not
	// carry out for some other reason, or an answer in a shape this console was not written against.
	Unanswered CheckKind = "unanswered"
)

// Checked is one check's outcome. Detail is empty on Readable, and Currency is the outcome currency
// as NOWPayments spells it — lowercased, which is what the deployment compares against — on Readable
// alone.
type Checked struct {
	Kind     CheckKind
	Detail   string
	Currency string
}

// Check asks NOWPayments whether the key reads the account and whether the outcome currency is one of
// its coins, in that order: a currency is not asked about with a key that reads nothing.
func Check(ctx context.Context, call Call, outcomeCurrency string) Checked {
	coins := call(ctx, coinsPath)
	if refused := failed(coins); refused != nil {
		return *refused
	}
	if selected, _ := body(coins)["selectedCurrencies"].([]any); selected == nil {
		return unreadable("the account's coin selection")
	}

	listing := call(ctx, currenciesPath)
	if refused := failed(listing); refused != nil {
		return *refused
	}
	currencies, _ := body(listing)["currencies"].([]any)
	if currencies == nil {
		return unreadable("the currency list")
	}
	wanted := strings.ToLower(outcomeCurrency)
	for _, one := range currencies {
		entry, _ := one.(map[string]any)
		if code, _ := entry["code"].(string); strings.ToLower(code) == wanted {
			return Checked{Kind: Readable, Currency: wanted}
		}
	}
	return Checked{
		Kind:   CurrencyUnknown,
		Detail: fmt.Sprintf("NOWPayments names no coin %q, so it cannot be the outcome currency.", wanted),
	}
}

func body(answer cf.Answer) map[string]any {
	held, _ := answer.Body.(map[string]any)
	return held
}

func unreadable(what string) Checked {
	return Checked{
		Kind:   Unanswered,
		Detail: "NOWPayments answered with " + what + " in a shape this console was not written against.",
	}
}

// the check a call that did not answer with a 200 ends as, or nil where it did.
func failed(answer cf.Answer) *Checked {
	if answer.Kind == cf.Unreachable {
		return &Checked{Kind: Unanswered, Detail: "NOWPayments could not be reached: " + answer.Detail}
	}
	switch {
	case answer.Status == http.StatusUnauthorized || answer.Status == http.StatusForbidden:
		return &Checked{Kind: KeyRefused, Detail: "NOWPayments did not accept this API key. " + said(answer)}
	case answer.Status != http.StatusOK:
		return &Checked{Kind: Unanswered, Detail: said(answer)}
	}
	return nil
}

// what NOWPayments said about a failure: the error body's `code` and `message`, and nothing else off
// it, or the status where it sent neither.
func said(answer cf.Answer) string {
	parts := []string{}
	for _, member := range []string{"code", "message"} {
		if held, _ := body(answer)[member].(string); held != "" {
			parts = append(parts, held)
		}
	}
	if len(parts) == 0 {
		return fmt.Sprintf("NOWPayments answered %d", answer.Status)
	}
	return "NOWPayments said: " + strings.Join(parts, ": ")
}
