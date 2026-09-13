package deployment

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// what a whole report off that surface looks like: one entry per processor, always all of them.
//
// the four members each case varies ride the first entry, and the second carries the arm a
// deployment holding none of that processor's credentials answers on — so every case below is one
// processor's reading read beside a processor nothing was asked of.
func report(rails, webhook, subscription, wallets any) map[string]any {
	return processors(
		configured("stripe", "Stripe", rails, webhook, subscription, wallets),
		unconfigured("paypal", "PayPal", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
	)
}

func processors(entries ...any) map[string]any {
	return map[string]any{"processors": entries}
}

func configured(processor, label string, rails, webhook, subscription, wallets any) map[string]any {
	return map[string]any{
		"processor": processor, "label": label, "state": "configured",
		"rails": rails, "webhook": webhook, "subscription": subscription, "wallets": wallets,
	}
}

func unconfigured(processor, label string, unset ...string) map[string]any {
	names := []any{}
	for _, name := range unset {
		names = append(names, name)
	}
	return map[string]any{
		"processor": processor, "label": label, "state": "unconfigured", "unset": names,
	}
}

func readRails(lines ...any) map[string]any {
	return map[string]any{
		"state": "read", "chargesEnabled": true, "evidence": "per_rail_approval", "rails": lines,
	}
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

// the entry ./report above varies, which is the first one.
func varied(t *testing.T, read PaymentsRead) ProcessorPayments {
	t.Helper()
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	return read.Report.Processors[0]
}

// one whole answer, asked for.
func answered(t *testing.T, body any) PaymentsRead {
	t.Helper()
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
	return ReadPayments(context.Background(), get)
}

// a deployment set up on one processor says nothing whatever about the other, and the arm that
// keeps them apart is what a fold with no reading to draw is keyed off.
func TestAProcessorTheDeploymentHoldsNoCredentialsForCarriesNoReading(t *testing.T) {
	read := answered(t, report(readRails(), verifying, map[string]any{"state": "complete"}, readWallets()))
	if read.Kind != PaymentsWasRead || len(read.Report.Processors) != 2 {
		t.Fatalf("read %+v", read)
	}
	none := read.Report.Processors[1]
	if none.Processor != "paypal" || none.State != "unconfigured" || none.Label != "PayPal" {
		t.Fatalf("processor %+v", none)
	}
	if len(none.Unset) != 2 || none.Unset[0] != "PAYPAL_CLIENT_ID" {
		t.Fatalf("the values it is short of were dropped: %v", none.Unset)
	}
	// no reading at all rather than empty ones, so a fold has no blank row to colour in.
	if none.Rails != nil || none.Webhook != nil || none.Subscription != nil || none.Wallets != nil {
		t.Fatalf("a processor nothing was asked of carried readings: %+v", none)
	}
}

// what a fold reads is the answer this console writes, not the struct behind it: a member that is
// not this arm's crosses as null, and a blank object in its place is what a fold colours in as a
// failure on keys nobody has set.
func TestAProcessorNothingWasAskedOfWritesNullWhereAReadingWouldBe(t *testing.T) {
	read := answered(t, report(readRails(), verifying, map[string]any{"state": "complete"}, readWallets()))
	written, err := json.Marshal(read.Report)
	if err != nil {
		t.Fatal(err)
	}
	var round struct {
		Processors []map[string]json.RawMessage `json:"processors"`
	}
	if err := json.Unmarshal(written, &round); err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{"rails", "webhook", "subscription", "wallets"} {
		if string(round.Processors[1][member]) != "null" {
			t.Errorf("an unconfigured processor wrote %s as %s", member, round.Processors[1][member])
		}
		if string(round.Processors[0][member]) == "null" {
			t.Errorf("a configured processor wrote %s as null", member)
		}
	}
	// and the other way round: the names it is short of belong to that arm alone.
	if string(round.Processors[0]["unset"]) != "null" {
		t.Errorf("a configured processor wrote unset as %s", round.Processors[0]["unset"])
	}
	if string(round.Processors[1]["unset"]) == "null" {
		t.Error("an unconfigured processor wrote no names at all")
	}
}

// a fold is drawn for every processor either way, so one left out is a fold with nothing to key off
// rather than a processor nobody set up.
func TestAReportShortOfAProcessorIsNoReportAtAll(t *testing.T) {
	read := answered(t, processors(
		configured("stripe", "Stripe", readRails(), verifying,
			map[string]any{"state": "complete"}, readWallets()),
	))
	if read.Kind != PaymentsUnread {
		t.Fatalf("read %+v", read)
	}
}

func TestAProcessorEntryThisConsoleCannotDrawIsNoReportAtAll(t *testing.T) {
	complete := map[string]any{"state": "complete"}
	for what, entries := range map[string][]any{
		"a processor this console draws no fold for": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			configured("adyen", "Adyen", readRails(), verifying, complete, nil),
		},
		// two entries under one name are two folds with nothing to tell them apart, whichever of
		// them a reader draws from.
		"a processor named twice beside every other one": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			unconfigured("paypal", "PayPal", "PAYPAL_CLIENT_ID"),
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
		},
		"a state nothing is drawn for": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			map[string]any{"processor": "paypal", "label": "PayPal", "state": "pending"},
		},
		"an entry naming no processor": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			map[string]any{"label": "PayPal", "state": "unconfigured", "unset": []any{}},
		},
		// the label travels because what an operator is shown a processor called is decided on the
		// deployment, and an entry carrying none is a fold with no heading.
		"an entry carrying no label": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			map[string]any{"processor": "paypal", "state": "unconfigured", "unset": []any{}},
		},
		"an unconfigured arm with no list of what it is short of": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			map[string]any{"processor": "paypal", "label": "PayPal", "state": "unconfigured"},
		},
		// the list is what an operator is sent to fill in, so a name this console draws no box for
		// is a name they would look for and not find.
		"an unconfigured arm naming a value this console draws no box for": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			map[string]any{
				"processor": "paypal", "label": "PayPal", "state": "unconfigured",
				"unset": []any{"PAYPAL_MERCHANT_ID"},
			},
		},
		"an entry that is not an entry": {
			configured("stripe", "Stripe", readRails(), verifying, complete, readWallets()),
			"paypal",
		},
	} {
		if read := answered(t, processors(entries...)); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

// a processor that draws its funding sources in its own window on its own domain registers no
// hostname anywhere: there is nothing to read, nothing to press and no section to draw, which an
// empty reading would turn into an invitation to register sites that would do nothing.
func TestAProcessorThatDrawsNoWalletCarriesNoHostnamesRatherThanNone(t *testing.T) {
	read := answered(t, processors(
		configured("stripe", "Stripe", readRails(), verifying,
			map[string]any{"state": "complete"}, readWallets()),
		configured("paypal", "PayPal", readRails(), verifying,
			map[string]any{"state": "complete"}, nil),
	))
	if read.Kind != PaymentsWasRead {
		t.Fatalf("read %+v", read)
	}
	if read.Report.Processors[0].Wallets == nil {
		t.Fatal("a processor that draws wallets came back with none")
	}
	drawn := read.Report.Processors[1]
	if drawn.State != "configured" || drawn.Wallets != nil {
		t.Fatalf("a processor that draws no wallet carried a reading: %+v", drawn)
	}
}

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
	if asked.path != PaymentsPath {
		t.Fatalf("asked %q", asked.path)
	}
	lines := varied(t, read).Rails.Rails
	if len(lines) != 2 || lines[0].Rail != "card" || lines[1].Rail != "ach" {
		t.Fatalf("rails %+v", lines)
	}
	if lines[1].Note == nil || *lines[1].Note != "Under review." {
		t.Fatalf("the sentence beside a rail was dropped: %+v", lines[1])
	}
	if !varied(t, read).Rails.ChargesEnabled {
		t.Fatal("whether the account can charge at all was not carried")
	}
}

// what the standings are worth is not the same question as what they say: on a credentials_only
// reading every rail is approved because the credentials authenticated and nothing was read about
// any rail, so a fold that drew the two alike would report a way of paying as switched on for an
// account that has never enabled it.
func TestWhatTheStandingsAreWorthIsCarriedBesideThem(t *testing.T) {
	rails := readRails(map[string]any{
		"rail": "paypal", "label": "PayPal", "standing": "approved", "note": nil,
	})
	rails["evidence"] = "credentials_only"
	read := answered(t, report(rails, verifying, map[string]any{"state": "complete"}, nil))
	if held := varied(t, read).Rails; held.Evidence != "credentials_only" {
		t.Fatalf("rails %+v", held)
	}
}

func TestARailsReadingTheDeploymentCouldNotMakeKeepsItsSentence(t *testing.T) {
	read := answered(t, report(
		map[string]any{"state": "unreadable", "detail": "Set STRIPE_SECRET_KEY."},
		verifying,
		map[string]any{"state": "unregistered"},
		readWallets(),
	))
	held := varied(t, read).Rails
	if held.State != "unreadable" || held.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("rails %+v", held)
	}
	if len(held.Rails) != 0 {
		t.Fatal("a reading nobody was given reported rails")
	}
}

func TestARailsReadingThisConsoleCannotDrawIsNoReportAtAll(t *testing.T) {
	noEvidence := readRails()
	delete(noEvidence, "evidence")
	unworth := readRails()
	unworth["evidence"] = "asserted"
	for what, rails := range map[string]any{
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable"},
		"a state nothing is drawn for":       map[string]any{"state": "pending"},
		"a standing nothing is drawn for": readRails(
			map[string]any{"rail": "card", "label": "Card", "standing": "maybe"},
		),
		// one unreadable line is the whole reading unread rather than a list with a gap in it: the
		// question is which ways of paying work, and an answer missing one reads exactly like an
		// account that was never approved for it.
		"a line that is not a line": readRails("card"),
		"no answer about charging": map[string]any{
			"state": "read", "evidence": "per_rail_approval", "rails": []any{},
		},
		// a rail may not be drawn without it, so a reading short of it is one this console has no
		// way to word.
		"no answer about what the standings are worth": noEvidence,
		"evidence nothing is drawn for":                unworth,
	} {
		body := report(rails, verifying, map[string]any{"state": "complete"}, readWallets())
		if read := answered(t, body); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

func TestTheSigningSecretsStandingIsCarriedWhole(t *testing.T) {
	read := answered(t, report(
		readRails(),
		map[string]any{"state": "stale", "detail": "The stored secret signs nothing this endpoint sends."},
		map[string]any{"state": "complete"},
		readWallets(),
	))
	held := varied(t, read).Webhook
	if held.State != "stale" || held.Detail == nil {
		t.Fatalf("webhook %+v", held)
	}
}

func TestASigningSecretStandingNothingIsDrawnForIsNoReport(t *testing.T) {
	body := report(readRails(), map[string]any{"state": "maybe"},
		map[string]any{"state": "complete"}, readWallets())
	if read := answered(t, body); read.Kind != PaymentsUnread {
		t.Fatalf("read %+v", read)
	}
}

// the two faults are the whole reason the screen can say which one an operator is looking at: a
// missing `delivering` defaulted to true would draw a switched-off endpoint as one merely short of
// an event.
func TestASwitchedOffEndpointIsToldFromOneShortOfEvents(t *testing.T) {
	read := answered(t, report(
		readRails(),
		verifying,
		map[string]any{
			"state": "incomplete", "delivering": false,
			"missingEventTypes": []any{"charge.succeeded"},
		},
		readWallets(),
	))
	held := varied(t, read).Subscription
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
		body := report(readRails(), verifying, subscription, readWallets())
		if read := answered(t, body); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}

func TestABodyCarryingNoProcessorsAtAllIsNoReport(t *testing.T) {
	if read := answered(t, map[string]any{"rails": readRails()}); read.Kind != PaymentsUnread {
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
	read := answered(t, report(
		readRails(), verifying, map[string]any{"state": "complete"},
		readWallets(
			map[string]any{"host": "w.acct.workers.dev", "own": true, "standing": "drawing", "wallets": drawing()},
			map[string]any{"host": "hound-haven.org", "own": false, "standing": "unregistered"},
		),
	))
	hosts := varied(t, read).Wallets.Hosts
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
	read := answered(t, report(
		readRails(), verifying, map[string]any{"state": "complete"},
		readWallets(map[string]any{
			"host": "hound-haven.org", "own": false, "standing": "wallet_inactive",
			"wallets": map[string]any{
				"apple_pay":  map[string]any{"state": "inactive", "detail": "Host the verification file."},
				"google_pay": map[string]any{"state": "active", "detail": nil},
				"link":       map[string]any{"state": "active", "detail": nil},
			},
		}),
	))
	hosts := varied(t, read).Wallets.Hosts
	line := hosts[0].Wallets["apple_pay"]
	if line.State != "inactive" || line.Detail == nil || *line.Detail != "Host the verification file." {
		t.Fatalf("wallet %+v", line)
	}
	if hosts[0].Wallets["google_pay"].Detail != nil {
		t.Fatal("a wallet the processor wrote nothing about was given a sentence")
	}
}

func TestAWalletsReadingTheDeploymentCouldNotMakeKeepsItsSentence(t *testing.T) {
	read := answered(t, report(
		readRails(), verifying, map[string]any{"state": "complete"},
		map[string]any{"state": "unreadable", "detail": "Set STRIPE_SECRET_KEY."},
	))
	held := varied(t, read).Wallets
	if held == nil || held.State != "unreadable" || held.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("wallets %+v", held)
	}
	if len(held.Hosts) != 0 {
		t.Fatal("a reading nobody was given reported hostnames")
	}
}

func TestAWalletsReadingThisConsoleCannotDrawIsNoReportAtAll(t *testing.T) {
	for what, wallets := range map[string]any{
		"an unreadable arm with no sentence": map[string]any{"state": "unreadable"},
		"a state nothing is drawn for":       map[string]any{"state": "pending"},
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
		body := report(readRails(), verifying, map[string]any{"state": "complete"}, wallets)
		if read := answered(t, body); read.Kind != PaymentsUnread {
			t.Errorf("a report carrying %s was read as one", what)
		}
	}
}
