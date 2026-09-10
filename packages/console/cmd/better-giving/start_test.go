package main

import (
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/terminal"
)

// what this command does about a chain that settled under a ledger a signal took.
//
// the operator pressed ctrl-c and was told the deploy is still going and that this terminal is
// waiting it out (../../internal/terminal's StillGoing). what they did not ask for is what stands
// on the other side of that wait: a port bound and a browser tab opened minutes later, with the
// process still holding the terminal they asked to be given back. what they did not ask to give up
// is knowing what the deploy did, which is the address of a deployment that now exists.

func TestAChainAConsoleStopWaitedOutSaysWhereTheDeploymentIsAndServesNoConsole(t *testing.T) {
	reporting, serving, err := afterTheChain(first.Outcome{Kind: first.Deployed}, true)

	if !reporting {
		t.Error("a deploy that landed under a stop went unsaid, so a deployment now stands unnamed")
	}
	if serving {
		t.Error("a console the operator stopped went on to serve and open a browser at itself")
	}
	if err != nil {
		t.Errorf("afterTheChain = %v, want a stop the operator asked for read as no failure", err)
	}
}

func TestAChainThatLandedWithNothingStoppingItGoesOnToServe(t *testing.T) {
	reporting, serving, err := afterTheChain(first.Outcome{Kind: first.Deployed}, false)

	if !reporting || !serving || err != nil {
		t.Errorf("afterTheChain = %v, %v, %v, want the console this command exists to open",
			reporting, serving, err)
	}
}

func TestAChainThatDidNotLandIsReportedWhetherOrNotASignalTookItsLedger(t *testing.T) {
	// a ctrl-c is a stop the operator asked for and a deploy that stopped in the middle is not one:
	// a command that ended quietly on the second would leave the database ahead of the code that
	// reads it with nothing said (CLAUDE.md).
	for _, halted := range []bool{false, true} {
		reporting, serving, err := afterTheChain(first.Outcome{Kind: first.NoDatabase}, halted)

		if reporting {
			t.Errorf("halted=%v named an address for a deployment the chain never stood up", halted)
		}
		if serving {
			t.Errorf("halted=%v served a console over a chain that did not land", halted)
		}
		if err == nil {
			t.Fatalf("halted=%v ended cleanly over a chain that did not land", halted)
		}
		if !strings.Contains(err.Error(), terminalOutcomeOf(t)) {
			t.Errorf("halted=%v said %v, want what the chain answered with", halted, err)
		}
	}
}

// the sentence a chain that found no database is answered with, as this command's own reporter
// draws it.
func terminalOutcomeOf(t *testing.T) string {
	t.Helper()
	return stopped(first.Outcome{Kind: first.NoDatabase}).Error()
}

// what this command says before it asks anything, and what it takes before it makes anything.
//
// the account is remembered between runs and drawn on no screen after the first, so an operator
// holding a personal account and an organisation's has nothing telling them which of the two this
// deploy is about to write into — and a d1 database cannot be moved once it exists.
//
// the loopback port is taken here rather than at the far end of the chain, which is the house rule
// about the one-way door (CLAUDE.md): a port another console is holding, met after the deploy, is a
// database, a worker and a widget made under an exit that reads as a failure.

// a loopback port held for the length of the case, and the number of it.
func portHeldBy(t *testing.T, held net.Listener) int {
	t.Helper()
	t.Cleanup(func() { _ = held.Close() })
	return held.Addr().(*net.TCPAddr).Port
}

func TestStartNamesTheAccountAndWhatItWillMakeAboveTheFirstQuestion(t *testing.T) {
	// it is handed to the password prompt rather than printed above it: that prompt erases the
	// screen before it draws (../../internal/terminal/clear.go), so a line printed here would be
	// off the visible screen at the moment the operator is answering.
	said := aboutToMake(account.Account{ID: "ac1", Name: "Acme Giving"})

	for _, want := range []string{
		"Acme Giving",
		"ac1",
		"database",
		"cannot be changed",
		release.Baked.Name,
		"/admin",
		"spam protection",
	} {
		if !strings.Contains(said, want) {
			t.Errorf("said %q, want %q named before anything is made", said, want)
		}
	}
	if strings.Index(said, "Acme Giving") > strings.Index(said, "database") {
		t.Errorf("said %q, want the account named before what will be made", said)
	}
}

func TestAPortAnotherConsoleHoldsStopsStartBeforeAnythingIsMade(t *testing.T) {
	holding, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no loopback port to take: %v", err)
	}

	taken, err := beforeTheDeploy(portHeldBy(t, holding))

	if taken != nil {
		t.Error("a port another console is holding was answered with a listener")
	}
	if err == nil {
		t.Fatal("a port another console is holding was met with no error, so the chain would run")
	}
	if !strings.Contains(err.Error(), "--port") {
		t.Errorf("said %v, want the way onto another port named", err)
	}
}

func TestAPortThisRunCanTakeIsHeldForTheChainToBeServedOn(t *testing.T) {
	taken, err := beforeTheDeploy(freePort(t))

	if err != nil {
		t.Fatalf("beforeTheDeploy = %v, want the port taken", err)
	}
	t.Cleanup(func() { _ = taken.Close() })
	if taken.Addr().String() == "" {
		t.Error("the listener the chain is served on names no address")
	}
}

// what a prompt the operator closed leaves on the screen.
//
// the door below argues the line for the identical act: a command that exited saying nothing would
// read as a deployment now standing.

func TestAPromptTheOperatorClosedSaysNothingWasMadeAndEndsCleanly(t *testing.T) {
	var said strings.Builder

	if err := closed(&said, nil); err != nil {
		t.Errorf("closed = %v, want a press not made read as no failure", err)
	}
	if !strings.Contains(said.String(), "nothing was created") {
		t.Errorf("said %q, want what did not happen", said.String())
	}
	if !strings.Contains(said.String(), "nothing was deployed") {
		t.Errorf("said %q, want both halves of it", said.String())
	}
}

func TestAQuestionThisConsoleCouldNotAskIsTheFailureAndNotTheClosedLine(t *testing.T) {
	var said strings.Builder
	asked := errors.New("this console asks for a password for the dashboard at a terminal")

	if err := closed(&said, asked); err != asked {
		t.Errorf("closed = %v, want the failure handed back", err)
	}
	if said.String() != "" {
		t.Errorf("said %q over a failure that already says what happened", said.String())
	}
}

// what a console that could not find out whether anything is deployed says.
//
// it is the first failure this press can hit and the one with nothing on the end of it: a refusal
// here is an access problem an operator can fix, and the same two states are answered with an act
// everywhere else in this program (../../internal/terminal/outcome.go).

func TestEveryUnreadableAddressEndsInSomethingToDo(t *testing.T) {
	for _, read := range []struct {
		kind deployment.AddressKind
		want string
	}{
		{deployment.AddressRefused, terminal.AnotherAccount},
		{deployment.AddressUnreadable, terminal.Starting.Alone},
		{"", terminal.Starting.After},
	} {
		err := unread(deployment.Address{Kind: read.kind, Detail: "said"})
		if err == nil {
			t.Fatalf("%q was answered with no failure", read.kind)
		}
		if !strings.Contains(err.Error(), read.want) {
			t.Errorf("%q said %v, want %q on the end of it", read.kind, err, read.want)
		}
		if !strings.Contains(err.Error(), "said") {
			t.Errorf("%q said %v, want what Cloudflare answered quoted", read.kind, err)
		}
	}
}

func TestTheActOnAnUnreadableAddressIsThePressThatMadeTheRead(t *testing.T) {
	// `start` is the one press that reaches a deployment, so the act is this command again: a
	// sentence naming the console installer sends an operator to a press that deploys nothing.
	err := unread(deployment.Address{Kind: deployment.AddressUnreadable})
	if !strings.Contains(err.Error(), "better-giving start") {
		t.Errorf("said %v, want the press that made the read", err)
	}
	if strings.Contains(err.Error(), "better-giving update") {
		t.Errorf("said %v, want no press but the one that made the read", err)
	}
}

// the two sentences that named no act at all.

func TestASessionKeyThisMachineCouldNotMintNamesThePressAgain(t *testing.T) {
	if !strings.Contains(noSessionKey, "better-giving start again") {
		t.Errorf("said %q, want something to do about it", noSessionKey)
	}
}

// the order this command runs its own acts in, which is what no case held before: each of them
// answers for itself elsewhere in this file, and the sequence they are put in answered nowhere.
//
// the port is claimed in front of the first question because everything able to fail runs in front
// of the one-way door (CLAUDE.md); the listener is handed to the console rather than taken again,
// because a port given back in between is one something else can claim in the gap; and a run that
// does not serve gives it back, or the next `start` meets a port this process is still holding.

// a run of ./standingUp with every act of it recorded, over a listener this case holds.
type firstDeploy struct {
	bound   net.Listener
	claims  int
	claimed error
	asked   bool
	made    bool
	closes  error
	ran     first.Outcome
	halted  bool
	served  net.Listener
	said    strings.Builder
}

func (deploy *firstDeploy) run(t *testing.T) error {
	t.Helper()
	return standingUp(&deploy.said,
		func() (net.Listener, error) {
			deploy.claims++
			if deploy.claimed != nil {
				return nil, deploy.claimed
			}
			return deploy.bound, nil
		},
		func() (first.Asked, bool, error) {
			deploy.asked = true
			return first.Asked{Password: "a password nobody types"}, deploy.made, deploy.closes
		},
		func(first.Asked) (first.Outcome, bool) { return deploy.ran, deploy.halted },
		func() string { return "your deployment is at https://give.acme.test" },
		func(bound net.Listener) error {
			deploy.served = bound
			return nil
		})
}

// a loopback listener for a case to hand its run, and whether the run gave it back.
func aPortHeld(t *testing.T) (net.Listener, func() bool) {
	t.Helper()
	bound, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no loopback port to take: %v", err)
	}
	t.Cleanup(func() { _ = bound.Close() })
	// a listener already closed refuses a second close, which is how a case sees one given back.
	return bound, func() bool { return bound.Close() != nil }
}

func TestAPortAnotherConsoleHoldsIsMetBeforeEitherQuestionIsPut(t *testing.T) {
	deploy := &firstDeploy{claimed: errors.New("5320 is in use")}

	err := deploy.run(t)

	if err == nil {
		t.Fatal("a port this run could not take went on to the questions and the chain")
	}
	if deploy.asked {
		t.Error("the operator was asked for a password over a port this run never held")
	}
}

func TestAPromptTheOperatorClosedGivesThePortBackAndServesNothing(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	deploy := &firstDeploy{bound: bound, made: false}

	err := deploy.run(t)

	if err != nil {
		t.Errorf("standingUp = %v, want a press not made read as no failure", err)
	}
	if deploy.served != nil {
		t.Error("a console was served over a question the operator closed")
	}
	if !strings.Contains(deploy.said.String(), "nothing was created") {
		t.Errorf("said %q, want what did not happen", deploy.said.String())
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestAChainThatLandedServesTheConsoleOnThePortTakenInFrontOfIt(t *testing.T) {
	bound, _ := aPortHeld(t)
	deploy := &firstDeploy{bound: bound, made: true, ran: first.Outcome{Kind: first.Deployed}}

	if err := deploy.run(t); err != nil {
		t.Fatalf("standingUp = %v, want the console this command exists to open", err)
	}
	if deploy.served != bound {
		t.Error("the console was served on a port other than the one claimed in front of the chain")
	}
	// a port given back and taken again is one something else can claim in the gap, so the claim is
	// made once and the listener carried to the console.
	if deploy.claims != 1 {
		t.Errorf("the port was claimed %d times, want the one taken in front of the chain",
			deploy.claims)
	}
	if !strings.Contains(deploy.said.String(), "https://give.acme.test") {
		t.Errorf("said %q, want where the deployment this run stood up answers", deploy.said.String())
	}
}

func TestAChainThatDidNotLandGivesThePortBackAndServesNothing(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	deploy := &firstDeploy{bound: bound, made: true, ran: first.Outcome{Kind: first.NoDatabase}}

	err := deploy.run(t)

	if err == nil {
		t.Fatal("a chain that did not land ended cleanly, which reads as a deployment now standing")
	}
	if deploy.served != nil {
		t.Error("a console was served over a chain that did not land")
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestAChainAStopWaitedOutSaysWhereTheDeploymentIsAndGivesThePortBack(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	deploy := &firstDeploy{
		bound: bound, made: true, halted: true, ran: first.Outcome{Kind: first.Deployed},
	}

	if err := deploy.run(t); err != nil {
		t.Fatalf("standingUp = %v, want a stop the operator asked for read as no failure", err)
	}
	if deploy.served != nil {
		t.Error("a console the operator stopped went on to serve and open a browser at itself")
	}
	if !strings.Contains(deploy.said.String(), "https://give.acme.test") {
		t.Errorf("said %q, want a deployment that now stands named", deploy.said.String())
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

// the order this command runs in over a deployment that is already standing, which is the other
// half of what it is: the port taken, whether the deployment already carries this release, what a
// deploy would apply read and named, the door answered, the carry, where it left the deployment,
// and the console served on the port taken in front of all of it.
//
// the port is claimed in front of the up-to-date check and the door for the same reason it is
// claimed in front of the two questions above (CLAUDE.md's one-way door): a port another console is
// holding, met past a migration, is a database moved forward under an exit that reads as a failure.

// the deployment every carry case below is about.
var ontoAcme = terminal.Deployment{Account: "Acme Giving", Address: "https://give.acme.test"}

// a run of ./catchingUp with every act of it recorded, over a listener this case holds.
type standingDeployment struct {
	bound    net.Listener
	claims   int
	claimed  error
	newer    string
	carries  bool
	weighed  bool
	reads    bool
	read     effects.Migrations
	named    bool
	answered terminal.Confirmation
	carried  bool
	ran      effects.Carried
	halted   bool
	served   net.Listener
	said     strings.Builder
}

func (onto *standingDeployment) run(t *testing.T) error {
	t.Helper()
	return catchingUp(&onto.said, ontoAcme, onto.newer,
		func() (net.Listener, error) {
			onto.claims++
			if onto.claimed != nil {
				return nil, onto.claimed
			}
			return onto.bound, nil
		},
		func() bool {
			onto.weighed = true
			return onto.carries
		},
		func() effects.Migrations {
			onto.reads = true
			return onto.read
		},
		func(effects.Migrations) terminal.Confirmation {
			onto.named = true
			return onto.answered
		},
		func() (effects.Carried, bool) {
			onto.carried = true
			return onto.ran, onto.halted
		},
		func() string { return "your deployment is up to date, at https://give.acme.test" },
		func(bound net.Listener) error {
			onto.served = bound
			return nil
		})
}

// the line a run holds where a console another console installed still reads a release past its
// own, which the door draws over its own screen and the up-to-date path has to draw itself.
const newerConsoleLine = "version 0.9.0 of this console is out"

// a carry that lands over a deployment already standing, for a case to vary one act of.
func aCarryThatLands(t *testing.T) *standingDeployment {
	t.Helper()
	bound, _ := aPortHeld(t)
	return &standingDeployment{
		bound: bound,
		newer: newerConsoleLine,
		// a read that landed carrying no migration this database has not: the door opens on its
		// own for it (../../internal/terminal/confirm.go) and the upload is what is left.
		read:     effects.Migrations{Applied: cf.ResultValue},
		answered: terminal.Confirmed,
		ran:      effects.Carried{Kind: effects.Deployed},
	}
}

func TestADeploymentAlreadyCarryingThisReleaseIsOpenedAndNotDeployedTo(t *testing.T) {
	// the deployment says which release it was built from and it is this one, so there is nothing to
	// carry: a door put in front of an operator here is a question about an upload that would change
	// nothing, and the console is what they typed the command for.
	onto := aCarryThatLands(t)
	onto.carries = true

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want the console this command exists to open", err)
	}
	if onto.reads || onto.named {
		t.Error("a deployment already on this release was read for migrations, or put behind a door")
	}
	if onto.carried {
		t.Error("this release was uploaded onto a deployment already carrying it")
	}
	if onto.served != onto.bound {
		t.Error("a deployment that needed nothing carried onto it was not opened")
	}
	if !strings.Contains(onto.said.String(), "up to date") {
		t.Errorf("said %q, want where the deployment answers", onto.said.String())
	}
	// the line naming a console newer than this one is held for a door, and no door opens here: a
	// run that put it nowhere is the operator who most needs it — the one whose install landed
	// somewhere this machine's PATH does not reach — told nothing at all.
	if !strings.Contains(onto.said.String(), newerConsoleLine) {
		t.Errorf("said %q, want the newer console named where no door will name it",
			onto.said.String())
	}
}

func TestADeploymentThisConsoleCouldNotWeighIsOfferedTheCarry(t *testing.T) {
	// no session held on this machine, a read that did not land, an envelope naming no version and a
	// deployment on another release are one answer (../../internal/effects' OwnRelease): the
	// operator is asked, because a console that guessed the other way leaves old code standing.
	onto := aCarryThatLands(t)
	onto.carries = false

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want this release carried onto the deployment", err)
	}
	if !onto.weighed {
		t.Error("the deployment was carried onto without this console asking what it holds")
	}
	if !onto.named || !onto.carried {
		t.Error("a deployment this console could not weigh was opened with no door and no carry")
	}
}

func TestTheUpToDateReadingIsTakenOnThePortThisRunAlreadyHolds(t *testing.T) {
	// everything able to fail runs in front of the one-way door (CLAUDE.md), and the port is the
	// failure this order exists to keep in front of it: a run that weighed the deployment first
	// would meet a port another console holds having already asked.
	onto := aCarryThatLands(t)
	onto.claimed = errors.New("5320 is in use")

	if err := onto.run(t); err == nil {
		t.Fatal("a port this run could not take went on to weigh the deployment")
	}
	if onto.weighed {
		t.Error("the deployment was weighed over a port this run never held")
	}
}

func TestADeploymentStandingWithNothingToApplyIsCarriedOntoAndTheConsoleOpened(t *testing.T) {
	onto := aCarryThatLands(t)

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want this release carried onto the deployment", err)
	}
	if !onto.carried {
		t.Error("a deployment already standing was opened without this release being carried onto it")
	}
	if onto.served != onto.bound {
		t.Error("the console was served on a port other than the one claimed in front of the door")
	}
	if !onto.named {
		t.Error("this release was uploaded with no door in front of it")
	}
	// the door draws it over its own screen, which is why it is held rather than printed
	// (../../internal/terminal/confirm.go).
	if strings.Contains(onto.said.String(), newerConsoleLine) {
		t.Errorf("said %q, want the door's own screen to be the one that named the newer console",
			onto.said.String())
	}
	if !strings.Contains(onto.said.String(), "up to date") {
		t.Errorf("said %q, want where the carry left the deployment", onto.said.String())
	}
}

func TestTheConsoleAtAStandingDeploymentIsServedOnAPortClaimedOnce(t *testing.T) {
	// a port given back and taken again is one something else can claim in the gap, so the claim is
	// made once and the listener carried to the console.
	onto := aCarryThatLands(t)

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want the console this command exists to open", err)
	}
	if onto.claims != 1 {
		t.Errorf("the port was claimed %d times, want the one taken in front of the door", onto.claims)
	}
}

func TestADoorTheOperatorOpenedCarriesThisReleaseAndOpensTheConsole(t *testing.T) {
	onto := aCarryThatLands(t)
	onto.read = effects.Migrations{Applied: cf.ResultValue, Names: []string{"0007_donors.sql"}}

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want this release carried onto the deployment", err)
	}
	if !onto.carried {
		t.Error("a door the operator opened uploaded nothing")
	}
	if onto.served != onto.bound {
		t.Error("a carry the operator agreed to did not end at the console")
	}
}

func TestADoorTheOperatorShutUploadsNothingAndStillOpensTheConsole(t *testing.T) {
	// the deployment is standing and opening the console at it is what the operator typed this
	// command for, so a database left alone on purpose ends at the console rather than at an exit.
	onto := aCarryThatLands(t)
	onto.answered = terminal.Declined

	if err := onto.run(t); err != nil {
		t.Errorf("catchingUp = %v, want a press not made read as no failure", err)
	}
	if onto.carried {
		t.Error("a door the operator shut went on to upload this release anyway")
	}
	if onto.served != onto.bound {
		t.Error("a door the operator shut took the console down with it")
	}
	if !strings.Contains(onto.said.String(), "nothing was uploaded") {
		t.Errorf("said %q, want what did not happen", onto.said.String())
	}
	if strings.Contains(onto.said.String(), "up to date") {
		t.Errorf("said %q, want no claim that a deployment carries a release it was left without",
			onto.said.String())
	}
}

func TestADoorNobodyWasAtEndsStartAndServesNoConsole(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	onto := aCarryThatLands(t)
	onto.bound, onto.answered = bound, terminal.Unattended

	err := onto.run(t)

	if err == nil {
		t.Fatal("a run nobody was at ended cleanly, which reads as a deployment carrying this release")
	}
	if onto.carried {
		t.Error("this release was uploaded on an answer nobody gave")
	}
	if onto.served != nil {
		t.Error("a console was opened over a question nobody answered")
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestADeploymentAheadOfThisBinaryEndsStartAndServesNoConsole(t *testing.T) {
	onto := aCarryThatLands(t)
	onto.answered = terminal.Ahead

	err := onto.run(t)

	if err == nil {
		t.Fatal("a deployment a newer console put up was carried backwards")
	}
	if onto.carried || onto.served != nil {
		t.Error("a deployment ahead of this binary was uploaded to, or opened, or both")
	}
}

func TestAPendingReadThatDidNotLandPutsNoDoorAndServesNoConsole(t *testing.T) {
	// a confirm in front of a list nobody read would be a confirmation of nothing, and the door
	// behind it is one way (CLAUDE.md).
	bound, handedBack := aPortHeld(t)
	onto := aCarryThatLands(t)
	onto.bound, onto.read = bound, effects.Migrations{Absent: "none"}

	err := onto.run(t)

	if err == nil {
		t.Fatal("a read that did not land fell through to the door and the upload behind it")
	}
	if onto.named {
		t.Error("a door was put in front of a list this console could not read")
	}
	if onto.carried || onto.served != nil {
		t.Error("a deployment this console could not read was uploaded to, or opened, or both")
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestACarryThatDidNotLandEndsStartAndServesNoConsole(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	onto := aCarryThatLands(t)
	onto.bound, onto.ran = bound, effects.Carried{Kind: effects.NoDatabase}

	err := onto.run(t)

	if err == nil {
		t.Fatal("a carry that did not land ended cleanly, which reads as one that carried")
	}
	if !strings.Contains(err.Error(), terminal.UpdateOutcome(effects.Carried{Kind: effects.NoDatabase})) {
		t.Errorf("said %v, want what the carry answered with", err)
	}
	if onto.served != nil {
		t.Error("a console was opened over a carry that did not land")
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestACarryAStopWaitedOutSaysWhereTheDeploymentIsAndServesNoConsole(t *testing.T) {
	// the same reading ./afterTheChain takes for the chain: what the operator's ctrl-c asked to stop
	// is this process holding their terminal, and never their knowledge of what the deploy did.
	bound, handedBack := aPortHeld(t)
	onto := aCarryThatLands(t)
	onto.bound, onto.halted = bound, true

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want a stop the operator asked for read as no failure", err)
	}
	if onto.served != nil {
		t.Error("a console the operator stopped went on to serve and open a browser at itself")
	}
	if !strings.Contains(onto.said.String(), "up to date") {
		t.Errorf("said %q, want where the carry left the deployment", onto.said.String())
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestAPortAnotherConsoleHoldsStopsAStandingCarryBeforeTheDoor(t *testing.T) {
	onto := aCarryThatLands(t)
	onto.claimed = errors.New("5320 is in use")

	err := onto.run(t)

	if err == nil {
		t.Fatal("a port this run could not take went on to the door and the carry behind it")
	}
	if onto.named {
		t.Error("a one-way door was opened over a port this run never held")
	}
	if onto.carried || onto.served != nil {
		t.Error("a port this run could not take ended in an upload, or a console, or both")
	}
}

// what this command does about the answer the one-way door came back with.
//
// the two that are not failures are told apart from each other: an operator who chose to leave the
// database alone made a decision and is told what it cost, and a run nobody was standing at made
// none — and a command that ended cleanly on the second reads as a deployment now carrying this
// release.

func TestADoorTheOperatorShutSaysWhatWasLeftAloneAndEndsTheCarryCleanly(t *testing.T) {
	said, on, err := atTheDoor(terminal.Declined)

	if on || err != nil {
		t.Errorf("a door shut on purpose = %v, %v, want a press not made", on, err)
	}
	if !strings.Contains(said, "database") || !strings.Contains(said, "nothing was uploaded") {
		t.Errorf("said %q, want both halves of what did not happen", said)
	}
}

func TestADoorNobodyWasAtEndsTheCarryAsAFailure(t *testing.T) {
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

func TestADeploymentAheadOfThisBinaryEndsTheCarryAsAFailure(t *testing.T) {
	_, on, err := atTheDoor(terminal.Ahead)

	if on {
		t.Error("a command went on past a deployment a newer console put up")
	}
	if err == nil || err.Error() != aheadOfThisBinary {
		t.Errorf("said %v, want %q", err, aheadOfThisBinary)
	}
	// the act is an install and then this press again: a binary older than the database it is
	// looking at has nothing it could deploy that would not carry the app backwards.
	if !strings.Contains(aheadOfThisBinary, "better-giving update") {
		t.Errorf("said %q, want the press that installs the current console", aheadOfThisBinary)
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

// what this command says about a carry that settled.
//
// a signal that took the ledger is no reading here: what a halt decides is whether the console is
// served on the far side of the carry, which is ./catchingUp's, and never whether the carry landed.

func TestACarryThatLandedIsReportedUpToDate(t *testing.T) {
	if err := afterTheCarry(effects.Carried{Kind: effects.Deployed}); err != nil {
		t.Errorf("afterTheCarry = %v, want the line that says the deployment carries this release",
			err)
	}
}

func TestACarryThatDidNotLandIsReportedInWhateverAnsweredIt(t *testing.T) {
	err := afterTheCarry(effects.Carried{Kind: effects.NoDatabase})

	if err == nil {
		t.Fatal("a carry that did not land ended cleanly, which reads as one that carried")
	}
	if !strings.Contains(err.Error(), terminal.UpdateOutcome(effects.Carried{Kind: effects.NoDatabase})) {
		t.Errorf("said %v, want what the carry answered with", err)
	}
}

// what each ending of the account question does to this run.
//
// the picker is put on every run now, so its endings are this command's business rather than
// `login`'s: an account chosen is the account everything after it is made in, a picker closed is a
// press not made, and the sign-out row is `logout` reached from the screen the operator is standing
// at — which leaves no cloudflare to deploy into and so ends the run.

// a run of ./operating with both acts recorded rather than made.
type accountAsked struct {
	chosen   account.Account
	answered terminal.Answered
	refused  error
	outs     int
	stopped  error
}

func (asked *accountAsked) run() (account.Account, bool, error) {
	return operating(
		func() (account.Account, terminal.Answered, error) {
			return asked.chosen, asked.answered, asked.refused
		},
		func() error {
			asked.outs++
			return asked.stopped
		})
}

func TestTheAccountChosenIsTheOneThisRunDeploysInto(t *testing.T) {
	asked := &accountAsked{
		chosen:   account.Account{ID: "ac1", Name: "Acme Giving"},
		answered: terminal.AccountChosen,
	}

	in, held, err := asked.run()

	if !held || err != nil {
		t.Fatalf("operating = %v, %v, want the account this run operates", held, err)
	}
	if in.ID != "ac1" {
		t.Errorf("operating = %v, want the account the operator picked", in)
	}
	if asked.outs != 0 {
		t.Error("choosing an account signed this machine out of Cloudflare")
	}
}

func TestAPickerTheOperatorClosedEndsTheRunHavingMadeNothing(t *testing.T) {
	asked := &accountAsked{answered: terminal.PickerClosed}

	_, held, err := asked.run()

	if held || err != nil {
		t.Errorf("operating = %v, %v, want a choice not made read as no failure", held, err)
	}
	if asked.outs != 0 {
		t.Error("a picker the operator closed signed this machine out of Cloudflare")
	}
}

func TestTheSignOutRowGivesUpTheSignInAndEndsTheRunCleanly(t *testing.T) {
	asked := &accountAsked{answered: terminal.SigningOut}

	_, held, err := asked.run()

	if asked.outs != 1 {
		t.Errorf("the sign-out row gave up the sign-in %d times, want once", asked.outs)
	}
	if held {
		t.Error("a run that signed this machine out went on to deploy into an account it left")
	}
	if err != nil {
		t.Errorf("operating = %v, want a sign-out the operator asked for read as no failure", err)
	}
}

func TestASignOutThatDidNotHappenIsTheFailureItIs(t *testing.T) {
	// a credential set in this console's environment is one ../../internal/oauth's Out refuses, and
	// what it says names the variable: an operator told nothing at all would be left believing this
	// machine is signed out while every command after it runs as that token.
	asked := &accountAsked{answered: terminal.SigningOut}
	asked.stopped = errors.New("the sign-in in use came from CLOUDFLARE_API_TOKEN")

	_, held, err := asked.run()

	if held {
		t.Error("a sign-out that did not happen went on to deploy")
	}
	if err == nil {
		t.Fatal("a sign-out that did not happen ended cleanly, which reads as one that did")
	}
}

func TestASignInThisConsoleCouldNotUseEndsTheRunAsAFailure(t *testing.T) {
	asked := &accountAsked{
		answered: terminal.PickerClosed,
		refused:  errors.New("this Cloudflare sign-in is a member of no account"),
	}

	_, held, err := asked.run()

	if held || err == nil {
		t.Errorf("operating = %v, %v, want the failure handed back", held, err)
	}
}
