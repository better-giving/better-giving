package deployment

import (
	"context"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the hostnames a donor is drawn wallet buttons on, as this console asks a deployment to register
// them on its processor account.
//
// **the deployment does it and this console cannot**, for ./recurring.go's reason: the call goes
// through the deployment's payment port with the key the deployment holds, and a console that could
// register a domain would be a console holding that key.
//
// **no hostname is posted and none may be.** the account is the operator's and a registration is a
// public claim on a domain, so a request naming one would let anything holding a session register a
// domain the deployment has never heard of. the list is the address the request reached plus the
// deployment's own site rows, settled inside the worker — packages/app/src/routes/console.wallet-domains.ts's
// header is the whole argument, and ./payments.go reads the account over that same list.
//
// **one hostname's failure stops no other.** the report carries a line per hostname, each with
// where it stands now and, where the press could not move it, the port's own sentence. so a press
// over four sites comes back with three levelled and one to go rather than a single word covering
// all of them, and a press is a failure only where the read that opens it did not land.
//
// **it is safe to press twice**: every hostname is levelled to the same finished state whatever it
// started in, which is what lets the keys run, the sites press and the fold's own button all reach
// it.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// WalletDomainsPath is the path on a deployment that levels them.
const WalletDomainsPath = "/console/wallet-domains"

// WalletsLevelKind is how one press to level them ended.
type WalletsLevelKind string

const (
	// WalletsLevelReported is the deployment saying what it did.
	WalletsLevelReported WalletsLevelKind = "reported"
	// WalletsLevelUnanswered is nothing coming back that says, and Read says why.
	WalletsLevelUnanswered WalletsLevelKind = "unanswered"
)

// LevelledWalletHost is one hostname after the press, and whether the press moved anything on it.
//
// Line is where the hostname stands now — what the press left behind where it landed, and what was
// already there where it did not — so a screen redraws the whole block from this answer without
// reading the account again, and a hostname the press failed on still shows what it is rather than
// going blank.
//
// Changed is false for both "it was already right" and "the press failed", which Detail tells
// apart: Detail is the deployment's own sentence for a hostname the press could not move, and nil
// where there was nothing to say.
type LevelledWalletHost struct {
	Line    WalletHostLine `json:"line"`
	Changed bool           `json:"changed"`
	Detail  *string        `json:"detail"`
}

// WalletLevellingReport is what one press left behind, per hostname it was asked about.
//
// Reason and Detail are the unreadable arm's alone and Hosts is the levelled arm's. There is no
// outcome word over the whole of it, unlike ./recurring.go's report: this press acts on a list, and
// one word over four hostnames would have to be either the best or the worst of them.
type WalletLevellingReport struct {
	State  string               `json:"state"`
	Reason string               `json:"reason"`
	Detail string               `json:"detail"`
	Hosts  []LevelledWalletHost `json:"hosts"`
}

// WalletsLevel is how one press went.
type WalletsLevel struct {
	Kind   WalletsLevelKind       `json:"kind"`
	Report *WalletLevellingReport `json:"report"`
	Read   *NoReport              `json:"read"`
}

// LevelWallets asks the deployment to register them, or says why it did not.
//
// A nil writer is its own answer rather than a request made with no credential, for the reason
// ./org.go states.
func LevelWallets(ctx context.Context, post cf.Post) WalletsLevel {
	if post == nil {
		read := NoReport{Kind: NoSession}
		return WalletsLevel{Kind: WalletsLevelUnanswered, Read: &read}
	}
	// no body of its own: the hostnames are the deployment's own rows and its own address.
	answer := post(ctx, WalletDomainsPath, map[string]any{})
	if report := walletLevellingReport(answer); report != nil {
		return WalletsLevel{Kind: WalletsLevelReported, Report: report}
	}
	read := readNoReport(answer)
	return WalletsLevel{Kind: WalletsLevelUnanswered, Read: &read}
}

// AwaitsKey is the press refused because the deployment is not holding the secret key yet.
//
// The same meaning ./recurring.go's has and read off the answer rather than out of a sentence: this
// press states which of the two ways the read failed, so what a screen decides on is the fact. what
// it buys is the same — the write landed seconds earlier and its edge has not caught up, so the
// thing to say is that the next press finishes it rather than the deployment's own sentence, which
// names a value that press has already set.
func (level WalletsLevel) AwaitsKey() bool {
	return level.Kind == WalletsLevelReported && level.Report != nil &&
		level.Report.State == "unreadable" && level.Report.Reason == "no_key"
}

// the answer as a report of a press, or nil where it is not one.
//
// Read whatever the status, because the arm that attempted nothing answers with one saying what is
// in the way — a reader that only read a 2xx would throw that sentence away. An unreadable arm with
// no sentence or no reason on it is dropped rather than drawn, for ./payments.go's reason: the two
// members are draw nothing and report a fault, and a guess either way is a screen silently doing
// the opposite of its job.
func walletLevellingReport(answer cf.Answer) *WalletLevellingReport {
	if answer.Kind != cf.Answered {
		return nil
	}
	body, mapped := answer.Body.(map[string]any)
	if !mapped {
		return nil
	}
	state, isText := body["state"].(string)
	if !isText {
		return nil
	}
	if state == "unreadable" {
		reason, named := body["reason"].(string)
		detail := text(body["detail"])
		if !named || !enumerated(release.StripeUnreadableReasons, reason) || detail == nil {
			return nil
		}
		return &WalletLevellingReport{
			State: state, Reason: reason, Detail: *detail, Hosts: []LevelledWalletHost{},
		}
	}
	if state != "levelled" {
		return nil
	}
	listed, isList := body["hosts"].([]any)
	if !isList {
		return nil
	}
	hosts := []LevelledWalletHost{}
	for _, one := range listed {
		// one unreadable line is the whole press unreported rather than a list with a gap in it: a
		// hostname missing from the answer reads exactly like a site nobody asked about.
		host := levelledWalletHost(one)
		if host == nil {
			return nil
		}
		hosts = append(hosts, *host)
	}
	return &WalletLevellingReport{State: state, Hosts: hosts}
}

// one hostname after the press, or nil where it is not one.
func levelledWalletHost(value any) *LevelledWalletHost {
	held, mapped := value.(map[string]any)
	if !mapped {
		return nil
	}
	line := walletHostLine(held["line"])
	changed, isBool := held["changed"].(bool)
	if line == nil || !isBool {
		return nil
	}
	return &LevelledWalletHost{Line: *line, Changed: changed, Detail: text(held["detail"])}
}
