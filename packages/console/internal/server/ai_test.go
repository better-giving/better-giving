package server

import (
	"net/http"
	"testing"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/state"
)

// the choice as the deployment holds it and, for a credit-billed one, what the account has left —
// both read off cloudflare on the environment's api token, the one credential a balance is read on.
func TestTheModelChoiceIsAnsweredWithTheCreditsItSpends(t *testing.T) {
	api, asked := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): map[string]any{
			"success": true, "errors": []any{},
			"result": map[string]any{"bindings": []any{
				map[string]any{"name": "AI_MODEL", "type": "plain_text", "text": "anthropic/claude-sonnet-4.6"},
			}},
		},
		"GET /accounts/an-account/ai-gateway/billing/credit-balance": map[string]any{
			"success": true, "errors": []any{}, "result": map[string]any{"balance": -1.5},
		},
	})

	status, body := ask(t, pressing(t, "an-account", api), "/api/ai-model")
	if status != http.StatusOK || body["kind"] != "read" {
		t.Fatalf("%d %v", status, body)
	}
	model, _ := body["model"].(map[string]any)
	if model["name"] != "AI_MODEL" || model["kind"] != "value" || model["value"] != "anthropic/claude-sonnet-4.6" {
		t.Errorf("model = %v", model)
	}
	credits, _ := body["credits"].(map[string]any)
	if credits["kind"] != "missing" || credits["balance"] != -1.5 {
		t.Errorf("credits = %v", credits)
	}
	if len(*asked) != 2 {
		t.Errorf("cloudflare was asked %v", *asked)
	}
}

func TestNoChoiceIsReadForAMachineThatHasChosenNoAccount(t *testing.T) {
	api, asked := writes(t, nil)
	status, _ := ask(t, pressing(t, "", api), "/api/ai-model")
	if status != http.StatusConflict || len(*asked) != 0 {
		t.Fatalf("%d, and cloudflare was asked %v", status, *asked)
	}
}

func TestAMachineHoldingNoSignInReadsNoChoice(t *testing.T) {
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
	})

	status, body := ask(t, handler, "/api/ai-model")
	credits, _ := body["credits"].(map[string]any)
	if status != http.StatusOK || body["kind"] != "no-credential" || credits["kind"] != "not-asked" {
		t.Fatalf("%d %v", status, body)
	}
	if len(*asked) != 0 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}

// a machine signed in through the browser holds a credential no AI Gateway read is granted to, so
// the choice is read and the balance is not asked for at all.
func TestAMachineSignedInThroughTheBrowserReadsTheChoiceAndNoBalance(t *testing.T) {
	api, asked := writes(t, map[string]any{
		"GET " + settingsOf(release.Baked.Name): map[string]any{
			"success": true, "errors": []any{},
			"result": map[string]any{"bindings": []any{
				map[string]any{"name": "AI_MODEL", "type": "plain_text", "text": "openai/gpt-5-mini"},
			}},
		},
	})
	dir := t.TempDir()
	t.Setenv(state.HomeVar, dir)
	t.Setenv(oauth.TokenVar, "")
	records := state.At(dir)
	stored := `{"access_token":"an-access-token","refresh_token":"","expires_at":"` +
		time.Now().Add(time.Hour).UTC().Format(time.RFC3339) + `","scopes":[]}`
	if err := records.Write(oauth.Record, []byte(stored)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	accounts := account.New(records)
	accounts.Choose(account.Account{ID: "an-account", Name: "hound-haven"})
	flow := oauth.New(oauth.Options{Store: records})
	t.Cleanup(flow.Stop)
	handler := New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: accounts,
		Reads:    func(cf.Credential) cf.Get { return cf.JSONGet(api.URL, nil) },
	})

	status, body := ask(t, handler, "/api/ai-model")
	credits, _ := body["credits"].(map[string]any)
	if status != http.StatusOK || body["kind"] != "read" || credits["kind"] != "unknown" ||
		credits["detail"] != deployment.CreditsUnreadOnSignIn {
		t.Fatalf("%d %v", status, body)
	}
	if len(*asked) != 1 {
		t.Fatalf("cloudflare was asked %v", *asked)
	}
}
