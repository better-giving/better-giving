package server

import (
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
)

// closing the console from its own page, and the disconnect this surface does not answer.
//
// **the answer is the whole of what the page gets**, so it is asserted rather than the stop: the
// run around this server is what goes away, and a case here holds no run — what it can hold is that
// the run was asked, and that a server built without one still answers.
//
// **the account cannot be disconnected**, and the case for that is here rather than beside the
// choosing because this route is what stands beside the account name on the page: that press closes
// the console, and a disconnect would change nothing in cloudflare either way.

// one console the run around it can be asked to stop through.
func closable(t *testing.T, asked func()) http.Handler {
	t.Helper()
	flow := oauth.New(oauth.Options{Store: state.At(t.TempDir())})
	t.Cleanup(flow.Stop)
	return New(Options{
		UI:       http.NotFoundHandler(),
		Flow:     flow,
		Accounts: account.New(state.At(t.TempDir())),
		Close:    asked,
	})
}

func TestClosingAnswersThatItIsClosingAndAsksTheRunToStop(t *testing.T) {
	asked := 0
	console := closable(t, func() { asked++ })

	status, body, _ := post(t, console, "/api/console/close", "")

	if status != http.StatusOK || body["closing"] != true {
		t.Fatalf("status = %d, body = %v, want the close answered", status, body)
	}
	if asked != 1 {
		t.Errorf("the run was asked to stop %d times, want once", asked)
	}
}

func TestPressingCloseTwiceAnswersTheSameBothTimes(t *testing.T) {
	asked := 0
	console := closable(t, func() { asked++ })

	first, firstBody, _ := post(t, console, "/api/console/close", "")
	second, secondBody, _ := post(t, console, "/api/console/close", "")

	if first != second || firstBody["closing"] != true || secondBody["closing"] != true {
		t.Fatalf("first = %d %v, second = %d %v, want the same answer twice",
			first, firstBody, second, secondBody)
	}
	// the handler asks on every press and guards nothing: the run's own hook is where a second
	// press is made safe (../../cmd/better-giving/main.go).
	if asked != 2 {
		t.Errorf("the run was asked to stop %d times, want once per press", asked)
	}
}

func TestAConsoleWithNoRunAroundItStillAnswersTheClose(t *testing.T) {
	console := closable(t, nil)

	status, body, _ := post(t, console, "/api/console/close", "")

	if status != http.StatusOK || body["closing"] != true {
		t.Fatalf("status = %d, body = %v, want the close answered with nothing listening",
			status, body)
	}
}

func TestTheAccountCanNoLongerBeDisconnected(t *testing.T) {
	console, _ := chooser(t, state.At(t.TempDir()), administered)

	gone, goneBody, _ := post(t, console, "/api/account/disconnect", "")
	// what this console answers an `/api` path that fell through, read rather than assumed.
	fell, fellBody, _ := post(t, console, "/api/account/nothing-of-the-kind", "")

	if gone != http.StatusNotFound {
		t.Fatalf("disconnecting answered %d, want it gone", gone)
	}
	if gone != fell || goneBody["error"] != fellBody["error"] {
		t.Errorf("disconnecting answered %d %v, want what a path that is not there answers: %d %v",
			gone, goneBody, fell, fellBody)
	}
}
