package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// a deployment answering one thing to whatever is read, and the path it was asked, recorded.
func asking(answer cf.Answer) (cf.Get, *pressed) {
	held := &pressed{}
	return func(_ context.Context, path string) cf.Answer {
		held.path = path
		return answer
	}, held
}

func TestWhatTheAccountHoldsForRepeatingGiftsIsTheDeploymentsWord(t *testing.T) {
	for _, standing := range []string{"ready", "absent", "archived"} {
		get, asked := asking(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"state": standing},
		})
		read := ReadRecurring(context.Background(), get)
		if read.Kind != RecurringWasRead || read.Reading.State != standing {
			t.Fatalf("read %+v", read)
		}
		if asked.path != RecurringPath {
			t.Fatalf("asked %q", asked.path)
		}
	}
}

// the reason's two members are draw nothing and report a fault, so one guessed at is a screen
// silently doing the opposite of what it is for.
func TestAReadingTheDeploymentCouldNotMakeKeepsItsReasonAndItsSentence(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"state": "unreadable", "reason": "no_key", "detail": "Set STRIPE_SECRET_KEY.",
	}})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringWasRead || read.Reading.State != "unreadable" {
		t.Fatalf("read %+v", read)
	}
	if read.Reading.Reason != "no_key" || read.Reading.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("reading %+v", read.Reading)
	}
}

func TestAStandingThisConsoleHasNoStateForIsNotReadAsOne(t *testing.T) {
	for what, body := range map[string]any{
		"a standing nothing is drawn for":  map[string]any{"state": "pending"},
		"an unreadable arm with no reason": map[string]any{"state": "unreadable", "detail": "No."},
		"an unreadable arm with a reason nothing is drawn for": map[string]any{
			"state": "unreadable", "reason": "elsewhere", "detail": "No.",
		},
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable", "reason": "failed"},
	} {
		get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		if read := ReadRecurring(context.Background(), get); read.Kind != RecurringUnread {
			t.Errorf("a reading carrying %s was read as one", what)
		}
	}
}

func TestARecurringReadCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringUnread || read.Read.Kind != NoReportRefused {
		t.Fatalf("read %+v", read)
	}
}

func TestARecurringReadWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	read := ReadRecurring(context.Background(), nil)
	if read.Kind != RecurringUnread || read.Read.Kind != NoSession {
		t.Fatalf("read %+v", read)
	}
}

// the two successes are the same finished state said differently, and both are worth saying: an
// operator who pressed a button is owed the difference between having done something and nothing.
func TestAPressTellsTheTwoSuccessesApart(t *testing.T) {
	for _, outcome := range []string{"set_up", "already_set_up"} {
		post, press := posting(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"outcome": outcome},
		})
		setup := SetUpRecurring(context.Background(), post)
		if setup.Kind != RecurringSetupReported || setup.Report.Outcome != outcome {
			t.Fatalf("setup %+v", setup)
		}
		if press.path != RecurringPath {
			t.Fatalf("pressed %q", press.path)
		}
		// nothing is posted with it: what the account holds is found by an id the deployment derives.
		if body, _ := press.body.(map[string]any); len(body) != 0 {
			t.Fatalf("posted %v", press.body)
		}
	}
}

// a refusal answers with a report saying what is in the way, and a reader keying on the status
// would throw that sentence away.
func TestAPressIsReadOffItsAnswerRatherThanItsStatus(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadGateway, Body: map[string]any{
		"outcome": "failed", "detail": "Stripe refused the key.",
	}})
	setup := SetUpRecurring(context.Background(), post)
	if setup.Kind != RecurringSetupReported || setup.Report.Outcome != "failed" {
		t.Fatalf("setup %+v", setup)
	}
	if setup.Report.Detail == nil || *setup.Report.Detail != "Stripe refused the key." {
		t.Fatalf("report %+v", setup.Report)
	}
}

func TestAPressAnsweredWithAnOutcomeNothingIsDrawnForIsUnanswered(t *testing.T) {
	post, _ := posting(cf.Answer{
		Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"outcome": "queued"},
	})
	setup := SetUpRecurring(context.Background(), post)
	if setup.Kind != RecurringSetupUnanswered || setup.Read.Kind != NoReportUnreadable {
		t.Fatalf("setup %+v", setup)
	}
}

func TestARecurringPressWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	setup := SetUpRecurring(context.Background(), nil)
	if setup.Kind != RecurringSetupUnanswered || setup.Read.Kind != NoSession {
		t.Fatalf("setup %+v", setup)
	}
}
