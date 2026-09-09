package deployment

import (
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// what one write asked cloudflare for, kept so that a case can assert where a value travelled as
// well as that it landed.
type call struct {
	Method string
	Path   string
	// Body is what was sent, whether that is json or one multipart part's bytes.
	Body []byte
}

// a status and the words cloudflare wrote with it, for a failure no error code of its own names.
type turnedDown struct {
	status int
	body   any
}

// a cloudflare answering whatever each method and path is bound to, recording every call.
//
// The three bindings are the same host and the same (absent) credential, because what a case is
// about is the request each write makes rather than how the door was opened.
func door(t *testing.T, answers map[string]any) (Door, *[]call) {
	t.Helper()
	made := []call{}
	// the calls are appended on the server's own goroutine and read on the test's, and the write
	// this fake stands in front of is one a handler makes concurrently with every other.
	var recording sync.Mutex
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		recording.Lock()
		made = append(made, call{Method: r.Method, Path: r.URL.Path, Body: body})
		recording.Unlock()

		answer, named := answers[r.Method+" "+r.URL.Path]
		if !named {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{}})
			return
		}
		if status, ok := answer.(int); ok {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{}})
			return
		}
		if refused, ok := answer.(turnedDown); ok {
			w.WriteHeader(refused.status)
			_ = json.NewEncoder(w).Encode(refused.body)
			return
		}
		_ = json.NewEncoder(w).Encode(answer)
	}))
	t.Cleanup(api.Close)
	return Door{
		AccountID:  account,
		WorkerName: worker,
		Get:        cf.JSONGet(api.URL, nil),
		Patch:      cf.JSONSend(api.URL, nil),
		Settings:   cf.MultipartSend(api.URL, nil),
	}, &made
}

// the bindings one settings patch sent, read back out of the multipart body it went up in.
func patched(t *testing.T, made call) []map[string]any {
	t.Helper()
	opening := strings.Index(string(made.Body), "\r\n")
	if opening < 1 {
		t.Fatalf("the patch carried no multipart body: %q", made.Body)
	}
	boundary := strings.TrimPrefix(string(made.Body[:opening]), "--")
	parts := multipart.NewReader(strings.NewReader(string(made.Body)), boundary)
	for {
		part, err := parts.NextPart()
		if err != nil {
			t.Fatalf("the patch carried no settings part: %v", err)
		}
		if part.FormName() != "settings" {
			continue
		}
		var settings struct {
			Bindings []map[string]any `json:"bindings"`
		}
		if err := json.NewDecoder(part).Decode(&settings); err != nil {
			t.Fatalf("the settings part is not json: %v", err)
		}
		return settings.Bindings
	}
}

// the binding the patch carried for `name`, or nil where it carried none — which is a name deleted.
func binding(list []map[string]any, name string) map[string]any {
	for _, one := range list {
		if one["name"] == name {
			return one
		}
	}
	return nil
}

func varsHeld(bindings ...map[string]any) map[string]any {
	held := []any{}
	for _, one := range bindings {
		held = append(held, one)
	}
	return envelope(map[string]any{"bindings": held})
}

var settingsCall = "GET " + settings

// **the patch replaces the whole binding list, so a name left off it is a name deleted.** what a
// var press must not cost is the ten credentials the deployment charges and signs sessions with,
// its database or its rate limiters — so everything not being written goes back up as `inherit`.
func TestAVarIsReplacedAndEverySecretGoesBackUpAsInherit(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "STRIPE_PUBLISHABLE_KEY", "type": "plain_text", "text": "pk_old"},
			map[string]any{"name": "STRIPE_SECRET_KEY", "type": "secret_text"},
			map[string]any{"name": "DB", "type": "d1", "id": "a-uuid"},
		),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
	})

	written := SetVars(context.Background(), open, map[string]*string{"STRIPE_PUBLISHABLE_KEY": value("pk_new")})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 2 || (*made)[1].Method != http.MethodPatch {
		t.Fatalf("made %d calls, the last %+v", len(*made), (*made)[len(*made)-1])
	}

	list := patched(t, (*made)[1])
	if key := binding(list, "STRIPE_PUBLISHABLE_KEY"); key == nil ||
		key["type"] != "plain_text" || key["text"] != "pk_new" {
		t.Fatalf("the var went up as %+v", key)
	}
	for _, name := range []string{"STRIPE_SECRET_KEY", "DB"} {
		if kept := binding(list, name); kept == nil || kept["type"] != "inherit" {
			t.Fatalf("%s went up as %+v", name, kept)
		}
	}
}

// a value cloudflare hands back is what the press is decided against, so a name already holding
// what was asked for costs no request at all.
func TestAVarAlreadyHoldingWhatWasAskedForIsNotWritten(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"},
		),
	})

	written := SetVars(context.Background(), open, map[string]*string{"TURNSTILE_SITE_KEY": value("0x4")})
	if written.Kind != WriteUnchanged {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 {
		t.Fatalf("a press with nothing to change made %d calls", len(*made))
	}
}

// **a name the deployment holds as a credential is refused rather than written over.** nothing can
// read the stored value back, so there is nothing to compare against, and a worker holding one name
// both ways is not a state this repository says what the app reads from.
func TestAVarHeldAsACredentialRefusesThePressAndNamesIt(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "BETTER_AUTH_URL", "type": "secret_text"},
		),
	})

	written := SetVars(context.Background(), open, map[string]*string{"BETTER_AUTH_URL": value("https://x.test")})
	if written.Kind != WriteWithheld || len(written.Names) != 1 || written.Names[0] != "BETTER_AUTH_URL" {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 {
		t.Fatalf("a press that was refused made %d calls", len(*made))
	}
}

// a var the deployment holds nothing under is added, which is every one of the three before the
// press that sets it.
func TestAVarNoBindingCarriesIsAddedToTheList(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall:        varsHeld(map[string]any{"name": "DB", "type": "d1", "id": "a-uuid"}),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
	})

	if written := SetVars(context.Background(), open, map[string]*string{"TURNSTILE_SITE_KEY": value("0x4")}); written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	list := patched(t, (*made)[1])
	if added := binding(list, "TURNSTILE_SITE_KEY"); added == nil ||
		added["type"] != "plain_text" || added["text"] != "0x4" {
		t.Fatalf("the var went up as %+v", added)
	}
	if kept := binding(list, "DB"); kept == nil || kept["type"] != "inherit" {
		t.Fatalf("the database went up as %+v", kept)
	}
}

// **every name a chain publishes goes up carrying its own value.** what Stored hands over is a
// pointer per name, and one shared across them would write whichever value the map was walked to
// last onto all of them.
func TestEveryPublishedValueGoesUpUnderItsOwnName(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall:        varsHeld(),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
	})

	published := map[string]string{"TURNSTILE_SITE_KEY": "0x4", "TURNSTILE_SECRET_KEY": "0x9"}
	if written := SetVars(context.Background(), open, Stored(published)); written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	list := patched(t, (*made)[1])
	for name, published := range published {
		if up := binding(list, name); up == nil || up["text"] != published {
			t.Fatalf("%s went up as %+v", name, up)
		}
	}
}

// **a name mapped to nil is left off the patched list, which is the binding gone from the new
// version.** it is how a value comes off a deployment at all: emptying a box is a removal, and
// every other binding is still inherited by the same press.
func TestANulledVarIsLeftOffTheListAndEveryOtherBindingIsKept(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "SMTP_PASSWORD", "type": "plain_text", "text": "a-password"},
			map[string]any{"name": "DB", "type": "d1", "id": "a-uuid"},
		),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
	})

	written := SetVars(context.Background(), open, map[string]*string{"SMTP_PASSWORD": nil})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	list := patched(t, (*made)[1])
	if gone := binding(list, "SMTP_PASSWORD"); gone != nil {
		t.Fatalf("the removed var went up as %+v", gone)
	}
	if kept := binding(list, "DB"); kept == nil || kept["type"] != "inherit" {
		t.Fatalf("the database went up as %+v", kept)
	}
}

// a name the read says holds nothing is already off, so emptying a box nobody had filled costs no
// request at all — the same reading a name already at its value is decided against.
func TestANulledVarTheDeploymentHoldsNothingUnderIsNotAChange(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"},
		),
	})

	written := SetVars(context.Background(), open, map[string]*string{"SMTP_PASSWORD": nil})
	if written.Kind != WriteUnchanged {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 {
		t.Fatalf("a press with nothing to change made %d calls", len(*made))
	}
}

// **a name held as a credential is taken off like any other, and does not earn the refusal a write
// of it does.** that refusal is there so a value is not stored over a credential and there is
// nothing to compare a stored one against — a removal stores none and needs no comparison. it
// travels through the credential door: `null` on secrets-bulk is what cloudflare documents as a
// deletion, and a settings patch that merely leaves the binding out says nothing about the secret
// behind it.
func TestANulledVarHeldAsACredentialIsDeletedThroughTheCredentialDoor(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "ADMIN_PASSWORD", "type": "secret_text"},
			map[string]any{"name": "DB", "type": "d1", "id": "a-uuid"},
		),
		bulk: envelope(map[string]any{}),
	})

	written := SetVars(context.Background(), open, map[string]*string{"ADMIN_PASSWORD": nil})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 2 || (*made)[1].Path != bulkPath {
		t.Fatalf("made %+v", *made)
	}
	carried := sent(t, (*made)[1])
	if len(carried) != 1 {
		t.Fatalf("the patch named %v", carried)
	}
	if freed, named := carried["ADMIN_PASSWORD"]; !named || freed != nil {
		t.Fatalf("the removal went up as %+v", freed)
	}
}

// **the settings patch goes first, carrying the credential back up as `inherit`.** its binding list
// is built from the read in front of it, so a deletion made before it would send a list claiming to
// inherit a binding the deployment no longer holds.
func TestAPressTakingOffBothKindsPatchesTheSettingsFirst(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "ADMIN_PASSWORD", "type": "secret_text"},
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"},
		),
		"PATCH " + settings: envelope(map[string]any{"bindings": []any{}}),
		bulk:                envelope(map[string]any{}),
	})

	written := SetVars(context.Background(), open, map[string]*string{
		"ADMIN_PASSWORD":     nil,
		"TURNSTILE_SITE_KEY": value("0x9"),
	})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 3 || (*made)[1].Path != settings || (*made)[2].Path != bulkPath {
		t.Fatalf("made %+v", *made)
	}
	list := patched(t, (*made)[1])
	if kept := binding(list, "ADMIN_PASSWORD"); kept == nil || kept["type"] != "inherit" {
		t.Fatalf("the credential went up as %+v", kept)
	}
	if set := binding(list, "TURNSTILE_SITE_KEY"); set == nil || set["text"] != "0x9" {
		t.Fatalf("the var went up as %+v", set)
	}
	if carried := sent(t, (*made)[2]); len(carried) != 1 {
		t.Fatalf("the deletion named %v", carried)
	}
}

// a settings patch that did not land takes no credential off: the press stops at the call that
// failed, so what an operator presses again is decided against the deployment the read found.
func TestAPressWhoseSettingsPatchDidNotLandFreesNothing(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "ADMIN_PASSWORD", "type": "secret_text"},
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"},
		),
		"PATCH " + settings: failed(10000, "Authentication error"),
		bulk:                envelope(map[string]any{}),
	})

	written := SetVars(context.Background(), open, map[string]*string{
		"ADMIN_PASSWORD":     nil,
		"TURNSTILE_SITE_KEY": value("0x9"),
	})
	if written.Kind != WriteRefused {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 2 {
		t.Fatalf("a press that stopped at the patch made %+v", *made)
	}
}

// a worker that is not in the account is nowhere to write to rather than a failure, which is every
// run before a first deploy.
func TestAWriteAgainstAWorkerThatIsNotThereIsNowhere(t *testing.T) {
	open, _ := door(t, map[string]any{settingsCall: failed(10007, "script not found")})

	written := SetVars(context.Background(), open, map[string]*string{"TURNSTILE_SITE_KEY": value("0x4")})
	if written.Kind != WriteNowhere || written.Address == nil || written.Address.Kind != "not-deployed" {
		t.Fatalf("wrote %+v", written)
	}
}

// cloudflare turning this sign-in down is its own state: the way out is another account rather than
// another press.
func TestAPatchCloudflareRefusesIsReportedAsARefusal(t *testing.T) {
	open, _ := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x0"},
		),
		"PATCH " + settings: failed(10000, "Authentication error"),
	})

	written := SetVars(context.Background(), open, map[string]*string{"TURNSTILE_SITE_KEY": value("0x4")})
	if written.Kind != WriteRefused || written.Detail == "" {
		t.Fatalf("wrote %+v", written)
	}
}

var (
	bulk     = "PATCH /accounts/" + account + "/workers/scripts/" + worker + "/secrets-bulk"
	bulkPath = secretsBulkPath(account, worker)
)

// the secrets a merge patch carried, keyed by name, with nil for the names it deletes.
func sent(t *testing.T, made call) map[string]any {
	t.Helper()
	var body struct {
		Secrets map[string]any `json:"secrets"`
	}
	if err := json.Unmarshal(made.Body, &body); err != nil {
		t.Fatalf("the patch is not json: %v", err)
	}
	return body.Secrets
}

func value(one string) *string { return &one }

// **one save of a group is one request, and a name the body does not mention is left as it was.**
// setting and clearing travel together, which is what makes a group holding one of each still one
// press. the value stored is this console's own session, because that is the only value this door
// stores: a configuration value reaches it as the `null` that takes it off.
func TestAGroupOfCredentialsGoesUpAsOneMergePatch(t *testing.T) {
	open, made := door(t, map[string]any{bulk: envelope(map[string]any{})})

	written := SetSecrets(context.Background(), open, map[string]*string{
		ConsoleTokenName: value("a-session"),
		"SMTP_PASSWORD":  nil,
	})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 || (*made)[0].Path != bulkPath {
		t.Fatalf("made %+v", *made)
	}

	carried := sent(t, (*made)[0])
	if len(carried) != 2 {
		t.Fatalf("the patch named %d credentials", len(carried))
	}
	stored, ok := carried[ConsoleTokenName].(map[string]any)
	if !ok || stored["text"] != "a-session" || stored["type"] != "secret_text" {
		t.Fatalf("the value went up as %+v", carried[ConsoleTokenName])
	}
	if cleared, named := carried["SMTP_PASSWORD"]; !named || cleared != nil {
		t.Fatalf("the removal went up as %+v", cleared)
	}
}

// **no value reaches a path or a method, whatever a screen goes on to draw.** the whole of the
// request is a body over https, so there is nothing in the address for a log or a proxy to keep.
func TestACredentialTravelsInTheBodyAndNowhereElse(t *testing.T) {
	open, made := door(t, map[string]any{bulk: envelope(map[string]any{})})

	SetSecrets(context.Background(), open, map[string]*string{ConsoleTokenName: value("a-password")})

	if strings.Contains((*made)[0].Path, "a-password") || strings.Contains((*made)[0].Method, "a-password") {
		t.Fatalf("the value was in %s %s", (*made)[0].Method, (*made)[0].Path)
	}
}

// a merge patch naming nothing changes nothing and answers 200, which a reader keying on the status
// would draw as a save that happened.
func TestAPressWithNothingToSendAsksCloudflareNothing(t *testing.T) {
	open, made := door(t, map[string]any{bulk: envelope(map[string]any{})})

	if written := SetSecrets(context.Background(), open, map[string]*string{}); written.Kind != WriteNothing {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 0 {
		t.Fatalf("a press with nothing to send made %+v", *made)
	}
}

// cloudflare answering in a shape nothing was written against is still a credential that was
// stored: nothing is read off the answer, and reporting it as a failure would tell an operator to
// type it again.
func TestASuccessInAnUnreadShapeIsStillStored(t *testing.T) {
	open, _ := door(t, map[string]any{bulk: "not the shape anything was written against"})

	written := SetSecrets(context.Background(), open, map[string]*string{ConsoleTokenName: value("a-session")})
	if written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
}

// a cloudflare that answered and would not store them is its own state, in its own words: the way
// out is neither another account nor another press.
func TestACloudflareThatWouldNotStoreThemSaysSo(t *testing.T) {
	open, _ := door(t, map[string]any{
		bulk: turnedDown{http.StatusBadRequest, failed(10021, "binding name not valid")},
	})

	written := SetSecrets(context.Background(), open, map[string]*string{ConsoleTokenName: value("a-session")})
	if written.Kind != WriteFailed || written.Detail == "" {
		t.Fatalf("wrote %+v", written)
	}
}

// **which names are freed is read off cloudflare and never posted**, so the press carries no name
// at all and only the vars held as credentials are deleted.
func TestFreeingAVarDeletesTheOnesHeldAsCredentialsAndNothingElse(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(
			map[string]any{"name": "BETTER_AUTH_URL", "type": "secret_text"},
			map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"},
			map[string]any{"name": "ADMIN_PASSWORD", "type": "secret_text"},
		),
		bulk: envelope(map[string]any{}),
	})

	if written := FreeWithheldVars(context.Background(), open); written.Kind != WriteSet {
		t.Fatalf("wrote %+v", written)
	}
	carried := sent(t, (*made)[1])
	if len(carried) != 2 {
		t.Fatalf("the patch named %v", carried)
	}
	for _, name := range []string{"BETTER_AUTH_URL", "ADMIN_PASSWORD"} {
		if freed, named := carried[name]; !named || freed != nil {
			t.Fatalf("%s went up as %+v", name, freed)
		}
	}
	if _, named := carried["TURNSTILE_SITE_KEY"]; named {
		t.Error("a name the deployment holds as a var was deleted")
	}
}

// a read that came back in none of its ways found nothing out, and a deletion made on that would be
// a credential destroyed over a claim nothing made.
func TestAVarsReadThatDidNotLandFreesNothing(t *testing.T) {
	open, made := door(t, map[string]any{settingsCall: failed(10000, "Authentication error")})

	if written := FreeWithheldVars(context.Background(), open); written.Kind != WriteRefused {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 {
		t.Fatalf("a press that freed nothing made %+v", *made)
	}
}

// the state the press was offered under is gone, which is a page a moment out of date rather than a
// fault.
func TestFreeingWhereNoVarIsHeldAsACredentialAsksCloudflareNothing(t *testing.T) {
	open, made := door(t, map[string]any{
		settingsCall: varsHeld(map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "0x4"}),
	})

	if written := FreeWithheldVars(context.Background(), open); written.Kind != WriteNothing {
		t.Fatalf("wrote %+v", written)
	}
	if len(*made) != 1 {
		t.Fatalf("a press with nothing to free made %+v", *made)
	}
}

// the session goes up under one name, so everything this deployment holds beside it is left exactly
// as it is.
func TestWritingTheSessionNamesItAndNothingElse(t *testing.T) {
	var sent map[string]any
	var at string
	door := Door{
		AccountID:  "acc",
		WorkerName: "better-giving",
		Patch: func(_ context.Context, _, path string, body any) cf.Answer {
			at = path
			sent, _ = body.(map[string]any)
			return cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: envelope(map[string]any{})}
		},
	}

	if written := WriteConsoleToken(context.Background(), door, "bg1.1.secret"); written.Kind != WriteSet {
		t.Fatalf("written %+v", written)
	}
	if at != "/accounts/acc/workers/scripts/better-giving/secrets-bulk" {
		t.Fatalf("written at %q", at)
	}
	secrets, ok := sent["secrets"].(map[string]any)
	if !ok || len(secrets) != 1 {
		t.Fatalf("sent %v", sent)
	}
	held, ok := secrets[ConsoleTokenName].(map[string]any)
	if !ok || held["text"] != "bg1.1.secret" || held["type"] != "secret_text" {
		t.Fatalf("sent %v", secrets)
	}
}
