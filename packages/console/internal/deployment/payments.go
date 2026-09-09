package deployment

import (
	"context"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// what a deployment says about the processor account it charges on, as this console reads it.
//
// **the deployment answers all four questions and this console can answer none of them.** the
// rails, what its endpoint is subscribed to and which of its hostnames the account draws wallet
// buttons on are read through the deployment's payment port with the key it holds, and the signing
// secret is stronger than that: no read on the processor's API hands a secret back and no read on
// cloudflare's hands a stored one back either, so the comparison that says whether deliveries
// verify can be made inside the worker and nowhere else.
//
// **the sentences are the deployment's**, and the one way out of a stale signing secret names a
// redeploy because the secret is deploy-time. neither is shortened here and neither is written
// again.
//
// **nothing in this console repairs an endpoint, and this file least of all.** it reads and nothing
// else. an endpoint that is short of an event or switched off is put right by the press that
// registers it afresh against the two keys.
//
// **so two of the four readings here are drawn by nothing.** the fold takes the rails and the
// hostnames off this report: the endpoint, what it is subscribed to and the secret that proves a
// delivery came from the processor are machinery that press establishes, and the fold states them
// in its confirm rather than as readings an operator is asked to act on. they are still read
// because they are what the deployment answers with, and a report parsed short of what it carries
// is a shape that fails on the next thing that wants it.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// PaymentsPath is the path on a deployment that answers for the account it charges on.
const PaymentsPath = "/console/payments"

// PaymentsReadKind is how one read of that account ended.
type PaymentsReadKind string

const (
	// PaymentsWasRead is the only kind that says anything about the account.
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

// RailsReading is which ways of paying this deployment can take, or that nothing was asked.
//
// Reason and Detail are the unreadable arm's alone; ChargesEnabled and Rails are the read arm's.
type RailsReading struct {
	State          string     `json:"state"`
	Reason         string     `json:"reason"`
	Detail         string     `json:"detail"`
	ChargesEnabled bool       `json:"chargesEnabled"`
	Rails          []RailLine `json:"rails"`
}

// WebhookSecretReading is whether deliveries from the processor verify.
type WebhookSecretReading struct {
	State  string  `json:"state"`
	Detail *string `json:"detail"`
}

// WebhookSubscriptionReading is what this deployment's endpoint is subscribed to.
//
// Delivering and MissingEventTypes are the incomplete arm's alone, and Detail the unreadable arm's.
type WebhookSubscriptionReading struct {
	State  string `json:"state"`
	Detail string `json:"detail"`
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

// WalletsReading is which hostnames the account draws wallet buttons on, or that nothing was asked.
//
// Reason and Detail are the unreadable arm's alone; Hosts is the read arm's. The failing arm is the
// whole reading rather than one hostname's: one read of the account answers for all of them.
type WalletsReading struct {
	State  string           `json:"state"`
	Reason string           `json:"reason"`
	Detail string           `json:"detail"`
	Hosts  []WalletHostLine `json:"hosts"`
}

// PaymentsReport is the whole of what a deployment answers about that account.
type PaymentsReport struct {
	Rails        RailsReading               `json:"rails"`
	Webhook      WebhookSecretReading       `json:"webhook"`
	Subscription WebhookSubscriptionReading `json:"subscription"`
	Wallets      WalletsReading             `json:"wallets"`
}

// PaymentsRead is where the account stands, or which way that was not read.
type PaymentsRead struct {
	Kind   PaymentsReadKind `json:"kind"`
	Report *PaymentsReport  `json:"report"`
	Read   *NoReport        `json:"read"`
}

// ReadPayments asks where the account stands, or says why it could not.
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
// Read one member at a time, because the body arrived off a network. All four have to be readable
// for this to be a report — part of it drawn as a whole one is a screen that is confidently wrong
// about the rest.
func paymentsReport(answer cf.Answer) *PaymentsReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	rails := railsReading(body["rails"])
	webhook := webhookReading(body["webhook"])
	subscription := subscriptionReading(body["subscription"])
	wallets := walletsReading(body["wallets"])
	if rails == nil || webhook == nil || subscription == nil || wallets == nil {
		return nil
	}
	return &PaymentsReport{
		Rails: *rails, Webhook: *webhook, Subscription: *subscription, Wallets: *wallets,
	}
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
		// the whole of what an operator acts on. and one with no reason on it, or a reason nothing is
		// drawn for, is one it cannot decide about — the two members are draw nothing and report a
		// fault, so a guess either way is a screen silently doing the opposite of its job.
		reason, named := held["reason"].(string)
		detail := text(held["detail"])
		if !named || !enumerated(release.StripeUnreadableReasons, reason) || detail == nil {
			return nil
		}
		return &RailsReading{State: state, Reason: reason, Detail: *detail, Rails: []RailLine{}}
	}
	if state != "read" {
		return nil
	}
	charging, isBool := held["chargesEnabled"].(bool)
	listed, isList := held["rails"].([]any)
	if !isBool || !isList {
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
	return &RailsReading{State: state, ChargesEnabled: charging, Rails: lines}
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
// same one: an unreadable arm carries the fact and the sentence or it is not drawn, and one
// unreadable line is the whole reading unread rather than a list with a gap in it — a hostname
// missing from the list reads exactly like a site nobody registered.
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
		reason, named := held["reason"].(string)
		detail := text(held["detail"])
		if !named || !enumerated(release.StripeUnreadableReasons, reason) || detail == nil {
			return nil
		}
		return &WalletsReading{
			State: state, Reason: reason, Detail: *detail, Hosts: []WalletHostLine{},
		}
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
