package deployment

import (
	"context"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the press that puts this deployment's own Stripe endpoint right, as this console asks for it.
//
// **the deployment does it and this console cannot**, for ./recurring.go's reason: the call goes
// through the deployment's payment port with the key the deployment holds.
//
// **it is the repair and never the replacement.** the endpoint already there is subscribed to
// everything the app acts on and switched back on, and its signing secret is left alone — so
// nothing comes back for this console to write onto the worker, and nothing here reaches
// ./write.go. an endpoint deleted since the screen was drawn comes back `failed`, with the
// deployment's sentence saying to register it again, which is the Stripe run's press (../stripe).
// packages/app/src/routes/console.webhook-repair.ts's header is the whole argument, and the one for
// why it is Stripe's alone.
//
// **no endpoint is named in the press and none may be.** which endpoint on the account is this
// deployment's is settled by the address the press reached, so a body carrying an id would be a
// press on whichever endpoint it was told to, another deployment's on the same account included.
// the processor is the one thing posted, and the deployment refuses any other.
//
// **nothing about the endpoint comes back**: no id, no secret, no fingerprint. the report is the
// outcome and, where the press did not land, the deployment's own sentence naming what to fix.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// WebhookRepairPath is the path on a deployment that repairs its endpoint.
const WebhookRepairPath = "/console/webhook-repair"

// WebhookRepairKind is how one press of the repair ended.
type WebhookRepairKind string

const (
	// WebhookRepairReported is the deployment saying what the press did.
	WebhookRepairReported WebhookRepairKind = "reported"
	// WebhookRepairUnanswered is nothing coming back that says, and Read says why.
	WebhookRepairUnanswered WebhookRepairKind = "unanswered"
)

// WebhookRepairReport is what the press did, in the deployment's own shape.
//
// Detail is the deployment's sentence on the failed arm and nil on the one that worked.
type WebhookRepairReport struct {
	Outcome string  `json:"outcome"`
	Detail  *string `json:"detail"`
}

// WebhookRepair is how one press went.
type WebhookRepair struct {
	Kind   WebhookRepairKind    `json:"kind"`
	Report *WebhookRepairReport `json:"report"`
	Read   *NoReport            `json:"read"`
}

// RepairWebhook asks the deployment to repair its Stripe endpoint, or says why it did not.
//
// A nil writer is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func RepairWebhook(ctx context.Context, post cf.Post) WebhookRepair {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return WebhookRepair{Kind: WebhookRepairUnanswered, Read: &read}
	}
	answer := post(ctx, WebhookRepairPath, map[string]any{"processor": release.StripeProcessor})
	if report := webhookRepairReport(answer); report != nil {
		return WebhookRepair{Kind: WebhookRepairReported, Report: report}
	}
	read := readNoReport(answer)
	return WebhookRepair{Kind: WebhookRepairUnanswered, Read: &read}
}

// the answer as a report of the press, or nil where it is not one.
//
// Read whatever the status, because the failed arm arrives under a 500 — a reader that only read a
// 2xx would throw its sentence away. A failed arm with no sentence is dropped rather than drawn,
// for ./payments.go's reason: that sentence is the whole of what an operator acts on.
func webhookRepairReport(answer cf.Answer) *WebhookRepairReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	outcome, isText := body["outcome"].(string)
	if !isText || !enumerated(release.WebhookRepairOutcomes, outcome) {
		return nil
	}
	if outcome == "repaired" {
		return &WebhookRepairReport{Outcome: outcome}
	}
	detail := text(body["detail"])
	if detail == nil {
		return nil
	}
	return &WebhookRepairReport{Outcome: outcome, Detail: detail}
}
