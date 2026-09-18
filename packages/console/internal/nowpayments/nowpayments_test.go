package nowpayments

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/release"
)

// NOWPayments as an httptest server: each path answers what the case names, and every call is
// remembered with the key header it carried.
func account(t *testing.T, answers map[string]answering) (string, func() []string) {
	t.Helper()
	asked := []string{}
	var recording sync.Mutex
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recording.Lock()
		asked = append(asked, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("x-api-key"))
		recording.Unlock()
		one, named := answers[r.URL.Path]
		if !named {
			one = answering{http.StatusNotFound, map[string]any{}}
		}
		w.WriteHeader(one.status)
		_ = json.NewEncoder(w).Encode(one.body)
	}))
	t.Cleanup(host.Close)
	return host.URL, func() []string {
		recording.Lock()
		defer recording.Unlock()
		return append([]string{}, asked...)
	}
}

type answering struct {
	status int
	body   any
}

var (
	selection = answering{http.StatusOK, map[string]any{"selectedCurrencies": []any{"BTC", "usdttrc20"}}}
	// the list as NOWPayments spells it: uppercase codes, a name that sorts by its second letter,
	// two coins of one name, a coin it takes in and will not pay out, and a coin switched off.
	listed = answering{http.StatusOK, map[string]any{"currencies": []any{
		coin("USDTTRC20", "Tether (TRC20)", "trx", true, true),
		coin("BTC", "Bitcoin", "btc", true, true),
		coin("ZEC", "Zcash", "zec", true, false),
		coin("XMR", "Monero", "xmr", false, true),
		coin("XEC", "eCash", "xec", true, true),
		coin("USDCSOL", "USD Coin", "sol", true, true),
		coin("USDCALGO", "USD Coin", "algo", true, true),
		coin("USDCMATIC", "USD Coin (Polygon)", "matic", true, true),
	}}}
)

// one entry of the currency list, carrying the members this console reads and some it does not.
func coin(code, name, network string, enable, payout bool) map[string]any {
	return map[string]any{
		"code": code, "name": name, "network": network, "ticker": strings.ToLower(code),
		"enable": enable, "available_for_payout": payout, "available_for_payment": true,
		"logo_url": "/images/coins/" + strings.ToLower(code) + ".svg", "precision": 8,
	}
}

func TestAKeyNowpaymentsRejectsIsRefusedAndNothingElseIsAsked(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		address, asked := account(t, map[string]answering{
			coinsPath:      {status, map[string]any{"code": "INVALID_API_KEY", "message": "Invalid api key"}},
			currenciesPath: listed,
		})
		checked := Check(t.Context(), BindAt(address, "np-typed-key"), "usdttrc20")
		if checked.Kind != KeyRefused {
			t.Errorf("%d checked as %+v", status, checked)
		}
		if calls := asked(); len(calls) != 1 {
			t.Errorf("%d: NOWPayments was asked %v", status, calls)
		}
	}
}

func TestAnOutcomeCurrencyNowpaymentsNamesNoCoinIsRefused(t *testing.T) {
	address, _ := account(t, map[string]answering{coinsPath: selection, currenciesPath: listed})
	checked := Check(t.Context(), BindAt(address, "np-typed-key"), "usdt")
	if checked.Kind != CurrencyUnknown || !strings.Contains(checked.Detail, "usdt") {
		t.Errorf("checked as %+v", checked)
	}
}

func TestAReadableKeyAndANamedCurrencyAreReadableInNowpaymentsOwnSpelling(t *testing.T) {
	address, asked := account(t, map[string]answering{coinsPath: selection, currenciesPath: listed})
	checked := Check(t.Context(), BindAt(address, "np-typed-key"), "USDTtrc20")
	if checked.Kind != Readable || checked.Currency != "usdttrc20" {
		t.Errorf("checked as %+v", checked)
	}
	calls := asked()
	if len(calls) != 2 {
		t.Fatalf("NOWPayments was asked %v", calls)
	}
	for _, call := range calls {
		// the key travels in its header, and the request line before it carries no part of it.
		if !strings.HasSuffix(call, " np-typed-key") || strings.Count(call, "np-typed-key") != 1 {
			t.Errorf("a call went as %q", call)
		}
	}
}

// nothing found out is never a refusal: neither box is what an operator changes about it.
func TestAnAnswerThatSaysNothingAboutTheKeyIsUnanswered(t *testing.T) {
	for what, answers := range map[string]map[string]answering{
		"a 5xx on the selection": {coinsPath: {http.StatusBadGateway, nil}, currenciesPath: listed},
		"a 429 on the list": {
			coinsPath: selection, currenciesPath: {http.StatusTooManyRequests, map[string]any{}},
		},
		"a selection in another shape": {
			coinsPath: {http.StatusOK, map[string]any{"coins": []any{}}}, currenciesPath: listed,
		},
		"a list in another shape": {
			coinsPath: selection, currenciesPath: {http.StatusOK, []any{"btc"}},
		},
	} {
		address, _ := account(t, answers)
		if checked := Check(t.Context(), BindAt(address, "np-typed-key"), "btc"); checked.Kind != Unanswered {
			t.Errorf("%s checked as %+v", what, checked)
		}
	}
}

func TestEveryNameThePressWritesIsOneTheDeploymentIsConfiguredWith(t *testing.T) {
	for _, name := range SetUpOnly {
		if !slices.Contains(release.DeployVars, name) {
			t.Errorf("%s is not one of the configuration values", name)
		}
	}
	written := Values("k", "s", Checked{Kind: Readable, Currency: "btc"})
	if len(written) != len(SetUpOnly) || *written["NOWPAYMENTS_OUTCOME_CURRENCY"] != "btc" {
		t.Errorf("wrote %v", written)
	}
}

func TestTheCoinsNowpaymentsWillPayOutInAreListedByNameAndNothingElseIs(t *testing.T) {
	address, asked := account(t, map[string]answering{currenciesPath: listed})
	listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
	if listing.Kind != Listed || listing.Detail != "" {
		t.Fatalf("listed as %+v", listing)
	}
	want := []Coin{
		{Code: "btc", Name: "Bitcoin", Network: "btc"},
		{Code: "xec", Name: "eCash", Network: "xec"},
		{Code: "usdttrc20", Name: "Tether (TRC20)", Network: "trx"},
		{Code: "usdcalgo", Name: "USD Coin", Network: "algo"},
		{Code: "usdcsol", Name: "USD Coin", Network: "sol"},
		{Code: "usdcmatic", Name: "USD Coin (Polygon)", Network: "matic"},
	}
	if !slices.Equal(listing.Coins, want) {
		t.Errorf("listed %+v, want %+v", listing.Coins, want)
	}
	calls := asked()
	// one read, and the key travels in its header alone.
	if len(calls) != 1 || !strings.HasSuffix(calls[0], " np-typed-key") ||
		strings.Count(calls[0], "np-typed-key") != 1 {
		t.Errorf("NOWPayments was asked %v", calls)
	}
}

// a coin on the list is not a coin the deployment can be paid out in, and the box it is typed into
// is what the operator changes either way.
func TestAnOutcomeCurrencyNowpaymentsWillNotPayOutInIsRefused(t *testing.T) {
	address, _ := account(t, map[string]answering{coinsPath: selection, currenciesPath: listed})
	for _, typed := range []string{"zec", "XMR"} {
		checked := Check(t.Context(), BindAt(address, "np-typed-key"), typed)
		if checked.Kind != CurrencyUnknown || checked.Detail == "" {
			t.Errorf("%s checked as %+v", typed, checked)
		}
	}
	checked := Check(t.Context(), BindAt(address, "np-typed-key"), "USDCMATIC")
	if checked.Kind != Readable || checked.Currency != "usdcmatic" {
		t.Errorf("checked as %+v", checked)
	}
}

func TestAKeyNowpaymentsRejectsListsNoCoins(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		address, _ := account(t, map[string]answering{
			currenciesPath: {status, map[string]any{"code": "INVALID_API_KEY", "message": "Invalid api key"}},
		})
		listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
		if listing.Kind != KeyRefused || listing.Detail == "" || len(listing.Coins) != 0 {
			t.Errorf("%d listed as %+v", status, listing)
		}
	}
}

// nothing found out is never a refusal, and it is never an empty box of coins either: a listing
// that says `listed` with nothing on it is a screen offering an operator no coin at all.
func TestAListingNowpaymentsSaysNothingAboutIsUnanswered(t *testing.T) {
	gone := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	gone.Close()

	addresses := map[string]string{"a host that is not there": gone.URL}
	for what, answers := range map[string]map[string]answering{
		"a 5xx":                   {currenciesPath: {http.StatusBadGateway, nil}},
		"a 429":                   {currenciesPath: {http.StatusTooManyRequests, map[string]any{}}},
		"a list in another shape": {currenciesPath: {http.StatusOK, []any{"btc"}}},
		"a list that is no list":  {currenciesPath: {http.StatusOK, map[string]any{"currencies": "btc"}}},
	} {
		address, _ := account(t, answers)
		addresses[what] = address
	}

	for what, address := range addresses {
		listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
		if listing.Kind != Unanswered || listing.Detail == "" || listing.Coins == nil {
			t.Errorf("%s listed as %+v", what, listing)
		}
	}
}
