package main

import (
	"strings"
	"testing"

	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/terminal"
)

// what this command does about the answer the one-way door came back with.
//
// the two that are not failures are told apart from each other: an operator who chose to leave the
// database alone made a decision and is told what it cost, and a run nobody was standing at made
// none — and a command that ended cleanly on the second reads as a deployment now carrying this
// release.

func TestADoorTheOperatorShutSaysWhatWasLeftAloneAndEndsTheCommandCleanly(t *testing.T) {
	said, on, err := atTheDoor(terminal.Declined)

	if on || err != nil {
		t.Errorf("a door shut on purpose = %v, %v, want a press not made", on, err)
	}
	if !strings.Contains(said, "database") || !strings.Contains(said, "nothing was uploaded") {
		t.Errorf("said %q, want both halves of what did not happen", said)
	}
}

func TestADoorNobodyWasAtEndsTheCommandAsAFailure(t *testing.T) {
	said, on, err := atTheDoor(terminal.Unattended)

	if on {
		t.Error("a command went on past a door nobody answered")
	}
	if err == nil {
		t.Fatal("a run nobody was at ended cleanly, which reads as a deployment carrying this release")
	}
	if said != "" {
		t.Errorf("said %q as well as failing, want the failure alone", said)
	}
	for _, want := range []string{"nothing was applied", "nothing was uploaded", "terminal"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("said %q, want %q in it", err, want)
		}
	}
}

func TestADeploymentAheadOfThisBinaryEndsTheCommandAsAFailure(t *testing.T) {
	_, on, err := atTheDoor(terminal.Ahead)

	if on {
		t.Error("a command went on past a deployment a newer console put up")
	}
	if err == nil || err.Error() != aheadOfThisBinary {
		t.Errorf("said %v, want %q", err, aheadOfThisBinary)
	}
}

func TestADoorTheOperatorOpenedGoesOnSayingNothing(t *testing.T) {
	said, on, err := atTheDoor(terminal.Confirmed)

	if !on || err != nil {
		t.Errorf("a door opened on purpose = %v, %v, want the deploy going on", on, err)
	}
	if said != "" {
		t.Errorf("said %q about a press that is about to run", said)
	}
}

func TestAnAnswerThisConsoleDidNotUnderstandLeavesTheOneWayDoorShut(t *testing.T) {
	// nothing reaches this today, and the door behind it cannot be undone: terminal.Confirmation is
	// a bare string and no exhaustiveness check stands between an unnamed value and a migration.
	for _, answered := range []terminal.Confirmation{"", "something else"} {
		said, on, err := atTheDoor(answered)

		if on {
			t.Errorf("%q opened a one-way door this console could not read the answer to", answered)
		}
		if err == nil {
			t.Fatalf("%q ended the command cleanly, which reads as a database left alone on purpose",
				answered)
		}
		if said != "" {
			t.Errorf("%q said %q as well as failing, want the failure alone", answered, said)
		}
		if !strings.Contains(err.Error(), "nothing was applied") {
			t.Errorf("%q said %v, want what did not happen", answered, err)
		}
	}
}

// what this command says about a redeploy that settled.
//
// a signal that took the ledger is no reading here and ./start_test.go is where it is one: this
// command holds nothing after it and prints where the deployment is either way.

func TestARedeployThatLandedIsReportedUpToDate(t *testing.T) {
	if err := afterTheCarry(effects.Carried{Kind: effects.Deployed}); err != nil {
		t.Errorf("afterTheCarry = %v, want the line that says the deployment carries this release",
			err)
	}
}

func TestARedeployThatDidNotLandIsReportedInWhateverAnsweredIt(t *testing.T) {
	err := afterTheCarry(effects.Carried{Kind: effects.NoDatabase})

	if err == nil {
		t.Fatal("a redeploy that did not land ended cleanly, which reads as one that carried")
	}
	if !strings.Contains(err.Error(), terminal.UpdateOutcome(effects.Carried{Kind: effects.NoDatabase})) {
		t.Errorf("said %v, want what the redeploy answered with", err)
	}
}

// what this command names in front of an upload that had no door in front of it.
//
// a release carrying no migration this database has not opens no door at all, so the screen that
// names the account and the address is never drawn — and that is the one path in this program that
// reaches an upload with nothing named.

var ontoAcme = terminal.Deployment{Account: "Acme Giving", Address: "https://give.acme.test"}

func TestAnUploadWithNoDoorInFrontOfItStillNamesTheAccountAndTheDeployment(t *testing.T) {
	said := undoored(nil, ontoAcme)

	if !strings.Contains(said, "Acme Giving") {
		t.Errorf("said %q, want the account this release is carried into", said)
	}
	if !strings.Contains(said, "https://give.acme.test") {
		t.Errorf("said %q, want the deployment it is carried onto", said)
	}
}

func TestAnUploadTheDoorAlreadyNamedItsObjectForSaysNothingASecondTime(t *testing.T) {
	if said := undoored([]string{"0007_donors.sql"}, ontoAcme); said != "" {
		t.Errorf("said %q, want the door's own screen to be the one that named it", said)
	}
}

func TestADeploymentAnsweringOnNoAddressIsStillNamedAsOne(t *testing.T) {
	said := undoored(nil, terminal.Deployment{Account: "Acme Giving"})

	if !strings.Contains(said, "no address this console can read") {
		t.Errorf("said %q, want an unreadable address said rather than left blank", said)
	}
}
