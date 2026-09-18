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
		marked(tickered(coin("USDTTRC20", "Tether (TRC20)", "trx", true, true), "usdt"), true, true),
		marked(coin("BTC", "Bitcoin", "btc", true, true), true, false),
		coin("ZEC", "Zcash", "zec", true, false),
		coin("XMR", "Monero", "xmr", false, true),
		coin("XEC", "eCash", "xec", true, true),
		tickered(coin("USDCSOL", "USD Coin", "sol", true, true), "usdc"),
		tickered(coin("USDCALGO", "USD Coin", "algo", true, true), "usdc"),
		tickered(coin("USDCMATIC", "USD Coin (Polygon)", "matic", true, true), "usdc"),
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

// the same entry with the coin's own ticker rather than one spelled after its code: NOWPayments
// names one ticker on every network it carries a coin on, which is what a code cannot say.
func tickered(entry map[string]any, ticker string) map[string]any {
	entry["ticker"] = ticker
	return entry
}

// the same entry with NOWPayments' two marks on it; the rest of the list carries neither.
func marked(entry map[string]any, popular, stable bool) map[string]any {
	entry["is_popular"] = popular
	entry["is_stable"] = stable
	return entry
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
	const logos = "https://nowpayments.io/images/coins/"
	want := []Coin{
		{Code: "btc", Ticker: "btc", Name: "Bitcoin", Network: "btc", Logo: logos + "btc.svg",
			Popular: true},
		{Code: "xec", Ticker: "xec", Name: "eCash", Network: "xec", Logo: logos + "xec.svg"},
		{Code: "usdttrc20", Ticker: "usdt", Name: "Tether (TRC20)", Network: "trx",
			Logo: logos + "usdttrc20.svg", Popular: true, Stablecoin: true},
		{Code: "usdcalgo", Ticker: "usdc", Name: "USD Coin", Network: "algo",
			Logo: logos + "usdcalgo.svg"},
		{Code: "usdcsol", Ticker: "usdc", Name: "USD Coin", Network: "sol",
			Logo: logos + "usdcsol.svg"},
		{Code: "usdcmatic", Ticker: "usdc", Name: "USD Coin (Polygon)", Network: "matic",
			Logo: logos + "usdcmatic.svg"},
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

// the list carries each coin's logo as a path on NOWPayments' own site, and a coin is never dropped
// over one: a picture nothing can resolve is a coin listed without one.
func TestACoinsLogoIsResolvedAgainstNowpaymentsSiteAndKeptOnlyOverHttps(t *testing.T) {
	for what, one := range map[string]struct {
		stated any
		want   string
	}{
		"a path on their site":        {"/images/coins/btc.svg", "https://nowpayments.io/images/coins/btc.svg"},
		"an address in full":          {"https://cdn.example/btc.svg", "https://cdn.example/btc.svg"},
		"no logo at all":              {nil, ""},
		"a logo that is no string":    {42, ""},
		"an address over http":        {"http://nowpayments.io/images/coins/btc.svg", ""},
		"an address nothing can read": {"https://nowpayments.io/%zz", ""},
	} {
		entry := coin("BTC", "Bitcoin", "btc", true, true)
		delete(entry, "logo_url")
		if one.stated != nil {
			entry["logo_url"] = one.stated
		}
		address, _ := account(t, map[string]answering{
			currenciesPath: {http.StatusOK, map[string]any{"currencies": []any{entry}}},
		})
		listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
		if len(listing.Coins) != 1 {
			t.Fatalf("%s listed as %+v", what, listing)
		}
		if listing.Coins[0].Logo != one.want {
			t.Errorf("%s carried logo %q, want %q", what, listing.Coins[0].Logo, one.want)
		}
	}
}

// NOWPayments' own two marks, which a screen groups coins by. Neither is a reason to list a coin or
// to leave one off, so anything but the mark said outright reads as false.
func TestNowpaymentsOwnMarksTravelAndAnythingElseReadsAsFalse(t *testing.T) {
	for what, one := range map[string]struct {
		stated          map[string]any
		popular, stable bool
	}{
		"both marks":                 {map[string]any{"is_popular": true, "is_stable": true}, true, true},
		"popular alone":              {map[string]any{"is_popular": true, "is_stable": false}, true, false},
		"stable alone":               {map[string]any{"is_stable": true}, false, true},
		"neither mark":               {map[string]any{}, false, false},
		"marks that are no booleans": {map[string]any{"is_popular": "yes", "is_stable": 1}, false, false},
	} {
		entry := coin("BTC", "Bitcoin", "btc", true, true)
		for member, value := range one.stated {
			entry[member] = value
		}
		address, _ := account(t, map[string]answering{
			currenciesPath: {http.StatusOK, map[string]any{"currencies": []any{entry}}},
		})
		listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
		if len(listing.Coins) != 1 {
			t.Fatalf("%s listed as %+v", what, listing)
		}
		if listing.Coins[0].Popular != one.popular || listing.Coins[0].Stablecoin != one.stable {
			t.Errorf("%s carried %+v", what, listing.Coins[0])
		}
	}
}

// the ticker is the coin's own symbol rather than its code, and the donation form draws a row by it
// (`acceptedCoins` in packages/app/src/lib/server/payments/nowpayments.ts), so both surfaces read a
// coin the same way only where both lowercase it. Like the logo, it is never a reason to leave a
// coin off: an entry carrying none is listed without one.
func TestACoinsTickerTravelsLowercasedAndNeverDropsACoin(t *testing.T) {
	for what, one := range map[string]struct {
		stated any
		want   string
	}{
		"the coin's own ticker":       {"usdt", "usdt"},
		"a ticker NOWPayments shouts": {"USDT", "usdt"},
		"no ticker at all":            {nil, ""},
		"a ticker that is no string":  {42, ""},
	} {
		entry := coin("USDTTRC20", "Tether (TRC20)", "trx", true, true)
		delete(entry, "ticker")
		if one.stated != nil {
			entry["ticker"] = one.stated
		}
		address, _ := account(t, map[string]answering{
			currenciesPath: {http.StatusOK, map[string]any{"currencies": []any{entry}}},
		})
		listing := Payable(t.Context(), BindAt(address, "np-typed-key"))
		if len(listing.Coins) != 1 {
			t.Fatalf("%s listed as %+v", what, listing)
		}
		if listing.Coins[0].Ticker != one.want {
			t.Errorf("%s carried ticker %q, want %q", what, listing.Coins[0].Ticker, one.want)
		}
	}
}
