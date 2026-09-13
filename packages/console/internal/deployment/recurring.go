package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// gifts that repeat, as this console reads where a deployment stands and asks it to get there.
//
// **the deployment does both and this console cannot.** the read and the press go through the
// deployment's payment port with the keys the deployment holds — a console that could ask a
// processor would be a console holding those keys.
//
// **one press over every account the deployment can reach, and one that may name a single one.**
// the operator's own names none, because a donor is offered a gift that repeats only where every
// one of them can collect it and there is no state between them worth pressing about on its own;
// what names one is the run in ../stripe, pressing seconds after it stored that account's key.
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
	// RecurringWasRead is the only kind that says anything about the accounts.
	RecurringWasRead RecurringReadKind = "read"
	// RecurringUnread is nothing coming back that says where they stand, and Read says why.
	RecurringUnread RecurringReadKind = "unread"
)

// RecurringReading is what the deployment answered a read of one account with.
//
// Detail is the unreadable arm's alone and is empty on every standing: the read could not be made
// — a rejected key, a processor that did not reply — which says nothing about what the account
// holds. It is the deployment's own sentence, and it names the value to fix.
//
// It carries no reason beside it, the way the payments reading's rails do not: a standing is
// reported only for a processor the deployment holds the credentials for, so the one thing a reason
// could say — that nothing was asked because no key is set — is a processor left out of the report
// altogether.
type RecurringReading struct {
	State  string `json:"state"`
	Detail string `json:"detail"`
}

// ProcessorRecurring is where one processor's account stands, under the name the fold draws it by.
type ProcessorRecurring struct {
	Processor string `json:"processor"`
	// Label is what an operator is shown the processor called, which the deployment decides.
	Label   string           `json:"label"`
	Reading RecurringReading `json:"reading"`
}

// RecurringReport is where every account this deployment can reach stands.
//
// One entry per processor the deployment holds the credentials for, in the deployment's own order.
// Empty is an answer and not a read that failed: it is every fork before any processor is set up.
type RecurringReport struct {
	Processors []ProcessorRecurring `json:"processors"`
}

// RecurringRead is where those accounts stand, or which way that was not read.
type RecurringRead struct {
	Kind   RecurringReadKind `json:"kind"`
	Report *RecurringReport  `json:"report"`
	Read   *NoReport         `json:"read"`
}

// RecurringSetupKind is how one press to provision it ended.
type RecurringSetupKind string

const (
	// RecurringSetupReported is the deployment saying what it did.
	RecurringSetupReported RecurringSetupKind = "reported"
	// RecurringSetupUnanswered is nothing coming back that says, and Read says why.
	RecurringSetupUnanswered RecurringSetupKind = "unanswered"
)

// ProcessorRecurringSetup is what the one press did to one account.
//
// Detail is what went wrong, verbatim from the deployment's payment port, and nil on both arms that
// worked. An account holding an archived one lands here rather than on a third success: the port
// refuses to replace it, and the sentence says so.
//
// Reason is that same failure as a fact rather than as a sentence, and nil on both arms that
// worked. The deployment decides it off which credentials it holds rather than off the words the
// port wrote, so `no_key` is an account this deployment is not serving the credentials for yet and
// `failed` is the processor refusing the call — what a caller does about them is opposite, and it
// is what ./AwaitsKey reads.
type ProcessorRecurringSetup struct {
	Processor string  `json:"processor"`
	Label     string  `json:"label"`
	Outcome   string  `json:"outcome"`
	Detail    *string `json:"detail"`
	Reason    *string `json:"reason"`
}

// RecurringSetupReport is what one press did, per account it acted on.
//
// Outcome is the worst of them, because a donor is offered a gift that repeats only where every
// configured processor can collect one: one account left short is the whole press left short.
type RecurringSetupReport struct {
	Outcome    string                    `json:"outcome"`
	Processors []ProcessorRecurringSetup `json:"processors"`
}

// RecurringSetup is how one press went.
//
// Named and NothingToSetUp are this console's own knowledge of the press rather than anything the
// deployment answered with, and they are off the wire for that reason: what a screen draws is the
// deployment's report, and ./AwaitsKey is the one thing either of them is read by. Named is the
// account the press was about, empty where it named none.
type RecurringSetup struct {
	Kind   RecurringSetupKind    `json:"kind"`
	Report *RecurringSetupReport `json:"report"`
	Read   *NoReport             `json:"read"`

	Named string `json:"-"`
	// NothingToSetUp is the deployment answering that it had no account to act on at all.
	NothingToSetUp bool `json:"-"`
}

// ReadRecurring asks where every account this deployment can reach stands, or says why it could
// not.
//
// A nil reader is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func ReadRecurring(ctx context.Context, get cf.Get) RecurringRead {
	if get == nil {
		read := NoReport{Kind: NoSession}
		return RecurringRead{Kind: RecurringUnread, Read: &read}
	}
	answer := get(ctx, RecurringPath)
	if held := recurringReport(answer); held != nil {
		return RecurringRead{Kind: RecurringWasRead, Report: held}
	}
	read := readNoReport(answer)
	return RecurringRead{Kind: RecurringUnread, Read: &read}
}

// SetUpRecurring asks the deployment to provision it on the account `named`, or on every account it
// holds credentials for where that is empty, and says why it did not.
//
// **what names one is a caller pressing seconds after it stored that processor's credentials.**
// which accounts the deployment counts as configured is read off the values it is serving, and a
// credential stored moments ago is not among them yet — so a press naming none would act on every
// account but the one it was made for and report a run that never asked about it. Named, that
// account is asked whatever those values say, and the refusal that comes back is the answer
// ./AwaitsKey reads.
//
// The operator's own press names none: it is about every account that deployment holds, and there
// is no state between them worth offering them a choice of.
func SetUpRecurring(ctx context.Context, post cf.Post, named string) RecurringSetup {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return RecurringSetup{Kind: RecurringSetupUnanswered, Read: &read, Named: named}
	}
	// nothing but the account travels: what that account holds is found by an id the deployment
	// derives, and an empty body is how a press about all of them is spelled.
	body := map[string]any{}
	if named != "" {
		body["processor"] = named
	}
	answer := post(ctx, RecurringPath, body)
	if report := recurringSetupReport(answer); report != nil {
		return RecurringSetup{Kind: RecurringSetupReported, Report: report, Named: named}
	}
	read := readNoReport(answer)
	return RecurringSetup{
		Kind:           RecurringSetupUnanswered,
		Read:           &read,
		Named:          named,
		NothingToSetUp: nothingToSetUp(answer),
	}
}

// the deployment answering that the press had no account to act on at all.
//
// It is a state of the deployment rather than a value the request got wrong — nothing failed, and
// no body a caller could send moves it — which is what the 409 and the code beside it say, in
// packages/app/src/routes/console.recurring.ts. The code and never the sentence, for the reason
// ./AwaitsKey reads a member: prose is free to change wording and a reader matching a fragment of
// it silently stops matching.
func nothingToSetUp(answer cf.Answer) bool {
	if answer.Kind != cf.Answered || answer.Status != http.StatusConflict {
		return false
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return false
	}
	return body["error"] == "nothing_to_set_up"
}

// AwaitsKey is the press refused because the deployment is not serving the secret key yet.
//
// **it is a member of the answer and never a sentence read for one.** the deployment decides
// `no_key` off which credentials it holds, so what this reads is a fact — a key the processor
// rejected is a refusal and never this. a console matching a fragment of the port's prose instead
// is one that silently stops matching the next time somebody edits a string, and a fragment naming
// one processor's variable can never match another's.
//
// **it is about the account the press named and no other.** the accounts beside it refuse for
// reasons of their own — an operator who has never filled PayPal's boxes is short of a value rather
// than waiting on one — so a wait taken off whichever of them happened to say `no_key` would be
// this console telling them to wait for something nothing is going to deliver. A press naming none
// leaves every account out of it: nothing has just written a key for any of them.
//
// **a press there was nothing to act on lands here too.** it is the deployment holding no
// credentials at all, which is the same moment said of every account at once — and a press naming
// an account cannot provoke it, so what meets it is the operator's own.
func (setup RecurringSetup) AwaitsKey() bool {
	if setup.NothingToSetUp {
		return true
	}
	if setup.Kind != RecurringSetupReported || setup.Report == nil || setup.Named == "" {
		return false
	}
	for _, held := range setup.Report.Processors {
		if held.Processor != setup.Named {
			continue
		}
		// a reason is read off a failed arm alone, so one that is there is one that did not land.
		return held.Reason != nil && *held.Reason == "no_key"
	}
	return false
}

// the answer as a report, or nil where it is not one.
//
// Read one member at a time, because the body arrived off a network. Any entry this console cannot
// draw drops the whole report rather than the row: the folds are keyed off the processor, so an
// entry left out silently would be an account reported as one the deployment does not hold.
func recurringReport(answer cf.Answer) *RecurringReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	listed, isList := body["processors"].([]any)
	if !isList {
		return nil
	}
	held := make([]ProcessorRecurring, 0, len(listed))
	named := map[string]bool{}
	for _, one := range listed {
		entry := processorRecurring(one)
		if entry == nil || named[entry.Processor] {
			return nil
		}
		named[entry.Processor] = true
		held = append(held, *entry)
	}
	// no check that every processor is named, which is where this parts company with the payments
	// report: a standing is reported only for an account the deployment holds a key for, so a
	// processor missing from the list is the deployment saying it holds none.
	return &RecurringReport{Processors: held}
}

// one account's standing, or nil where it is not one.
func processorRecurring(one any) *ProcessorRecurring {
	entry, mapped := one.(map[string]any)
	if !mapped {
		return nil
	}
	processor, isText := entry["processor"].(string)
	label := text(entry["label"])
	body, held := entry["reading"].(map[string]any)
	if !isText || !enumerated(release.PaymentProcessors, processor) || label == nil || !held {
		return nil
	}
	reading := recurringReading(body)
	if reading == nil {
		return nil
	}
	return &ProcessorRecurring{Processor: processor, Label: *label, Reading: *reading}
}

// the standing under one account, or nil where it is not one.
//
// An unreadable arm with no sentence is dropped rather than drawn — that sentence is the whole of
// what an operator acts on, and a state saying only "could not read" is one this console has
// nothing to say under.
func recurringReading(body map[string]any) *RecurringReading {
	state, isText := body["state"].(string)
	if !isText {
		return nil
	}
	if state == "unreadable" {
		detail := text(body["detail"])
		if detail == nil {
			return nil
		}
		return &RecurringReading{State: state, Detail: *detail}
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
	listed, isList := body["processors"].([]any)
	if !isList {
		return nil
	}
	held := make([]ProcessorRecurringSetup, 0, len(listed))
	for _, one := range listed {
		entry := processorRecurringSetup(one)
		if entry == nil {
			return nil
		}
		held = append(held, *entry)
	}
	// every line of a report is an account, so a report of none is a finished-looking answer about
	// nothing: the deployment refuses a press it would act on no account at all with rather than
	// reporting one. an empty list is therefore an answer this console cannot draw a sentence from,
	// and the screen says the deployment answered nothing rather than naming an account that is not
	// there.
	if len(held) == 0 {
		return nil
	}
	return &RecurringSetupReport{Outcome: outcome, Processors: held}
}

// what the press did to one account, or nil where it is not that.
func processorRecurringSetup(one any) *ProcessorRecurringSetup {
	entry, mapped := one.(map[string]any)
	if !mapped {
		return nil
	}
	processor, isText := entry["processor"].(string)
	label := text(entry["label"])
	outcome, named := entry["outcome"].(string)
	if !isText || !enumerated(release.PaymentProcessors, processor) || label == nil {
		return nil
	}
	if !named || !enumerated(release.RecurringSetupOutcomes, outcome) {
		return nil
	}
	// the reason is the failed arm's alone and is required there: the two members are wait and press
	// again or stop and read the sentence, and a press that did not land with neither of them on it
	// is one this console cannot say which it is in — which is a run drawing the opposite of its job.
	var reason *string
	if outcome == "failed" {
		reason = text(entry["reason"])
		if reason == nil || !enumerated(release.RecurringSetupReasons, *reason) {
			return nil
		}
	}
	return &ProcessorRecurringSetup{
		Processor: processor, Label: *label, Outcome: outcome,
		Detail: text(entry["detail"]), Reason: reason,
	}
}
