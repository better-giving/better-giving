package terminal

import (
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/charmbracelet/huh"
)

// the one-way door, named in front of the press that opens it.
//
// **a remote migration cannot be taken back and nothing here rolls one back** (CLAUDE.md), so what
// stands in front of it is the list of files it would apply and a confirm that opens on the
// refusal. a hand resting on the keyboard is how a door like this is opened by accident, and every
// keystroke that is not the operator choosing to apply them leaves the database as it stands.
//
// **a deployment ahead of this binary is refused rather than confirmed.** a migration the database
// records and this release does not carry was applied by a newer console, so a press from here
// would carry the app backwards while leaving that file's schema standing — which is not a thing an
// operator can agree to, because there is nothing this binary could do about it afterwards
// (../migrate's AheadNames).
//
// **the list is named where nobody is standing, and the door is not opened there.** ./prompt.go's
// rule is this one's too and it takes both ends of the prompt: a form drawn at a pipe, or into the
// file `better-giving update > update.log` redirects it to, is one nobody ever answers — so a
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
	// Confirmed is the door opened on purpose, which is also the answer where there is no door.
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

// ConfirmMigration names what a deploy would apply to the live database and takes the operator's
// answer for it.
//
// `at` is the deployment the answer is about, drawn above the count. `pending` is what this release
// carries and the database has not, in the order it applies them; `ahead` is what the database
// records and this release does not carry. Both are ../migrate's. `newer` is the line naming a
// console newer than the one asking, and empty where there is none.
func ConfirmMigration(
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
	if len(pending) == 0 {
		above(to, newer)
		return Confirmed
	}

	// the names are what the question is about, so they are drawn on the question's own screen
	// rather than under whatever the run printed ahead of them (./clear.go). a run at a pipe is
	// cleared of nothing and keeps its record whole.
	clear(to)
	above(to, newer)
	object(to, at)
	fmt.Fprintf(to, "this deploy applies %s to the live database, which cannot be\n"+
		"undone:\n", migrations(len(pending)))
	list(to, pending)

	if !attended(in, to) {
		return Unattended
	}
	return confirming(in, to)
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

// where a deployment answers, said once so that the door and ./redeploy.go's CarryingOnto agree
// about a deployment this console could read no address for.
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

// the door itself, put once the list has been named and the operator is known to be at it.
//
// **a form that failed is no answer and never the refusal.** the operator is standing at a terminal
// this console could not draw the question on, so nothing was put to them: reported as the refusal
// it would be ../../cmd/better-giving/update.go exiting 0 on "the database was left alone", which
// is a decision nobody made. the door stays shut either way and only the sentence differs.
//
// **the one failure that is an answer is the operator's own.** ctrl-c at the form is a press not
// made, which every prompt in this package reads as the value not given (./prompt.go) — and what
// they left is the database alone, which is the refusal.
func confirming(in io.Reader, to io.Writer) Confirmation {
	// false is where the confirm opens, so what an operator has to do to open the door is choose
	// the other one.
	apply := false
	asking := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("apply them to the live database?").
			Affirmative("Apply them").
			Negative("Leave the database alone").
			Value(&apply),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return Declined
	case err != nil:
		return Unattended
	case !apply:
		return Declined
	}
	return Confirmed
}

func list(to io.Writer, names []string) {
	for _, name := range names {
		fmt.Fprintf(to, "  %s\n", name)
	}
}
