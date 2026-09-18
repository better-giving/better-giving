// Package nowpayments is the console's door to NOWPayments.
//
// **three reads and nothing else, over two paths.** the press that stores NOWPayments' values asks
// the account's coin selection with the key it was handed, which is what says the key reads the
// account, and then the currency list, which is what says the outcome currency is a coin
// NOWPayments will pay out in. the listing is that same currency list read on its own and with
// nothing checked, so the box an outcome currency is typed into is one an operator picks from
// rather than spells. both paths are the reads `acceptedCoins` in
// packages/app/src/lib/server/payments/nowpayments.ts makes with the key the deployment holds, so a
// key this check passes is one the deployment's own reads accept. no call here creates, pays out or
// converts anything.
//
// **a coin on the list is not a coin this deployment can be paid out in.** an entry carries
// `enable` and `available_for_payout` and NOWPayments names plenty it takes in and will not send
// back out, so both the listing and the check read those two rather than the code alone — a coin
// stored as the outcome currency off the code alone is a payout that fails at the first settlement.
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
	"net/url"
	"slices"
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

// CheckKind is how one read of NOWPayments ended: a check of the pasted values, or the listing a
// screen fills its outcome-currency box from. Both are sorted into the same words, because what an
// operator does about a key NOWPayments turned down is the same either way.
type CheckKind string

const (
	// Readable is the key reading the account and the outcome currency a coin NOWPayments pays out
	// in: the only kind a press stores anything on.
	Readable CheckKind = "readable"
	// Listed is the coin listing read: the only kind coins are carried on.
	Listed CheckKind = "listed"
	// KeyRefused is NOWPayments turning the key down. The way out is the key box.
	KeyRefused CheckKind = "key_refused"
	// CurrencyUnknown is an outcome currency NOWPayments will not pay out in — one its list does not
	// name at all, and one it names and takes in only. The way out is that box.
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
		code, _ := entry["code"].(string)
		if strings.ToLower(code) != wanted {
			continue
		}
		if !payable(entry) {
			return Checked{Kind: CurrencyUnknown, Detail: fmt.Sprintf(
				"NOWPayments does not pay out in %q, so it cannot be the outcome currency.", wanted)}
		}
		return Checked{Kind: Readable, Currency: wanted}
	}
	return Checked{
		Kind:   CurrencyUnknown,
		Detail: fmt.Sprintf("NOWPayments names no coin %q, so it cannot be the outcome currency.", wanted),
	}
}

// Coin is one coin NOWPayments will pay out in, in the members a screen draws it by. Code and
// Ticker are lowercased: the code is the spelling a deployment compares against and the one Check
// hands back, and the ticker is the coin's own symbol in the spelling `acceptedCoins` in
// packages/app/src/lib/server/payments/nowpayments.ts carries into the served form config, so one
// coin reads the same on a console screen and on the donation form. Everything else is
// NOWPayments' own. Ticker is empty where the entry named none and Logo where it carried none this
// console could resolve, and the two marks are false unless the entry said so — a coin is listed on
// all of them either way.
type Coin struct {
	Code       string `json:"code"`
	Ticker     string `json:"ticker"`
	Name       string `json:"name"`
	Network    string `json:"network"`
	Logo       string `json:"logo"`
	Popular    bool   `json:"popular"`
	Stablecoin bool   `json:"stablecoin"`
}

// Listing is one read of the payable coins. Detail is empty on Listed, and Coins is the whole set
// on Listed and empty on every other kind — never nil, so a screen has a list to draw either way.
type Listing struct {
	Kind   CheckKind
	Detail string
	Coins  []Coin
}

// Payable asks NOWPayments for every coin it will pay out in, which is the set an outcome currency
// is chosen out of and the set Check accepts one out of. It is the currency list read on its own,
// with no key checked against the account first: a key this read is made with is one a screen is
// about to check anyway, and a listing nothing came back for says so in the same words.
func Payable(ctx context.Context, call Call) Listing {
	answer := call(ctx, currenciesPath)
	if refused := failed(answer); refused != nil {
		return nothingListed(*refused)
	}
	currencies, _ := body(answer)["currencies"].([]any)
	if currencies == nil {
		return nothingListed(unreadable("the currency list"))
	}

	coins := []Coin{}
	for _, one := range currencies {
		entry, _ := one.(map[string]any)
		code, _ := entry["code"].(string)
		if code == "" || !payable(entry) {
			continue
		}
		ticker, _ := entry["ticker"].(string)
		name, _ := entry["name"].(string)
		network, _ := entry["network"].(string)
		popular, _ := entry["is_popular"].(bool)
		stablecoin, _ := entry["is_stable"].(bool)
		coins = append(coins, Coin{
			Code: strings.ToLower(code), Ticker: strings.ToLower(ticker), Name: name,
			Network: network, Logo: logo(entry), Popular: popular, Stablecoin: stablecoin,
		})
	}
	slices.SortFunc(coins, func(a, b Coin) int {
		if by := strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)); by != 0 {
			return by
		}
		return strings.Compare(a.Code, b.Code)
	})
	return Listing{Kind: Listed, Coins: coins}
}

// whether one entry of the currency list is a coin this deployment could be paid out in: switched
// on in the account, and one NOWPayments pays out at all. A coin it takes in only is on the list
// like any other.
func payable(entry map[string]any) bool {
	on, _ := entry["enable"].(bool)
	out, _ := entry["available_for_payout"].(bool)
	return on && out
}

// where NOWPayments serves the coin logos its list carries as paths.
var logoOrigin = &url.URL{Scheme: "https", Host: "nowpayments.io"}

// one entry's own logo as an absolute https address, or empty where it carries none this console can
// resolve — a coin listed like any other and drawn without a picture.
//
// `logo_url` is a path on NOWPayments' site (`/images/coins/btc.svg`), so the origin is supplied and
// the path never is: a logo assembled from a coin's code would be a table this repo keeps and
// NOWPayments moves. an entry stating an address in full is used as it stands, and nothing but
// https is kept — the row is drawn on a screen this project does not own the pictures for.
func logo(entry map[string]any) string {
	stated, _ := entry["logo_url"].(string)
	if stated == "" {
		return ""
	}
	reference, err := url.Parse(stated)
	if err != nil {
		return ""
	}
	resolved := logoOrigin.ResolveReference(reference)
	if resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}

// the listing a read that found nothing out ends as, in the words the same failure gives a check.
func nothingListed(from Checked) Listing {
	return Listing{Kind: from.Kind, Detail: from.Detail, Coins: []Coin{}}
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
