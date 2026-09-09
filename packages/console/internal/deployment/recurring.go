package deployment

import (
	"context"
	"strings"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// gifts that repeat, as this console reads where a deployment stands and asks it to get there.
//
// **the deployment does both and this console cannot.** the read and the press go through the
// deployment's payment port with the key the deployment holds — a console that could ask the
// processor would be a console holding that key.
//
// **it is a block and never a fold of its own.** a deployment that only ever wants one-time gifts
// is not incomplete, so this reports what an account is approved for and never how far set-up has
// got.
//
// **the read changes nothing.** it is the port's read arm inside the worker, and a screen drawn
// from the find-or-create one would provision an operator's processor account as a side effect of
// them opening a page. that separation is the deployment's and is not restated here.
//
// **the sentences are the deployment's.** what a read or a press failed on and what to set to fix
// it is decided inside the worker, and both arrive naming the value.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// RecurringPath is the path on a deployment that reads and provisions this.
const RecurringPath = "/console/recurring"

// RecurringReadKind is how one read of the standing ended.
type RecurringReadKind string

const (
	// RecurringWasRead is the only kind that says anything about the account.
	RecurringWasRead RecurringReadKind = "read"
	// RecurringUnread is nothing coming back that says where it stands, and Read says why.
	RecurringUnread RecurringReadKind = "unread"
)

// RecurringReading is what the deployment answered a read with.
//
// Reason and Detail are the unreadable arm's alone and are empty on every standing: the read could
// not be made — no credentials, a rejected key, a processor that did not reply — which says nothing
// about what the account holds. Detail is the deployment's own sentence, which names the value to
// fix, and Reason is the fact: a console deciding between them off the prose would be a screen that
// changes what it draws when somebody edits a string.
type RecurringReading struct {
	State  string `json:"state"`
	Reason string `json:"reason"`
	Detail string `json:"detail"`
}

// RecurringRead is where the account stands, or which way that was not read.
type RecurringRead struct {
	Kind    RecurringReadKind `json:"kind"`
	Reading *RecurringReading `json:"reading"`
	Read    *NoReport         `json:"read"`
}

// RecurringSetupKind is how one press to provision it ended.
type RecurringSetupKind string

const (
	// RecurringSetupReported is the deployment saying what it did.
	RecurringSetupReported RecurringSetupKind = "reported"
	// RecurringSetupUnanswered is nothing coming back that says, and Read says why.
	RecurringSetupUnanswered RecurringSetupKind = "unanswered"
)

// RecurringSetupReport is what one press did.
type RecurringSetupReport struct {
	Outcome string `json:"outcome"`
	// Detail is what went wrong, verbatim from the deployment's payment port, and nil on both arms
	// that worked. An account holding an archived one lands here rather than on a third success: the
	// port refuses to replace it, and the sentence says so.
	Detail *string `json:"detail"`
}

// RecurringSetup is how one press went.
type RecurringSetup struct {
	Kind   RecurringSetupKind    `json:"kind"`
	Report *RecurringSetupReport `json:"report"`
	Read   *NoReport             `json:"read"`
}

// ReadRecurring asks where the account stands, or says why it could not.
//
// A nil reader is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func ReadRecurring(ctx context.Context, get cf.Get) RecurringRead {
	if get == nil {
		read := NoReport{Kind: NoSession}
		return RecurringRead{Kind: RecurringUnread, Read: &read}
	}
	answer := get(ctx, RecurringPath)
	if standing := recurringReading(answer); standing != nil {
		return RecurringRead{Kind: RecurringWasRead, Reading: standing}
	}
	read := readNoReport(answer)
	return RecurringRead{Kind: RecurringUnread, Read: &read}
}

// SetUpRecurring asks the deployment to provision it, or says why it did not.
func SetUpRecurring(ctx context.Context, post cf.Post) RecurringSetup {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return RecurringSetup{Kind: RecurringSetupUnanswered, Read: &read}
	}
	// no body of its own: what the account holds is found by an id the deployment derives.
	answer := post(ctx, RecurringPath, map[string]any{})
	if report := recurringSetupReport(answer); report != nil {
		return RecurringSetup{Kind: RecurringSetupReported, Report: report}
	}
	read := readNoReport(answer)
	return RecurringSetup{Kind: RecurringSetupUnanswered, Read: &read}
}

// how the deployment says it is holding no secret key, matched inside the sentence it writes.
//
// The whole sentence is longer and names the console and the fold to open, so this is the part of
// it that is the fact. It is written by `build` in
// packages/app/src/lib/server/payments/factory.ts, which is the one place a payment provider is
// refused for an unset key.
const noKeySaid = "`STRIPE_SECRET_KEY` is not set"

// AwaitsKey is the press refused because the deployment is not holding the secret key yet.
//
// **it is this console reading a sentence, and it is that because the press states no reason.** the
// read beside it answers one (release.StripeUnreadableReasons, `no_key` among them) and this arm
// carries an outcome and free text, so the sentence is the whole of what there is to go on. a
// wording change in that file makes this false rather than wrong: what is lost is the console
// saying to wait, and what is drawn instead is the deployment's own words.
func (setup RecurringSetup) AwaitsKey() bool {
	return setup.Kind == RecurringSetupReported && setup.Report != nil &&
		setup.Report.Outcome == "failed" && setup.Report.Detail != nil &&
		strings.Contains(*setup.Report.Detail, noKeySaid)
}

// the answer as a standing, or nil where it is not one.
//
// Read one member at a time, because the body arrived off a network. An unreadable arm with no
// sentence on it is dropped rather than drawn — that sentence is the whole of what an operator acts
// on, and a state saying only "could not read" is one this console has nothing to say under.
func recurringReading(answer cf.Answer) *RecurringReading {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := body["state"].(string)
	if !isText {
		return nil
	}
	if state == "unreadable" {
		reason, named := body["reason"].(string)
		detail := text(body["detail"])
		if !named || !enumerated(release.StripeUnreadableReasons, reason) || detail == nil {
			return nil
		}
		return &RecurringReading{State: state, Reason: reason, Detail: *detail}
	}
	if !enumerated(release.RecurringStandings, state) {
		return nil
	}
	return &RecurringReading{State: state}
}

// the answer as a report of a press, or nil where it is not one.
//
// Read whatever the status, because a refusal answers with one saying what is in the way — a reader
// that only read a 2xx would throw that sentence away.
func recurringSetupReport(answer cf.Answer) *RecurringSetupReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	outcome, isText := body["outcome"].(string)
	if !isText || !enumerated(release.RecurringSetupOutcomes, outcome) {
		return nil
	}
	return &RecurringSetupReport{Outcome: outcome, Detail: text(body["detail"])}
}
