package effects

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// which release the deployment says it carries, which is what says whether `start` has anything to
// carry onto it.
//
// every way of not finding out is one answer — the empty string — because they are one thing to do
// about it: the operator is asked, and a deployment this console could not read, or read about
// somewhere else, is one it may not call up to date (../../cmd/better-giving/start.go).

// a token far enough past the minimum random length to be one, spelled as ../session's own cases do.
const random = "0123456789012345678901234567890123456789012"

// a machine holding a live session on this deployment.
func signedInTo(t *testing.T, origin string) state.Store {
	t.Helper()
	records := state.At(t.TempDir())
	ends := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	err := session.Record(records, session.Session{
		WorkerName: release.Baked.Name,
		Origin:     origin,
		Token:      "bg1." + ends + "." + random,
	})
	if err != nil {
		t.Fatalf("no session to read the deployment over: %v", err)
	}
	return records
}

// a deployment answering with the envelope its console surface serves, and the origin it was asked
// at — which is what says the answer came from the deployment this run is weighing.
func answering(t *testing.T, asked *string, body map[string]any) func(origin, token string) cf.Get {
	t.Helper()
	return func(origin, _ string) cf.Get {
		return func(context.Context, string) cf.Answer {
			*asked = origin
			return cf.Answer{Kind: cf.Answered, Status: 200, Body: body}
		}
	}
}

// the address the deployment this run found answers on, which every case below weighs against.
const atAcme = "https://give.acme.test"

// the envelope, with whatever this case says about the version.
func reporting(version any) map[string]any {
	body := map[string]any{
		"sites":   []any{},
		"session": map[string]any{"expiresAt": "2030-01-01T00:00:00.000Z"},
	}
	if version != nil {
		body["version"] = version
	}
	return body
}

func TestADeploymentNamingItsReleaseIsReadAsCarryingIt(t *testing.T) {
	asked := ""
	held := OwnRelease(t.Context(), signedInTo(t, atAcme), atAcme,
		answering(t, &asked, reporting("0.4.0")))

	if held != "0.4.0" {
		t.Errorf("OwnRelease = %q, want the release the deployment says it was built from", held)
	}
	if asked != atAcme {
		t.Errorf("the release was read at %q, want the deployment this run found", asked)
	}
}

func TestASessionMintedAgainstAnotherDeploymentIsAskedNothing(t *testing.T) {
	// the record is keyed on the baked worker name alone (../session's Held) and every deployment
	// of this fork carries that name, so a machine that connected the console to one account's
	// deployment holds a session naming it for twelve hours. the picker is put on every run: an
	// operator who switches account would otherwise have this run read that deployment, find this
	// release on it, and call the one they just chose up to date without ever asking it.
	asked := ""
	held := OwnRelease(t.Context(), signedInTo(t, "https://give.other.test"), atAcme,
		answering(t, &asked, reporting("0.4.0")))

	if held != "" {
		t.Errorf("OwnRelease = %q, want a report about another deployment read as unknown", held)
	}
	if asked != "" {
		t.Errorf("a deployment at %q was asked about one at %q", asked, atAcme)
	}
}

func TestADeploymentAnsweringNowhereThisConsoleCanReadIsWeighedAgainstNothing(t *testing.T) {
	// the address is read off the account and a worker answering on none is a deployment this run
	// cannot match a session to: an empty address matching an empty origin would be every session
	// on this machine standing in for it.
	asked := ""
	held := OwnRelease(t.Context(), signedInTo(t, ""), "",
		answering(t, &asked, reporting("0.4.0")))

	if held != "" || asked != "" {
		t.Errorf("OwnRelease = %q having asked %q, want a deployment with no address read as unknown",
			held, asked)
	}
}

func TestADeploymentNamingNoReleaseIsNotKnownToCarryOne(t *testing.T) {
	// a worker built from a checkout names none, and so does one older than the member itself.
	asked := ""
	held := OwnRelease(t.Context(), signedInTo(t, atAcme), atAcme,
		answering(t, &asked, reporting(nil)))

	if held != "" {
		t.Errorf("OwnRelease = %q, want a deployment that named none read as unknown", held)
	}
}

func TestAMachineHoldingNoSessionAsksTheDeploymentNothing(t *testing.T) {
	asked := 0
	held := OwnRelease(t.Context(), state.At(t.TempDir()), atAcme,
		func(string, string) cf.Get {
			return func(context.Context, string) cf.Answer {
				asked++
				return cf.Answer{Kind: cf.Answered, Status: 200, Body: reporting("0.4.0")}
			}
		})

	if held != "" {
		t.Errorf("OwnRelease = %q, want a deployment nobody asked read as unknown", held)
	}
	if asked != 0 {
		t.Errorf("the deployment was asked %d times over a session this machine does not hold", asked)
	}
}

func TestADeploymentThatDidNotAnswerIsNotKnownToCarryAnything(t *testing.T) {
	for _, answer := range []cf.Answer{
		{Kind: cf.Unreachable, Detail: "no route"},
		{Kind: cf.Answered, Status: 401, Body: map[string]any{"error": "unauthorized"}},
		{Kind: cf.Answered, Status: 200, Body: map[string]any{"nothing": "of the shape"}},
	} {
		held := OwnRelease(t.Context(), signedInTo(t, atAcme), atAcme,
			func(string, string) cf.Get {
				return func(context.Context, string) cf.Answer { return answer }
			})

		if held != "" {
			t.Errorf("a %q answer read as %q, want a read that did not land read as unknown",
				answer.Kind, held)
		}
	}
}
