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
	listed    = answering{http.StatusOK, map[string]any{"currencies": []any{
		map[string]any{"code": "BTC", "enable": true},
		map[string]any{"code": "USDTTRC20", "enable": true},
	}}}
)

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
