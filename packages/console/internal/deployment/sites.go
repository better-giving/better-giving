package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
)

// the sites this deployment's donation forms may be loaded on, as this console writes them back.
//
// **the rule is read in front of the press and it is not read here.** what a site may be — the
// scheme, the trailing slash, the wildcard, the count cap — is one module both ends read, and the
// browser applies it to the boxes before anything is posted (packages/console-ui/src/lib/sites.ts).
// a second reading in this binary would be a third statement of it, and the half that drifts is the
// one nothing reports. **the console reading it first is a courtesy to the operator and never a
// replacement for the boundary**: that path is reachable by anything holding a session, so the
// worker parses every list it is sent whatever asked it to — and its refusal arrives here as one of
// the arms below.
//
// **the whole list goes with every press, never one row.** the endpoint stores a list and deletes
// what is not in it inside the same batch, so a row left out of the body is a site removed. that is
// also why a removal can be refused: a site still ticked on a live donation form is one the
// deployment will not drop, and it answers naming every form standing in the way.
//
// **a press answers with the report, so this console never holds a second view of the list.** the
// stored list comes back off the write itself, which is what the boxes are re-seeded from.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// SitesPath is the path on a deployment that stores its site list.
const SitesPath = "/console/sites"

// SitesWriteKind is how one write of the list ended.
type SitesWriteKind string

const (
	// SitesSaved is the list moving, which is the only kind that changed the deployment.
	SitesSaved SitesWriteKind = "saved"
	// SitesRefused is the deployment reading the list against the rule and turning it down.
	SitesRefused SitesWriteKind = "refused"
	// SitesBlocked is a site still listed on a live donation form, so the whole list was kept.
	SitesBlocked SitesWriteKind = "blocked"
	// SitesUnwritten is a deployment that never read one, and Read says which way.
	SitesUnwritten SitesWriteKind = "unwritten"
)

// BlockingForm is one donation form standing in the way of a removal, as the endpoint names it.
type BlockingForm struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// BlockedSite is one site that could not be removed, and every form still listing it.
type BlockedSite struct {
	Site  string         `json:"site"`
	Forms []BlockingForm `json:"forms"`
}

// SitesWrite is how one write went.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type SitesWrite struct {
	Kind SitesWriteKind `json:"kind"`
	// Sites is the list the deployment holds now, read back off the report the write answered with.
	Sites []string `json:"sites"`
	// Message is the deployment's own sentence about a refusal or a removal it would not make, and
	// Fix its second — the only thing on the screen that says how to get out of the state.
	Message string  `json:"message"`
	Fix     *string `json:"fix"`
	// InUse is every site a live donation form still lists, on SitesBlocked alone.
	InUse []BlockedSite `json:"inUse"`
	// Read is which way the deployment never read a list at all, and nil on every other kind.
	Read *NoReport `json:"read"`
}

// SaveSites stores the list, or says why it did not.
//
// The list is posted as it was typed, never as anything here parsed it: the trim, the blank-row
// skip and the dedupe are the deployment's to make over what it stores, and a console that sent its
// own reading would be storing a list nobody typed.
//
// A nil writer is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func SaveSites(ctx context.Context, post cf.Post, sites []string) SitesWrite {
	if post == nil {
		return unstored(NoReport{Kind: NoSession})
	}
	return readSitesWrite(post(ctx, SitesPath, map[string]any{"sites": sites}))
}

// what the deployment answered a write with, read.
//
// The classification is the report's and is not restated. What is added in front of it is the two
// answers only this write gets — the refusal, and the removal the deployment would not make.
func readSitesWrite(answer cf.Answer) SitesWrite {
	body, _ := answer.Body.(map[string]any)
	if answer.Kind == cf.Answered && answer.Status == http.StatusUnprocessableEntity {
		return SitesWrite{
			Kind:    SitesRefused,
			Sites:   []string{},
			Message: said(body, "This deployment turned the list down and said nothing this console could read."),
			Fix:     text(body["fix"]),
			InUse:   []BlockedSite{},
		}
	}
	if answer.Kind == cf.Answered && answer.Status == http.StatusConflict {
		return SitesWrite{
			Kind:    SitesBlocked,
			Sites:   []string{},
			Message: said(body, "A site on this list is still in use by a donation form, so nothing was saved."),
			Fix:     text(body["fix"]),
			InUse:   blockedSites(body["inUse"]),
		}
	}

	read := readReport(answer)
	if read.Kind != Reported {
		return unstored(read.NoReport)
	}
	return SitesWrite{Kind: SitesSaved, Sites: read.Sites, InUse: []BlockedSite{}}
}

// the forms the endpoint named, read one row at a time.
//
// The member arrived off a network: a row that is not a form is dropped rather than drawn, and the
// sentence beside it is the deployment's own either way.
func blockedSites(value any) []BlockedSite {
	listed, ok := value.([]any)
	if !ok {
		return []BlockedSite{}
	}
	blocked := []BlockedSite{}
	for _, entry := range listed {
		held, mapped := entry.(map[string]any)
		if !mapped {
			continue
		}
		site := text(held["site"])
		if site == nil {
			continue
		}
		rows, _ := held["forms"].([]any)
		forms := []BlockingForm{}
		for _, row := range rows {
			form, mapped := row.(map[string]any)
			if !mapped {
				continue
			}
			name := text(form["name"])
			if name == nil {
				continue
			}
			id, _ := form["id"].(string)
			forms = append(forms, BlockingForm{ID: id, Name: *name})
		}
		blocked = append(blocked, BlockedSite{Site: *site, Forms: forms})
	}
	return blocked
}

// the deployment's own sentence, or this console's where it wrote none readable.
func said(body map[string]any, otherwise string) string {
	if wrote := text(body["message"]); wrote != nil {
		return *wrote
	}
	return otherwise
}

func unstored(read NoReport) SitesWrite {
	return SitesWrite{Kind: SitesUnwritten, Sites: []string{}, InUse: []BlockedSite{}, Read: &read}
}
