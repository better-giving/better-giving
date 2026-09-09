package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// what a ctrl-c does about a press this process is still holding.
//
// the wait exists because the deploy's middle step is a one-way door: a console that went away
// between the migration and the upload leaves the database ahead of the code that reads it, and the
// terminal it was closed from is the only place that can say so.

func TestAStopWaitsForThePressStillGoingAndNamesItOnce(t *testing.T) {
	readings := 0
	going := func() (string, bool) {
		readings++
		return "a deploy is still running (migrating)", readings < 3
	}
	var said strings.Builder

	waitForPress(&said, going, time.Millisecond)

	if readings != 3 {
		t.Errorf("readings = %d, want a wait that ended with the press", readings)
	}
	if !strings.Contains(said.String(), "a deploy is still running (migrating)") {
		t.Errorf("said %q, want the press named", said.String())
	}
	if strings.Count(said.String(), "\n") != 1 {
		t.Errorf("said %q, want one line and not one per reading", said.String())
	}
}

func TestAStopWithNoPressGoingWaitsForNothingAndSaysNothing(t *testing.T) {
	var said strings.Builder

	waitForPress(&said, func() (string, bool) { return "", false }, time.Hour)

	if said.String() != "" {
		t.Errorf("said %q, want a stop that says nothing about presses nobody made", said.String())
	}
}

// what `open` refuses on, and what it goes on serving through.
//
// the console is the screen an operator opens when something is wrong, so the only refusal is a
// cloudflare that answered plainly that no worker of this deployment's name is in the account.

// cloudflare answering every read with one status and one of its own error codes.
func cloudflareSaying(t *testing.T, status, code int) cf.Get {
	t.Helper()
	answering := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"errors":  []any{map[string]any{"code": code, "message": "said"}},
		})
	}))
	t.Cleanup(answering.Close)
	return cf.JSONGet(answering.URL, nil)
}

// a machine holding a sign-in, and the account it chose.
var (
	signedIn    = cf.BearerCredential("a-token")
	inAnAccount = &account.Choice{Account: account.Account{ID: "an-account"}}
)

func TestOpenRefusesWhereCloudflareSaysNoWorkerOfThisNameIsThere(t *testing.T) {
	if !certainlyNotDeployed(t.Context(), signedIn, inAnAccount, cloudflareSaying(t, 404, 10007)) {
		t.Error("a definite no from cloudflare is the one reading open refuses on")
	}
}

func TestOpenServesOnAReadThatDidNotLand(t *testing.T) {
	// the opposite of start and update, which refuse here: a remote migration stands behind those
	// two, and nothing at all stands behind this one.
	unreachable := func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route"}
	}

	if certainlyNotDeployed(t.Context(), signedIn, inAnAccount, unreachable) {
		t.Error("a cloudflare that did not answer is not a deployment that is not there")
	}
	if certainlyNotDeployed(t.Context(), signedIn, inAnAccount, cloudflareSaying(t, 403, 10000)) {
		t.Error("a sign-in cloudflare turned down is not a deployment that is not there")
	}
}

func TestOpenServesAMachineSignedOutAndOneWithNoAccountChosen(t *testing.T) {
	asked := 0
	counting := func(context.Context, string) cf.Answer {
		asked++
		return cf.Answer{Kind: cf.Unreachable}
	}

	if certainlyNotDeployed(t.Context(), cf.Credential{Kind: cf.NoCredential}, inAnAccount, counting) {
		t.Error("signed out is the connect panel and never a refusal")
	}
	if certainlyNotDeployed(t.Context(), signedIn, nil, counting) {
		t.Error("no account chosen is the connect panel and never a refusal")
	}
	if asked != 0 {
		t.Errorf("cloudflare was asked %d times about a machine with nothing to ask it about", asked)
	}
}

// the one line a newer console is named on, and the silence every other reading is.

// github answering with one release.
func releasing(t *testing.T, tag string) cf.Get {
	t.Helper()
	forge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": tag})
	}))
	t.Cleanup(forge.Close)
	return cf.JSONGet(forge.URL, nil)
}

// this binary built as a tagged release rather than as the `dev` every `go build` here leaves.
func built(t *testing.T, as string) {
	t.Helper()
	held := version
	version = as
	t.Cleanup(func() { version = held })
}

func TestALaunchNamesAConsoleNewerThanThisOneOnceAndSaysWhereItComesFrom(t *testing.T) {
	built(t, "0.3.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, releasing(t, "v0.4.0"))

	if !strings.Contains(said.String(), "0.4.0") {
		t.Errorf("said %q, want the release that is newer named", said.String())
	}
	if !strings.Contains(said.String(), release.ReleasesPage) {
		t.Errorf("said %q, want where it is installed from", said.String())
	}
	if strings.Count(said.String(), "\n") != 1 {
		t.Errorf("said %q, want one line", said.String())
	}
}

func TestALaunchHoldingTheLatestReleaseSaysNothing(t *testing.T) {
	built(t, "0.4.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, releasing(t, "v0.4.0"))

	if said.String() != "" {
		t.Errorf("said %q, want nothing to install said as nothing", said.String())
	}
}

func TestAGithubThatWouldNotAnswerSaysNothingAndEndsNoCommand(t *testing.T) {
	built(t, "0.3.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route"}
	})

	if said.String() != "" {
		t.Errorf("said %q, want a host this console can do without to cost the command nothing",
			said.String())
	}
}
