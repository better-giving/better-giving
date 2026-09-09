package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// a deployment answering one thing to whatever is posted, and the press it was sent, recorded.
type pressed struct {
	path string
	body any
}

func posting(answer cf.Answer) (cf.Post, *pressed) {
	held := &pressed{}
	return func(_ context.Context, path string, body any) cf.Answer {
		held.path, held.body = path, body
		return answer
	}, held
}

// the report a write answers with is what says the row moved: a 200 carrying anything else is a
// deployment answering a question other than the one asked.
func TestAProfileTheDeploymentStoredIsASave(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"sites":   []any{"https://example.org"},
		"session": map[string]any{"expiresAt": "2026-08-19T12:00:00.000Z"},
	}})

	write := SaveOrg(context.Background(), post, map[string]string{"legal_name": "  Example  "})
	if write.Kind != OrgSaved {
		t.Fatalf("write %+v", write)
	}
	if press.path != OrgPath {
		t.Fatalf("posted to %q", press.path)
	}
	// the whole profile under `org`, as it was typed: the trim and every other rule are the
	// deployment's, and a console that sent its own reading would store a value nobody typed.
	body, _ := press.body.(map[string]any)
	values, _ := body["org"].(map[string]string)
	if len(body) != 1 || values["legal_name"] != "  Example  " {
		t.Fatalf("posted %v", press.body)
	}
}

func TestAProfileAnsweredWithSomethingElseIsNoSave(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"ok": true}})
	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgUnwritten || write.Read.Kind != NoReportUnreadable {
		t.Fatalf("write %+v", write)
	}
}

// keyed by field, so every offending box comes back at once and each sentence lands under the box
// it is about.
func TestARefusedProfileComesBackKeyedByFieldWithBothSentences(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"message": "This organisation profile was not stored.",
		"fix":     "Fix the fields named and send it again.",
		"errors": map[string]any{
			"legal_name":         "Give the organisation's legal name.",
			"notification_email": "That is not an address.",
			// a key this console draws no box for is counted rather than dropped: a deployment newer
			// than the console reading it is the ordinary way that happens.
			"something_later": "Newer than this console.",
			"empty_sentence":  "",
		},
	}})

	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgRefused {
		t.Fatalf("write %+v", write)
	}
	if len(write.Errors) != 2 || write.Errors["legal_name"] == "" || write.Errors["notification_email"] == "" {
		t.Fatalf("errors %v", write.Errors)
	}
	if write.Unread != 2 {
		t.Fatalf("%d keys were counted unread", write.Unread)
	}
	if write.Message == nil || write.Fix == nil {
		t.Fatalf("the two sentences a reader reads were dropped: %+v", write)
	}
}

// a 422 in a shape this was not written against is still a save that did not land.
func TestARefusalCarryingNeitherSentenceIsStillARefusal(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"errors": map[string]any{},
	}})
	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgRefused || write.Message != nil || write.Fix != nil || len(write.Errors) != 0 {
		t.Fatalf("write %+v", write)
	}
}

// a 422 carrying no keyed map at all is a body this console cannot draw under any box, so it is the
// read's own answer rather than a refusal with nothing in it.
func TestA422CarryingNoKeysIsTheReadsOwnAnswer(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"message": "No.",
	}})
	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgUnwritten || write.Read.Kind != NoReportUnreadable {
		t.Fatalf("write %+v", write)
	}
}

// the deployment's own refusal is carried whole: a session it no longer holds, a deployment older
// than the surface and a deployment nothing could reach each have a different way out.
func TestAProfileWriteCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgUnwritten || write.Read.Kind != NoReportRefused {
		t.Fatalf("write %+v", write)
	}
	if write.Read.Fix == nil || *write.Read.Fix != "Connect again." {
		t.Fatalf("read %+v", write.Read)
	}
}

// no session is its own answer rather than a request made with no credential: the state an operator
// is in is that this console has not connected, which is a different sentence from anything the
// deployment would say.
func TestAProfileWriteWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	write := SaveOrg(context.Background(), nil, map[string]string{"legal_name": "Example"})
	if write.Kind != OrgUnwritten || write.Read.Kind != NoSession {
		t.Fatalf("write %+v", write)
	}
}

// the boxes are re-seeded from the write's own answer, so the profile the deployment now holds
// comes back off the press. the reading taken after a press lands one render later than the answer
// does, and boxes re-seeded from it are re-seeded from the profile the press replaced.
func TestASavedProfileComesBackOffTheWriteItself(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"sites":   []any{},
		"session": map[string]any{"expiresAt": "2026-08-19T12:00:00.000Z"},
		"org": map[string]any{
			"legal_name":         "Example",
			"notification_email": "alerts@example.org",
		},
	}})

	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgSaved {
		t.Fatalf("write %+v", write)
	}
	held, mapped := write.Org.(map[string]any)
	if !mapped || held["notification_email"] != "alerts@example.org" {
		t.Fatalf("org %v", write.Org)
	}
}

// a press that stored nothing carries no profile: the boxes are left holding what was typed, so
// there is something to fix.
func TestARefusedProfileCarriesNoProfileBack(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"errors": map[string]any{"legal_name": "Give the organisation's legal name."},
	}})
	write := SaveOrg(context.Background(), post, map[string]string{})
	if write.Kind != OrgRefused || write.Org != nil {
		t.Fatalf("write %+v", write)
	}
}
