package deployment

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// a deployment answering its console surface with one body, at one status.
func deployment(t *testing.T, status int, body any) cf.Get {
	t.Helper()
	answering := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ConsolePath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if body != nil {
			_ = json.NewEncoder(w).Encode(body)
		}
	}))
	t.Cleanup(answering.Close)
	return cf.JSONGet(answering.URL, map[string]string{})
}

func envelopeBody(extra map[string]any) map[string]any {
	body := map[string]any{
		"sites":   []any{"https://hound-haven.org", 7},
		"org":     map[string]any{"legal_name": "Hound Haven"},
		"session": map[string]any{"expiresAt": "2026-09-01T00:00:00.000Z"},
	}
	for name, value := range extra {
		body[name] = value
	}
	return body
}

func TestTheReportIsWhatTheDeploymentSaidAboutItself(t *testing.T) {
	read := Report(context.Background(), deployment(t, http.StatusOK, envelopeBody(nil)))
	if read.Kind != Reported {
		t.Fatalf("read %+v", read)
	}
	if len(read.Sites) != 1 || read.Sites[0] != "https://hound-haven.org" {
		t.Fatalf("sites %v", read.Sites)
	}
	if read.Org == nil {
		t.Fatal("the organisation's profile was dropped")
	}
}

// a refusal is carried whole: the deployment writes a code a machine reads and two sentences a
// reader does, and the second of those is the only thing on a screen that says how to get out.
func TestARefusalCarriesTheDeploymentsOwnTwoSentences(t *testing.T) {
	read := Report(context.Background(), deployment(t, http.StatusUnauthorized, map[string]any{
		"error":   "no_session",
		"message": "This console is not connected.",
		"fix":     "Connect it again.",
	}))
	if read.Kind != NoReportRefused {
		t.Fatalf("read %+v", read)
	}
	if read.Error == nil || *read.Fix != "Connect it again." {
		t.Fatalf("read %+v", read)
	}
}

// a 401 in a shape this was not written against is still a refusal, and the console's own screen
// says so where the deployment said nothing readable.
func TestARefusalWithNothingReadableInItIsStillARefusal(t *testing.T) {
	read := Report(context.Background(), deployment(t, http.StatusUnauthorized, nil))
	if read.Kind != NoReportRefused || read.Error != nil || read.Fix != nil {
		t.Fatalf("read %+v", read)
	}
}

// a deployment older than the console surface is up, reached, and serving no such path.
func TestNothingServedThereIsItsOwnState(t *testing.T) {
	if read := Report(context.Background(), deployment(t, http.StatusNotFound, nil)); read.Kind != NoSurface {
		t.Fatalf("read %+v", read)
	}
}

func TestAnAnswerThatIsNotAnEnvelopeIsUnreadable(t *testing.T) {
	for _, body := range []map[string]any{
		{"sites": "one"},
		envelopeBody(map[string]any{"session": map[string]any{}}),
		envelopeBody(map[string]any{"sites": nil}),
	} {
		read := Report(context.Background(), deployment(t, http.StatusOK, body))
		if read.Kind != NoReportUnreadable {
			t.Fatalf("%v read %+v", body, read)
		}
	}
}

// the release the deployment says it runs, which is the one member of the envelope a console
// weighs against a version of its own.
func TestTheVersionIsWhatTheDeploymentSaysItRuns(t *testing.T) {
	read := Report(context.Background(), deployment(t, http.StatusOK, envelopeBody(map[string]any{
		"version": "0.3.1",
	})))
	if read.Kind != Reported || read.Version == nil || *read.Version != "0.3.1" {
		t.Fatalf("read %+v", read)
	}
}

// absent, null and a member in another shape are one state, and none of them is a refusal: a
// deployment older than this member and one built from a checkout both say nothing about a release,
// and everything else in their envelopes is still drawable.
func TestADeploymentNamingNoVersionIsStillAReport(t *testing.T) {
	for _, body := range []map[string]any{
		envelopeBody(nil),
		envelopeBody(map[string]any{"version": nil}),
		envelopeBody(map[string]any{"version": 7}),
	} {
		read := Report(context.Background(), deployment(t, http.StatusOK, body))
		if read.Kind != Reported || read.Version != nil {
			t.Fatalf("%v read %+v", body, read)
		}
	}
}

// both sentences on a failure outside 401 too, because the way out is the only one of them that
// says what to do about the state.
func TestAFailureOutsideRefusalStillCarriesTheWayOut(t *testing.T) {
	read := Report(context.Background(), deployment(t, http.StatusInternalServerError, map[string]any{
		"message": "This deployment could not read its own configuration.",
		"fix":     "Set the missing values.",
	}))
	if read.Kind != NoReportUnreadable || read.Fix == nil || *read.Fix != "Set the missing values." {
		t.Fatalf("read %+v", read)
	}
	if read.Detail != "This deployment could not read its own configuration." {
		t.Fatalf("detail %q", read.Detail)
	}
}

// the two acts on this surface answer with a report of the press rather than with the deployment's
// own report, so an envelope arriving where one was expected is an answer to another question.
func TestAnActsAnswerThatIsTheDeploymentsOwnReportIsUnreadable(t *testing.T) {
	read := readNoReport(cf.Answer{
		Kind:   cf.Answered,
		Status: http.StatusOK,
		Body: map[string]any{
			"sites":   []any{},
			"session": map[string]any{"expiresAt": "2026-08-19T12:00:00.000Z"},
		},
	})
	if read.Kind != NoReportUnreadable {
		t.Fatalf("read %+v", read)
	}
	if read.Detail != "This deployment answered 200" {
		t.Fatalf("detail %q", read.Detail)
	}
}

// every other way an answer was not the thing asked for is the reading the report already makes.
func TestAnActsAnswerKeepsEveryRefusalTheReportTellsApart(t *testing.T) {
	refused := readNoReport(cf.Answer{
		Kind:   cf.Answered,
		Status: http.StatusUnauthorized,
		Body:   map[string]any{"error": "session_mismatch", "message": "Not this one.", "fix": "Connect again."},
	})
	if refused.Kind != NoReportRefused || refused.Error == nil || *refused.Error != "session_mismatch" {
		t.Fatalf("read %+v", refused)
	}
	if refused.Fix == nil || *refused.Fix != "Connect again." {
		t.Fatalf("the way out was not carried: %+v", refused)
	}

	if gone := readNoReport(cf.Answer{Kind: cf.Answered, Status: http.StatusNotFound}); gone.Kind != NoSurface {
		t.Errorf("a deployment older than this surface read as %q", gone.Kind)
	}
	unreachable := readNoReport(cf.Answer{Kind: cf.Unreachable, Detail: "no route"})
	if unreachable.Kind != NoReportUnreachable || unreachable.Detail != "no route" {
		t.Errorf("read %+v", unreachable)
	}
}
