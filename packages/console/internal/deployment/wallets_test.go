package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// one hostname the press left where it wants it, in the shape the deployment reports it.
func levelled(host string, changed bool, detail any) map[string]any {
	return map[string]any{
		"line": map[string]any{
			"host": host, "own": false, "standing": "drawing", "wallets": drawing(),
		},
		"changed": changed,
		"detail":  detail,
	}
}

// one hostname's failure stops no other: the press acts on a list, so a word covering all of them
// would have to be either the best or the worst of them.
func TestALevellingCarriesALinePerHostnameWithWhatThePressDidToIt(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"state": "levelled",
		"hosts": []any{
			levelled("w.acct.workers.dev", true, nil),
			levelled("hound-haven.org", false, "Stripe would not take this hostname."),
		},
	}})

	level := LevelWallets(context.Background(), post)
	if level.Kind != WalletsLevelReported || level.Report.State != "levelled" {
		t.Fatalf("level %+v", level)
	}
	if press.path != WalletDomainsPath {
		t.Fatalf("pressed %q", press.path)
	}
	// nothing is posted with it: a hostname that travelled through a page would be a registration
	// made on the operator's own account against whatever the page said.
	if body, _ := press.body.(map[string]any); len(body) != 0 {
		t.Fatalf("posted %v", press.body)
	}
	hosts := level.Report.Hosts
	if len(hosts) != 2 || hosts[0].Line.Host != "w.acct.workers.dev" || !hosts[0].Changed {
		t.Fatalf("hosts %+v", hosts)
	}
	if hosts[1].Changed || hosts[1].Detail == nil ||
		*hosts[1].Detail != "Stripe would not take this hostname." {
		t.Fatalf("the sentence for a hostname the press could not move was dropped: %+v", hosts[1])
	}
	if hosts[0].Detail != nil {
		t.Fatal("a hostname the press moved was given a sentence")
	}
}

// the read that opens the press is the only failure of the whole press: it has to know what the
// account held before it can say what it changed, so nothing was attempted at all.
func TestALevellingTheDeploymentCouldNotOpenKeepsItsReasonAndItsSentence(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError,
		Body: map[string]any{
			"state": "unreadable", "reason": "failed", "detail": "Stripe refused the key.",
		}})

	level := LevelWallets(context.Background(), post)
	if level.Kind != WalletsLevelReported || level.Report.State != "unreadable" {
		t.Fatalf("level %+v", level)
	}
	if level.Report.Reason != "failed" || level.Report.Detail != "Stripe refused the key." {
		t.Fatalf("report %+v", level.Report)
	}
	if len(level.Report.Hosts) != 0 {
		t.Fatal("a press that attempted nothing reported hostnames")
	}
	if level.AwaitsKey() {
		t.Fatal("a key the processor refused was read as one the deployment has not picked up")
	}
}

// the write landed seconds earlier and the edge has not caught up, which is the deployment saying
// to press again rather than a refusal an operator has anything to do about.
func TestADeploymentHoldingNoKeyYetIsToldFromEveryOtherWayThePressDidNotOpen(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError,
		Body: map[string]any{
			"state": "unreadable", "reason": "no_key", "detail": "Set `STRIPE_SECRET_KEY`.",
		}})

	level := LevelWallets(context.Background(), post)
	if level.Kind != WalletsLevelReported || !level.AwaitsKey() {
		t.Fatalf("level %+v", level)
	}
}

func TestALevellingThisConsoleCannotDrawIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"a state nothing is drawn for":       map[string]any{"state": "pending"},
		"an unreadable arm with no reason":   map[string]any{"state": "unreadable", "detail": "No."},
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable", "reason": "failed"},
		"an unreadable arm with a reason nothing is drawn for": map[string]any{
			"state": "unreadable", "reason": "elsewhere", "detail": "No.",
		},
		"a levelled arm with no list": map[string]any{"state": "levelled"},
		"a line that is not a line":   map[string]any{"state": "levelled", "hosts": []any{"a-host"}},
		"a line that does not say whether the press moved it": map[string]any{
			"state": "levelled",
			"hosts": []any{map[string]any{"line": map[string]any{
				"host": "hound-haven.org", "own": false, "standing": "unregistered",
			}}},
		},
		"a line this console has no standing for": map[string]any{
			"state": "levelled",
			"hosts": []any{map[string]any{
				"line":    map[string]any{"host": "hound-haven.org", "own": false, "standing": "pending"},
				"changed": false,
			}},
		},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		level := LevelWallets(context.Background(), post)
		if level.Kind != WalletsLevelUnanswered || level.Read.Kind != NoReportUnreadable {
			t.Errorf("a levelling carrying %s was read as one", what)
		}
	}
}

func TestAWalletsPressCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	level := LevelWallets(context.Background(), post)
	if level.Kind != WalletsLevelUnanswered || level.Read.Kind != NoReportRefused {
		t.Fatalf("level %+v", level)
	}
}

func TestAWalletsPressWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	level := LevelWallets(context.Background(), nil)
	if level.Kind != WalletsLevelUnanswered || level.Read.Kind != NoSession {
		t.Fatalf("level %+v", level)
	}
}
