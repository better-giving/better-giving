package deployment

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// what the deployment answered, as it reaches the page: the report is carried and never read, so
// what a case asserts is that every line it sent is still there after the round trip this console
// puts it through.
func carried(t *testing.T, report any) map[string]any {
	t.Helper()
	written, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("marshalling the report: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(written, &back); err != nil {
		t.Fatalf("reading the report back: %v", err)
	}
	return back
}

func TestAQuickbooksReadWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	read := ReadQuickbooks(context.Background(), nil)
	if read.Kind != QuickbooksUnread || read.Read.Kind != NoSession {
		t.Fatalf("read %+v", read)
	}
}

// nothing in this binary branches on a line of the report, so every line the deployment wrote
// reaches the page as it arrived — the nested chart of accounts and the address intuit sends a
// browser back to included.
func TestAQuickbooksReadCarriesTheDeploymentsWholeReport(t *testing.T) {
	report := map[string]any{
		"connection": map[string]any{
			"state":       "connected",
			"companyName": "Hope Springs",
			"income":      "42",
		},
		"accounts": map[string]any{"state": "read", "accounts": []any{
			map[string]any{"id": "42", "name": "Donations", "kind": "Income"},
		}},
		"backlog":         map[string]any{"pending": float64(3), "abandoned": float64(1)},
		"callbackAddress": "https://give.example.org/quickbooks/callback",
	}
	get, asked := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report})
	read := ReadQuickbooks(context.Background(), get)
	if read.Kind != QuickbooksWasRead {
		t.Fatalf("read %+v", read)
	}
	if asked.path != QuickbooksPath {
		t.Fatalf("asked %q", asked.path)
	}
	if held := carried(t, read.Report); !reflect.DeepEqual(held, report) {
		t.Fatalf("carried %+v, want %+v", held, report)
	}
}

// an answer with no connection on it is a body written against another question — a page at a
// custom domain that is not this deployment, or a proxy answering for it.
func TestAQuickbooksAnswerWithNoConnectionOnItIsNotAReport(t *testing.T) {
	for what, body := range map[string]any{
		"no connection at all":      map[string]any{"backlog": map[string]any{}},
		"a connection that is text": map[string]any{"connection": "connected"},
		"a body that is not an object at all": []any{
			map[string]any{"connection": map[string]any{"state": "connected"}},
		},
	} {
		get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		read := ReadQuickbooks(context.Background(), get)
		if read.Kind != QuickbooksUnread || read.Read.Kind != NoReportUnreadable {
			t.Errorf("an answer carrying %s was read as a report", what)
		}
	}
}

func TestAQuickbooksReadCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	read := ReadQuickbooks(context.Background(), get)
	if read.Kind != QuickbooksUnread || read.Read.Kind != NoReportRefused {
		t.Fatalf("read %+v", read)
	}
	if read.Read.Message == nil || *read.Read.Message != "Another console." {
		t.Fatalf("read %+v", read.Read)
	}
	if read.Read.Fix == nil || *read.Read.Fix != "Connect again." {
		t.Fatalf("read %+v", read.Read)
	}
}

func TestAQuickbooksPressWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	pressed := PressQuickbooks(context.Background(), nil, QuickbooksPress{Press: "connect"})
	if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoSession {
		t.Fatalf("pressed %+v", pressed)
	}
}

// the report of a press is carried whole for the reason the read's is: what a press did is the
// deployment's word, and the page draws it as it arrived.
func TestAQuickbooksPressCarriesTheDeploymentsWholeReport(t *testing.T) {
	report := map[string]any{"press": "retry", "retried": float64(4)}
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report})
	pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{Press: "retry"})
	if pressed.Kind != QuickbooksReported {
		t.Fatalf("pressed %+v", pressed)
	}
	if press.path != QuickbooksPath {
		t.Fatalf("pressed %q", press.path)
	}
	if held := carried(t, pressed.Report); !reflect.DeepEqual(held, report) {
		t.Fatalf("carried %+v, want %+v", held, report)
	}
}

// a press that landed says which press it was, and an answer that names none is one no screen has a
// sentence for.
func TestAQuickbooksAnswerNamingNoPressIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"no press at all":     map[string]any{"retried": float64(4)},
		"a press of no words": map[string]any{"press": ""},
		"a press that is not text": map[string]any{
			"press": []any{"retry"},
		},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{Press: "retry"})
		if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoReportUnreadable {
			t.Errorf("a press answering %s was read as reported", what)
		}
	}
}

// the ids are settled against the connected company's own chart, and one those books do not hold is
// refused there — which arrives here as the deployment's own sentence and nothing this console
// worked out.
func TestAQuickbooksPressTheDeploymentRefusedKeepsItsSentence(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadRequest, Body: map[string]any{
		"error":   "unknown_account",
		"message": "These books hold no account 42.",
		"fix":     "Pick an account from the list.",
	}})
	pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{
		Press: "accounts", Income: "42", Fee: "7", Deposit: "9",
	})
	if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoReportUnreadable {
		t.Fatalf("pressed %+v", pressed)
	}
	if pressed.Read.Detail != "These books hold no account 42." {
		t.Fatalf("read %+v", pressed.Read)
	}
	if pressed.Read.Fix == nil || *pressed.Read.Fix != "Pick an account from the list." {
		t.Fatalf("read %+v", pressed.Read)
	}
}

// only what was filled in travels: a press carrying nothing but its own name sends that alone, and
// a box this press has no use for is a value the deployment is never told about.
func TestAQuickbooksPressSendsOnlyWhatItCarries(t *testing.T) {
	answered := cf.Answer{
		Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"press": "accounts"},
	}
	for what, one := range map[string]struct {
		press QuickbooksPress
		sent  map[string]any
	}{
		"a press naming nothing but itself": {
			press: QuickbooksPress{Press: "connect"},
			sent:  map[string]any{"press": "connect"},
		},
		"the three accounts, picked together": {
			press: QuickbooksPress{Press: "accounts", Income: "42", Fee: "7", Deposit: "9"},
			sent: map[string]any{
				"press": "accounts", "income": "42", "fee": "7", "deposit": "9",
			},
		},
		"the day the books start from": {
			press: QuickbooksPress{Press: "start-date", StartAt: "2026-01-01"},
			sent:  map[string]any{"press": "start-date", "startAt": "2026-01-01"},
		},
	} {
		post, press := posting(answered)
		PressQuickbooks(context.Background(), post, one.press)
		if body, _ := press.body.(map[string]any); !reflect.DeepEqual(body, one.sent) {
			t.Errorf("%s posted %v, want %v", what, press.body, one.sent)
		}
	}
}
