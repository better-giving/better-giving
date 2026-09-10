package terminal

import (
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/charmbracelet/huh"
)

// the carry onto a deployment that is already standing, named in front of the press that makes it.
//
// **a remote migration cannot be taken back and nothing here rolls one back** (CLAUDE.md), so what
// stands in front of it is the list of files it would apply and a confirm that opens on the
// refusal. a hand resting on the keyboard is how a door like this is opened by accident, and every
// keystroke that is not the operator choosing to apply them leaves the database as it stands.
//
// **it is put where this release moves the database nowhere as well.** `better-giving start` is the
// one press that carries, and it carries onto a deployment the operator asked it to open a console
// at — so the upload itself is the thing being agreed to, and a release with nothing to apply is
// still this release's code going onto their worker. the question is the other question then
// (./carrying), and the screen is the same screen: an operator whose machine has operated two
// deployments answers off the account and the address on it or not at all.
//
// **a deployment ahead of this binary is refused rather than confirmed.** a migration the database
// records and this release does not carry was applied by a newer console, so a press from here
// would carry the app backwards while leaving that file's schema standing — which is not a thing an
// operator can agree to, because there is nothing this binary could do about it afterwards
// (../migrate's AheadNames).
//
// **the list is named where nobody is standing, and the door is not opened there.** ./prompt.go's
// rule is this one's too and it takes both ends of the prompt: a form drawn at a pipe, or into the
// file `better-giving start > start.log` redirects it to, is one nobody ever answers — so a
// command that put one there would stand at it waiting on an answer that is not coming. the names
// go out either way — a run whose output is a record still says what it would have applied — and
// the answer is its own, because nobody shut that door: an operator who chose to leave the database
// alone made a decision, and a pipe made none.
//
// **a console newer than this one is named above the door and not before it.** the list is drawn on
// a screen of its own (./clear.go), so a line printed by the caller ahead of this call is off the
// screen by the time the operator answers — which is the moment it exists to inform. what says
// whether there is one is ../../cmd/better-giving/main.go's, and what arrives here is the line.
//
// **the door names its object, for that same screen's reason.** the account this deployment is in
// is remembered between runs and drawn nowhere else, and the address is a reading the caller has
// already taken — so both are handed in rather than read again, and both are drawn above the count.
// a machine that has operated two deployments, or one whose remembered account is not the one the
// operator has in mind, cannot answer "apply them to the live database?" from a screen that names
// neither.

// Confirmation is how the door was answered.
type Confirmation string

const (
	// Confirmed is the door opened on purpose.
	Confirmed Confirmation = "confirmed"
	// Declined is the door shut on purpose: the refusal chosen, or the form closed.
	Declined Confirmation = "declined"
	// Ahead is a deployment put up by a newer console, which is refused outright.
	Ahead Confirmation = "ahead"
	// Unattended is the door nobody was put in front of: an end of the prompt that is not a
	// terminal, or a form that could not be drawn at one. The list was named and no question was
	// ever answered, so nothing was refused and nobody refused it.
	Unattended Confirmation = "unattended"
)

// Deployment is what a door is being opened on: whose account it is in, and where it answers.
type Deployment struct {
	// Account is the cloudflare account the deployment is in, by the name it carries there.
	Account string
	// Address is where the deployment answers, and empty where the caller could read none.
	Address string
}

// ConfirmCarry names what a carry onto a standing deployment would do and takes the operator's
// answer for it.
//
// `at` is the deployment the answer is about, drawn above the count. `pending` is what this release
// carries and the database has not, in the order it applies them; `ahead` is what the database
// records and this release does not carry. Both are ../migrate's. `newer` is the line naming a
// console newer than the one asking, and empty where there is none.
func ConfirmCarry(
	in io.Reader,
	to io.Writer,
	at Deployment,
	pending, ahead []string,
	newer string,
) Confirmation {
	if len(ahead) > 0 {
		above(to, newer)
		fmt.Fprintf(to, "this deployment was put up by a newer console: its database records %s\n"+
			"this binary does not carry, so nothing here can carry it forward.\n",
			migrations(len(ahead)))
		list(to, ahead)
		return Ahead
	}

	// what the question is about is drawn on the question's own screen rather than under whatever
	// the run printed ahead of it (./clear.go). a run at a pipe is cleared of nothing and keeps its
	// record whole.
	clear(to)
	above(to, newer)
	object(to, at)
	naming(to, pending)

	if !attended(in, to) {
		return Unattended
	}
	return confirming(in, to, carrying(pending))
}

// what the carry would do to the live database, which is a list of files or a line saying there are
// none.
//
// a release that applies nothing says so rather than saying nothing: the operator is being asked
// about an upload, and a screen silent about the database reads as one that did not check.
func naming(to io.Writer, pending []string) {
	if len(pending) == 0 {
		fmt.Fprint(to, "this deploy uploads this release's code and applies nothing to the live\n"+
			"database.\n")
		return
	}
	fmt.Fprintf(to, "this deploy applies %s to the live database, which cannot be\n"+
		"undone:\n", migrations(len(pending)))
	list(to, pending)
}

// the question this door puts, which is a different question where there is nothing to apply.
//
// both stand on leaving the deployment as it is: the one-way door for the reason this file opens
// on, and the upload because a `start` that carries nothing still opens the console at a deployment
// that is already serving (../../cmd/better-giving/start.go).
func carrying(pending []string) question {
	if len(pending) == 0 {
		return question{
			title: "carry this release onto the deployment?",
			apply: "Carry it over",
			leave: "Leave the deployment alone",
		}
	}
	return question{
		title: "apply them to the live database?",
		apply: "Apply them",
		leave: "Leave the database alone",
	}
}

// what stands over the door, with a blank line under it so that the question below reads as its
// own. nothing at all where the caller has nothing to say.
func above(to io.Writer, line string) {
	if line == "" {
		return
	}
	fmt.Fprintf(to, "%s\n\n", line)
}

// what the act would be applied to, one fact to the line, with a blank line under it so that the
// count below reads as its own.
//
// a deployment answering on no address this console can read is said as that rather than left
// blank: a line with nothing after it reads as a value that went missing on the way here.
func object(to io.Writer, at Deployment) {
	if at.Account != "" {
		fmt.Fprintf(to, "Cloudflare account: %s\n", at.Account)
	}
	fmt.Fprintf(to, "deployment: %s\n\n", answering(at))
}

// where a deployment answers, or that this console could read no address for it.
//
// said rather than left blank, which is ./object's reading of every absent value on that screen: a
// line with nothing after it reads as a value that went missing on the way here.
func answering(at Deployment) string {
	if at.Address == "" {
		return "no address this console can read"
	}
	return at.Address
}

// the count and the noun it counts, inflected, the way ./outcome.go's heldBack inflects its own.
func migrations(count int) string {
	if count == 1 {
		return "1 migration"
	}
	return strconv.Itoa(count) + " migrations"
}

// question is what a confirm puts and which of its two answers a bare return gives.
//
// It is a value rather than three arguments because the standing is the part that can be wrong
// quietly: a door drawn with the right words over the wrong default is a screen that reads
// correctly and answers itself.
type question struct {
	// title is the question, and apply and leave the two answers as the operator reads them.
	title, apply, leave string
	// opens is whether a return takes the act. False is a confirm standing on leaving things as
	// they are, which every door in front of a deployment does; ./install.go argues the one that
	// does not.
	opens bool
}

// the door itself, put once what it is about has been named and the operator is known to be at it.
//
// **a form that failed is no answer and never the refusal.** the operator is standing at a terminal
// this console could not draw the question on, so nothing was put to them: reported as the refusal
// it would be ../../cmd/better-giving/start.go exiting 0 on "the database was left alone", which is
// a decision nobody made. the door stays shut either way and only the sentence differs.
//
// **the one failure that is an answer is the operator's own.** ctrl-c at the form is a press not
// made, which every prompt in this package reads as the value not given (./prompt.go) — and what
// they left is the deployment alone, which is the refusal.
func confirming(in io.Reader, to io.Writer, put question) Confirmation {
	answered := put.opens
	asking := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title(put.title).
			Affirmative(put.apply).
			Negative(put.leave).
			Value(&answered),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return Declined
	case err != nil:
		return Unattended
	case !answered:
		return Declined
	}
	return Confirmed
}

func list(to io.Writer, names []string) {
	for _, name := range names {
		fmt.Fprintf(to, "  %s\n", name)
	}
}
