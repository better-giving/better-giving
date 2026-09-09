package deployment

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// a cloudflare answering whatever each path is bound to, and 404 for anything else.
//
// Every read in this package is one GET, so a case states the answers it wants by path and asserts
// on what the reading made of them — which is the whole of what a screen draws.
func fake(t *testing.T, answers map[string]any) cf.Get {
	t.Helper()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, named := answers[r.URL.Path]
		if !named {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{}})
			return
		}
		if status, ok := body.(int); ok {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{}})
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(api.Close)
	return cf.JSONGet(api.URL, map[string]string{})
}

// what cloudflare wraps every answer in.
func envelope(result any) map[string]any {
	return map[string]any{"success": true, "errors": []any{}, "messages": []any{}, "result": result}
}

// what cloudflare wraps a failure in, in its own words.
func failed(code int, message string) map[string]any {
	return map[string]any{
		"success": false,
		"errors":  []any{map[string]any{"code": code, "message": message}},
	}
}
