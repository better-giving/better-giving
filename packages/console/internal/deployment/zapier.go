package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
)

// the one key Zapier presents to this deployment and the Zaps listening on it, as this console reads
// where they stand and passes on the make or replace an operator pressed.
//
// **both reports are carried through rather than read**, ./quickbooks.go's arrangement and its
// reason: nothing here branches on a line of either, and what the lines are called is
// packages/operator/src/console/zapier.ts's.
//
// **a refused press is a report.** the deployment answers a make over a key that exists, or a
// replace with none to replace, 200 with `ok: false` and the sentence naming the press that would
// have landed — so what reaches the page is the reported arm either way, and only a press that
// never got a 200 back is unanswered.
//
// **the press answer carries the plaintext key**, and it is in this answer and no other: the
// deployment keeps a hash. so neither body is logged, stored or copied anywhere by this binary —
// it is handed to the page and dropped. a make that timed out has lost its key for good, and the
// next read says whether one was made.
//
// every failure is a value, for the reason ./quickbooks.go states.

// ZapierPath is the path on a deployment that reads the key's standing and makes or replaces it.
const ZapierPath = "/console/zapier"

// ZapierReadKind is how one read of the key's standing ended.
type ZapierReadKind string

const (
	// ZapierWasRead is the only kind carrying anything about the key.
	ZapierWasRead ZapierReadKind = "read"
	// ZapierUnread is nothing coming back that says where it stands, and Read says why.
	ZapierUnread ZapierReadKind = "unread"
)

// ZapierRead is where the key and its Zaps stand, or which way that was not read.
type ZapierRead struct {
	Kind   ZapierReadKind `json:"kind"`
	Report any            `json:"report"`
	Read   *NoReport      `json:"read"`
}

// ReadZapier asks where this deployment's Zapier key stands, or says why it could not.
//
// A nil reader is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func ReadZapier(ctx context.Context, get cf.Get) ZapierRead {
	if get == nil {
		read := NoReport{Kind: NoSession}
		return ZapierRead{Kind: ZapierUnread, Read: &read}
	}
	answer := get(ctx, ZapierPath)
	if report := zapierReport(answer); report != nil {
		return ZapierRead{Kind: ZapierWasRead, Report: report}
	}
	read := readNoReport(answer)
	return ZapierRead{Kind: ZapierUnread, Read: &read}
}

// ZapierPressKind is how one make or replace ended.
type ZapierPressKind string

const (
	// ZapierReported is the deployment saying what the press did, or why it did nothing.
	ZapierReported ZapierPressKind = "reported"
	// ZapierUnanswered is nothing coming back that says, and Read says why.
	ZapierUnanswered ZapierPressKind = "unanswered"
)

// ZapierPressed is how one press went.
type ZapierPressed struct {
	Kind   ZapierPressKind `json:"kind"`
	Report any             `json:"report"`
	Read   *NoReport       `json:"read"`
}

// PressZapier asks the deployment to make or replace its key, and says why nothing came back.
//
// The press is forwarded by name and never checked against a list here: the deployment refuses a
// name it does not take, which arrives as a non-200 and therefore as unanswered.
func PressZapier(ctx context.Context, post cf.Post, press string) ZapierPressed {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return ZapierPressed{Kind: ZapierUnanswered, Read: &read}
	}
	answer := post(ctx, ZapierPath, map[string]any{"press": press})
	if report := pressReport(answer, press); report != nil {
		return ZapierPressed{Kind: ZapierReported, Report: report}
	}
	read := readNoReport(answer)
	return ZapierPressed{Kind: ZapierUnanswered, Read: &read}
}

// the answer as a report, or nil where it is not one.
//
// Listening is what says this came from that surface: the key is null before one is made, and the
// counts are on the report in every state of it.
func zapierReport(answer cf.Answer) any {
	if answer.Kind != cf.Answered || answer.Status != http.StatusOK {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	if _, held := body["listening"].(map[string]any); !held {
		return nil
	}
	return body
}
