package deployment

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/session"
)

// a worker answering on its own workers.dev address, which is where a console connects.
func answering() map[string]any {
	return map[string]any{
		"/accounts/acc/workers/scripts/better-giving/subdomain": envelope(map[string]any{"enabled": true}),
		"/accounts/acc/workers/domains":                         envelope([]any{}),
		"/accounts/acc/workers/subdomain":                       envelope(map[string]any{"subdomain": "example"}),
	}
}

func connecting(t *testing.T, answers map[string]any, patch cf.Send) (Connection, *session.Session) {
	t.Helper()
	return connectingOver(t, answers, patch, accepting)
}

// a deployment that reads the session it was just written straight back.
func accepting(string, string) cf.Get {
	return func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{}}
	}
}

func connectingOver(
	t *testing.T,
	answers map[string]any,
	patch cf.Send,
	surface func(origin, token string) cf.Get,
) (Connection, *session.Session) {
	t.Helper()
	var kept *session.Session
	held := Connect(context.Background(), ConnectInputs{
		Door: Door{
			AccountID:  "acc",
			WorkerName: "better-giving",
			Get:        fake(t, answers),
			Patch:      patch,
		},
		Credential: cf.Credential{Kind: cf.BearerToken},
		Record: func(mine session.Session) error {
			kept = &mine
			recordedToken = mine.Token
			return nil
		},
		Surface: surface,
		Within:  time.Second,
		Every:   time.Millisecond,
		Now:     time.Unix(1_700_000_000, 0),
	})
	return held, kept
}

// a secret written a moment ago is not what every copy of the worker reads yet, so the press answers
// once the deployment takes the session it recorded rather than on the write alone.
func TestAConnectAnswersOnceTheDeploymentTakesTheSession(t *testing.T) {
	asked := 0
	var at, bearer string
	held, kept := connectingOver(t, answering(), stored(http.StatusOK), func(origin, token string) cf.Get {
		return func(_ context.Context, path string) cf.Answer {
			asked++
			at, bearer = origin+path, token
			if asked < 3 {
				return cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{"error": "session_mismatch"}}
			}
			return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{}}
		}
	})
	if held.Kind != Connected || kept == nil {
		t.Fatalf("connection %+v", held)
	}
	if asked != 3 {
		t.Fatalf("asked the deployment %d times, want until it took the session", asked)
	}
	if at != held.Origin+ConsolePath || bearer != kept.Token {
		t.Fatalf("asked %q with a token other than the one recorded", at)
	}
}

// the wait is bounded: a deployment that never takes the session is the reading's to draw, and the
// write it answers for did land.
func TestAConnectStopsWaitingOnADeploymentThatNeverTakesTheSession(t *testing.T) {
	var kept *session.Session
	held := Connect(context.Background(), ConnectInputs{
		Door: Door{
			AccountID:  "acc",
			WorkerName: "better-giving",
			Get:        fake(t, answering()),
			Patch:      stored(http.StatusOK),
		},
		Credential: cf.Credential{Kind: cf.BearerToken},
		Record:     func(mine session.Session) error { kept = &mine; return nil },
		Surface: func(string, string) cf.Get {
			return func(context.Context, string) cf.Answer {
				return cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{}}
			}
		},
		Within: 50 * time.Millisecond,
		Every:  time.Millisecond,
		Now:    time.Unix(1_700_000_000, 0),
	})
	if held.Kind != Connected || kept == nil {
		t.Fatalf("connection %+v", held)
	}
}

// a machine with nowhere to keep what it remembers.
var errNotKept = errors.New("the folder could not be written")

func stored(status int) cf.Send {
	return func(_ context.Context, _, _ string, _ any) cf.Answer {
		return cf.Answer{Kind: cf.Answered, Status: status, Body: envelope(map[string]any{})}
	}
}

func TestConnectingWritesATokenTheDeploymentWillReadBackAsASession(t *testing.T) {
	held, kept := connecting(t, answering(), stored(http.StatusOK))
	if held.Kind != Connected {
		t.Fatalf("connection %+v", held)
	}
	if held.Origin != "https://better-giving.example.workers.dev" {
		t.Fatalf("connected at %q", held.Origin)
	}
	if kept == nil {
		t.Fatal("nothing was recorded on this machine")
	}
	if _, ok := session.Parse(kept.Token); !ok {
		t.Fatalf("what was written is not a token: %q", kept.Token)
	}
	// the record is held under the worker it was minted for, at the address it was written to.
	if kept.WorkerName != "better-giving" || kept.Origin != held.Origin {
		t.Fatalf("recorded %+v", kept)
	}
	// twelve hours out, in the seconds the token carries.
	if held.ExpiresAt != "2023-11-15T10:13:20Z" {
		t.Fatalf("the session ends %q", held.ExpiresAt)
	}
}

// the credential goes into the request body and into no part of the address.
func TestConnectingPutsTheTokenInTheBodyAndNowhereElse(t *testing.T) {
	var at string
	var carried string
	held, _ := connecting(t, answering(), func(_ context.Context, _, path string, body any) cf.Answer {
		at = path
		sent, _ := body.(map[string]any)
		secrets, _ := sent["secrets"].(map[string]any)
		named, _ := secrets[ConsoleTokenName].(map[string]any)
		carried, _ = named["text"].(string)
		return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: envelope(map[string]any{})}
	})
	if carried == "" || carried != tokenOf(t, held) {
		t.Fatalf("the body carried %q", carried)
	}
	if strings.Contains(at, carried) {
		t.Fatalf("the address carried the credential: %q", at)
	}
}

// the token the last Record above was handed. what a screen may know is when the session ends and
// where it was written, so the credential is read off the record rather than off the answer.
var recordedToken string

func tokenOf(t *testing.T, held Connection) string {
	t.Helper()
	if held.Kind != Connected {
		t.Fatalf("connection %+v", held)
	}
	return recordedToken
}

func TestADeploymentAnsweringOnNoAddressIsNotWrittenTo(t *testing.T) {
	answers := answering()
	answers["/accounts/acc/workers/scripts/better-giving/subdomain"] = envelope(map[string]any{"enabled": false})
	written := false
	held, kept := connecting(t, answers, func(_ context.Context, _, _ string, _ any) cf.Answer {
		written = true
		return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: envelope(map[string]any{})}
	})
	if held.Kind != ConnectNowhere {
		t.Fatalf("connection %+v", held)
	}
	if written || kept != nil {
		t.Fatal("a deployment with nowhere to connect to was written to")
	}
}

// a worker that has never been deployed is nowhere to connect to as well, and its own sentence says
// which of the two it was.
func TestAWorkerThatIsNotInTheAccountIsNowhereToConnectTo(t *testing.T) {
	held, kept := connecting(t, map[string]any{}, stored(http.StatusOK))
	if held.Kind != ConnectNowhere || kept != nil {
		t.Fatalf("connection %+v", held)
	}
}

// recorded only once the deployment holds it: a failed write leaves whatever session was there
// still live, and a console that had dropped its own would have no way back to it.
func TestAWriteThatDidNotLandRecordsNothing(t *testing.T) {
	for _, one := range []struct {
		status int
		kind   ConnectionKind
	}{
		{http.StatusForbidden, ConnectRefused},
		{http.StatusInternalServerError, ConnectFailed},
	} {
		held, kept := connecting(t, answering(), stored(one.status))
		if held.Kind != one.kind || kept != nil {
			t.Errorf("a write answered %d became %+v", one.status, held)
		}
	}
}

// a call that never landed is kept apart, because the network is its way out.
func TestACallThatNeverLandedIsKeptApart(t *testing.T) {
	held, _ := connecting(t, answering(), func(_ context.Context, _, _ string, _ any) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route"}
	})
	if held.Kind != ConnectUnreachable || held.Detail != "no route" {
		t.Fatalf("connection %+v", held)
	}
}

// the deployment holds a token this console cannot use, which is its own state and its own way out.
func TestASessionThatCouldNotBeKeptSaysSo(t *testing.T) {
	held := Connect(context.Background(), ConnectInputs{
		Door: Door{
			AccountID:  "acc",
			WorkerName: "better-giving",
			Get:        fake(t, answering()),
			Patch:      stored(http.StatusOK),
		},
		Credential: cf.Credential{Kind: cf.BearerToken},
		Record:     func(session.Session) error { return errNotKept },
		Now:        time.Unix(1_700_000_000, 0),
	})
	if held.Kind != ConnectUnkept {
		t.Fatalf("connection %+v", held)
	}
}

// nothing is asked of cloudflare at all on a credential this console does not hold.
func TestNoSignInAsksCloudflareNothing(t *testing.T) {
	held := Connect(context.Background(), ConnectInputs{
		Credential: cf.Credential{Kind: cf.NoCredential, Detail: "not signed in"},
		Now:        time.Unix(1_700_000_000, 0),
	})
	if held.Kind != ConnectNowhere || held.Detail != "not signed in" {
		t.Fatalf("connection %+v", held)
	}
}
