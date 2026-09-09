package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the organisation's legal identity, as this console writes it back.
//
// **the deployment is the authority and this states no rule of its own.** what a value may be — the
// caps, which boxes refuse a blank, what an email has to look like — is decided inside the worker
// in one parse, and every refusal it answers with is keyed by the field the operator has to edit.
// so this posts what was typed and carries the sentence that comes back at the box its key names. a
// check written here would be a second opinion about whether a receipt may be printed, and the half
// that drifts is the one nothing reports.
//
// **every box is submitted, every time.** the endpoint reads a profile whole: a field left out of
// the body is stored as cleared, not left alone. that is the opposite of a group of credentials,
// where an empty box means leave this one alone — and the difference is that these values read
// back, so an empty box here is a value an operator can see is empty and meant to clear.
//
// **a press answers with the report, so this console never holds a second view of the profile.**
// the stored profile comes back off the write itself, which is what the boxes are re-seeded from —
// ./sites.go carries its own list back the same way and for the same reason. the reading the page
// takes after a press commits a render later than the answer does, so boxes re-seeded from that
// reading are re-seeded from the profile the press replaced, and nothing seeds them again.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// OrgPath is the path on a deployment that stores an organisation's profile.
const OrgPath = "/console/org"

// OrgWriteKind is how one write of the profile ended.
type OrgWriteKind string

const (
	// OrgSaved is the row moving, which is the only kind that changed anything.
	OrgSaved OrgWriteKind = "saved"
	// OrgRefused is the deployment reading the profile and turning it down.
	OrgRefused OrgWriteKind = "refused"
	// OrgUnwritten is a deployment that never read one, and Read says which way.
	OrgUnwritten OrgWriteKind = "unwritten"
)

// OrgWrite is how one write went.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type OrgWrite struct {
	Kind OrgWriteKind `json:"kind"`
	// Message and Fix are the deployment's own two sentences about a refusal, carried whole the way
	// a report's are: the keyed sentences say which boxes, and the second of these is the only thing
	// on the screen that says how to get out of the state the press left. Either may be nil — a 422
	// in a shape this was not written against is still a save that did not land.
	Message *string `json:"message"`
	Fix     *string `json:"fix"`
	// Errors is one sentence per offending field, so each is drawn under the box it is about and
	// every one of them comes back at once rather than one per round trip.
	Errors map[string]string `json:"errors"`
	// Org is the profile the deployment holds now, read back off the report the write answered
	// with, and nil on every kind but OrgSaved. Carried through unread, the way a reading carries
	// it (./report.go).
	Org any `json:"org"`
	// Unread is how many keys came back that this console draws no box for. Counted rather than
	// dropped: a deployment newer than the console reading it is the ordinary way that happens, and
	// a refusal with nothing on screen to show for it is a save that failed silently.
	Unread int `json:"unread"`
	// Read is which way the deployment never read a profile at all, and nil on every other kind.
	Read *NoReport `json:"read"`
}

// SaveOrg stores the profile, or says why it did not.
//
// The writer is handed in so that every state above can be looked at without a deployment and
// without a network. A nil writer is its own answer rather than a request made with no credential:
// the state an operator is in is that this console has not connected, which is a different sentence
// from anything the deployment would say.
func SaveOrg(ctx context.Context, post cf.Post, values map[string]string) OrgWrite {
	if post == nil {
		return unsaved(NoReport{Kind: NoSession})
	}
	return readOrgWrite(post(ctx, OrgPath, map[string]any{"org": values}))
}

// what the deployment answered a write with, read.
//
// The classification is the report's and is not restated: a write answers with the report, so a 200
// that is an envelope is the save landing and every other answer is one of the states the read
// already has a screen for. What is added in front of it is the one answer only a write gets — the
// refusal keyed by field.
func readOrgWrite(answer cf.Answer) OrgWrite {
	if refused, keyed := fieldErrors(answer); keyed {
		return refused
	}
	read := readReport(answer)
	if read.Kind != Reported {
		return unsaved(read.NoReport)
	}
	return OrgWrite{Kind: OrgSaved, Errors: map[string]string{}, Org: read.Org}
}

// a refusal read whole, or false where the answer carries no keyed map at all.
func fieldErrors(answer cf.Answer) (OrgWrite, bool) {
	if answer.Kind != cf.Answered || answer.Status != http.StatusUnprocessableEntity {
		return OrgWrite{}, false
	}
	body, _ := answer.Body.(map[string]any)
	keyed, mapped := body["errors"].(map[string]any)
	if !mapped {
		return OrgWrite{}, false
	}

	refused := OrgWrite{
		Kind:    OrgRefused,
		Message: text(body["message"]),
		Fix:     text(body["fix"]),
		Errors:  map[string]string{},
	}
	for field, said := range keyed {
		sentence := text(said)
		if sentence == nil || !drawn(field) {
			refused.Unread++
			continue
		}
		refused.Errors[field] = *sentence
	}
	return refused, true
}

// whether this console has a box that sentence could be printed under.
func drawn(field string) bool {
	for _, one := range release.OrgProfileFields {
		if one == field {
			return true
		}
	}
	return false
}

func unsaved(read NoReport) OrgWrite {
	return OrgWrite{Kind: OrgUnwritten, Errors: map[string]string{}, Read: &read}
}
