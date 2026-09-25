package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
)

// the company this deployment sends its books to, as this console reads where it stands and passes
// on what an operator pressed.
//
// **the report is carried through rather than read, which is ./report.go's Org arrangement.**
// nothing in this binary branches on a single line of it — what a connection holds, which accounts
// the books offer and how far behind they are are the deployment's, and a console that restated one
// would be a second opinion about it. so both reports travel as `any` and reach the page whole.
//
// **the shape check is shallow for the reason ./report.go's header states**: what is asserted is
// that this is an answer from that surface rather than an unrelated json body, and everything
// inside it is rendered as it arrived.
//
// **the press is forwarded and never interpreted.** whether an id fits its role is settled in the
// deployment against the connected company's own chart, and an id those books do not hold is
// refused there — which arrives here as a non-200 and therefore as unanswered. a rule written here
// would be a second opinion on a chart this binary cannot see. what this binary knows is the body's
// shape: an accounts press names every role.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// QuickbooksPath is the path on a deployment that reads and presses on that connection.
const QuickbooksPath = "/console/quickbooks"

// QuickbooksReadKind is how one read of the connection ended.
type QuickbooksReadKind string

const (
	// QuickbooksWasRead is the only kind carrying anything about the books.
	QuickbooksWasRead QuickbooksReadKind = "read"
	// QuickbooksUnread is nothing coming back that says where they stand, and Read says why.
	QuickbooksUnread QuickbooksReadKind = "unread"
)

// QuickbooksRead is where the books stand, or which way that was not read.
type QuickbooksRead struct {
	Kind   QuickbooksReadKind `json:"kind"`
	Report any                `json:"report"`
	Read   *NoReport          `json:"read"`
}

// ReadQuickbooks asks where this deployment's books stand, or says why it could not.
//
// A nil reader is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func ReadQuickbooks(ctx context.Context, get cf.Get) QuickbooksRead {
	if get == nil {
		read := NoReport{Kind: NoSession}
		return QuickbooksRead{Kind: QuickbooksUnread, Read: &read}
	}
	answer := get(ctx, QuickbooksPath)
	if report := quickbooksReport(answer); report != nil {
		return QuickbooksRead{Kind: QuickbooksWasRead, Report: report}
	}
	read := readNoReport(answer)
	return QuickbooksRead{Kind: QuickbooksUnread, Read: &read}
}

// QuickbooksPressKind is how one press over that connection ended.
type QuickbooksPressKind string

const (
	// QuickbooksReported is the deployment saying what the press did.
	QuickbooksReported QuickbooksPressKind = "reported"
	// QuickbooksUnanswered is nothing coming back that says, and Read says why.
	QuickbooksUnanswered QuickbooksPressKind = "unanswered"
)

// QuickbooksPress is what an operator pressed and whatever that press acts on.
//
// One struct rather than the values one at a time, so the account ids are named where they are
// filled in and cannot be handed over in each other's place. A nil holding is one nobody chose, and
// an empty start date is one this press does not carry: ./PressQuickbooks names every role on an
// accounts press and nothing else, and on the rest sends the start date only where it was filled in.
type QuickbooksPress struct {
	Press              string  `json:"press"`
	Income             string  `json:"income"`
	Fee                string  `json:"fee"`
	StripeBalance      *string `json:"stripeBalance"`
	PaypalBalance      *string `json:"paypalBalance"`
	ChariotBalance     *string `json:"chariotBalance"`
	NowpaymentsBalance *string `json:"nowpaymentsBalance"`
	UndepositedFunds   *string `json:"undepositedFunds"`
	StartAt            string  `json:"startAt"`
}

// the body the deployment reads for that press.
//
// An accounts press names all seven roles, a holding nobody chose as null: the deployment refuses a
// body leaving a role out, so a console knowing fewer roles than it does cannot clear the rest
// (`QUICKBOOKS_PRESSES` in packages/operator/src/console/quickbooks.ts).
func (press QuickbooksPress) body() map[string]any {
	if press.Press == "accounts" {
		return map[string]any{
			"press": press.Press, "income": press.Income, "fee": press.Fee,
			"stripeBalance":      chosenOrNone(press.StripeBalance),
			"paypalBalance":      chosenOrNone(press.PaypalBalance),
			"chariotBalance":     chosenOrNone(press.ChariotBalance),
			"nowpaymentsBalance": chosenOrNone(press.NowpaymentsBalance),
			"undepositedFunds":   chosenOrNone(press.UndepositedFunds),
		}
	}
	body := map[string]any{"press": press.Press}
	if press.StartAt != "" {
		body["startAt"] = press.StartAt
	}
	return body
}

// QuickbooksPressed is how one press went.
type QuickbooksPressed struct {
	Kind   QuickbooksPressKind `json:"kind"`
	Report any                 `json:"report"`
	Read   *NoReport           `json:"read"`
}

// PressQuickbooks asks the deployment to act on that connection, and says why it did not.
//
// A nil writer is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func PressQuickbooks(ctx context.Context, post cf.Post, press QuickbooksPress) QuickbooksPressed {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return QuickbooksPressed{Kind: QuickbooksUnanswered, Read: &read}
	}
	answer := post(ctx, QuickbooksPath, press.body())
	if report := pressReport(answer, press.Press); report != nil {
		return QuickbooksPressed{Kind: QuickbooksReported, Report: report}
	}
	read := readNoReport(answer)
	return QuickbooksPressed{Kind: QuickbooksUnanswered, Read: &read}
}

// the id, or an untyped nil where none was chosen: a nil *string held in an any is not nil.
func chosenOrNone(id *string) any {
	if id == nil {
		return nil
	}
	return *id
}

// the answer as a report, or nil where it is not one.
//
// The connection is what says this came from that surface: it is the one line the report carries on
// every state of the books, so an answer without it is a body written against another question.
func quickbooksReport(answer cf.Answer) any {
	if answer.Kind != cf.Answered || answer.Status != http.StatusOK {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	if _, held := body["connection"].(map[string]any); !held {
		return nil
	}
	return body
}

// the answer as a report of the press that was sent, or nil where it is not one.
//
// The press it names is read against the press this console sent, and not merely for being there: a
// report naming another press is the deployment answering about something nobody asked it, which a
// screen would draw at the control that was pressed as what that press did. A refusal outside 200
// is not read for one: the deployment answers it with the words to act on, and those reach the page
// as the unanswered arm's own. One inside 200 names its press and is a report (./zapier.go).
func pressReport(answer cf.Answer, sent string) any {
	if answer.Kind != cf.Answered || answer.Status != http.StatusOK {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	if named, isText := body["press"].(string); !isText || named != sent {
		return nil
	}
	return body
}
