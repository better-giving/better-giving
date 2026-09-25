package deployment

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
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

// the address this deployment tells an operator to register at intuit, which arrives on the report
// and is composed nowhere else.
const quickbooksCallback = "https://give.example.org/quickbooks/callback"

// the deployment's own report, as a company connected and its chart read.
func quickbooksReported() map[string]any {
	return map[string]any{
		"connection": map[string]any{
			"state":       "connected",
			"realmId":     "9341454792073042",
			"companyName": "Hope Springs",
			"income":      map[string]any{"id": "42", "name": "Donations"},
			"fee":         map[string]any{"id": "7", "name": "Merchant fees"},
			// a holding one processor's gifts wait in, or the gifts received in hand: one this
			// organisation takes nothing through stays unchosen.
			"stripeBalance":      map[string]any{"id": "31", "name": "Stripe balance"},
			"paypalBalance":      map[string]any{"id": "32", "name": "PayPal balance"},
			"chariotBalance":     nil,
			"nowpaymentsBalance": nil,
			"undepositedFunds":   map[string]any{"id": "9", "name": "Undeposited funds"},
			"awaitingAccounts":   false,
			"startAt":            "2026-01-01T00:00:00.000Z",
		},
		"accounts": map[string]any{"state": "read", "accounts": []any{
			map[string]any{
				"id": "42", "name": "Donations",
				"type": "Income", "subType": "NonProfitIncome", "classification": "Revenue",
				"roles": []any{"income"},
			},
		}},
		"backlog": map[string]any{
			"failed": float64(2), "oldestWaitingAt": "2026-09-01T09:00:00.000Z",
		},
		"callbackAddress": quickbooksCallback,
	}
}

// what every fork that has never connected a company answers, which is the ordinary state of this
// wire: no company, so no chart to draw a picker over, and a backlog of nothing.
func quickbooksDisconnected() map[string]any {
	return map[string]any{
		"connection":      map[string]any{"state": "disconnected"},
		"accounts":        nil,
		"backlog":         map[string]any{"failed": float64(0), "oldestWaitingAt": nil},
		"callbackAddress": quickbooksCallback,
	}
}

// a company connected and its chart out of reach, which says nothing about the connection: the
// sentence and the move are the deployment's own and reach the page as they arrived.
func quickbooksChartUnreadable() map[string]any {
	report := quickbooksReported()
	report["accounts"] = map[string]any{
		"state":    "unreadable",
		"recourse": "reconnect",
		"detail":   "Intuit turned this deployment's credential down.",
	}
	return report
}

// what each press answers with: four of them have something to say beyond having happened, and what
// the rest change is read back off the report. a disconnect answers on both arms of the revoke,
// because the one intuit did not confirm is the one carrying where to finish it.
func quickbooksPressReports() []map[string]any {
	return []map[string]any{
		{"press": "connect", "url": "https://appcenter.intuit.com/connect/oauth2?state=x"},
		{"press": "accounts"},
		{"press": "retry", "retried": float64(4)},
		{"press": "disconnect", "revoke": map[string]any{"state": "revoked"}},
		{"press": "disconnect", "revoke": map[string]any{
			"state":  "not_revoked",
			"detail": "Intuit did not answer the revoke.",
			"fix":    "Remove this app from the company's connected apps at Intuit.",
		}},
		quickbooksPreviewed(),
	}
}

// what the start-date preview answers: what a move of the start date would queue and drop, one side
// touching records and the other none.
func quickbooksPreviewed() map[string]any {
	return map[string]any{
		"press":   "start-date-preview",
		"startAt": "2025-12-01T00:00:00.000Z",
		"queues": map[string]any{
			"gifts": float64(3), "corrections": float64(1), "reversals": float64(2),
			"earliest": "2026-01-02T00:00:00.000Z", "latest": "2026-02-14T00:00:00.000Z",
		},
		"drops": map[string]any{
			"gifts": float64(0), "corrections": float64(0), "reversals": float64(0),
			"earliest": nil, "latest": nil,
		},
	}
}

// every report this wire carries, which is what the sweep below is taken over.
func quickbooksFixtures() []map[string]any {
	return append(
		[]map[string]any{quickbooksReported(), quickbooksDisconnected(), quickbooksChartUnreadable()},
		quickbooksPressReports()...,
	)
}

// the fixtures above, against the module the deployment writes that wire from.
//
// **carrying a report is shape-blind, and that is what makes this the only case here that can go
// red on a field that moved.** every other one asserts that what arrived reaches the page, which it
// does whatever the lines are called — so a fixture inventing a block would prove the carrying over
// lines nothing ever writes. it is ../release/config_test.go's arrangement and its reason: the
// source is read as text, and what is asserted is the names.
func TestTheQuickbooksFixturesAreTheShapeTheDeploymentAnswersWith(t *testing.T) {
	source := wire(t, "quickbooks.ts")

	connected, _ := quickbooksReported()["connection"].(map[string]any)
	chart, _ := quickbooksReported()["accounts"].(map[string]any)
	offered, _ := chart["accounts"].([]any)
	for _, one := range []struct {
		declared string
		fixture  map[string]any
	}{
		{"QuickbooksReport", quickbooksReported()},
		{"QuickbooksCompany", connected},
		{"ChosenAccountLine", connected["income"].(map[string]any)},
		{"LedgerAccountLine", offered[0].(map[string]any)},
		{"QuickbooksBacklogLine", quickbooksReported()["backlog"].(map[string]any)},
		{"QuickbooksStartAtSide", quickbooksPreviewed()["queues"].(map[string]any)},
	} {
		declared := membersOf(t, source, one.declared)
		if held := keysOf(one.fixture); !slices.Equal(declared, held) {
			t.Errorf("%s states %v and the fixture carries %v", one.declared, declared, held)
		}
	}

	// every name that module states, somewhere across these fixtures: a member added there that no
	// case here ever carries is a line this binary is never shown handing on.
	keys := map[string]bool{}
	for _, fixture := range quickbooksFixtures() {
		keysInto(fixture, keys)
	}
	stated := everyMember(source)
	for _, one := range stated {
		if !keys[one] {
			t.Errorf("no fixture here carries %q, which that module states", one)
		}
	}
	for one := range keys {
		if !slices.Contains(stated, one) {
			t.Errorf("a fixture here carries %q, which that module states nowhere", one)
		}
	}
}

// one module of packages/operator/src/console/, with its comments taken out.
//
// the deployment answers each of those wires and both operator surfaces read it, and that module
// is where every line of it is named once.
//
// the comments go first because a doc comment in one carries braces of its own (`{@link failed}`),
// and a reader taking a declaration as far as its closing brace would stop inside one.
func wire(t *testing.T, module string) string {
	t.Helper()
	root, err := release.RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	at := filepath.Join(root, filepath.FromSlash("packages/operator/src/console/"+module))
	source, err := os.ReadFile(at)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", at, err)
	}
	return lineComments.ReplaceAllString(blockComments.ReplaceAllString(string(source), ""), "")
}

var (
	blockComments = regexp.MustCompile(`(?s)/\*.*?\*/`)
	lineComments  = regexp.MustCompile(`(?m)//.*$`)
	member        = regexp.MustCompile(`readonly\s+([A-Za-z0-9_]+)\??\s*:`)
)

// every member one interface in that module states, in the order it states them.
func membersOf(t *testing.T, source, declared string) []string {
	t.Helper()
	block := regexp.MustCompile(`export interface ` + declared + `\s*\{([^}]*)\}`).
		FindStringSubmatch(source)
	if block == nil {
		t.Fatalf("no interface %s is stated", declared)
	}
	return sortedNames(member.FindAllStringSubmatch(block[1], -1))
}

// every member that module states anywhere on that wire, the arms of its unions included.
func everyMember(source string) []string {
	return sortedNames(member.FindAllStringSubmatch(source, -1))
}

// the names one sweep of ./member found, each once and in an order two lists can be compared in.
func sortedNames(matches [][]string) []string {
	names := []string{}
	for _, match := range matches {
		if !slices.Contains(names, match[1]) {
			names = append(names, match[1])
		}
	}
	slices.Sort(names)
	return names
}

func keysOf(fixture map[string]any) []string {
	return slices.Sorted(maps.Keys(fixture))
}

// every key one fixture carries, however deep.
func keysInto(value any, into map[string]bool) {
	switch held := value.(type) {
	case map[string]any:
		for key, under := range held {
			into[key] = true
			keysInto(under, into)
		}
	case []any:
		for _, under := range held {
			keysInto(under, into)
		}
	}
}

// the door the errands Intuit is behind go through outlasts a read's own deadline, which is the
// whole of what makes it a second door: ../server/errands.go names the three errands it is for and
// argues what a cut on the disconnect would leave behind.
func TestTheDoorAThirdPartyIsBehindOutlastsAReadsOwn(t *testing.T) {
	if patientTimeout <= cf.ReadTimeout {
		t.Fatalf("a patient call is bound to %s and a read to %s", patientTimeout, cf.ReadTimeout)
	}
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
	for _, report := range []map[string]any{
		quickbooksReported(), quickbooksDisconnected(), quickbooksChartUnreadable(),
	} {
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
}

// nothing found out either way is its own arm and carries what the call said, which is the whole of
// what a screen has to say about a deployment nobody could reach.
func TestAQuickbooksReadThatFoundNothingOutSaysWhatItFound(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Unreachable, Detail: "dial tcp: connection refused"})
	read := ReadQuickbooks(context.Background(), get)
	if read.Kind != QuickbooksUnread || read.Read.Kind != NoReportUnreachable {
		t.Fatalf("read %+v", read)
	}
	if read.Read.Detail != "dial tcp: connection refused" {
		t.Fatalf("read %+v", read.Read)
	}
}

// nothing served under that path is what every deployment older than this surface answers, and it
// is the likeliest thing an operator meets: it is up, this console reached it, and the routes being
// asked for are not on the version it holds.
func TestADeploymentServingNoQuickbooksSurfaceIsSaidToServeNone(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusNotFound})
	read := ReadQuickbooks(context.Background(), get)
	if read.Kind != QuickbooksUnread || read.Read.Kind != NoSurface {
		t.Fatalf("read %+v", read)
	}

	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusNotFound})
	pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{Press: "connect"})
	if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoSurface {
		t.Fatalf("pressed %+v", pressed)
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
	if read.Read.Error == nil || *read.Read.Error != "session_mismatch" {
		t.Fatalf("read %+v", read.Read)
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
	for _, report := range quickbooksPressReports() {
		post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report})
		named, _ := report["press"].(string)
		pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{Press: named})
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
}

// nothing found out either way is the press's own arm too, and a press that may have landed is what
// makes it worth telling apart from a refusal: ../server/errands.go's disconnect arm argues it.
func TestAQuickbooksPressThatFoundNothingOutSaysWhatItFound(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Unreachable, Detail: "context deadline exceeded"})
	pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{Press: "disconnect"})
	if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoReportUnreachable {
		t.Fatalf("pressed %+v", pressed)
	}
	if pressed.Read.Detail != "context deadline exceeded" {
		t.Fatalf("read %+v", pressed.Read)
	}
}

// a press that landed says which press it was, and an answer naming another is one this console
// asked no question about: the echo is what tells a report of the press apart from a deployment
// answering about something else, so it is read against the press that was sent.
func TestAQuickbooksAnswerThatIsNotAboutThePressSentIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"no press at all":     map[string]any{"retried": float64(4)},
		"a press of no words": map[string]any{"press": ""},
		"a press other than the one sent": map[string]any{
			"press": "disconnect",
		},
		"a press that is not text": map[string]any{
			"press": []any{"retry"},
		},
		"a body that is not an object at all": []any{map[string]any{"press": "retry"}},
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
//
// the code travels beside the two sentences: it is the one member of a refusal a reader switches
// on, and a console that dropped it would hold a precise answer and draw a vague one.
func TestAQuickbooksPressTheDeploymentRefusedKeepsItsSentence(t *testing.T) {
	for what, refused := range map[string]map[string]any{
		"an id the connected company's books do not hold": {
			"error":   "unknown_account",
			"message": "These books hold no account 42.",
			"fix":     "Pick an account from the list.",
		},
		// what the retry press answers on every fork that has connected nothing, which is the one
		// refusal an operator meets without having typed anything wrong.
		"a press over books no company is connected to": {
			"error":   "not_connected",
			"message": "No QuickBooks company is connected to this deployment.",
			"fix":     "Press Connect and choose a company at Intuit.",
		},
	} {
		post, _ := posting(cf.Answer{
			Kind: cf.Answered, Status: http.StatusBadRequest, Body: refused,
		})
		pressed := PressQuickbooks(context.Background(), post, QuickbooksPress{
			Press: "accounts", Income: "42", Fee: "7", UndepositedFunds: picked("9"),
		})
		if pressed.Kind != QuickbooksUnanswered || pressed.Read.Kind != NoReportUnreadable {
			t.Fatalf("%s was pressed %+v", what, pressed)
		}
		for held, want := range map[*string]any{
			pressed.Read.Error: refused["error"],
			pressed.Read.Fix:   refused["fix"],
		} {
			if held == nil || *held != want {
				t.Errorf("%s read %+v", what, pressed.Read)
			}
		}
		if pressed.Read.Detail != refused["message"] {
			t.Errorf("%s read %+v", what, pressed.Read)
		}
	}
}

// only what was filled in travels: a press carrying nothing but its own name sends that alone, and
// a box this press has no use for is a value the deployment is never told about.
func TestAQuickbooksPressSendsOnlyWhatItCarries(t *testing.T) {
	for what, one := range map[string]struct {
		press QuickbooksPress
		sent  map[string]any
	}{
		"a press naming nothing but itself": {
			press: QuickbooksPress{Press: "connect"},
			sent:  map[string]any{"press": "connect"},
		},
		// every role is named on an accounts press, so a holding nobody chose travels as null
		// rather than as nothing: a body leaving one out is refused.
		"the accounts, with one holding chosen and the rest none": {
			press: QuickbooksPress{
				Press: "accounts", Income: "42", Fee: "7", StripeBalance: picked("31"),
			},
			sent: map[string]any{
				"press": "accounts", "income": "42", "fee": "7",
				"stripeBalance": "31", "paypalBalance": nil, "chariotBalance": nil,
				"nowpaymentsBalance": nil, "undepositedFunds": nil,
			},
		},
		"the day the books start from": {
			press: QuickbooksPress{Press: "start-date", StartAt: "2026-01-01"},
			sent:  map[string]any{"press": "start-date", "startAt": "2026-01-01"},
		},
		"the day a move of the start date is counted against": {
			press: QuickbooksPress{Press: "start-date-preview", StartAt: "2026-01-01"},
			sent:  map[string]any{"press": "start-date-preview", "startAt": "2026-01-01"},
		},
	} {
		post, press := posting(cf.Answer{
			Kind:   cf.Answered,
			Status: http.StatusOK,
			Body:   map[string]any{"press": one.press.Press},
		})
		PressQuickbooks(context.Background(), post, one.press)
		if body, _ := press.body.(map[string]any); !reflect.DeepEqual(body, one.sent) {
			t.Errorf("%s posted %v, want %v", what, press.body, one.sent)
		}
	}
}

// an account an operator chose, as the page names it.
func picked(id string) *string {
	return &id
}
