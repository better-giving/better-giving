package terminal

import (
	"fmt"
	"io"

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
// **the list is named at a reader nobody is at, and the door is not opened there.** ./prompt.go's
// rule is this one's too: a form drawn at a pipe is one nobody ever answers, so a command that put
// one there would stand at it waiting on an answer that is not coming. the names go out either way
// — a run over a pipe still says what it would have applied — and the answer is the refusal.

// Confirmation is how the door was answered.
type Confirmation string

const (
	// Confirmed is the door opened on purpose, which is also the answer where there is no door.
	Confirmed Confirmation = "confirmed"
	// Declined is every other end of the question, a prompt this console could not put among them.
	Declined Confirmation = "declined"
	// Ahead is a deployment put up by a newer console, which is refused outright.
	Ahead Confirmation = "ahead"
)

// ConfirmMigration names what a deploy would apply to the live database and takes the operator's
// answer for it.
//
// `pending` is what this release carries and the database has not, in the order it applies them;
// `ahead` is what the database records and this release does not carry. Both are ../migrate's.
func ConfirmMigration(in io.Reader, to io.Writer, pending, ahead []string) Confirmation {
	if len(ahead) > 0 {
		fmt.Fprintf(to, "this deployment was put up by a newer console: its database records %d\n"+
			"migration(s) this binary does not carry, so nothing here can carry it forward.\n",
			len(ahead))
		list(to, ahead)
		return Ahead
	}
	if len(pending) == 0 {
		return Confirmed
	}

	// the names are what the question is about, so they are drawn on the question's own screen
	// rather than under whatever the run printed ahead of them (./clear.go). a run at a pipe is
	// cleared of nothing and keeps its record whole.
	clear(to)
	fmt.Fprintf(to, "this deploy applies %d migration(s) to the live database, which cannot be\n"+
		"undone:\n", len(pending))
	list(to, pending)

	if !attended(in) {
		return Declined
	}
	return confirming(in, to)
}

// the door itself, put once the list has been named and the operator is known to be at it.
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

	if err := asking.Run(); err != nil || !apply {
		return Declined
	}
	return Confirmed
}

func list(to io.Writer, names []string) {
	for _, name := range names {
		fmt.Fprintf(to, "  %s\n", name)
	}
}
