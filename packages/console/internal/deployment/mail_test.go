package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

func TestASendThatLandedSaysWhereItWent(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"outcome": "sent", "detail": nil, "to": "you@example.org",
	}})

	send := SendTest(context.Background(), post, "you@example.org")
	if send.Kind != TestReported || send.Report.Outcome != "sent" || send.Report.To != "you@example.org" {
		t.Fatalf("send %+v", send)
	}
	if send.Report.Detail != nil {
		t.Fatalf("a send that worked carried %v", *send.Report.Detail)
	}
	if press.path != TestEmailPath {
		t.Fatalf("posted to %q", press.path)
	}
	body, _ := press.body.(map[string]any)
	if len(body) != 1 || body["to"] != "you@example.org" {
		t.Fatalf("posted %v", press.body)
	}
}

// the report is read off the body whatever the status: the arm that did not send answers with one
// saying so, and a reader that only read a 2xx would throw away the sentence naming what is in the
// way.
func TestADeploymentThatCannotSendIsReadOffItsAnswerRatherThanItsStatus(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed", "detail": "SMTP_HOST is not set.", "to": "you@example.org",
	}})
	send := SendTest(context.Background(), post, "you@example.org")
	if send.Kind != TestReported || send.Report.Outcome != "failed" {
		t.Fatalf("send %+v", send)
	}
	if send.Report.Detail == nil || *send.Report.Detail != "SMTP_HOST is not set." {
		t.Fatalf("the sentence naming what to set was dropped: %+v", send.Report)
	}
}

// what is in the way is the box on this screen, so it is its own state: the deployment's refusal is
// written for a caller sending json rather than for the operator holding the box.
func TestARefusedDestinationIsTheBoxsOwnState(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadRequest, Body: map[string]any{
		"error": "bad_to", "message": "Not an address.",
	}})
	if send := SendTest(context.Background(), post, "nope"); send.Kind != TestBadAddress {
		t.Fatalf("send %+v", send)
	}
}

// every other refusal at 400 is about the request this console made rather than about the box.
func TestABodyTheDeploymentCouldNotReadIsNotARefusedDestination(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadRequest, Body: map[string]any{
		"error": "bad_body", "message": "Send `{ \"to\": … }`.",
	}})
	send := SendTest(context.Background(), post, "you@example.org")
	if send.Kind != TestUnanswered || send.Read.Kind != NoReportUnreadable {
		t.Fatalf("send %+v", send)
	}
}

// a report this console has no state for, and one naming nowhere it went, are both a deployment
// newer than the console reading it.
func TestAReportThisConsoleHasNoStateForIsNotReadAsOne(t *testing.T) {
	for what, body := range map[string]any{
		"an outcome nothing is drawn for": map[string]any{"outcome": "queued", "to": "you@example.org"},
		"nowhere named on it":             map[string]any{"outcome": "sent"},
		"an address that is not one":      map[string]any{"outcome": "sent", "to": 7},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		if send := SendTest(context.Background(), post, "you@example.org"); send.Kind != TestUnanswered {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

func TestATestSendWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	send := SendTest(context.Background(), nil, "you@example.org")
	if send.Kind != TestUnanswered || send.Read.Kind != NoSession {
		t.Fatalf("send %+v", send)
	}
}
