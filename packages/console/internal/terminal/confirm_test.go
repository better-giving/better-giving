package terminal

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/better-giving/console/internal/release"
)

// the deployment a door is being opened on, as every case below names it, and the release this
// binary would put on it.
var onDeployment = Deployment{
	Account: "Acme Giving",
	Address: "https://give.acme.test",
	Release: "1.3.2",
}

const carried = "1.4.0"

// the door driven over a reader, which is what its answers are asserted through.
//
// the keystrokes are the list's own: it opens on the row the door stands on, `k` and `j` move off
// it, and a return takes the row the cursor is on. ./install.go's question is a confirm and keeps
// the two keys a confirm has, which is ./confirming's case below.
//
// the keystrokes go to ./deciding and not to ./ConfirmCarry, because a reader is not a terminal
// and ConfirmCarry refuses in front of the form over one: what is left to drive is the door, and
// the guard in front of it is its own case below. what each door stands on is ./carrying's and
// ./install.go's updatingConsole's, held to a case of its own.

func TestTheDoorOpensOnlyWhereTheOperatorChoseTheUpdate(t *testing.T) {
	held := &bytes.Buffer{}
	if said := deciding(
		strings.NewReader("k\r"), held, carrying(carried),
	); said != Confirmed {
		t.Errorf("choosing the update = %q, want %q", said, Confirmed)
	}

	// a return pressed at the door takes the row it stands on, and the carry stands on the refusal: a
	// hand resting on the keyboard is how an update, and the migrations in it, go through by accident.
	held = &bytes.Buffer{}
	if said := deciding(
		strings.NewReader("\r"), held, carrying(carried),
	); said != Declined {
		t.Errorf("a return at the door = %q, want %q", said, Declined)
	}
}

func TestAConfirmStandingOnItsOwnActIsTakenByAReturn(t *testing.T) {
	// installing a console can be undone and an older console deploys older code, so that question
	// stands on the act rather than on leaving it (./install.go). the door in front of a deployment
	// is the other way round, and the case above holds it there.
	held := &bytes.Buffer{}
	if said := confirming(strings.NewReader("\r"), held, updatingConsole("0.9.0")); said != Confirmed {
		t.Errorf("a return at the console question = %q, want %q", said, Confirmed)
	}
}

func TestAFormThatFailedIsNoDecisionAndNeverTheRefusal(t *testing.T) {
	// a door that could not be drawn at a terminal is the state ./Unattended exists for: reported as
	// the refusal, it would be a command exiting 0 on "left on its current version" — a decision
	// nobody made, which is the one thing this door may never say (../../cmd/better-giving/start.go).
	held := &bytes.Buffer{}
	if said := deciding(
		iotest.ErrReader(errors.New("the keyboard went away")), held,
		carrying(carried),
	); said != Unattended {
		t.Errorf("a form that failed = %q, want %q", said, Unattended)
	}
}

func TestADoorTheOperatorClosedIsTheRefusalTheyChose(t *testing.T) {
	// ctrl-c at the door is a press not made and every prompt in this package reads one that way
	// (./prompt.go): the operator was standing at it, and what they left is the deployment as it is.
	held := &bytes.Buffer{}
	if said := deciding(
		strings.NewReader("\x03"), held, carrying(carried),
	); said != Declined {
		t.Errorf("a door the operator closed = %q, want %q", said, Declined)
	}
}

func TestADeploymentAheadOfThisBinaryIsRefusedWithNothingAsked(t *testing.T) {
	// a file this release does not carry was applied by a newer console, so this binary would carry
	// the app backwards while leaving that file's schema in place. it is not a thing to confirm.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment, carried,
		[]string{"0009_pledges.sql"}, "")
	if said != Ahead {
		t.Errorf("ConfirmCarry = %q, want %q", said, Ahead)
	}
	if !strings.Contains(held.String(), "0009_pledges.sql") {
		t.Errorf("the migration this binary does not carry was never named: %q", held.String())
	}
	if strings.Contains(held.String(), "Update deployment") {
		t.Errorf("a door was offered on a deployment ahead of this binary: %q", held.String())
	}
}

func TestACarryNamesItsObjectAndAsks(t *testing.T) {
	// the account and the address are on the door's own screen, because no other screen names them.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment, carried, nil, "")

	if said != Unattended {
		t.Errorf("ConfirmCarry over a reader nobody is at = %q, want %q", said, Unattended)
	}
	for _, want := range []string{onDeployment.Account, onDeployment.Address} {
		if !strings.Contains(held.String(), want) {
			t.Errorf("said %q, want %q named above the question", held.String(), want)
		}
	}
}

func TestTheQuestionScreenSaysNothingAboutMigrations(t *testing.T) {
	// the operator answers for the update and its migrations apply as part of it, so the screen
	// names none of them and says nothing about the database.
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("y"), held, onDeployment, carried, nil, "")

	for _, unwanted := range []string{"database", "migration", "undone"} {
		if strings.Contains(held.String(), unwanted) {
			t.Errorf("said %q, want nothing about %q on the question screen", held.String(), unwanted)
		}
	}
}

func TestTheQuestionIsTheUpdateAndStandsOnKeepingTheCurrentVersion(t *testing.T) {
	put := carrying(carried)

	if put.title != "update your deployment?" {
		t.Errorf("the title is %q, want the update", put.title)
	}
	if put.opens {
		t.Error("a carry stands on keeping the current version, and every keystroke that is not the " +
			"operator choosing the update leaves the deployment as it stands")
	}
}

func TestAConfirmNobodyIsAtDrawsNoForm(t *testing.T) {
	// a command run over a pipe reaches the door like every other and is refused at it: a form
	// drawn at a reader nobody is at is one nobody answers, and the answer that runs an update is
	// never the one nobody gave.
	//
	// it is its own answer and not the refusal: nobody shut this door, so a command that reported
	// it as one an operator shut would be reporting a decision nobody made.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment, carried, nil, "")
	if said != Unattended {
		t.Errorf("ConfirmCarry over a reader nobody is at = %q, want %q", said, Unattended)
	}
	if strings.Contains(held.String(), "Update deployment") {
		t.Errorf("a form was drawn at nobody: %q", held.String())
	}
}

// the line about a console newer than this one, drawn on the screen the question is put on.
//
// it is handed in rather than read here: what says whether a newer release exists is the caller's
// (../../cmd/better-giving/main.go), and this end only draws it where the door is named — which is
// the moment it exists to inform, and the moment ./clear has just taken every earlier line off the
// screen.

const newerConsole = "version 0.9.0 of this console is out"

func TestTheNewerConsoleIsNamedOnTheScreenTheDoorIsDrawnOn(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, carried, nil, newerConsole)

	line := strings.Index(held.String(), newerConsole)
	door := strings.Index(held.String(), onDeployment.Account)
	if line < 0 {
		t.Fatalf("the newer console was never named: %q", held.String())
	}
	if line > door {
		t.Errorf("the newer console was named under the door rather than above it: %q", held.String())
	}
}

func TestTheNewerConsoleIsNamedWhereThisBinaryIsBehindTheDeploymentToo(t *testing.T) {
	// the one reading where installing it is the whole act: this binary cannot carry a deployment
	// forward that a newer console already moved.
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("y"), held, onDeployment, carried,
		[]string{"0009_pledges.sql"}, newerConsole)

	line := strings.Index(held.String(), newerConsole)
	block := strings.Index(held.String(), "newer console:")
	if line < 0 {
		t.Fatalf("the newer console was never named: %q", held.String())
	}
	if block < 0 {
		t.Fatalf("the refusal this line stands over was never drawn: %q", held.String())
	}
	if line > block {
		t.Errorf("the newer console was named under the block rather than above it: %q", held.String())
	}
}

func TestTheNewerConsoleIsNamedWhereNobodyIsAtTheDoor(t *testing.T) {
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader(""), held, onDeployment, carried, nil, newerConsole)
	if said != Unattended {
		t.Errorf("ConfirmCarry = %q, want %q", said, Unattended)
	}
	if !strings.Contains(held.String(), newerConsole) {
		t.Errorf("said %q, want the newer console named on a run with no question to ask", held.String())
	}
}

func TestNothingIsDrawnAboveTheDoorWhereThisConsoleIsTheCurrentOne(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader(""), held, onDeployment, carried, nil, "")
	if strings.Contains(held.String(), "of this console is out") {
		t.Errorf("said %q, want nothing to install said as nothing", held.String())
	}
}

// what the door is about, which is a deployment.
//
// the screen was cleared a line before the count, so nothing the command printed earlier is on it:
// an operator whose machine has ever operated two deployments, or whose remembered account is not
// the one they have in mind, answers this off what is in front of them or not at all.

func TestTheDoorNamesTheAccountAndTheDeployment(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, carried, nil, "")

	if !strings.Contains(held.String(), onDeployment.Account) {
		t.Errorf("the account the deploy would write into was never named: %q", held.String())
	}
	if !strings.Contains(held.String(), onDeployment.Address) {
		t.Errorf("the deployment the update would reach was never named: %q", held.String())
	}
}

func TestADeploymentAnsweringOnNoAddressIsSaidRatherThanLeftBlank(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, Deployment{Account: "Acme Giving"}, carried, nil, "")

	if !strings.Contains(held.String(), "no address this console can read") {
		t.Errorf("said %q, want a deployment with no readable address said as one", held.String())
	}
}

// the count and its noun, inflected the way ./outcome.go's heldBack inflects its own.
//
// the parenthetical plural was the one in the program, and it was at the one screen that has to be
// read carefully.

func TestTheCountInflectsItsOwnNounOnTheRefusal(t *testing.T) {
	for _, held := range []struct {
		ahead []string
		want  string
	}{
		{[]string{"0009_pledges.sql"}, "1 migration this"},
		{[]string{"0009_pledges.sql", "0010_funds.sql"}, "2 migrations this"},
	} {
		said := &bytes.Buffer{}
		ConfirmCarry(strings.NewReader("y"), said, onDeployment, carried, held.ahead, "")
		if !strings.Contains(flowing(said.String()), held.want) {
			t.Errorf("said %q, want %q", said.String(), held.want)
		}
		if strings.Contains(said.String(), "migration(s)") {
			t.Errorf("said %q, want a plural chosen from the count", said.String())
		}
	}
}

// the two releases this door weighs, which are the numbers an operator answers it off.
//
// the account and the address say which deployment; these say what would happen to it. neither is
// on any other screen of a run that carries, and the screen was erased a line before them.

func TestTheDoorNamesTheReleaseOnOfferAndTheOneTheDeploymentIsOn(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, carried, nil, "")

	for _, want := range []string{carried, onDeployment.Release} {
		if !strings.Contains(held.String(), want) {
			t.Errorf("said %q, want %q named on the door", held.String(), want)
		}
	}
}

func TestTheDoorStatesBothReleasesOnOneLineUnderWhereItAnswers(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, carried, nil, "")

	want := "version: " + onDeployment.Release + " \u2192 " + carried
	pair := strings.Index(held.String(), want)
	if pair < 0 {
		t.Fatalf("said %q, want %q", held.String(), want)
	}
	if pair < strings.Index(held.String(), onDeployment.Address) {
		t.Errorf("said %q, want the pair under where the deployment answers", held.String())
	}
}

func TestADeploymentThisConsoleReadNoReleaseOffIsSaidAsUnknown(t *testing.T) {
	// ../effects' OwnRelease answers empty for every way of not finding out, and the door says
	// outright that this console could not read one: the pair is what the operator answers off, and
	// a run that drew no line at all left them weighing the offer against nothing.
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held,
		Deployment{Account: onDeployment.Account, Address: onDeployment.Address}, carried,
		nil, "")

	if !strings.Contains(held.String(), "version: unknown \u2192 "+carried) {
		t.Errorf("said %q, want the release this console could not read said as unknown",
			held.String())
	}
}

func TestNoScreenPutsTheOfferedReleaseAsNewsOfItsOwn(t *testing.T) {
	// the version pair is the news and the question under it is the act, so a sentence announcing
	// the release over them is the same fact a third time.
	for _, held := range []struct {
		what     string
		at       Deployment
		offering string
		ahead    []string
		newer    string
	}{
		{"a carry", onDeployment, carried, nil, ""},
		{"a carry under a newer console", onDeployment, carried, nil, newerConsole},
		{"a deployment ahead of this binary", onDeployment, carried,
			[]string{"0009_pledges.sql"}, ""},
		{"a binary naming no release", onDeployment, "dev", nil, ""},
	} {
		said := &bytes.Buffer{}
		ConfirmCarry(strings.NewReader("n"), said, held.at, held.offering, held.ahead, held.newer)
		if strings.Contains(said.String(), "A new version") {
			t.Errorf("%s said %q, want the version line to carry the news alone",
				held.what, said.String())
		}
	}
}

func TestTheTwoAnswersAreTheActsThemselvesAndNameNoRelease(t *testing.T) {
	// both releases are on the version line above the question (./object), so an answer that named
	// one again would be the same number twice on one screen.
	put := carrying(carried)

	if put.apply != "Update deployment" || put.leave != "Keep current version" {
		t.Errorf("the answers are %q / %q, want the two acts", put.apply, put.leave)
	}
	for _, said := range []string{put.apply, put.leave} {
		if strings.Contains(said, carried) || strings.Contains(said, onDeployment.Release) {
			t.Errorf("the answer %q names a release the facts above it already carry", said)
		}
	}
}

func TestABinaryThatNamesNoReleaseOffersNoneAndPointsAtNoNotes(t *testing.T) {
	// `dev` is what a `go build` in this repository leaves (../../cmd/better-giving/main.go): there
	// is no tag on the releases page for it, so the door is the carry it has always been.
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, "dev", nil, "")

	for _, unwanted := range []string{"dev", "version:", "release notes"} {
		if strings.Contains(held.String(), unwanted) {
			t.Errorf("said %q, want no version and no notes over a binary that names none: %q",
				held.String(), unwanted)
		}
	}
	if put := carrying(""); put.title != "carry this release onto the deployment?" {
		t.Errorf("the title is %q, want the carry asked without a release to name", put.title)
	}
}

func TestTheNotesTheDoorPointsAtAreTheOfferedReleasesOwnPage(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment, carried, nil, "")

	if !strings.Contains(held.String(), release.Notes(carried)) {
		t.Errorf("said %q, want %q", held.String(), release.Notes(carried))
	}
	notes := strings.Index(held.String(), release.Notes(carried))
	address := strings.Index(held.String(), onDeployment.Address)
	if notes < address {
		t.Errorf("said %q, want what the release carries under where the deployment answers",
			held.String())
	}
}

// the two answers, and that there is no third.
//
// the list stands on the refusal and comes round to the act from it, so the row under the refusal
// is the act itself: a door carrying a third answer is one that row lands on instead. an operator
// holding the wrong account quits and runs the command again.

func TestEveryDoorPutsTwoAnswersAndNothingUnderThem(t *testing.T) {
	for _, put := range []question{
		carrying(carried),
		carrying(""),
	} {
		held := &bytes.Buffer{}
		if said := deciding(strings.NewReader("j\r"), held, put); said != Confirmed {
			t.Errorf("%q: the row under the refusal = %q, want the list come round to the act",
				put.title, said)
		}
	}
}

func TestTheDoorsBlocksStandOneBlankLineApart(t *testing.T) {
	// the line about the console and the facts are two blocks, and a screen that ran them together is
	// the wall this measure exists against.
	said := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader(""), said, onDeployment, carried, nil,
		"version 0.4.0 of this console is out")

	if strings.Contains(said.String(), "\n\n\n") {
		t.Errorf("said %q, want blocks one blank line apart", said.String())
	}
	if blocks := strings.Count(said.String(), "\n\n"); blocks != 2 {
		t.Errorf("said %q, which is %d blocks and not the two this door draws", said.String(),
			blocks)
	}
}
