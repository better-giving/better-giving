package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// what a whole report off that surface looks like, with each member named by the case that varies
// it: all four have to be readable for any of them to be drawn.
func report(rails, webhook, subscription, wallets any) map[string]any {
	return map[string]any{
		"rails": rails, "webhook": webhook, "subscription": subscription, "wallets": wallets,
	}
}

func readRails(lines ...any) map[string]any {
	return map[string]any{"state": "read", "chargesEnabled": true, "rails": lines}
}

func readWallets(hosts ...any) map[string]any {
	return map[string]any{"state": "read", "hosts": hosts}
}

// every wallet drawn on a hostname, which is what a line the press has finished with carries.
func drawing() map[string]any {
	held := map[string]any{}
	for _, wallet := range release.Wallets {
		held[wallet] = map[string]any{"state": "active", "detail": nil}
	}
	return held
}

var verifying = map[string]any{"state": "verifying", "detail": nil}

func TestTheWaysOfPayingComeBackInTheOrderTheDeploymentSentThem(t *testing.T) {
	get, asked := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(
			map[string]any{"rail": "card", "label": "Card", "standing": "approved", "note": nil},
			map[string]any{"rail": "ach", "label": "Bank transfer", "standing": "in_review", "note": "Under review."},
		),
		verifying,
		map[string]any{"state": "complete"},
		readWallets(),
	)})

	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	if asked.path != PaymentsPath {
		t.Fatalf("asked %q", asked.path)
	}
	lines := read.Report.Rails.Rails
	if len(lines) != 2 || lines[0].Rail != "card" || lines[1].Rail != "ach" {
		t.Fatalf("rails %+v", lines)
	}
	if lines[1].Note == nil || *lines[1].Note != "Under review." {
		t.Fatalf("the sentence beside a rail was dropped: %+v", lines[1])
	}
	if !read.Report.Rails.ChargesEnabled {
		t.Fatal("whether the account can charge at all was not carried")
	}
}

// the reason's two members are draw nothing and report a fault, so one guessed at is a screen
// silently doing the opposite of its job.
func TestARailsReadingTheDeploymentCouldNotMakeKeepsItsReasonAndItsSentence(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		map[string]any{"state": "unreadable", "reason": "no_key", "detail": "Set STRIPE_SECRET_KEY."},
		verifying,
		map[string]any{"state": "unregistered"},
		readWallets(),
	)})
	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead || read.Report.Rails.State != "unreadable" {
		t.Fatalf("read %+v", read)
	}
	if read.Report.Rails.Reason != "no_key" || read.Report.Rails.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("rails %+v", read.Report.Rails)
	}
}

func TestARailsReadingThisConsoleCannotDrawIsNoReportAtAll(t *testing.T) {
	for what, rails := range map[string]any{
		"an unreadable arm with no reason":   map[string]any{"state": "unreadable", "detail": "No."},
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable", "reason": "failed"},
		"an unreadable arm with a reason nothing is drawn for": map[string]any{
			"state": "unreadable", "reason": "elsewhere", "detail": "No.",
		},
		"a state nothing is drawn for": map[string]any{"state": "pending"},
		"a standing nothing is drawn for": readRails(
			map[string]any{"rail": "card", "label": "Card", "standing": "maybe"},
		),
		// one unreadable line is the whole reading unread rather than a list with a gap in it: the
		// question is which ways of paying work, and an answer missing one reads exactly like an
		// account that was never approved for it.
		"a line that is not a line": readRails("card"),
		"no answer about charging":  map[string]any{"state": "read", "rails": []any{}},
	} {
		get, _ := asking(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK,
			Body: report(rails, verifying, map[string]any{"state": "complete"}, readWallets()),
		})
		if read := ReadPayments(context.Background(), get); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

func TestTheSigningSecretsStandingIsCarriedWhole(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(),
		map[string]any{"state": "stale", "detail": "The stored secret signs nothing this endpoint sends."},
		map[string]any{"state": "complete"},
		readWallets(),
	)})
	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead || read.Report.Webhook.State != "stale" {
		t.Fatalf("read %+v", read)
	}
	if read.Report.Webhook.Detail == nil {
		t.Fatal("the sentence about a stale secret was dropped")
	}
}

func TestASigningSecretStandingNothingIsDrawnForIsNoReport(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(), map[string]any{"state": "maybe"}, map[string]any{"state": "complete"}, readWallets(),
	)})
	if read := ReadPayments(context.Background(), get); read.Kind != PaymentsUnread {
		t.Fatalf("read %+v", read)
	}
}

// the two faults are the whole reason the screen can say which one an operator is looking at: a
// missing `delivering` defaulted to true would draw a switched-off endpoint as one merely short of
// an event.
func TestASwitchedOffEndpointIsToldFromOneShortOfEvents(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(),
		verifying,
		map[string]any{
			"state": "incomplete", "delivering": false,
			"missingEventTypes": []any{"charge.succeeded"},
		},
		readWallets(),
	)})
	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	held := read.Report.Subscription
	if held.State != "incomplete" || held.Delivering {
		t.Fatalf("subscription %+v", held)
	}
	if len(held.MissingEventTypes) != 1 || held.MissingEventTypes[0] != "charge.succeeded" {
		t.Fatalf("missing %v", held.MissingEventTypes)
	}
}

func TestASubscriptionReadingThisConsoleCannotDrawIsNoReport(t *testing.T) {
	for what, subscription := range map[string]any{
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable"},
		"a state nothing is drawn for":       map[string]any{"state": "pending"},
		"an incomplete arm missing whether it delivers": map[string]any{
			"state": "incomplete", "missingEventTypes": []any{},
		},
		"an incomplete arm missing its list": map[string]any{
			"state": "incomplete", "delivering": true,
		},
		"a list whose members are not event names": map[string]any{
			"state": "incomplete", "delivering": true, "missingEventTypes": []any{7},
		},
	} {
		get, _ := asking(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK,
			Body: report(readRails(), verifying, subscription, readWallets()),
		})
		if read := ReadPayments(context.Background(), get); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

func TestABodyCarryingOnlyOneOfTheFourIsNoReport(t *testing.T) {
	get, _ := asking(cf.Answer{
		Kind: cf.Answered, Status: http.StatusOK,
		Body: map[string]any{"rails": readRails()},
	})
	if read := ReadPayments(context.Background(), get); read.Kind != PaymentsUnread {
		t.Fatalf("read %+v", read)
	}
}

func TestAPaymentsReadCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusNotFound})
	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsUnread || read.Read.Kind != NoSurface {
		t.Fatalf("read %+v", read)
	}
}

func TestAPaymentsReadWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	read := ReadPayments(context.Background(), nil)
	if read.Kind != PaymentsUnread || read.Read.Kind != NoSession {
		t.Fatalf("read %+v", read)
	}
}

// the deployment's own address is one line among the rest, told apart by a flag rather than by a
// member of its own: it is the same registration on the same account, and what differs is only the
// words a screen puts beside it.
func TestTheHostnamesComeBackInTheOrderTheDeploymentSentThem(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(), verifying, map[string]any{"state": "complete"},
		readWallets(
			map[string]any{"host": "w.acct.workers.dev", "own": true, "standing": "drawing", "wallets": drawing()},
			map[string]any{"host": "hound-haven.org", "own": false, "standing": "unregistered"},
		),
	)})

	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	hosts := read.Report.Wallets.Hosts
	if len(hosts) != 2 || hosts[0].Host != "w.acct.workers.dev" || hosts[1].Host != "hound-haven.org" {
		t.Fatalf("hosts %+v", hosts)
	}
	if !hosts[0].Own || hosts[1].Own {
		t.Fatalf("the deployment's own address was not told from a listed site: %+v", hosts)
	}
	// a hostname the account holds nothing for has no wallet state to report, and a line carrying
	// three of them would be a screen drawing blanks under a site nothing was asked about.
	if len(hosts[1].Wallets) != 0 {
		t.Fatalf("an unregistered hostname carried wallets: %+v", hosts[1])
	}
}

// the processor's sentence about a wallet it is not drawing is the only thing either end can say
// about what to do, so a reader that dropped it would leave the line with nothing on it.
func TestTheProcessorsSentenceAboutAWalletItIsNotDrawingIsCarried(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(), verifying, map[string]any{"state": "complete"},
		readWallets(map[string]any{
			"host": "hound-haven.org", "own": false, "standing": "wallet_inactive",
			"wallets": map[string]any{
				"apple_pay":  map[string]any{"state": "inactive", "detail": "Host the verification file."},
				"google_pay": map[string]any{"state": "active", "detail": nil},
				"link":       map[string]any{"state": "active", "detail": nil},
			},
		}),
	)})

	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	line := read.Report.Wallets.Hosts[0].Wallets["apple_pay"]
	if line.State != "inactive" || line.Detail == nil || *line.Detail != "Host the verification file." {
		t.Fatalf("wallet %+v", line)
	}
	if read.Report.Wallets.Hosts[0].Wallets["google_pay"].Detail != nil {
		t.Fatal("a wallet the processor wrote nothing about was given a sentence")
	}
}

// the reason's two members are draw nothing and report a fault, so one guessed at is a screen
// silently doing the opposite of its job.
func TestAWalletsReadingTheDeploymentCouldNotMakeKeepsItsReasonAndItsSentence(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: report(
		readRails(), verifying, map[string]any{"state": "complete"},
		map[string]any{"state": "unreadable", "reason": "no_key", "detail": "Set STRIPE_SECRET_KEY."},
	)})
	read := ReadPayments(context.Background(), get)
	if read.Kind != PaymentsWasRead || read.Report.Wallets.State != "unreadable" {
		t.Fatalf("read %+v", read)
	}
	if read.Report.Wallets.Reason != "no_key" || read.Report.Wallets.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("wallets %+v", read.Report.Wallets)
	}
	if len(read.Report.Wallets.Hosts) != 0 {
		t.Fatal("a reading nobody was given reported hostnames")
	}
}

func TestAWalletsReadingThisConsoleCannotDrawIsNoReportAtAll(t *testing.T) {
	for what, wallets := range map[string]any{
		"an unreadable arm with no reason":   map[string]any{"state": "unreadable", "detail": "No."},
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable", "reason": "failed"},
		"an unreadable arm with a reason nothing is drawn for": map[string]any{
			"state": "unreadable", "reason": "elsewhere", "detail": "No.",
		},
		"a state nothing is drawn for": map[string]any{"state": "pending"},
		"a standing nothing is drawn for": readWallets(map[string]any{
			"host": "hound-haven.org", "own": false, "standing": "pending",
		}),
		"a line naming no hostname": readWallets(map[string]any{
			"own": false, "standing": "unregistered",
		}),
		"a line that does not say whether it is this deployment's own address": readWallets(
			map[string]any{"host": "hound-haven.org", "standing": "unregistered"},
		),
		// the wallets are what the line is drawn from on a registered hostname, and a reading short
		// of one is a button an operator is told nothing about.
		"a registered hostname short of a wallet": readWallets(map[string]any{
			"host": "hound-haven.org", "own": false, "standing": "drawing",
			"wallets": map[string]any{"apple_pay": map[string]any{"state": "active", "detail": nil}},
		}),
		"a wallet in a state nothing is drawn for": readWallets(map[string]any{
			"host": "hound-haven.org", "own": false, "standing": "drawing",
			"wallets": map[string]any{
				"apple_pay":  map[string]any{"state": "maybe"},
				"google_pay": map[string]any{"state": "active"},
				"link":       map[string]any{"state": "active"},
			},
		}),
	} {
		get, _ := asking(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK,
			Body: report(readRails(), verifying, map[string]any{"state": "complete"}, wallets),
		})
		if read := ReadPayments(context.Background(), get); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}
