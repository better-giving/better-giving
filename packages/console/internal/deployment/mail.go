package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// asking a deployment to send a test message, and reading what happened.
//
// **the deployment does it and this console cannot.** the message goes over the deployment's own
// mail transport with the deployment's own SMTP credentials, which live inside the worker — a
// console that could send would be a console holding a credential, and this arrangement exists so
// that it never has to. so this posts a press and carries the answer.
//
// **the press carries the destination and nothing else.** the address is the operator's, typed in
// the box beside the button, because a mail host is only checked by an inbox somebody is watching.
// nothing about the message is decided here: the deployment writes it.
//
// **the sentences are the deployment's.** what a send may fail on and what to set to fix it is
// stated once inside the worker, and every failure arrives naming the value. a console that rewrote
// one into something friendlier would throw away the only actionable part.
//
// **a refused destination is the exception, and it is a state rather than a sentence.** the
// deployment's refusal is written for a caller sending json; the operator is looking at a box they
// just typed into, and the way out is that box — so the arm is carried and the words are the
// screen's.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// TestEmailPath is the path on a deployment that sends the test.
const TestEmailPath = "/console/test-email"

// TestSendKind is how one press ended.
type TestSendKind string

const (
	// TestReported is the deployment performing the act and saying which arm it ended on.
	TestReported TestSendKind = "reported"
	// TestBadAddress is the deployment refusing to read the destination, so nothing was sent.
	TestBadAddress TestSendKind = "bad-address"
	// TestUnanswered is nothing coming back that says what happened, and Read says why.
	//
	// Unanswered rather than unsent: a deployment that answered in a shape this was not written
	// against may well have sent the message, and a console claiming otherwise would be telling an
	// operator to expect nothing in an inbox that has one.
	TestUnanswered TestSendKind = "unanswered"
)

// TestSendReport is what the deployment said one send did.
type TestSendReport struct {
	Outcome string `json:"outcome"`
	// Detail is what went wrong, verbatim, and nil on the arm where nothing did.
	Detail *string `json:"detail"`
	// To is the address the message was addressed to: what the press named, echoed back. On both
	// arms, because a failure is worth reading beside where it was headed.
	To string `json:"to"`
}

// TestSend is how one press went.
type TestSend struct {
	Kind   TestSendKind    `json:"kind"`
	Report *TestSendReport `json:"report"`
	Read   *NoReport       `json:"read"`
}

// SendTest asks the deployment to send one, or says why it did not.
//
// A nil writer is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func SendTest(ctx context.Context, post cf.Post, to string) TestSend {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return TestSend{Kind: TestUnanswered, Read: &read}
	}
	return readTestSend(post(ctx, TestEmailPath, map[string]any{"to": to}))
}

// what the deployment answered a press with, read.
func readTestSend(answer cf.Answer) TestSend {
	if refusedDestination(answer) {
		return TestSend{Kind: TestBadAddress}
	}
	if report := testSendReport(answer); report != nil {
		return TestSend{Kind: TestReported, Report: report}
	}
	read := readNoReport(answer)
	return TestSend{Kind: TestUnanswered, Read: &read}
}

// whether the answer is the deployment refusing the address rather than anything about mail.
//
// Keyed on the code and not on the status, because every other refusal at 400 is about the request
// this console made rather than about the box: that one is an answer the console could not read and
// says so, and this one is a typo somebody fixes in place.
func refusedDestination(answer cf.Answer) bool {
	if answer.Kind != cf.Answered || answer.Status != http.StatusBadRequest {
		return false
	}
	body, _ := answer.Body.(map[string]any)
	return body["error"] == "bad_to"
}

// the answer as a report of a send, or nil where it is not one.
//
// Read one member at a time, because the body arrived off a network. An outcome this console draws
// no state for is not a report it can render, and neither is a report naming nowhere it went — both
// are a deployment newer than the console reading it, which the screen answers by saying it could
// not read the answer rather than by drawing half of one.
func testSendReport(answer cf.Answer) *TestSendReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	outcome, isText := body["outcome"].(string)
	if !isText || !enumerated(release.TestSendOutcomes, outcome) {
		return nil
	}
	to := text(body["to"])
	if to == nil {
		return nil
	}
	return &TestSendReport{Outcome: outcome, Detail: text(body["detail"]), To: *to}
}

// whether `value` is on one of the closed sets internal/release states.
func enumerated(closed []string, value string) bool {
	for _, one := range closed {
		if one == value {
			return true
		}
	}
	return false
}
