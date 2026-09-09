package widget

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// the account this deployment's widget is looked for in, answering each call by method and path.

const account = "an-account"

const name = "better-giving"

// a cloudflare answering whatever each `METHOD /path` is bound to, and recording every call.
type api struct {
	mutex sync.Mutex
	// calls is every `METHOD /path` asked, in order, so a case can say what a press did not do.
	calls []string
	// bodies is the json body of each write, in the order they were made.
	bodies []map[string]any
	// answers is what each `METHOD /path` answers: a status for a bare failure, a body otherwise.
	answers map[string]any
}

func serve(t *testing.T, answers map[string]any) (*api, Calls) {
	t.Helper()
	held := &api{answers: answers}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// the paging the list is walked with rides on the query, and a case names the path alone.
		at := r.Method + " " + r.URL.Path
		var body map[string]any
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		held.mutex.Lock()
		held.calls = append(held.calls, at)
		if body != nil {
			held.bodies = append(held.bodies, body)
		}
		held.mutex.Unlock()

		answer, named := held.answers[at]
		if !named {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(failed(10007, "widget not found"))
			return
		}
		if status, ok := answer.(int); ok {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(failed(10000, "Authentication error"))
			return
		}
		_ = json.NewEncoder(w).Encode(answer)
	}))
	t.Cleanup(server.Close)
	return held, Calls{Send: cf.JSONSend(server.URL, map[string]string{}), AccountID: account}
}

func (held *api) saw(at string) bool {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	for _, one := range held.calls {
		if one == at {
			return true
		}
	}
	return false
}

func (held *api) made() []string {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return append([]string{}, held.calls...)
}

func (held *api) wrote(at int) map[string]any {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	if at >= len(held.bodies) {
		return nil
	}
	return held.bodies[at]
}

// what cloudflare wraps a list in, with the counts that end the walk on one page.
func listed(rows ...any) map[string]any {
	if rows == nil {
		rows = []any{}
	}
	return map[string]any{
		"success": true,
		"errors":  []any{},
		"result":  rows,
		"result_info": map[string]any{
			"page": 1.0, "per_page": 100.0, "total_count": float64(len(rows)),
		},
	}
}

func envelope(result any) map[string]any {
	return map[string]any{"success": true, "errors": []any{}, "result": result}
}

func failed(code int, message string) map[string]any {
	return map[string]any{
		"success": false,
		"errors":  []any{map[string]any{"code": code, "message": message}},
	}
}

// one widget as cloudflare's list answers it, which redacts the secret.
func row(sitekey string, hosts ...string) map[string]any {
	return map[string]any{
		"name": name, "sitekey": sitekey, "mode": "managed", "domains": anyList(hosts),
	}
}

// one widget as a create or a get answers it, which is the widget whole.
func whole(sitekey, secret string, hosts ...string) map[string]any {
	return map[string]any{
		"name": name, "sitekey": sitekey, "secret": secret, "mode": "managed",
		"domains": anyList(hosts),
	}
}

func anyList(values []string) []any {
	held := []any{}
	for _, value := range values {
		held = append(held, value)
	}
	return held
}

func widgets() string { return "/accounts/" + account + "/challenges/widgets" }

func at(sitekey string) string { return widgets() + "/" + sitekey }

// whether `detail` carries a value nothing about a widget may ever put in a sentence.
func leaks(detail, secret string) bool {
	return secret != "" && strings.Contains(detail, secret)
}
