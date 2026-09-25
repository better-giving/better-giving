package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

func TestARepairTheDeploymentMadeIsReportedWithNothingToSay(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"outcome": "repaired", "detail": nil,
	}})

	repair := RepairWebhook(context.Background(), post)
	if repair.Kind != WebhookRepairReported || repair.Report.Outcome != "repaired" {
		t.Fatalf("repair %+v", repair)
	}
	if repair.Report.Detail != nil {
		t.Fatalf("a repair that landed was given a sentence: %q", *repair.Report.Detail)
	}
	if press.path != WebhookRepairPath {
		t.Fatalf("pressed %q", press.path)
	}
	// the processor and nothing else: which endpoint is this deployment's is settled by the address
	// the press reached, so an id carried here would be a press on whatever endpoint it named.
	body, _ := press.body.(map[string]any)
	if len(body) != 1 || body["processor"] != "stripe" {
		t.Fatalf("posted %v", press.body)
	}
}

// the deployment answers a press that did not land with a 500, because no value a caller could send
// fixes it — and the sentence under it is the whole of what an operator acts on.
func TestARepairThatDidNotLandKeepsTheDeploymentsSentence(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError,
		Body: map[string]any{
			"outcome": "failed", "detail": "The endpoint is gone. Reload and register it again.",
		}})

	repair := RepairWebhook(context.Background(), post)
	if repair.Kind != WebhookRepairReported || repair.Report.Outcome != "failed" {
		t.Fatalf("repair %+v", repair)
	}
	if repair.Report.Detail == nil ||
		*repair.Report.Detail != "The endpoint is gone. Reload and register it again." {
		t.Fatalf("the sentence was dropped: %+v", repair.Report)
	}
}

func TestARepairThisConsoleCannotDrawIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"no outcome at all":               map[string]any{"detail": "No."},
		"an outcome nothing is drawn for": map[string]any{"outcome": "replaced", "detail": "Done."},
		"a failed arm with no sentence":   map[string]any{"outcome": "failed", "detail": nil},
		"a body that is not an object":    []any{"repaired"},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		repair := RepairWebhook(context.Background(), post)
		if repair.Kind != WebhookRepairUnanswered || repair.Read.Kind != NoReportUnreadable {
			t.Errorf("a repair carrying %s was read as one: %+v", what, repair)
		}
	}
}

// the deployment's refusals are carried in its own words: the session it holds is another
// console's, or the press named something the deployment will not act on.
func TestARepairTheDeploymentRefusedCarriesItsOwnWords(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	repair := RepairWebhook(context.Background(), post)
	if repair.Kind != WebhookRepairUnanswered || repair.Read.Kind != NoReportRefused {
		t.Fatalf("repair %+v", repair)
	}
	if *repair.Read.Error != "session_mismatch" || *repair.Read.Message != "Another console." ||
		*repair.Read.Fix != "Connect again." {
		t.Fatalf("the refusal was not carried whole: %+v", repair.Read)
	}

	post, _ = posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadRequest, Body: map[string]any{
		"error": "bad_processor", "message": "Only Stripe’s webhook endpoint is repaired here.",
	}})
	repair = RepairWebhook(context.Background(), post)
	if repair.Kind != WebhookRepairUnanswered || repair.Read.Kind != NoReportUnreadable ||
		repair.Read.Status != http.StatusBadRequest || *repair.Read.Error != "bad_processor" ||
		repair.Read.Detail != "Only Stripe’s webhook endpoint is repaired here." {
		t.Fatalf("repair %+v", repair.Read)
	}
}

// a deployment older than the repair serves no such path, which is a release behind rather than a
// press that failed.
func TestADeploymentWithNoRepairIsOneWithoutTheSurface(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusNotFound})
	repair := RepairWebhook(context.Background(), post)
	if repair.Kind != WebhookRepairUnanswered || repair.Read.Kind != NoSurface {
		t.Fatalf("repair %+v", repair)
	}
}

func TestARepairWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	repair := RepairWebhook(context.Background(), nil)
	if repair.Kind != WebhookRepairUnanswered || repair.Read.Kind != NoSession {
		t.Fatalf("repair %+v", repair)
	}
}
