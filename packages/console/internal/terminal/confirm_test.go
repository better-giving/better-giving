package terminal

import (
	"bytes"
	"strings"
	"testing"
)

// the confirm driven over a reader, which is what the door's three answers are asserted through.
// the keystrokes are the field's own: `y` applies them, `n` leaves the database alone, and a return
// takes whichever of the two the confirm is standing on — which is the second one, always.
//
// the keystrokes go to ./confirming and not to ./ConfirmMigration, because a reader is not a
// terminal and ConfirmMigration refuses in front of the form over one: what is left to drive is the
// door, and the guard in front of it is its own case below.

func TestTheConfirmNamesEveryPendingMigrationInTheOrderItWouldApplyThem(t *testing.T) {
	held := &bytes.Buffer{}
	ConfirmMigration(strings.NewReader("n"), held,
		[]string{"0007_donors.sql", "0008_gifts.sql"}, nil)

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
	if said := confirming(strings.NewReader("y"), held); said != Confirmed {
		t.Errorf("applying them = %q, want %q", said, Confirmed)
	}

	// a return pressed at the confirm takes what it is standing on, and it stands on the refusal: a
	// hand resting on the keyboard is how a one-way door is opened by accident.
	for _, typed := range []string{"n", "\r"} {
		held := &bytes.Buffer{}
		if said := confirming(strings.NewReader(typed), held); said != Declined {
			t.Errorf("%q = %q, want %q", typed, said, Declined)
		}
	}
}

func TestADeploymentAheadOfThisBinaryIsRefusedWithNothingAsked(t *testing.T) {
	// a file this release does not carry was applied by a newer console, so this binary would carry
	// the app backwards while leaving that file's schema in place. it is not a thing to confirm.
	held := &bytes.Buffer{}
	said := ConfirmMigration(strings.NewReader("y"), held,
		[]string{"0007_donors.sql"}, []string{"0009_pledges.sql"})
	if said != Ahead {
		t.Errorf("ConfirmMigration = %q, want %q", said, Ahead)
	}
	if !strings.Contains(held.String(), "0009_pledges.sql") {
		t.Errorf("the migration this binary does not carry was never named: %q", held.String())
	}
	if strings.Contains(held.String(), "Apply them") {
		t.Errorf("a door was offered on a deployment ahead of this binary: %q", held.String())
	}
}

func TestNothingIsAskedWhereThereIsNoDoorToOpen(t *testing.T) {
	// a release carrying no migration this database has not is a deploy that opens the one-way door
	// on nothing, and a prompt naming an empty list is a question about nothing.
	held := &bytes.Buffer{}
	if said := ConfirmMigration(strings.NewReader(""), held, nil, nil); said != Confirmed {
		t.Errorf("ConfirmMigration = %q, want %q", said, Confirmed)
	}
	if held.String() != "" {
		t.Errorf("something was asked: %q", held.String())
	}
}

func TestAConfirmNobodyIsAtNamesTheListAndLeavesTheDatabaseAlone(t *testing.T) {
	// a command run over a pipe reaches the door like every other and is refused at it: a form
	// drawn at a reader nobody is at is one nobody answers, and the answer that opens a one-way
	// door is never the one nobody gave. what still goes out is the list, so a piped run says what
	// it would have applied.
	held := &bytes.Buffer{}
	said := ConfirmMigration(strings.NewReader("y"), held, []string{"0007_donors.sql"}, nil)
	if said != Declined {
		t.Errorf("ConfirmMigration over a reader nobody is at = %q, want %q", said, Declined)
	}
	if !strings.Contains(held.String(), "0007_donors.sql") {
		t.Errorf("the migration was never named: %q", held.String())
	}
	if strings.Contains(held.String(), "Apply them") {
		t.Errorf("a form was drawn at nobody: %q", held.String())
	}
}
