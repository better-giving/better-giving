// Package chariot is the console's door to Chariot, and the fifth host this binary calls.
//
// **plain http and no sdk**, for ../paypal's reason: five calls, and every failure a screen has a
// sentence for is one of the kinds below. what each call takes and answers is Chariot's API
// reference (https://docs.givechariot.com/api), whose default version is the one
// packages/app/src/lib/server/payments/chariot.ts names.
//
// **the api key is a local value for the length of one press.** it arrives in this process from the
// browser's own press, is closed over by BindAt, and is never logged, put in a sentence a screen draws,
// or passed to a child process; the one place it is written is the deployment's var door. it travels
// in a bearer header and no url carries it, which is what makes a failure's own sentence safe to draw.
//
// **the address is the operator's, and nothing checks the key against it.** live and sandbox are
// separate object graphs (a key, an organisation's Connect and a subscription exist in one only), and
// rehearsing is a second deployment holding sandbox keys (DEPLOY.md) — so the address is a value
// like the key, blank meaning live.
//
// every failure is a value, the way ../cf's are: nothing here returns an error.
package chariot

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// API is where live Chariot answers, and the address a deployment holding none calls.
const API = "https://api.givechariot.com"

// Request is one call to Chariot, as a value before it is made.
type Request struct {
	Method string
	// Path carries its own query, which is never a credential.
	Path string
	// Body is nil on a read, which is what decides whether the request declares one at all.
	Body any
}

// Call is one call bound to a key the caller never sees again.
type Call func(ctx context.Context, request Request) cf.Answer

// BindAt binds one api key against an address Address accepted, or a test host.
func BindAt(address, apiKey string) Call {
	send := cf.JSONSend(strings.TrimSuffix(address, "/"), map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	return func(ctx context.Context, request Request) cf.Answer {
		return send(ctx, request.Method, request.Path, request.Body)
	}
}

// Address is the address a press typed, as the one this console calls — and whether it is one.
//
// blank is live. anything else is an https origin and nothing more: a path would be joined in front
// of every call's own, and the deployment joins the value the same way, so an address with one is
// two ends calling somewhere neither documents.
func Address(typed string) (string, bool) {
	if strings.TrimSpace(typed) == "" {
		return API, true
	}
	parsed, err := url.Parse(strings.TrimSuffix(typed, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", false
	}
	return parsed.Scheme + "://" + parsed.Host, true
}

// ResultKind is one answer sorted into the states a screen draws differently.
type ResultKind string

const (
	// Value is an answer this console was written against.
	Value ResultKind = "value"
	// Refused is a key Chariot would not accept at this address: wrong, revoked, or the other
	// address's. The way out is the two boxes on the screen.
	Refused ResultKind = "refused"
	// Forbidden is a key Chariot accepted and would not let do this. The way out is Chariot.
	Forbidden ResultKind = "forbidden"
	// Rejected is a request Chariot understood and would not carry out. Detail names what it said.
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

// unreadable is a failure this console names itself, for an answer it could not read.
func unreadable(detail string) *Failure {
	return &Failure{Kind: Unreadable, Detail: detail}
}

// Read sorts one answer into the states a screen draws differently.
//
// 401 and 403 are two arms, unlike ../paypal's one, because the ways out differ: a refused key is
// the boxes, and a forbidden one is a conversation with Chariot the boxes cannot have.
func Read(answer cf.Answer) Result {
	if answer.Kind == cf.Unreachable {
		return Result{Kind: Unreachable, Detail: answer.Detail}
	}
	detail := Said(answer)
	switch {
	case answer.Status == http.StatusUnauthorized:
		return Result{Kind: Refused, Detail: detail}
	case answer.Status == http.StatusForbidden:
		return Result{Kind: Forbidden, Detail: detail}
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

// Said is what Chariot said about a failure.
//
// the problem body's `detail` and nothing else: `type` and `title` are the same on every error
// Chariot sends, so `detail` is the only member that tells one from another. a gateway page is no
// problem body, and is named by its status.
func Said(answer cf.Answer) string {
	if answer.Kind == cf.Unreachable {
		return answer.Detail
	}
	body, _ := answer.Body.(map[string]any)
	if said := text(body["detail"]); said != "" {
		return "Chariot said: " + said
	}
	return fmt.Sprintf("Chariot answered %d", answer.Status)
}

func text(value any) string {
	held, _ := value.(string)
	return held
}
