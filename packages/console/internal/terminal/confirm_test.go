package terminal

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"testing/iotest"
)

// the deployment a door is being opened on, as every case below names it.
var onDeployment = Deployment{Account: "Acme Giving", Address: "https://give.acme.test"}

// a release that would move the live database, which is the door with a list on it.
var oneMigration = []string{"0007_donors.sql"}

// the confirm driven over a reader, which is what the door's three answers are asserted through.
// the keystrokes are the field's own: `y` takes the affirmative, `n` the other one, and a return
// takes whichever of the two the confirm is standing on.
//
// the keystrokes go to ./confirming and not to ./ConfirmCarry, because a reader is not a terminal
// and ConfirmCarry refuses in front of the form over one: what is left to drive is the door, and
// the guard in front of it is its own case below. what each door stands on is ./carrying's and
// ./install.go's updatingConsole's, held to a case of its own.

func TestTheConfirmNamesEveryPendingMigrationInTheOrderItWouldApplyThem(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment,
		[]string{"0007_donors.sql", "0008_gifts.sql"}, nil, "")

	first := strings.Index(held.String(), "0007_donors.sql")
	second := strings.Index(held.String(), "0008_gifts.sql")
	if first < 0 || second < 0 {
		t.Fatalf("the pending migrations were not named: %q", held.String())
	}
	if first > second {
		t.Errorf("the migrations were named out of the order they apply in: %q", held.String())
	}
}

func TestTheDoorOpensOnlyWhereTheOperatorChoseToApplyThem(t *testing.T) {
	held := &bytes.Buffer{}
	if said := confirming(strings.NewReader("y"), held, carrying(oneMigration)); said != Confirmed {
		t.Errorf("applying them = %q, want %q", said, Confirmed)
	}

	// a return pressed at the confirm takes what it is standing on, and the carry stands on the
	// refusal: a hand resting on the keyboard is how a one-way door is opened by accident.
	for _, typed := range []string{"n", "\r"} {
		held := &bytes.Buffer{}
		if said := confirming(strings.NewReader(typed), held, carrying(oneMigration)); said != Declined {
			t.Errorf("%q = %q, want %q", typed, said, Declined)
		}
	}
}

func TestAConfirmStandingOnItsOwnActIsTakenByAReturn(t *testing.T) {
	// installing a console can be undone and an older console deploys older code, so that question
	// stands on the act rather than on leaving it (./install.go). the door in front of the database
	// is the other way round, and the case above holds it there.
	held := &bytes.Buffer{}
	if said := confirming(strings.NewReader("\r"), held, updatingConsole("0.9.0")); said != Confirmed {
		t.Errorf("a return at the console question = %q, want %q", said, Confirmed)
	}
}

func TestAFormThatFailedIsNoDecisionAndNeverTheRefusal(t *testing.T) {
	// a door that could not be drawn at a terminal is the state ./Unattended exists for: reported as
	// the refusal, it would be a command exiting 0 on "the database was left alone" — a decision
	// nobody made, which is the one thing this door may never say (../../cmd/better-giving/start.go).
	held := &bytes.Buffer{}
	if said := confirming(
		iotest.ErrReader(errors.New("the keyboard went away")), held, carrying(oneMigration),
	); said != Unattended {
		t.Errorf("a form that failed = %q, want %q", said, Unattended)
	}
}

func TestADoorTheOperatorClosedIsTheRefusalTheyChose(t *testing.T) {
	// ctrl-c at the door is a press not made and every prompt in this package reads one that way
	// (./prompt.go): the operator was standing at it, and what they left is the database alone.
	held := &bytes.Buffer{}
	if said := confirming(strings.NewReader("\x03"), held, carrying(oneMigration)); said != Declined {
		t.Errorf("a door the operator closed = %q, want %q", said, Declined)
	}
}

func TestADeploymentAheadOfThisBinaryIsRefusedWithNothingAsked(t *testing.T) {
	// a file this release does not carry was applied by a newer console, so this binary would carry
	// the app backwards while leaving that file's schema in place. it is not a thing to confirm.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment,
		[]string{"0007_donors.sql"}, []string{"0009_pledges.sql"}, "")
	if said != Ahead {
		t.Errorf("ConfirmCarry = %q, want %q", said, Ahead)
	}
	if !strings.Contains(held.String(), "0009_pledges.sql") {
		t.Errorf("the migration this binary does not carry was never named: %q", held.String())
	}
	if strings.Contains(held.String(), "Apply them") {
		t.Errorf("a door was offered on a deployment ahead of this binary: %q", held.String())
	}
}

func TestACarryWithNothingToApplyStillNamesItsObjectAndAsks(t *testing.T) {
	// `start` carries onto a deployment that is already standing whether or not this release moves
	// the database, so the operator answers for the upload on that path too — and the account and
	// the address are on the door's own screen, because no other screen names them.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment, nil, nil, "")

	if said != Unattended {
		t.Errorf("ConfirmCarry over a reader nobody is at = %q, want %q", said, Unattended)
	}
	for _, want := range []string{onDeployment.Account, onDeployment.Address} {
		if !strings.Contains(held.String(), want) {
			t.Errorf("said %q, want %q named above the question", held.String(), want)
		}
	}
	if !strings.Contains(held.String(), "applies nothing") {
		t.Errorf("said %q, want a release that moves the database nowhere said as one", held.String())
	}
}

func TestTheQuestionIsAboutTheUploadWhereThereIsNothingToApply(t *testing.T) {
	// a title about the live database over a release that applies nothing to it is a question about
	// something that is not happening.
	empty, pending := carrying(nil), carrying(oneMigration)

	if strings.Contains(empty.title, "database") {
		t.Errorf("the title is %q, want the deployment rather than the database", empty.title)
	}
	if !strings.Contains(pending.title, "database") {
		t.Errorf("the title is %q, want what the migrations are applied to", pending.title)
	}
	if empty.opens || pending.opens {
		t.Error("a carry stands on the act, and every keystroke that is not the operator choosing " +
			"it leaves the deployment as it stands")
	}
}

func TestAConfirmNobodyIsAtNamesTheListAndLeavesTheDatabaseAlone(t *testing.T) {
	// a command run over a pipe reaches the door like every other and is refused at it: a form
	// drawn at a reader nobody is at is one nobody answers, and the answer that opens a one-way
	// door is never the one nobody gave. what still goes out is the list, so a piped run says what
	// it would have applied.
	//
	// it is its own answer and not the refusal: nobody shut this door, so a command that reported
	// it as one an operator shut would be reporting a decision nobody made.
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader("y"), held, onDeployment,
		[]string{"0007_donors.sql"}, nil, "")
	if said != Unattended {
		t.Errorf("ConfirmCarry over a reader nobody is at = %q, want %q", said, Unattended)
	}
	if !strings.Contains(held.String(), "0007_donors.sql") {
		t.Errorf("the migration was never named: %q", held.String())
	}
	if strings.Contains(held.String(), "Apply them") {
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
	ConfirmCarry(strings.NewReader("n"), held, onDeployment,
		[]string{"0007_donors.sql"}, nil, newerConsole)

	line := strings.Index(held.String(), newerConsole)
	door := strings.Index(held.String(), "0007_donors.sql")
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
	ConfirmCarry(strings.NewReader("y"), held, onDeployment,
		[]string{"0007_donors.sql"}, []string{"0009_pledges.sql"}, newerConsole)

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

func TestTheNewerConsoleIsNamedWhereThereIsNothingToApplyEither(t *testing.T) {
	held := &bytes.Buffer{}
	said := ConfirmCarry(strings.NewReader(""), held, onDeployment, nil, nil, newerConsole)
	if said != Unattended {
		t.Errorf("ConfirmCarry = %q, want %q", said, Unattended)
	}
	if !strings.Contains(held.String(), newerConsole) {
		t.Errorf("said %q, want the newer console named on a run with no question to ask", held.String())
	}
}

func TestNothingIsDrawnAboveTheDoorWhereThisConsoleIsTheCurrentOne(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader(""), held, onDeployment, nil, nil, "")
	if strings.Contains(held.String(), "of this console is out") {
		t.Errorf("said %q, want nothing to install said as nothing", held.String())
	}
}

// what the door is about, which is a deployment and not "the live database".
//
// the screen was cleared a line before the count, so nothing the command printed earlier is on it:
// an operator whose machine has ever operated two deployments, or whose remembered account is not
// the one they have in mind, answers this off what is in front of them or not at all.

func TestTheDoorNamesTheAccountAndTheDeploymentAboveTheCount(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, onDeployment,
		[]string{"0007_donors.sql"}, nil, "")

	account := strings.Index(held.String(), onDeployment.Account)
	address := strings.Index(held.String(), onDeployment.Address)
	count := strings.Index(held.String(), "1 migration")
	if account < 0 {
		t.Fatalf("the account the deploy would write into was never named: %q", held.String())
	}
	if address < 0 {
		t.Fatalf("the deployment the migration would be applied to was never named: %q", held.String())
	}
	if count < 0 {
		t.Fatalf("the count was never drawn: %q", held.String())
	}
	if account > count || address > count {
		t.Errorf("the object was named under the count rather than above it: %q", held.String())
	}
}

func TestADeploymentAnsweringOnNoAddressIsSaidRatherThanLeftBlank(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("n"), held, Deployment{Account: "Acme Giving"},
		[]string{"0007_donors.sql"}, nil, "")

	if !strings.Contains(held.String(), "no address this console can read") {
		t.Errorf("said %q, want a deployment with no readable address said as one", held.String())
	}
}

// the count and its noun, inflected the way ./outcome.go's heldBack inflects its own.
//
// the parenthetical plural was the one in the program, and it was at the one screen that has to be
// read carefully.

func TestTheCountInflectsItsOwnNounAtBothDoors(t *testing.T) {
	for _, held := range []struct {
		names []string
		want  string
	}{
		{[]string{"0007_donors.sql"}, "1 migration to"},
		{[]string{"0007_donors.sql", "0008_gifts.sql"}, "2 migrations to"},
	} {
		said := &bytes.Buffer{}
		ConfirmCarry(strings.NewReader("n"), said, onDeployment, held.names, nil, "")
		if !strings.Contains(said.String(), held.want) {
			t.Errorf("said %q, want %q", said.String(), held.want)
		}
		if strings.Contains(said.String(), "migration(s)") {
			t.Errorf("said %q, want a plural chosen from the count", said.String())
		}
	}

	said := &bytes.Buffer{}
	ConfirmCarry(strings.NewReader("y"), said, onDeployment,
		[]string{"0007_donors.sql"}, []string{"0009_pledges.sql"}, "")
	if !strings.Contains(said.String(), "1 migration") {
		t.Errorf("said %q, want the count inflected on the refusal too", said.String())
	}
	if strings.Contains(said.String(), "migration(s)") {
		t.Errorf("said %q, want a plural chosen from the count", said.String())
	}
}
