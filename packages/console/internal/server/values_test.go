package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/state"
)

// the two presses that set the seventeen, and what each of them refuses.

// a cloudflare that answers everything and remembers what it was asked.
func writes(t *testing.T, answers map[string]any) (*httptest.Server, *[]string) {
	t.Helper()
	asked := []string{}
	// the calls are appended on the server's own goroutine and read on the test's.
	var recording sync.Mutex
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recording.Lock()
		asked = append(asked, r.Method+" "+r.URL.Path)
		recording.Unlock()
		body, named := answers[r.Method+" "+r.URL.Path]
		if !named {
			body = map[string]any{"success": true, "errors": []any{}, "result": map[string]any{}}
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(api.Close)
	return api, &asked
}

// a console signed in to cloudflare, holding `chosen`, whose every door is the fake api.
func pressing(t *testing.T, chosen string, api *httptest.Server) http.Handler {
	t.Helper()
	_, flow, accounts := machine(t, chosen)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Settings: func(cf.Credential) cf.MultipartUpload { return cf.MultipartSend(api.URL, nil) },
	})
}

func press(t *testing.T, handler http.Handler, path, body string) (int, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Host = loopback
	request.Header.Set("Content-Type", "application/json")
	recorded := httptest.NewRecorder()
	handler.ServeHTTP(recorded, request)
	var answer map[string]any
	if err := json.Unmarshal(recorded.Body.Bytes(), &answer); err != nil {
		t.Fatalf("%s answered %q", path, recorded.Body.String())
	}
	return recorded.Code, answer
}

func settingsOf(name string) string {
	return "/accounts/an-account/workers/scripts/" + name + "/settings"
}

// every press here is scoped to an account, so there is nothing to write to before one is chosen.
func TestNothingIsWrittenForAMachineThatHasChosenNoAccount(t *testing.T) {
	api, asked := writes(t, nil)
	handler := pressing(t, "", api)

	for _, path := range []string{"/api/values/vars", "/api/values/vars/free"} {
		status, _ := press(t, handler, path, `{"values":{}}`)
		if status != http.StatusConflict {
			t.Fatalf("%s answered %d", path, status)
		}
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// **the names a press may carry are the enumeration's and never the body's own keys.** a name off
// that list is a value written under whatever a page said, and the seventeen are what this console
// is for — the console's own session credential among the names it refuses.
func TestANameOffTheEnumerationIsRefusedBeforeCloudflareIsAsked(t *testing.T) {
	api, asked := writes(t, nil)
	handler := pressing(t, "an-account", api)

	status, answer := press(t, handler, "/api/values/vars", `{"values":{"CONSOLE_TOKEN":"bg1.x"}}`)
	if status != http.StatusBadRequest || answer["error"] == "" {
		t.Fatalf("%d %v", status, answer)
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// no press stores a configuration value as a credential: the door that wrote them is gone, and a
// page still asking for it is a page against an older binary.
func TestThereIsNoDoorThatStoresAValueAsACredential(t *testing.T) {
	api, asked := writes(t, nil)
	handler := pressing(t, "an-account", api)

	if status, _ := press(t, handler, "/api/values/secrets", `{"values":{"ADMIN_PASSWORD":"x"}}`); status != http.StatusNotFound {
		t.Fatalf("answered %d", status)
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// a var press reads what the worker is bound to and patches the settings back, which is the whole
// of what setting one costs.
func TestAVarPressReadsTheSettingsAndPatchesThemBack(t *testing.T) {
	worker := release.Baked.Name
	api, asked := writes(t, map[string]any{
		"GET " + settingsOf(worker): map[string]any{
			"success": true, "errors": []any{},
			"result": map[string]any{"bindings": []any{
				map[string]any{"name": "STRIPE_SECRET_KEY", "type": "secret_text"},
			}},
		},
	})
	handler := pressing(t, "an-account", api)

	status, answer := press(t, handler, "/api/values/vars",
		`{"values":{"STRIPE_PUBLISHABLE_KEY":"pk_live_x"}}`)
	if status != http.StatusOK || answer["kind"] != "set" {
		t.Fatalf("%d %v", status, answer)
	}
	if len(*asked) != 2 || (*asked)[1] != "PATCH "+settingsOf(worker) {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// the free press carries no name at all: what it removes is read off cloudflare inside the binary.
func TestTheFreePressReadsWhichVarsAreHeldAsCredentials(t *testing.T) {
	worker := release.Baked.Name
	api, asked := writes(t, map[string]any{
		"GET " + settingsOf(worker): map[string]any{
			"success": true, "errors": []any{},
			"result": map[string]any{"bindings": []any{
				map[string]any{"name": "BETTER_AUTH_URL", "type": "secret_text"},
			}},
		},
	})
	handler := pressing(t, "an-account", api)

	status, answer := press(t, handler, "/api/values/vars/free", "")
	if status != http.StatusOK || answer["kind"] != "set" {
		t.Fatalf("%d %v", status, answer)
	}
	if len(*asked) != 2 || !strings.HasSuffix((*asked)[1], "/secrets-bulk") {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// **a machine holding no sign-in has nowhere to write to, and says so without asking anything.**
// what an operator does about it is sign in rather than press again, so it is the write that never
// happened and never a refusal cloudflare made.
func TestAMachineHoldingNoSignInIsNowhereToWriteTo(t *testing.T) {
	api, asked := writes(t, nil)
	dir := t.TempDir()
	t.Setenv(state.HomeVar, dir)
	records := state.At(dir)
	accounts := account.New(records)
	accounts.Choose(account.Account{ID: "an-account", Name: "hound-haven"})
	flow := oauth.New(oauth.Options{Store: records})
	t.Cleanup(flow.Stop)
	handler := New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
		Patches:  func(cf.Credential) cf.Send { return cf.JSONSend(api.URL, nil) },
		Settings: func(cf.Credential) cf.MultipartUpload { return cf.MultipartSend(api.URL, nil) },
	})

	status, answer := press(t, handler, "/api/values/vars", `{"values":{"MAIL_FROM":"a@b.test"}}`)
	if status != http.StatusOK || answer["kind"] != "nowhere" {
		t.Fatalf("%d %v", status, answer)
	}
	address, ok := answer["address"].(map[string]any)
	if !ok || address["kind"] != "no-credential" {
		t.Fatalf("the answer said %v", answer["address"])
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// **a name mapped to `null` is a removal and reaches the write**, which is what an emptied box
// posts: the only other reading of one is the blank string below, and that is refused.
func TestAVarPressCarryingNullTakesTheValueOff(t *testing.T) {
	worker := release.Baked.Name
	api, asked := writes(t, map[string]any{
		"GET " + settingsOf(worker): map[string]any{
			"success": true, "errors": []any{},
			"result": map[string]any{"bindings": []any{
				map[string]any{"name": "SMTP_PASSWORD", "type": "plain_text", "text": "a-password"},
			}},
		},
	})
	handler := pressing(t, "an-account", api)

	status, answer := press(t, handler, "/api/values/vars", `{"values":{"SMTP_PASSWORD":null}}`)
	if status != http.StatusOK || answer["kind"] != "set" {
		t.Fatalf("%d %v", status, answer)
	}
	if len(*asked) != 2 || (*asked)[1] != "PATCH "+settingsOf(worker) {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// a body naming a var with nothing in it is refused: the deployment reads a blank as unset, so
// storing one would leave the console drawing a value the deployment does not read.
func TestAVarPressCarryingNothingIsRefused(t *testing.T) {
	api, asked := writes(t, nil)
	handler := pressing(t, "an-account", api)

	if status, _ := press(t, handler, "/api/values/vars", `{"values":{"TURNSTILE_SITE_KEY":"  "}}`); status != http.StatusBadRequest {
		t.Fatalf("answered %d", status)
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// **the charity-rate switch has two positions and its off one is the name being taken off.** the
// deployment reads one word as approved and every other value — a stored `false` among them — as
// the standard rate, so a switch left off with a word in it is a box this console draws full over a
// deployment that is not on that rate. the removal above is the off position, and nothing else is.
func TestTheCharityRateSwitchIsOnlyEverStoredAsTheWordTheDeploymentReads(t *testing.T) {
	worker := release.Baked.Name
	stored := map[string]any{"name": "PAYPAL_CHARITY_RATE_APPROVED", "type": "plain_text", "text": "true"}
	for what, one := range map[string]struct {
		bindings []any
		body     string
	}{
		"switched on":  {bindings: []any{}, body: `{"values":{"PAYPAL_CHARITY_RATE_APPROVED":"true"}}`},
		"switched off": {bindings: []any{stored}, body: `{"values":{"PAYPAL_CHARITY_RATE_APPROVED":null}}`},
	} {
		api, asked := writes(t, map[string]any{
			"GET " + settingsOf(worker): map[string]any{
				"success": true, "errors": []any{},
				"result": map[string]any{"bindings": one.bindings},
			},
		})
		status, answer := press(t, pressing(t, "an-account", api), "/api/values/vars", one.body)
		if status != http.StatusOK || answer["kind"] != "set" {
			t.Errorf("%s answered %d %v", what, status, answer)
		}
		if len(*asked) != 2 || (*asked)[1] != "PATCH "+settingsOf(worker) {
			t.Errorf("%s asked cloudflare %v", what, *asked)
		}
	}
}

// a third position is one the fold cannot draw and the deployment does not act on: `false` and `no`
// price at the standard rate exactly as an absent value does, so storing one would be a value an
// operator could read back and a deployment that reads nothing of it.
func TestASpellingTheDeploymentDoesNotReadAsApprovedIsRefused(t *testing.T) {
	for _, spelling := range []string{"false", "no", "True", "1"} {
		api, asked := writes(t, nil)
		status, answer := press(t, pressing(t, "an-account", api), "/api/values/vars",
			`{"values":{"PAYPAL_CHARITY_RATE_APPROVED":"`+spelling+`"}}`)
		if status != http.StatusBadRequest || answer["error"] == "" {
			t.Errorf("%q answered %d %v", spelling, status, answer)
		}
		if len(*asked) != 0 {
			t.Errorf("%q asked cloudflare %v", spelling, *asked)
		}
	}
}
