// Package paypal is the console's door to PayPal, and the fourth host this binary calls.
//
// **plain http and no sdk**, for ../stripe's reason: the calls are few, and every failure a screen
// has a sentence for is one of the kinds below.
//
// **the client id and secret are local values for the length of one press.** they arrive in this
// process from the browser's own press, are closed over by Bind, and are never written down, logged,
// put in a sentence a screen draws, or passed to a child process. the pair travels in a basic
// authorization header on one call and the token it mints in a bearer header on the rest; no url
// carries either, which is what makes a failure's own sentence safe to draw.
//
// **live only.** the host is PayPal's live API, the one packages/app/src/lib/server/payments/paypal.ts
// talks to: nothing in this project reads test-versus-live, and rehearsing is a second deployment
// (DEPLOY.md).
//
// every failure is a value, the way ../cf's are: nothing here returns an error.
package paypal

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// API is where PayPal answers.
const API = "https://api-m.paypal.com"

// Request is one call to PayPal past the token, as a value before it is made.
type Request struct {
	Method string
	Path   string
	// Body is nil on a read, which is what decides whether the request declares one at all.
	Body any
}

// Call is one call bound to a token the caller never sees again.
type Call func(ctx context.Context, request Request) cf.Answer

// Binding is one client id and secret, bound: the call that mints a token with them, and the caller
// every later call is made through once one is minted.
type Binding struct {
	Authorize func(ctx context.Context) cf.Answer
	Bearer    func(accessToken string) Call
}

// Bind binds one client id and secret, against the live API.
//
// The chain is handed functions and never the pair, which is ../cf's arrangement for every
// credential this binary holds.
func Bind(clientID, secret string) Binding { return BindAt(API, clientID, secret) }

// BindAt is that same binding against a host named, so a case can answer for PayPal with no app
// and no network.
func BindAt(base, clientID, secret string) Binding {
	basic := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + secret))
	mint := cf.FormSend(base, map[string]string{"Authorization": "Basic " + basic})
	return Binding{
		// the client-credentials grant (https://developer.paypal.com/api/rest/authentication/).
		Authorize: func(ctx context.Context) cf.Answer {
			return mint(ctx, "/v1/oauth2/token", url.Values{"grant_type": {"client_credentials"}})
		},
		Bearer: func(accessToken string) Call {
			send := cf.JSONSend(base, map[string]string{"Authorization": "Bearer " + accessToken})
			return func(ctx context.Context, request Request) cf.Answer {
				return send(ctx, request.Method, request.Path, request.Body)
			}
		},
	}
}

// ResultKind is one answer sorted into the states a screen draws differently.
type ResultKind string

const (
	// Value is an answer this console was written against.
	Value ResultKind = "value"
	// Refused is a pair PayPal would not accept, or an app it would not let do this. The way out is
	// a different pair, which is the two boxes on the screen.
	Refused ResultKind = "refused"
	// Rejected is a request PayPal understood and would not carry out. Detail names what it said.
	Rejected ResultKind = "rejected"
	// Unreachable is nothing found out either way, a 5xx included.
	Unreachable ResultKind = "unreachable"
	// Unreadable is an answer in a shape this console was not written against.
	Unreadable ResultKind = "unreadable"
)

// Result is one answer, read.
type Result struct {
	Kind   ResultKind
	Value  map[string]any
	Detail string
}

// Failure is the ways a call did not answer, flat and on the wire.
type Failure struct {
	Kind   ResultKind `json:"kind"`
	Detail string     `json:"detail"`
}

// Turned is one read that did not land, as the failure a screen draws.
func (result Result) Turned() *Failure {
	return &Failure{Kind: result.Kind, Detail: result.Detail}
}

// Read sorts one answer into the states a screen draws differently.
//
// 401 is a pair PayPal will not accept and 403 an app without the permission a call needs
// (https://developer.paypal.com/api/rest/responses/). Both are one arm because the way out of either
// is the boxes the pair was typed in.
func Read(answer cf.Answer) Result {
	if answer.Kind == cf.Unreachable {
		return Result{Kind: Unreachable, Detail: answer.Detail}
	}
	detail := Said(answer)
	switch {
	case answer.Status == http.StatusUnauthorized || answer.Status == http.StatusForbidden:
		return Result{Kind: Refused, Detail: detail}
	case answer.Status >= 400 && answer.Status < 500:
		return Result{Kind: Rejected, Detail: detail}
	case answer.Status < 200 || answer.Status > 299:
		return Result{Kind: Unreachable, Detail: detail}
	}
	held, ok := answer.Body.(map[string]any)
	if !ok {
		return Result{Kind: Unreadable, Detail: detail}
	}
	return Result{Kind: Value, Value: held}
}

// Said is what PayPal said about a failure.
//
// The error name and its `issue` codes, which is the part PayPal documents as a closed vocabulary
// (https://developer.paypal.com/api/rest/responses/) — and the token call's own `error_description`,
// which is the one call answering in the oauth shape instead. Never `debug_id` and never the prose
// around a field, so no value the request carried is echoed back.
func Said(answer cf.Answer) string {
	if answer.Kind == cf.Unreachable {
		return answer.Detail
	}
	body, _ := answer.Body.(map[string]any)
	parts := []string{}
	if name := text(body["name"]); name != "" {
		parts = append(parts, name)
	}
	if details, ok := body["details"].([]any); ok {
		for _, one := range details {
			entry, _ := one.(map[string]any)
			if issue := text(entry["issue"]); issue != "" {
				parts = append(parts, issue)
			}
		}
	}
	if said := text(body["error_description"]); said != "" {
		parts = append(parts, said)
	}
	if len(parts) == 0 {
		return fmt.Sprintf("PayPal answered %d", answer.Status)
	}
	return "PayPal said: " + strings.Join(parts, ", ")
}

// Listener is one listener on the app, in the facts this console acts on.
type Listener struct {
	ID         string   `json:"id"`
	URL        string   `json:"url"`
	EventTypes []string `json:"eventTypes"`
}

// ReadListener reads one `webhook` object, or nil where it is not one.
func ReadListener(value any) *Listener {
	held, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	id, address := text(held["id"]), text(held["url"])
	if id == "" || address == "" {
		return nil
	}
	types := []string{}
	if listed, ok := held["event_types"].([]any); ok {
		for _, one := range listed {
			entry, _ := one.(map[string]any)
			if name := text(entry["name"]); name != "" {
				types = append(types, name)
			}
		}
	}
	return &Listener{ID: id, URL: address, EventTypes: types}
}

// ReadListeners reads `GET /v1/notifications/webhooks`, and says whether it read a list at all.
//
// **an answer carrying no list is not an app holding no listeners**, with one exception: `webhooks`
// is optional on `WebhookList` (notifications_webhooks_v1.json in
// https://github.com/paypal/paypal-rest-api-specifications), so an absent member is the empty list
// and a member that is not a list is the answer unread. the empty list is what decides a create, so
// reading one off a shape this was not written against would register a second listener beside the
// one already there.
func ReadListeners(value any) ([]Listener, bool) {
	held, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	rows := []Listener{}
	raw, present := held["webhooks"]
	if !present {
		return rows, true
	}
	data, ok := raw.([]any)
	if !ok {
		return nil, false
	}
	for _, one := range data {
		if row := ReadListener(one); row != nil {
			rows = append(rows, *row)
		}
	}
	return rows, true
}

func text(value any) string {
	held, _ := value.(string)
	return held
}
