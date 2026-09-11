package terminal

import (
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/charmbracelet/huh"

	"github.com/better-giving/console/internal/release"
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
// (./carrying) and the screen says nothing whatever about the database (./naming). what stays is
// the object: an operator whose machine has operated two deployments answers off the account and
// the address on it or not at all.
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
//
// **it names both releases and points at what the offered one changes, for the same reason again.**
// what is being asked for is a deployment moved from one release to another, and neither number is
// on any other screen of the run: the release this binary carries is what would go on, the release
// the deployment says it is on is what it is leaving, and ../release's Notes is where the first of
// them states what it carries. neither is guessed at — a binary a plain `go build` left carries no
// release at all and names none here, and a deployment this console could not read a release off is
// ../effects' OwnRelease answering empty, which is every way of not finding out and no number
// (./object).

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

// Deployment is what a door is being opened on: whose account it is in, where it answers, and which
// release it says it is on.
type Deployment struct {
	// Account is the cloudflare account the deployment is in, by the name it carries there.
	Account string
	// Address is where the deployment answers, and empty where the caller could read none.
	Address string
	// Release is the release the deployment is on, and empty where the caller could not find out —
	// which is what ../effects' OwnRelease answers for every way of not finding out.
	Release string
}

// ConfirmCarry names what a carry onto a standing deployment would do and takes the operator's
// answer for it.
//
// `at` is the deployment the answer is about, drawn above the count. `offering` is the release this
// binary would put on it, as ../../cmd/better-giving/main.go's version states it. `pending` is what
// this release carries and the database has not, in the order it applies them; `ahead` is what the
// database records and this release does not carry. Both are ../migrate's. `newer` is the line
// naming a console newer than the one asking, and empty where there is none.
func ConfirmCarry(
	in io.Reader,
	to io.Writer,
	at Deployment,
	offering string,
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

	named, notes := offered(offering)
	// what the question is about is drawn on the question's own screen rather than under whatever
	// the run printed ahead of it (./clear.go). a run at a pipe is cleared of nothing and keeps its
	// record whole.
	clear(to)
	above(to, newer)
	object(to, at, notes)
	weighing(to, named)
	naming(to, pending)

	if !attended(in, to) {
		return Unattended
	}
	return deciding(in, to, carrying(named, pending))
}

// the release this binary would put on the deployment, as this screen names it: the version itself,
// and where that release states what it carries.
//
// **a version with no release behind it is named nowhere on the screen.** `dev` is what a plain `go
// build` in this repository leaves (../../cmd/better-giving/main.go): the releases page carries no
// tag for it, so an operator offered it reads a number that answers nothing and a link to a page
// that is not there. what they get instead is the door as it stands without one.
func offered(version string) (named, notes string) {
	if notes = release.Notes(version); notes == "" {
		return "", ""
	}
	return version, notes
}

// that a release newer than the deployment's is out, above what the deploy would do.
//
// **it is news because this door is never put in front of a deployment already carrying it**:
// ../../cmd/better-giving/start.go's alreadyCarrying prints the address and opens the console
// instead. which release the deployment is on is a fact about the deployment and is drawn with the
// rest of them (./object).
func weighing(to io.Writer, offering string) {
	if offering == "" {
		return
	}
	fmt.Fprintf(to, "A new version of better-giving is available %s\n", offering)
}

// what the carry would do to the live database, which is a list of files where there is one and
// nothing at all where there is not.
//
// **a change that cannot hurt is not announced.** a sentence about the database on a screen where
// nothing touches the database reads as a warning, and this one is not one.
func naming(to io.Writer, pending []string) {
	if len(pending) == 0 {
		return
	}
	fmt.Fprintf(to, "this deploy applies %s to the live database, which cannot be\n"+
		"undone:\n", migrations(len(pending)))
	list(to, pending)
}

// the question this door puts, which is a different question where there is nothing to apply.
//
// **the one about the live database is the one that never softens.** what a migration does is what
// it does: the sentence, the list under it and these two answers are the same words on a screen
// naming two releases as on one naming none.
//
// **the answers name no release where the screen above them names two.** the release on offer and
// the one the deployment is on are both facts on that screen (./object, ./weighing), so an answer
// spelling either of them again is the same number twice — and the act is the whole of what is
// being chosen between.
//
// **a release this binary cannot name asks the question it always asked.** `offering` is empty for
// exactly that binary (./offered), so there is no news above these answers and the words that name
// the deployment are what is left to choose between.
//
// all three stand on leaving the deployment as it is: the one-way door for the reason this file
// opens on, and the upload because a `start` that carries nothing still opens the console at a
// deployment that is already serving (../../cmd/better-giving/start.go).
func carrying(offering string, pending []string) question {
	if len(pending) > 0 {
		return question{
			title: "apply them to the live database?",
			apply: "Apply them",
			leave: "Leave the database alone",
		}
	}
	if offering == "" {
		return question{
			title: "carry this release onto the deployment?",
			apply: "Carry it over",
			leave: "Leave the deployment alone",
		}
	}
	return question{
		title: "update your deployment?",
		apply: "Update deployment",
		leave: "Keep current version",
	}
}

// what stands over a question, with a blank line under it so that the question below reads as its
// own. nothing at all where the caller has nothing to say.
func above(to io.Writer, line string) {
	if line == "" {
		return
	}
	fmt.Fprintf(to, "%s\n\n", line)
}

// what the act would be applied to, one fact to the line, with a blank line under it so that what
// follows reads as its own.
//
// a deployment answering on no address this console can read is said as that rather than left
// blank: a line with nothing after it reads as a value that went missing on the way here.
//
// **the release the deployment is on is left off the screen in that same state rather than said.**
// the address is what the door is about and an operator needs to know this console could not read
// one; the release is what the deploy would move them off, and ../effects' OwnRelease answering
// empty is not having found out — so there is nothing to say, and a label with nothing after it
// would read as a value lost on the way here.
//
// `notes` is where the release on offer states what it carries, drawn under the address because it
// is the one line here an operator can leave the terminal and read, and empty where this binary
// names no release (./offered).
func object(to io.Writer, at Deployment, notes string) {
	if at.Account != "" {
		fmt.Fprintf(to, "Cloudflare account: %s\n", at.Account)
	}
	fmt.Fprintf(to, "deployment: %s\n", answering(at))
	if at.Release != "" {
		fmt.Fprintf(to, "ver: %s\n", at.Release)
	}
	if notes != "" {
		fmt.Fprintf(to, "release notes: %s\n", Code(notes))
	}
	fmt.Fprintln(to)
}

// where a deployment answers, or that this console could read no address for it.
//
// said rather than left blank, which is ./object's reading of every absent value on that screen: a
// line with nothing after it reads as a value that went missing on the way here.
func answering(at Deployment) string {
	if at.Address == "" {
		return "no address this console can read"
	}
	return Code(at.Address)
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
	// opens is whether a return takes the act. False is a question standing on leaving things as
	// they are, which every door in front of a deployment does; ./install.go argues the one that
	// does not.
	opens bool
}

// the door itself, put once what it is about has been named and the operator is known to be at it.
//
// **it is a list rather than a confirm because its answers are two acts and not a yes and a no.**
// each row says what it would do to the deployment, which is what an operator is choosing between
// here; ./confirming is the other shape and ./install.go is what puts it.
//
// **the row the list opens on is the one the question stands on**, which is huh's own arrangement:
// the value the field is bound to is the row under the cursor when it is drawn, so a return takes
// what `opens` says and nothing else does (./account.go takes the same reading).
//
// ./confirming's two failures are read the same way here and for the same reasons: a form that could
// not be drawn is no answer and never the refusal, and the operator's own ctrl-c is the refusal.
func deciding(in io.Reader, to io.Writer, put question) Confirmation {
	answered := Declined
	if put.opens {
		answered = Confirmed
	}
	asking := huh.NewForm(huh.NewGroup(
		huh.NewSelect[Confirmation]().
			Title(put.title).
			Options(
				huh.NewOption(put.apply, Confirmed),
				huh.NewOption(put.leave, Declined),
			).
			Value(&answered),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return Declined
	case err != nil:
		return Unattended
	}
	return answered
}

// the two-answer confirm, which is the question in front of an act that can be undone
// (./install.go).
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
