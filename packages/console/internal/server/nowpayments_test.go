package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/nowpayments"
	"github.com/better-giving/console/internal/release"
)

// the press that stores NOWPayments' three values.
//
// NOWPayments and cloudflare are httptest servers here, so what is asserted is the whole press: what
// the door refuses before anything leaves this machine, what goes onto each wire, and that the key
// and the secret are in nothing a page can read.

const (
	nowpaymentsKey    = "np-typed-key"
	nowpaymentsSecret = "np-typed-ipn-secret"
)

// NOWPayments holding a key that reads the account or not, remembering every call.
func nowpaymentsAccount(t *testing.T, keyStatus int) (*httptest.Server, func() []string) {
	t.Helper()
	asked := []string{}
	var recording sync.Mutex
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recording.Lock()
		asked = append(asked, r.Method+" "+r.URL.RequestURI())
		recording.Unlock()
		if r.Header.Get("x-api-key") != nowpaymentsKey || keyStatus != http.StatusOK {
			w.WriteHeader(keyStatus)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": "INVALID_API_KEY", "message": "Invalid api key"})
			return
		}
		switch r.URL.Path {
		case "/v1/merchant/coins":
			_ = json.NewEncoder(w).Encode(map[string]any{"selectedCurrencies": []any{"usdttrc20"}})
		case "/v1/full-currencies":
			_ = json.NewEncoder(w).Encode(map[string]any{"currencies": []any{
				map[string]any{"code": "USDTTRC20", "name": "Tether (TRC20)", "network": "trx",
					"enable": true, "available_for_payout": true},
				map[string]any{"code": "BTC", "name": "Bitcoin", "network": "btc",
					"enable": true, "available_for_payout": true},
				map[string]any{"code": "ZEC", "name": "Zcash", "network": "zec",
					"enable": true, "available_for_payout": false},
			}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(host.Close)
	return host, func() []string {
		recording.Lock()
		defer recording.Unlock()
		return append([]string{}, asked...)
	}
}

// a console signed in and holding an account, with NOWPayments and cloudflare bound to fakes.
// `cloudflare` is every call cloudflare was asked, and `sent` every settings body it was sent.
func settingNowpayments(t *testing.T, chosen string, keyStatus int) (http.Handler, func() []string, *[]string, *[]string) {
	t.Helper()
	_, flow, accounts := machine(t, chosen)
	api, cloudflare := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): resulting(map[string]any{"bindings": []any{}}),
	})
	host, asked := nowpaymentsAccount(t, keyStatus)
	sent := []string{}
	var recording sync.Mutex
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Settings: func(credential cf.Credential) cf.MultipartUpload {
			upload := cf.MultipartSend(api.URL, nil)
			return func(ctx context.Context, method, path string, parts []cf.Part, watching cf.Sending) cf.Answer {
				recording.Lock()
				for _, part := range parts {
					sent = append(sent, string(part.Body))
				}
				recording.Unlock()
				return upload(ctx, method, path, parts, watching)
			}
		},
		Nowpayments: func(apiKey string) nowpayments.Call { return nowpayments.BindAt(host.URL, apiKey) },
	}), asked, cloudflare, &sent
}

func nowpaymentsPressed(apiKey, secret, currency string) string {
	written, _ := json.Marshal(map[string]string{
		"apiKey": apiKey, "ipnSecret": secret, "outcomeCurrency": currency,
	})
	return string(written)
}

func TestAKeyNowpaymentsRejectsIsRefusedByNameAndNothingIsStored(t *testing.T) {
	handler, _, cloudflare, _ := settingNowpayments(t, "an-account", http.StatusForbidden)

	status, answer := press(t, handler, "/api/nowpayments/values",
		nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, "usdttrc20"))
	if status != http.StatusOK || answer["kind"] != "key_refused" {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	for _, call := range *cloudflare {
		if strings.HasPrefix(call, "PATCH ") {
			t.Errorf("cloudflare was written to: %v", *cloudflare)
		}
	}
}

func TestAReadableKeyAndTheIpnSecretAreWrittenAsPlainVars(t *testing.T) {
	handler, asked, cloudflare, sent := settingNowpayments(t, "an-account", http.StatusOK)

	status, answer := press(t, handler, "/api/nowpayments/values",
		nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, "USDTTRC20"))
	written, _ := answer["written"].(map[string]any)
	if status != http.StatusOK || answer["kind"] != "written" || written["kind"] != "set" {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	if calls := asked(); len(calls) != 2 {
		t.Errorf("NOWPayments was asked %v", calls)
	}

	held := strings.Join(*cloudflare, ",")
	if strings.Count(held, "PATCH "+settingsOf(release.Baked.Name)) != 1 || strings.Contains(held, "/secrets-bulk") {
		t.Errorf("cloudflare was asked %v, want one settings patch and no credential", *cloudflare)
	}
	body := strings.Join(*sent, "")
	for name, value := range map[string]string{
		"NOWPAYMENTS_API_KEY":          nowpaymentsKey,
		"NOWPAYMENTS_IPN_SECRET":       nowpaymentsSecret,
		"NOWPAYMENTS_OUTCOME_CURRENCY": "usdttrc20",
	} {
		want := `{"name":"` + name + `","text":"` + value + `","type":"plain_text"}`
		if !strings.Contains(body, want) {
			t.Errorf("the settings patch carried no %s; sent %s", want, body)
		}
	}
}

func TestAnOutcomeCurrencyNowpaymentsNamesNoCoinIsRefusedByNameAndNothingIsStored(t *testing.T) {
	handler, _, cloudflare, _ := settingNowpayments(t, "an-account", http.StatusOK)

	status, answer := press(t, handler, "/api/nowpayments/values",
		nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, "usdt"))
	if status != http.StatusOK || answer["kind"] != "currency_unknown" || answer["written"] != nil {
		t.Fatalf("the press answered %d %v", status, answer)
	}
	if len(*cloudflare) != 0 {
		t.Errorf("cloudflare was asked %v", *cloudflare)
	}
}

func TestAnEmptyNowpaymentsSlotIsRefusedBeforeAnythingLeavesThisMachine(t *testing.T) {
	for _, body := range []string{
		nowpaymentsPressed("", nowpaymentsSecret, "btc"),
		nowpaymentsPressed(nowpaymentsKey, "", "btc"),
		nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, " btc"),
		`{"apiKey":"np-typed-key","ipnSecret":"np-typed-ipn-secret"}`,
	} {
		t.Run(body, func(t *testing.T) {
			handler, asked, cloudflare, _ := settingNowpayments(t, "an-account", http.StatusOK)
			status, answer := press(t, handler, "/api/nowpayments/values", body)
			if status != http.StatusBadRequest {
				t.Fatalf("the press answered %d %v", status, answer)
			}
			if len(asked()) != 0 || len(*cloudflare) != 0 {
				t.Errorf("NOWPayments was asked %v and cloudflare %v", asked(), *cloudflare)
			}
		})
	}
}

func TestNothingIsCheckedOnNowpaymentsForAMachineThatHasChosenNoAccount(t *testing.T) {
	handler, asked, _, _ := settingNowpayments(t, "", http.StatusOK)
	status, _ := press(t, handler, "/api/nowpayments/values",
		nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, "btc"))
	if status != http.StatusConflict {
		t.Fatalf("the press answered %d", status)
	}
	if len(asked()) != 0 {
		t.Errorf("NOWPayments was asked %v", asked())
	}
}

// the key and the secret travel in a header and a settings body and nowhere else: no answer the page
// reads, no log line, and no path or query string on either host.
func TestTheKeyAndTheSecretReachNothingTheNowpaymentsPressAnswersWith(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	restoring := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, nil)))
	t.Cleanup(func() {
		log.SetOutput(os.Stderr)
		slog.SetDefault(restoring)
	})

	for _, one := range []struct {
		keyStatus int
		currency  string
		kind      string
	}{
		{http.StatusForbidden, "btc", "key_refused"},
		{http.StatusOK, "usdt", "currency_unknown"},
		{http.StatusOK, "btc", "written"},
	} {
		handler, asked, cloudflare, _ := settingNowpayments(t, "an-account", one.keyStatus)
		request := httptest.NewRequest(http.MethodPost, "/api/nowpayments/values",
			strings.NewReader(nowpaymentsPressed(nowpaymentsKey, nowpaymentsSecret, one.currency)))
		request.Host = loopback
		recorded := httptest.NewRecorder()
		handler.ServeHTTP(recorded, request)

		if !strings.Contains(recorded.Body.String(), `"kind":"`+one.kind+`"`) {
			t.Fatalf("the press answered %s, want %s", recorded.Body.String(), one.kind)
		}
		for where, read := range map[string]string{
			"the answer":               recorded.Body.String(),
			"a request to NOWPayments": strings.Join(asked(), "\n"),
			"a request to cloudflare":  strings.Join(*cloudflare, "\n"),
		} {
			for _, credential := range []string{nowpaymentsKey, nowpaymentsSecret} {
				if strings.Contains(read, credential) {
					t.Errorf("%s: %s carries %q: %s", one.kind, where, credential, read)
				}
			}
		}
	}
	for _, credential := range []string{nowpaymentsKey, nowpaymentsSecret} {
		if strings.Contains(logged.String(), credential) {
			t.Errorf("a log line carries %q", credential)
		}
	}
}

func nowpaymentsAsked(apiKey string) string {
	written, _ := json.Marshal(map[string]string{"apiKey": apiKey})
	return string(written)
}

// the box an outcome currency is chosen in is filled from this door, and it offers only what the
// deployment could actually be paid out in.
func TestTheCoinsNowpaymentsPaysOutInAreListedForTheBox(t *testing.T) {
	handler, asked, cloudflare, _ := settingNowpayments(t, "an-account", http.StatusOK)

	status, answer := press(t, handler, "/api/nowpayments/currencies", nowpaymentsAsked(nowpaymentsKey))
	if status != http.StatusOK || answer["kind"] != "listed" || answer["detail"] != "" {
		t.Fatalf("the listing answered %d %v", status, answer)
	}
	listed, _ := json.Marshal(answer["coins"])
	want := `[{"code":"btc","name":"Bitcoin","network":"btc"},` +
		`{"code":"usdttrc20","name":"Tether (TRC20)","network":"trx"}]`
	if string(listed) != want {
		t.Errorf("the listing carried %s, want %s", listed, want)
	}
	if calls := asked(); len(calls) != 1 || calls[0] != "GET /v1/full-currencies" {
		t.Errorf("NOWPayments was asked %v", calls)
	}
	if len(*cloudflare) != 0 {
		t.Errorf("cloudflare was asked %v", *cloudflare)
	}
}

func TestAKeyNowpaymentsRejectsListsNoCoinsAndIsNamedByTheListing(t *testing.T) {
	handler, _, _, _ := settingNowpayments(t, "an-account", http.StatusForbidden)

	status, answer := press(t, handler, "/api/nowpayments/currencies", nowpaymentsAsked(nowpaymentsKey))
	coins, _ := answer["coins"].([]any)
	if status != http.StatusOK || answer["kind"] != "key_refused" || answer["detail"] == "" {
		t.Fatalf("the listing answered %d %v", status, answer)
	}
	if coins == nil || len(coins) != 0 {
		t.Errorf("the listing carried %v, want an empty list", answer["coins"])
	}
}

func TestAnEmptyKeyIsRefusedBeforeAnyCoinIsAskedFor(t *testing.T) {
	for _, body := range []string{nowpaymentsAsked(""), nowpaymentsAsked(" np-typed-key"), `{}`} {
		t.Run(body, func(t *testing.T) {
			handler, asked, _, _ := settingNowpayments(t, "an-account", http.StatusOK)
			status, answer := press(t, handler, "/api/nowpayments/currencies", body)
			if status != http.StatusBadRequest {
				t.Fatalf("the listing answered %d %v", status, answer)
			}
			if len(asked()) != 0 {
				t.Errorf("NOWPayments was asked %v", asked())
			}
		})
	}
}

// the listing door carries the key exactly as the press does: a header on the way out, and nothing
// a page can read on the way back.
func TestTheKeyReachesNothingTheNowpaymentsListingAnswersWith(t *testing.T) {
	for _, keyStatus := range []int{http.StatusOK, http.StatusForbidden} {
		handler, asked, _, _ := settingNowpayments(t, "an-account", keyStatus)
		request := httptest.NewRequest(http.MethodPost, "/api/nowpayments/currencies",
			strings.NewReader(nowpaymentsAsked(nowpaymentsKey)))
		request.Host = loopback
		recorded := httptest.NewRecorder()
		handler.ServeHTTP(recorded, request)

		for where, read := range map[string]string{
			"the answer":               recorded.Body.String(),
			"a request to NOWPayments": strings.Join(asked(), "\n"),
		} {
			if strings.Contains(read, nowpaymentsKey) {
				t.Errorf("%d: %s carries the key: %s", keyStatus, where, read)
			}
		}
	}
}
