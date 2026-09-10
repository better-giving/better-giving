package terminal

import (
	"fmt"
	"io"

	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/update"
)

// what an operator reads while the console they typed a command to installs a newer one and hands
// it the run.
//
// **the lines under it are a running commentary and not a ledger.** ./ledger.go holds the terminal
// and un-draws what it drew; these are printed as each part lands and left where they are, because
// what writes to that terminal next is a different binary — a drawing this process owns cannot
// survive the exec that replaces it (../../cmd/better-giving/main.go's asNewer).
//
// **every failure names the install line and the press it belongs to.** the command is over and
// nothing was uploaded: the operator is holding a console this run decided not to deploy from, so
// what is left to do is the line they installed this one with (../release's InstallLine) and then
// the command again.
//
// **the question in front of it is here too, and it is the one confirm in this package that stands
// on its own act.** an install can be undone — the operator installs the console they had back, and
// nothing on their account moved — while a console left older than the release deploys older code
// onto the deployment, which is the failure the install exists to close
// (../../cmd/better-giving/main.go's carried). so a return takes the install, and ./confirm.go's
// door in front of the live database is the opposite reading of the same keystroke.
//
// the rest are pure functions of a reading, which is ./outcome.go's arrangement and its reason:
// ./install_test.go holds every step and every way an install can stop to a sentence of its own.

// ConfirmNewer asks whether to install the console `version` names over this one and put that
// release on the deployment.
//
// It answers in ./confirm.go's values, less Ahead and Elsewhere: nothing has been read about a
// deployment when this is put — a console being behind a release is not a state a deployment can be
// in, and the account picker a door offers the way back to has not been drawn yet.
// Unattended is a run nobody is standing at, which the caller carries on past — a question nobody
// was put in front of is not a refusal to report where the act it asks about can be undone.
//
// **nothing is drawn where nobody is standing, which is the opposite of ./confirm.go's door.** that
// one names its list either way, because a run whose output is a record still says what it would
// have applied; this one has no list, and the caller says the same thing in its own words on the
// way past (../../cmd/better-giving/main.go's newer) — so a line here would be the same news
// twice in the same file.
func ConfirmNewer(in io.Reader, to io.Writer, version string) Confirmation {
	if !attended(in, to) {
		return Unattended
	}
	clear(to)
	fmt.Fprintf(to, "version %s of this console is out, and a console deploys only the release it\n"+
		"was built with.\n\n", version)
	return confirming(in, to, updatingConsole(version))
}

// the question that install puts.
func updatingConsole(version string) question {
	return question{
		title: "update this console to " + version + " and put that release on your deployment?",
		apply: "Update, then carry on",
		leave: "Carry on with this console",
		opens: true,
	}
}

// InstallingNewer is what stands over an install, naming the release it is about to fetch.
func InstallingNewer(version string) string {
	return "version " + version + " of this console is out — installing it"
}

// InstallStep is one finished part of that install, drawn under it.
//
// The archive and the file are named because they are the two facts an operator cannot work out for
// themselves: which of the release's archives this machine took, and which of the consoles on their
// PATH was replaced — they may have installed anywhere (../update's Install).
func InstallStep(done update.Step, at update.Landed) string {
	switch done {
	case update.Downloaded:
		return "  downloaded " + Code(at.Asset)
	case update.Checked:
		return "  checked against the release's checksums"
	case update.Installed:
		return "  installed to " + Code(at.Path)
	}
	return ""
}

// NowOn is what says the newer console is about to take the run over.
//
// The last line this binary writes: what draws under it is written by the console named in it.
func NowOn(version string) string {
	return "now on " + version + ", carrying on"
}

// NowOnThenStart is what an install with nothing left to run leaves on the screen: the console this
// machine now holds, and the press that puts that release on the deployment.
//
// It is not ./NowOn: nothing carries on here. `better-giving update` installs a console and deploys
// nothing at all (../../cmd/better-giving/update.go), so an operator left with no line naming
// `start` has a newer console and a deployment on the older release, with nothing on the screen
// saying which press closes that.
func NowOnThenStart(version string) string {
	return "this console is now on " + version + " — run " + Cmd("start") +
		" to put that release on your deployment"
}

// InstallStopped is why the newer console is not on this machine, and what that left undone.
//
// Empty for the install that landed: what says it worked is the console that draws the rest of the
// run.
//
// `fix` is the caller's own press, because both presses install this way and each is run again by a
// command of its own (../../cmd/better-giving).
func InstallStopped(at update.Landed, fix Repair) string {
	switch at.Kind {
	case update.Replaced:
		return ""
	case update.NoAsset:
		// the one that will not come right on another try: no console for this platform appears
		// under that release however many times it is asked for.
		return "That release publishes no console for this machine (" + Code(at.Asset) +
			"), so nothing was installed and nothing was deployed. " + byHand(fix)
	case update.Unreachable:
		return "The newer console could not be downloaded, so nothing was installed and nothing " +
			"was deployed. Check this machine's connection. " + byHand(fix)
	case update.Mismatched:
		return "The archive that came down is not the one that release publishes a checksum for, " +
			"so nothing was installed and nothing was deployed. " + byHand(fix)
	case update.Unreadable:
		return "The archive that came down carries no console, so nothing was installed and " +
			"nothing was deployed. " + byHand(fix)
	case update.Unwritable:
		// the file is left off rather than left dangling, which is ./confirm.go's reading of the
		// same absence: a machine that would not say what this process is executing is exactly the
		// case in which there is no path to quote.
		where := ""
		if at.Path != "" {
			where = " at " + Code(at.Path)
		}
		return "This console could not be replaced" + where + ", so nothing was installed and " +
			"nothing was deployed. " + byHand(fix)
	default:
		return unaccountedInstall(fix)
	}
}

// what an install that ended in a kind this file does not know left behind.
//
// ./install_test.go holds every kind ../update names to a sentence of its own, so a kind added there
// and not here fails `go test` — and reaches this rather than a blank line under a screen that just
// said an install was happening.
func unaccountedInstall(fix Repair) string {
	return "This console did not install the newer one and has no account of why, so nothing was " +
		"deployed. " + byHand(fix)
}

// what an operator does about a console this one could not install for them, which is the line they
// installed this one with and then the press they typed.
func byHand(fix Repair) string {
	return "Install the newer console yourself:\n  " + Code(release.InstallLine) + "\n" + fix.Alone
}
