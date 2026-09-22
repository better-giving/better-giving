package deployment

import (
	"context"
	"net/http"
	"reflect"
	"slices"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// a key as the deployment mints one, which only the answer to the press that made it carries.
const zapierKey = "bgz_q7Rk3vYh0cXw9LmN2pAe5sTu8jBf1gHd4iKo6lZyC0M"

// a key made and two Zaps listening on it, with a delivery owed.
func zapierKeyed() map[string]any {
	return map[string]any{
		"key":       map[string]any{"madeAt": "2026-09-01T09:00:00.000Z"},
		"listening": map[string]any{"newGift": float64(2), "newDonor": float64(1)},
		"deliveries": map[string]any{
			"waiting": float64(3), "failed": float64(1),
			"oldestWaitingAt": "2026-09-20T12:00:00.000Z",
		},
	}
}

// what every fork that has never made a key answers, which is the ordinary state of this wire.
func zapierUnkeyed() map[string]any {
	return map[string]any{
		"key":       nil,
		"listening": map[string]any{"newGift": float64(0), "newDonor": float64(0)},
		"deliveries": map[string]any{
			"waiting": float64(0), "failed": float64(0), "oldestWaitingAt": nil,
		},
	}
}

// a press that landed, and one the key's own state turned down: both are 200s the deployment wrote.
func zapierPressReports() []map[string]any {
	return []map[string]any{
		{
			"ok": true, "press": "replace", "key": zapierKey,
			"madeAt": "2026-09-22T10:00:00.000Z", "disconnected": float64(3),
		},
		{
			"ok": false, "press": "make",
			"detail": "This deployment already has a Zapier key. Press replace to make a new one.",
		},
	}
}

// every name packages/operator/src/console/zapier.ts states, somewhere across the fixtures above,
// and no name it does not: ./quickbooks_test.go's sweep and its reason.
func TestTheZapierFixturesAreTheShapeTheDeploymentAnswersWith(t *testing.T) {
	stated := everyMember(wire(t, "zapier.ts"))
	keys := map[string]bool{}
	for _, fixture := range append(
		[]map[string]any{zapierKeyed(), zapierUnkeyed()}, zapierPressReports()...,
	) {
		keysInto(fixture, keys)
	}
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

func TestAZapierReadWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	read := ReadZapier(context.Background(), nil)
	if read.Kind != ZapierUnread || read.Read == nil || read.Read.Kind != NoSession {
		t.Fatalf("read %+v", read)
	}
}

func TestAZapierReadCarriesTheDeploymentsWholeReport(t *testing.T) {
	for _, report := range []map[string]any{zapierKeyed(), zapierUnkeyed()} {
		get, asked := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report})
		read := ReadZapier(context.Background(), get)
		if read.Kind != ZapierWasRead || read.Read != nil {
			t.Fatalf("read %+v", read)
		}
		if asked.path != ZapierPath {
			t.Fatalf("asked %q", asked.path)
		}
		if held := carried(t, read.Report); !reflect.DeepEqual(held, report) {
			t.Fatalf("carried %+v, want %+v", held, report)
		}
	}
}

func TestAZapierReadThatFoundNothingOutSaysWhatItFound(t *testing.T) {
	for want, answer := range map[ReportKind]cf.Answer{
		NoReportUnreachable: {Kind: cf.Unreachable, Detail: "dial tcp: connection refused"},
		NoSurface:           {Kind: cf.Answered, Status: http.StatusNotFound},
		NoReportRefused: {Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
			"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
		}},
	} {
		get, _ := asking(answer)
		read := ReadZapier(context.Background(), get)
		if read.Kind != ZapierUnread || read.Read == nil || read.Read.Kind != want {
			t.Errorf("%s was read %+v", want, read)
		}
	}
}

// listening is on the report in every state of the key, so an answer without it is a body written
// against another question.
func TestAZapierAnswerWithNoListeningOnItIsNotAReport(t *testing.T) {
	for what, body := range map[string]any{
		"a key and nothing else":  map[string]any{"key": nil},
		"listening that is a sum": map[string]any{"key": nil, "listening": float64(3)},
		"a body that is an array": []any{zapierUnkeyed()},
		"the quickbooks report":   map[string]any{"connection": map[string]any{}},
	} {
		get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		if read := ReadZapier(context.Background(), get); read.Kind != ZapierUnread {
			t.Errorf("an answer carrying %s was read as a report", what)
		}
	}
}

func TestAZapierPressWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	pressed := PressZapier(context.Background(), nil, "make")
	if pressed.Kind != ZapierUnanswered || pressed.Read == nil || pressed.Read.Kind != NoSession {
		t.Fatalf("pressed %+v", pressed)
	}
}

// a refusal by the key's own state is a report like a press that landed: the deployment answered
// 200 and said why, and the page draws it at the control that was pressed.
func TestAZapierPressCarriesTheDeploymentsWholeReportLandedOrRefused(t *testing.T) {
	for _, report := range zapierPressReports() {
		named, _ := report["press"].(string)
		post, sent := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report})
		pressed := PressZapier(context.Background(), post, named)
		if pressed.Kind != ZapierReported || pressed.Read != nil {
			t.Fatalf("pressed %+v", pressed)
		}
		if sent.path != ZapierPath {
			t.Fatalf("pressed %q", sent.path)
		}
		if body, _ := sent.body.(map[string]any); !reflect.DeepEqual(body, map[string]any{"press": named}) {
			t.Fatalf("posted %v", sent.body)
		}
		if held := carried(t, pressed.Report); !reflect.DeepEqual(held, report) {
			t.Fatalf("carried %+v, want %+v", held, report)
		}
	}
}

// a make that may have landed and was never answered is the case this arm exists for: the key it
// minted is gone, and the next read says whether one was made.
func TestAZapierPressThatFoundNothingOutSaysWhatItFound(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Unreachable, Detail: "context deadline exceeded"})
	pressed := PressZapier(context.Background(), post, "make")
	if pressed.Kind != ZapierUnanswered || pressed.Read == nil || pressed.Read.Kind != NoReportUnreachable {
		t.Fatalf("pressed %+v", pressed)
	}
}

func TestAZapierAnswerThatIsNotAboutThePressSentIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"no press at all":         map[string]any{"ok": true, "key": zapierKey},
		"the other press":         map[string]any{"ok": true, "press": "replace", "key": zapierKey},
		"a press that is a list":  map[string]any{"press": []any{"make"}},
		"a body that is an array": []any{map[string]any{"press": "make"}},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		if pressed := PressZapier(context.Background(), post, "make"); pressed.Kind != ZapierUnanswered {
			t.Errorf("a press answering %s was read as reported", what)
		}
	}
}
