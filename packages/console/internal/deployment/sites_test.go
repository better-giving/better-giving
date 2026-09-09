package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// the stored list comes back off the write itself, which is what the boxes are re-seeded from: a
// console reading it back separately could draw the list it has just written from a stale answer.
func TestASavedListIsReadBackOffTheWriteItself(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"sites":   []any{"https://example.org", "https://donate.example.org"},
		"session": map[string]any{"expiresAt": "2026-08-19T12:00:00.000Z"},
	}})

	write := SaveSites(context.Background(), post, []string{"https://example.org"})
	if write.Kind != SitesSaved {
		t.Fatalf("write %+v", write)
	}
	if len(write.Sites) != 2 || write.Sites[0] != "https://example.org" {
		t.Fatalf("stored %v", write.Sites)
	}
	if press.path != SitesPath {
		t.Fatalf("posted to %q", press.path)
	}
	// the whole list with every press, never one row: the endpoint deletes what is not in the body.
	body, _ := press.body.(map[string]any)
	rows, _ := body["sites"].([]string)
	if len(body) != 1 || len(rows) != 1 {
		t.Fatalf("posted %v", press.body)
	}
}

// one sentence and not a map keyed by row: the parse names every offending address inside its own
// message, because an operator who pasted thirty rows has thirty to fix.
func TestAListTheDeploymentTurnedDownCarriesItsOwnSentence(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"message": "example.org — write the scheme too.",
		"fix":     "Fix the addresses named and submit the list again.",
	}})
	write := SaveSites(context.Background(), post, []string{"example.org"})
	if write.Kind != SitesRefused || write.Message == "" || write.Fix == nil {
		t.Fatalf("write %+v", write)
	}
}

func TestARefusalTheDeploymentWroteNoSentenceForStillSaysNothingWasStored(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnprocessableEntity, Body: nil})
	write := SaveSites(context.Background(), post, []string{"example.org"})
	if write.Kind != SitesRefused || write.Message == "" {
		t.Fatalf("write %+v", write)
	}
}

// the forms travel structured rather than as marks inside the sentence, which is what lets the
// screen draw a way to each one instead of an operator reading an id out of prose.
func TestARemovalTheDeploymentWouldNotMakeNamesEveryFormInTheWay(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusConflict, Body: map[string]any{
		"message": "These sites are still listed on a live donation form.",
		"fix":     "Untick them first.",
		"inUse": []any{
			map[string]any{"site": "https://example.org", "forms": []any{
				map[string]any{"id": "form_1", "name": "Winter appeal"},
				// a row that is not a form is dropped rather than drawn as a blank line.
				map[string]any{"id": "form_2"},
			}},
			map[string]any{"forms": []any{}},
		},
	}})

	write := SaveSites(context.Background(), post, []string{})
	if write.Kind != SitesBlocked {
		t.Fatalf("write %+v", write)
	}
	if len(write.InUse) != 1 || write.InUse[0].Site != "https://example.org" {
		t.Fatalf("in use %+v", write.InUse)
	}
	if len(write.InUse[0].Forms) != 1 || write.InUse[0].Forms[0].Name != "Winter appeal" {
		t.Fatalf("forms %+v", write.InUse[0].Forms)
	}
}

func TestASitesWriteCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Unreachable, Detail: "took too long"})
	write := SaveSites(context.Background(), post, []string{})
	if write.Kind != SitesUnwritten || write.Read.Kind != NoReportUnreachable {
		t.Fatalf("write %+v", write)
	}
	if write.Read.Detail != "took too long" {
		t.Fatalf("read %+v", write.Read)
	}
}

func TestASitesWriteWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	write := SaveSites(context.Background(), nil, []string{"https://example.org"})
	if write.Kind != SitesUnwritten || write.Read.Kind != NoSession {
		t.Fatalf("write %+v", write)
	}
}
