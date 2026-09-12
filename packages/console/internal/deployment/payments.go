package deployment

import (
	"context"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// what a deployment says about each processor account it charges on, as this console reads it.
//
// **one entry per processor and always all of them.** a deployment set up on one holds none of the
// other's credentials, so nothing was asked of that one and nothing about its account is known —
// which is not the same as an account that was asked and did not answer. the unconfigured arm
// carries the names it is short of and no reading at all, so a fold drawn off it has no blank row
// to colour in.
//
// **the deployment answers every question here and this console can answer none of them.** the
// rails, what an endpoint is subscribed to and which of its hostnames an account draws wallet
// buttons on are read through the deployment's payment port with the keys it holds, and the signing
// secret is stronger than that: no read on a processor's API hands a secret back and no read on
// cloudflare's hands a stored one back either, so the comparison that says whether deliveries
// verify can be made inside the worker and nowhere else.
//
// **the sentences are the deployment's**, and the one way out of a stale signing secret names a
// redeploy because the secret is deploy-time. neither is shortened here and neither is written
// again.
//
// **nothing in this console repairs an endpoint, and this file least of all.** it reads and nothing
// else. an endpoint this release registers and that is short of an event or switched off is put
// right by the press that registers it afresh against the two keys; an endpoint this release
// registers on no processor is the unmanaged arm, which no press reaches at all.
//
// **the address on that arm is the one thing here an operator retypes and it is carried whole.**
// an unmanaged endpoint is registered by hand in the processor's own dashboard, and no hostname is
// committed to this repository (CLAUDE.md) — so the deployment learning its own off the request is
// the only place it is ever said, and a reading that dropped it leaves an operator pointing a
// listener at nothing.
//
// **a reading this console cannot draw is the whole report unread.** part of it drawn as a whole
// one is a screen that is confidently wrong about the rest.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// PaymentsPath is the path on a deployment that answers for the accounts it charges on.
const PaymentsPath = "/console/payments"

// PaymentsReadKind is how one read of those accounts ended.
type PaymentsReadKind string

const (
	// PaymentsWasRead is the only kind that says anything about any of them.
	PaymentsWasRead PaymentsReadKind = "read"
	// PaymentsUnread is nothing coming back that says where it stands, and Read says why.
	PaymentsUnread PaymentsReadKind = "unread"
)

// RailLine is one way of paying and where it stands on that account.
type RailLine struct {
	// Rail is the processor-independent name, which is what makes a line identifiable.
	Rail string `json:"rail"`
	// Label is what it is called where a donor is shown one.
	Label    string  `json:"label"`
	Standing string  `json:"standing"`
	Note     *string `json:"note"`
}

// RailsReading is which ways of paying this deployment can take on one account, or the read that
// could not be made.
//
// Detail is the unreadable arm's alone; ChargesEnabled, Evidence and Rails are the read arm's. It
// carries no reason beside Detail: a reading exists only under a processor this deployment is
// configured for, so the one thing a reason could say here is the arm above it.
type RailsReading struct {
	State  string `json:"state"`
	Detail string `json:"detail"`
	// ChargesEnabled rides beside the rails rather than only folded into them, so a screen can say
	// which of the two kinds of problem it is looking at.
	ChargesEnabled bool `json:"chargesEnabled"`
	// Evidence is what the standings underneath are worth, and a rail may not be drawn without
	// reading it: on a `credentials_only` reading every rail is approved because the credentials
	// authenticated, and nothing was read about any rail.
	Evidence string     `json:"evidence"`
	Rails    []RailLine `json:"rails"`
}

// WebhookSecretReading is whether deliveries from the processor verify.
type WebhookSecretReading struct {
	State  string  `json:"state"`
	Detail *string `json:"detail"`
}

// WebhookSubscriptionReading is what this deployment's endpoint is subscribed to.
//
// Delivering and MissingEventTypes are the incomplete arm's alone; Detail is the unreadable and
// unmanaged arms', and Address the unmanaged arm's.
type WebhookSubscriptionReading struct {
	State  string `json:"state"`
	Detail string `json:"detail"`
	// Address is where an operator has to point an endpoint this release registers on no processor,
	// which only the deployment knows.
	Address string `json:"address"`
	// Delivering is whether the processor is delivering to it at all.
	Delivering        bool     `json:"delivering"`
	MissingEventTypes []string `json:"missingEventTypes"`
}

// WalletLine is one wallet on one registered hostname, as the deployment reports it.
//
// Detail is the processor's own sentence about a wallet it is not drawing and is nil where it wrote
// none — the ordinary case for a wallet that is drawn, so absence is "nothing to say" and never
// "the reason could not be read". It is nobody's sentence in this repository: it arrives already
// bounded and flattened by the port that carried it, and is printed as it came.
type WalletLine struct {
	State  string  `json:"state"`
	Detail *string `json:"detail"`
}

// WalletHostLine is one hostname this deployment wants wallet buttons on, and where it stands.
//
// Own is the address the deployment answers on, and at most one line carries it: the donation page
// a deployment serves is on no site row, so a screen draws that line as the donation page and every
// other as a site the operator listed.
//
// Wallets is keyed by ../release's Wallets and holds every one of them, on the three registered
// standings alone: a hostname the account does not hold has no wallet state to report, and a line
// carrying three of them would be a screen drawing blanks under a site nothing has been asked about
// yet.
type WalletHostLine struct {
	Host     string                `json:"host"`
	Own      bool                  `json:"own"`
	Standing string                `json:"standing"`
	Wallets  map[string]WalletLine `json:"wallets"`
}

// WalletsReading is which hostnames the account draws wallet buttons on, or the read that could not
// be made.
//
// Detail is the unreadable arm's alone and Hosts the read arm's, and it carries no reason beside
// Detail for RailsReading's reason. The failing arm is the whole reading rather than one hostname's:
// one read of the account answers for all of them.
type WalletsReading struct {
	State  string           `json:"state"`
	Detail string           `json:"detail"`
	Hosts  []WalletHostLine `json:"hosts"`
}

// ProcessorPayments is where a deployment stands on one processor, which is what one fold is drawn
// from.
//
// **every member that is not this arm's is nil and crosses the wire as null, never as a blank one.**
// a processor this deployment holds no credentials for was asked nothing, so it has no reading to
// carry — and an empty reading is what a fold colours in as a failure, which is a fold reporting a
// fault on keys nobody has set. Unset is the unconfigured arm's alone; the four readings are the
// configured arm's.
//
// Wallets is nil on the configured arm too, for a processor that draws none anywhere, and that is a
// third answer rather than an empty reading: a processor whose funding sources are drawn in its own
// window on its own domain registers no hostname, so there is nothing to read, nothing to press and
// no section to draw.
type ProcessorPayments struct {
	Processor string `json:"processor"`
	// Label is what an operator is shown the processor called, which the deployment decides.
	Label string `json:"label"`
	State string `json:"state"`
	// Unset is the values this deployment would have to hold before any of it could be asked, in
	// the deployment's own order. Names only, and every one of them a name this console draws a box
	// for.
	Unset        []string                    `json:"unset"`
	Rails        *RailsReading               `json:"rails"`
	Webhook      *WebhookSecretReading       `json:"webhook"`
	Subscription *WebhookSubscriptionReading `json:"subscription"`
	Wallets      *WalletsReading             `json:"wallets"`
}

// PaymentsReport is the whole of what a deployment answers about the accounts it charges on.
type PaymentsReport struct {
	Processors []ProcessorPayments `json:"processors"`
}

// PaymentsRead is where every account stands, or which way that was not read.
type PaymentsRead struct {
	Kind   PaymentsReadKind `json:"kind"`
	Report *PaymentsReport  `json:"report"`
	Read   *NoReport        `json:"read"`
}

// ReadPayments asks where those accounts stand, or says why it could not.
//
// A nil reader is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func ReadPayments(ctx context.Context, get cf.Get) PaymentsRead {
	if get == nil {
		read := NoReport{Kind: NoSession}
		return PaymentsRead{Kind: PaymentsUnread, Read: &read}
	}
	answer := get(ctx, PaymentsPath)
	if held := paymentsReport(answer); held != nil {
		return PaymentsRead{Kind: PaymentsWasRead, Report: held}
	}
	read := readNoReport(answer)
	return PaymentsRead{Kind: PaymentsUnread, Read: &read}
}

// the answer as a report, or nil where it is not one.
//
// Read one entry at a time, because the body arrived off a network. Every processor has to be
// readable for this to be a report — part of it drawn as a whole one is a screen that is
// confidently wrong about the rest.
func paymentsReport(answer cf.Answer) *PaymentsReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	listed, isList := body["processors"].([]any)
	if !isList {
		return nil
	}
	held := make([]ProcessorPayments, 0, len(listed))
	named := map[string]bool{}
	for _, one := range listed {
		entry := processorPayments(one)
		// a processor this console draws no fold for, and one named twice, are both a report whose
		// folds cannot be keyed off it. the order is the deployment's and nothing here sorts it.
		if entry == nil || named[entry.Processor] {
			return nil
		}
		named[entry.Processor] = true
		held = append(held, *entry)
	}
	// every processor or none: a fold is drawn for each either way — the unconfigured one is where
	// the boxes that configure it are — so one left out is a fold with nothing to key off rather
	// than a processor nobody set up.
	for _, processor := range release.PaymentProcessors {
		if !named[processor] {
			return nil
		}
	}
	return &PaymentsReport{Processors: held}
}

// one processor's whole entry, or nil where it is not one.
//
// The unconfigured arm is settled before any reading is read, which is the arrangement it exists
// for: a processor this deployment holds no credentials for has no reading to carry, and a blank
// one is what a fold colours in as a failure.
func processorPayments(value any) *ProcessorPayments {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	processor, isText := held["processor"].(string)
	label := text(held["label"])
	state, named := held["state"].(string)
	if !isText || !enumerated(release.PaymentProcessors, processor) || label == nil || !named {
		return nil
	}
	entry := ProcessorPayments{Processor: processor, Label: *label, State: state}

	if state == "unconfigured" {
		listed, isList := held["unset"].([]any)
		if !isList {
			return nil
		}
		entry.Unset = []string{}
		for _, one := range listed {
			// the list is what an operator is sent to fill in, so a name this console draws no box
			// for is a name they would look for and not find.
			name := text(one)
			if name == nil || !enumerated(release.DeployVars, *name) {
				return nil
			}
			entry.Unset = append(entry.Unset, *name)
		}
		return &entry
	}
	if state != "configured" {
		return nil
	}

	rails := railsReading(held["rails"])
	webhook := webhookReading(held["webhook"])
	subscription := subscriptionReading(held["subscription"])
	if rails == nil || webhook == nil || subscription == nil {
		return nil
	}
	entry.Rails, entry.Webhook, entry.Subscription = rails, webhook, subscription
	// nothing where the processor draws no wallet anywhere, which is not an empty reading: there is
	// no hostname to register and no section to draw, and an empty one would be a screen inviting an
	// operator to register sites that would do nothing.
	if held["wallets"] == nil {
		return &entry
	}
	wallets := walletsReading(held["wallets"])
	if wallets == nil {
		return nil
	}
	entry.Wallets = wallets
	return &entry
}

// the member as a reading of the rails, or nil where it is not one.
func railsReading(value any) *RailsReading {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := held["state"].(string)
	if !isText {
		return nil
	}
	if state == "unreadable" {
		// an unreadable arm with no sentence on it is one this console cannot draw: that sentence is
		// the whole of what an operator acts on.
		detail := text(held["detail"])
		if detail == nil {
			return nil
		}
		return &RailsReading{State: state, Detail: *detail, Rails: []RailLine{}}
	}
	if state != "read" {
		return nil
	}
	charging, isBool := held["chargesEnabled"].(bool)
	evidence, weighed := held["evidence"].(string)
	listed, isList := held["rails"].([]any)
	// what the standings are worth is read before any of them is: a reading short of it, or one
	// carrying evidence nothing is drawn for, is a list of approvals this console has no way to
	// word — and the two members are worded differently about the same green row.
	if !isBool || !weighed || !enumerated(release.RailEvidence, evidence) || !isList {
		return nil
	}

	lines := []RailLine{}
	for _, one := range listed {
		line := railLine(one)
		// one unreadable line is the whole reading unread rather than a list with a gap in it: the
		// question this answers is which ways of paying work, and an answer missing one of them reads
		// exactly like an account that was never approved for it.
		if line == nil {
			return nil
		}
		lines = append(lines, *line)
	}
	return &RailsReading{
		State: state, ChargesEnabled: charging, Evidence: evidence, Rails: lines,
	}
}

// one line, or nil where it is not one.
func railLine(value any) *RailLine {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	rail := text(held["rail"])
	label := text(held["label"])
	standing, isText := held["standing"].(string)
	if rail == nil || label == nil || !isText || !enumerated(release.RailStandings, standing) {
		return nil
	}
	return &RailLine{Rail: *rail, Label: *label, Standing: standing, Note: text(held["note"])}
}

// the member as a reading of the signing secret, or nil where it is not one.
func webhookReading(value any) *WebhookSecretReading {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := held["state"].(string)
	if !isText || !enumerated(release.WebhookSecretStandings, state) {
		return nil
	}
	return &WebhookSecretReading{State: state, Detail: text(held["detail"])}
}

// the member as a reading of what the endpoint is subscribed to, or nil where it is not one.
//
// Every arm is read on its own terms, because they do not carry the same fields. The two faults the
// incomplete arm holds are the whole reason the screen can say which one an operator is looking at
// — a missing `delivering` defaulted to true would draw a switched-off endpoint as one merely short
// of an event.
func subscriptionReading(value any) *WebhookSubscriptionReading {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := held["state"].(string)
	if !isText {
		return nil
	}
	switch state {
	case "unreadable":
		// an unreadable arm with no sentence on it is one this console cannot draw: that sentence is
		// the whole of what an operator acts on.
		detail := text(held["detail"])
		if detail == nil {
			return nil
		}
		return &WebhookSubscriptionReading{
			State: state, Detail: *detail, MissingEventTypes: []string{},
		}
	case "unmanaged":
		// the sentence and the address both, because neither stands without the other: the sentence
		// is what says nothing is wrong, and the address is the whole of what an operator does about
		// it. one without the other is a fold telling somebody to register an endpoint somewhere.
		detail := text(held["detail"])
		address := text(held["address"])
		if detail == nil || address == nil {
			return nil
		}
		return &WebhookSubscriptionReading{
			State: state, Detail: *detail, Address: *address, MissingEventTypes: []string{},
		}
	case "unregistered", "complete":
		return &WebhookSubscriptionReading{State: state, MissingEventTypes: []string{}}
	case "incomplete":
		delivering, isBool := held["delivering"].(bool)
		listed, isList := held["missingEventTypes"].([]any)
		if !isBool || !isList {
			return nil
		}
		missing := []string{}
		for _, one := range listed {
			// an event type that is not a name is a list this console would draw a blank line in, and
			// the list is what an operator checks their endpoint against.
			named := text(one)
			if named == nil {
				return nil
			}
			missing = append(missing, *named)
		}
		return &WebhookSubscriptionReading{
			State: state, Delivering: delivering, MissingEventTypes: missing,
		}
	}
	return nil
}

// the member as a reading of the hostnames, or nil where it is not one.
//
// The same two arms the rails take and read the same way, because the read that makes them is the
// same one: an unreadable arm carries its sentence or it is not drawn, and one unreadable line is
// the whole reading unread rather than a list with a gap in it — a hostname missing from the list
// reads exactly like a site nobody registered.
func walletsReading(value any) *WalletsReading {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := held["state"].(string)
	if !isText {
		return nil
	}
	if state == "unreadable" {
		detail := text(held["detail"])
		if detail == nil {
			return nil
		}
		return &WalletsReading{State: state, Detail: *detail, Hosts: []WalletHostLine{}}
	}
	if state != "read" {
		return nil
	}
	listed, isList := held["hosts"].([]any)
	if !isList {
		return nil
	}
	lines := []WalletHostLine{}
	for _, one := range listed {
		line := walletHostLine(one)
		if line == nil {
			return nil
		}
		lines = append(lines, *line)
	}
	return &WalletsReading{State: state, Hosts: lines}
}

// one hostname, or nil where it is not one.
//
// Whether the line is this deployment's own address is read rather than defaulted: a missing flag
// taken for false draws the donation page as a site the operator listed, which is a row offering to
// be removed on a screen that has nothing to remove it from.
func walletHostLine(value any) *WalletHostLine {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	host := text(held["host"])
	own, isBool := held["own"].(bool)
	standing, isText := held["standing"].(string)
	if host == nil || !isBool || !isText || !enumerated(release.WalletHostStandings, standing) {
		return nil
	}
	line := WalletHostLine{
		Host: *host, Own: own, Standing: standing, Wallets: map[string]WalletLine{},
	}
	if standing == "unregistered" {
		return &line
	}
	wallets, isMap := held["wallets"].(map[string]any)
	if !isMap {
		return nil
	}
	for _, wallet := range release.Wallets {
		// every wallet or none: what a line says is which buttons a donor is shown, and one left out
		// is a button an operator is told nothing about on a hostname they were told about.
		one := walletLine(wallets[wallet])
		if one == nil {
			return nil
		}
		line.Wallets[wallet] = *one
	}
	return &line
}

// one wallet, or nil where it is not one.
func walletLine(value any) *WalletLine {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := held["state"].(string)
	if !isText || !enumerated(release.WalletStates, state) {
		return nil
	}
	return &WalletLine{State: state, Detail: text(held["detail"])}
}
