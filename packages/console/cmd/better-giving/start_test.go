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
	"github.com/better-giving/console/internal/widget"
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
	said := aboutToMake(
		account.Account{ID: "ac1", Name: "Acme Giving"},
		deployment.Named{Kind: deployment.NameHeld, Name: "acme"})

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
	// named is what the name act said, went whether it settled one, and names whether it was
	// reached at all.
	named   string
	went    bool
	names   bool
	ran     first.Outcome
	chained bool
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
		func() (string, bool, error) {
			deploy.names = true
			return deploy.named, deploy.went, nil
		},
		func(first.Asked) (first.Outcome, bool) {
			deploy.chained = true
			return deploy.ran, deploy.halted
		},
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
	deploy := &firstDeploy{bound: bound, made: true, went: true, ran: first.Outcome{Kind: first.Deployed}}

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
	deploy := &firstDeploy{bound: bound, made: true, went: true, ran: first.Outcome{Kind: first.NoDatabase}}

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
		bound: bound, made: true, went: true, halted: true, ran: first.Outcome{Kind: first.Deployed},
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
	carrying string
	deployed string
	weighed  bool
	onto     terminal.Deployment
	reads    bool
	read     effects.Migrations
	named    bool
	answered terminal.Confirmation
	carried  bool
	ran      effects.Carried
	halted   bool
	// finished is what the finish said, and finishes whether it was reached at all.
	finished string
	finishes bool
	served   net.Listener
	said     strings.Builder
	// order is every act of the run in the order it was reached, so that a case can say where the
	// wait over the reads was given up rather than only that it was.
	order []string
}

// what the run drew, recorded as one act among the rest: the wait over the reads has to be given up
// in front of the first of these, because the screen that follows erases the terminal
// (../../internal/terminal/confirm.go).
func (onto *standingDeployment) Write(said []byte) (int, error) {
	onto.order = append(onto.order, "drew")
	return onto.said.Write(said)
}

func (onto *standingDeployment) run(t *testing.T) error {
	t.Helper()
	return catchingUp(onto, ontoAcme, onto.carrying, onto.newer,
		func() { onto.order = append(onto.order, "settled") },
		func() (net.Listener, error) {
			onto.claims++
			if onto.claimed != nil {
				return nil, onto.claimed
			}
			return onto.bound, nil
		},
		func() string {
			onto.weighed = true
			onto.order = append(onto.order, "weighed")
			return onto.deployed
		},
		func() effects.Migrations {
			onto.reads = true
			onto.order = append(onto.order, "read")
			return onto.read
		},
		func(at terminal.Deployment, _ effects.Migrations) terminal.Confirmation {
			onto.named = true
			onto.order = append(onto.order, "named")
			onto.onto = at
			return onto.answered
		},
		func() (effects.Carried, bool) {
			onto.carried = true
			return onto.ran, onto.halted
		},
		func() string { return "your deployment is up to date, at https://give.acme.test" },
		func() string {
			onto.finishes = true
			onto.order = append(onto.order, "finished")
			return onto.finished
		},
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
		bound:    bound,
		newer:    newerConsoleLine,
		carrying: "1.4.0",
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
	onto.deployed = onto.carrying

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

func TestABinaryCarryingNoReleaseIsNeverLevelWithWhatItDeployed(t *testing.T) {
	// `dev` is what a plain `go build` leaves (./main.go) and every one of them carries whatever
	// bundle the machine packed, so two of them reading alike says nothing about the code being the
	// same — and a console that called it up to date would never redeploy on the path this
	// repository is developed over (scripts/console-start.sh).
	onto := aCarryThatLands(t)
	onto.carrying, onto.deployed = "dev", "dev"

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want the carry offered", err)
	}
	if !onto.named || !onto.carried {
		t.Error("a deployment a dev binary put up was called up to date and never deployed to")
	}
}

func TestADeploymentThisConsoleCouldNotWeighIsOfferedTheCarry(t *testing.T) {
	// no session held on this machine, a read that did not land, an envelope naming no version and a
	// deployment on another release are one answer (../../internal/effects' OwnRelease): the
	// operator is asked, because a console that guessed the other way leaves old code standing.
	onto := aCarryThatLands(t)
	onto.deployed = "0.1.0"

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
	said, went, err := atTheDoor(terminal.Declined)

	if went != shut || err != nil {
		t.Errorf("a door shut on purpose = %v, %v, want a press not made", went, err)
	}
	if !strings.Contains(said, "database") || !strings.Contains(said, "nothing was uploaded") {
		t.Errorf("said %q, want both halves of what did not happen", said)
	}
}

func TestADoorNobodyWasAtEndsTheCarryAsAFailure(t *testing.T) {
	said, went, err := atTheDoor(terminal.Unattended)

	if went == through {
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
	_, went, err := atTheDoor(terminal.Ahead)

	if went == through {
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
	said, went, err := atTheDoor(terminal.Confirmed)

	if went != through || err != nil {
		t.Errorf("a door opened on purpose = %v, %v, want the deploy going on", went, err)
	}
	if said != "" {
		t.Errorf("said %q about a press that is about to run", said)
	}
}

func TestAnAnswerThisConsoleDidNotUnderstandLeavesTheOneWayDoorShut(t *testing.T) {
	// nothing reaches this today, and the door behind it cannot be undone: terminal.Confirmation is
	// a bare string and no exhaustiveness check stands between an unnamed value and a migration.
	for _, answered := range []terminal.Confirmation{"", "something else"} {
		said, went, err := atTheDoor(answered)

		if went == through {
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

func TestTheDoorIsAskedAboutTheReleaseTheDeploymentSaysItIsOn(t *testing.T) {
	// ../../internal/effects' OwnRelease is what reads it and the door is what draws it, so what this
	// holds is the one thing neither of them can: that the string reaches the screen at all.
	onto := aCarryThatLands(t)
	onto.deployed = "1.3.2"

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want this release carried onto the deployment", err)
	}
	if onto.onto.Release != "1.3.2" {
		t.Errorf("the door was put about %q, want the release the deployment reported", onto.onto)
	}
	if onto.onto.Account != ontoAcme.Account || onto.onto.Address != ontoAcme.Address {
		t.Errorf("the door was put about %q, want the deployment this run read", onto.onto)
	}
}

func TestADeploymentThisConsoleReadNoReleaseOffIsPutBehindADoorNamingNone(t *testing.T) {
	onto := aCarryThatLands(t)

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v, want the carry offered", err)
	}
	if onto.onto.Release != "" {
		t.Errorf("the door was told the deployment is on %q, want the reading that never landed left "+
			"as one", onto.onto.Release)
	}
}

// the account named and the whole reading made against it, which is the one pass a run makes.

// a run of ./againstOneAccount with the account a case hands it and the pass recorded.
type overOneAccount struct {
	picked  account.Account
	held    bool
	refused error
	against []string
	stopped error
	said    strings.Builder
}

func (over *overOneAccount) run() error {
	return againstOneAccount(&over.said,
		func() (account.Account, bool, error) { return over.picked, over.held, over.refused },
		func(in account.Account) error {
			over.against = append(over.against, in.ID)
			return over.stopped
		})
}

func TestTheReadingIsMadeAgainstTheAccountTheOperatorNamed(t *testing.T) {
	over := &overOneAccount{picked: account.Account{ID: "ac1", Name: "Acme Giving"}, held: true}

	if err := over.run(); err != nil {
		t.Fatalf("againstOneAccount = %v, want the pass the operator asked for", err)
	}
	if len(over.against) != 1 || over.against[0] != "ac1" {
		t.Errorf("the deployment was read for %v, want the account chosen", over.against)
	}
}

func TestAPickerTheOperatorClosedEndsTheRunOnACleanExitAndALine(t *testing.T) {
	over := &overOneAccount{}

	if err := over.run(); err != nil {
		t.Errorf("againstOneAccount = %v, want a choice not made read as no failure", err)
	}
	if len(over.against) != 0 {
		t.Errorf("a run whose picker was closed read %v", over.against)
	}
	if !strings.Contains(over.said.String(), "nothing was created") {
		t.Errorf("said %q, want what did not happen", over.said.String())
	}
}

func TestAPassThatDidNotLandEndsTheRunAsTheFailureItIs(t *testing.T) {
	over := &overOneAccount{
		picked:  account.Account{ID: "ac1"},
		held:    true,
		stopped: errors.New("this release was not carried onto the deployment"),
	}

	if err := over.run(); err == nil {
		t.Fatal("a pass that did not land ended the run cleanly")
	}
}

// the deployment read for the account the operator picked, carried forward out of the picker.
//
// the picker reads every account to mark its rows (../../internal/effects' EachAddress), and the
// account chosen is one of the ones it read — so the pass under it asks cloudflare nothing this
// screen already answered. a read that never landed is absent from that list exactly as it is from
// the marks, and there the pass reads for itself: this is a reading carried forward and never a
// reading stood in for.

func TestTheDeploymentThePickerAlreadyFoundIsNotLookedForAgain(t *testing.T) {
	read := 0

	standing := standingOn(
		effects.Addresses{"ac1": {Kind: deployment.Deployed, WorkersDev: "https://one.workers.dev"}},
		account.Account{ID: "ac1"},
		func() deployment.Address { read++; return deployment.Address{} })

	if read != 0 {
		t.Errorf("the deployment was read %d more times, want the reading the picker took", read)
	}
	if standing.Origin() != "https://one.workers.dev" {
		t.Errorf("the pass runs against %v, want where the picker found the deployment", standing)
	}
}

func TestAnAccountThePickersOwnReadsDidNotLandForIsReadNow(t *testing.T) {
	read := 0

	standing := standingOn(effects.Addresses{}, account.Account{ID: "ac1"},
		func() deployment.Address { read++; return deployment.Address{Kind: deployment.NotDeployed} })

	if read != 1 {
		t.Errorf("the deployment was read %d times, want the one this pass makes for itself", read)
	}
	if standing.Kind != deployment.NotDeployed {
		t.Errorf("the pass runs against %v, want what it read for itself", standing)
	}
}

// what the wait over the pass under the account just picked says, and whether there is one at all.
//
// a wait that appeared and vanished in the same frame would be noise, so the pass that fetches
// nothing draws nothing (../../internal/terminal/waiting.go).

func TestAPassThatStandsADeploymentUpWaitsOnTheAccountAndNotOnADeployment(t *testing.T) {
	// the picker's own read landed and found no deployment there, so the row the operator pressed
	// has already told them there is none: what this pass reads is the account's own name.
	said := waitingOver(
		effects.Addresses{"ac1": {Kind: deployment.NotDeployed}},
		account.Account{ID: "ac1"})

	if said != terminal.ReadingTheAccount() {
		t.Errorf("waited on %q, want the read this pass actually makes", said)
	}
}

func TestAPassTheDeploymentIsReadForStandsUnderAWait(t *testing.T) {
	// a deployment the picker found: which release it is on and what a deploy would apply are both
	// read before the door draws.
	if said := waitingOver(
		effects.Addresses{"ac1": {Kind: deployment.Deployed}},
		account.Account{ID: "ac1"},
	); said != terminal.ReadingTheDeployment() {
		t.Errorf("waited on %q, want the reads in front of the door", said)
	}

	// and an account the picker's own read did not land for is read here whatever is on it.
	if said := waitingOver(effects.Addresses{}, account.Account{ID: "ac1"}); said != terminal.ReadingTheDeployment() {
		t.Errorf("waited on %q, want the read this pass makes for itself", said)
	}
}

func TestAPassOverAnAddressNothingCanBeToldFromDrawsNoWait(t *testing.T) {
	// a read the picker landed that says neither: this pass reads nothing more, it stops
	// (./unread).
	if said := waitingOver(
		effects.Addresses{"ac1": {Kind: deployment.AddressRefused}},
		account.Account{ID: "ac1"},
	); said != "" {
		t.Errorf("waited on %q over a pass that stops on what the picker already read", said)
	}
}

// where the wait over this pass's own reads is given up, which is in front of the first thing the
// pass draws and never behind it.
//
// the door erases the visible screen before it names what it would apply
// (../../internal/terminal/clear.go), so a spinner still turning when it draws is written into the
// screen the operator answers on. the reads themselves are the whole of what the wait is for, so it
// stands until the last of them has landed (../../internal/terminal's ReadingTheDeployment).

func TestTheWaitOverTheReadsIsGivenUpBetweenTheLastReadAndTheDoor(t *testing.T) {
	onto := aCarryThatLands(t)

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v", err)
	}
	if ran := strings.Join(onto.order, " "); ran != "weighed read settled named drew finished" {
		t.Errorf("a carry ran %q, want the wait given up between the last read and the door", ran)
	}
}

func TestTheWaitOverTheReadsIsGivenUpBeforeADeploymentAlreadyCarryingIsNamed(t *testing.T) {
	// the up-to-date path opens no door and says its two lines on the screen the wait is drawn on,
	// so it is given up in front of those instead.
	onto := aCarryThatLands(t)
	onto.deployed = onto.carrying

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v", err)
	}
	if ran := strings.Join(onto.order, " "); ran != "weighed settled drew drew finished" {
		t.Errorf("an up-to-date pass ran %q, want the wait given up in front of both lines", ran)
	}
}

// the workers.dev name this account answers under, settled in front of everything that creates
// anything.
//
// a deployment stands where nobody can reach it when the account holds no name: the address is
// derived from the account's name and the worker's (../../internal/deployment/address.go), so a
// press that skipped this leaves a deployment up, a password stored and a spam widget that cannot
// be registered against any host at all.

// a run of ./naming with every act of it recorded.
type theName struct {
	held      deployment.Named
	registers []string
	answers   []deployment.Named
	asks      []string
	typed     []string
}

// the run over an account whose own name derives one, which is every case but the account named
// nothing usable.
func (one *theName) run() (string, bool, error) { return namingFrom(one, "hound-haven") }

func TestAnAccountAlreadyHoldingANameIsLeftAloneAndNothingIsSaid(t *testing.T) {
	// cloudflare takes one name per account and every worker on it answers under that one, so a run
	// that registered over it would move every other deployment in the account.
	one := &theName{held: deployment.Named{Kind: deployment.NameHeld, Name: "somebody-elses"}}

	said, went, err := one.run()

	if !went || err != nil {
		t.Fatalf("naming = %v, %v", went, err)
	}
	if said != "" {
		t.Errorf("said %q about an account this run did not touch", said)
	}
	if len(one.registers) != 0 || len(one.asks) != 0 {
		t.Errorf("registered %v and asked %d questions", one.registers, len(one.asks))
	}
}

func TestAnAccountHoldingNoNameGetsTheOneDerivedFromItsOwnWithNothingAsked(t *testing.T) {
	one := &theName{
		held:    deployment.Named{Kind: deployment.NameNone},
		answers: []deployment.Named{{Kind: deployment.NameRegistered, Name: "hound-haven"}},
	}

	said, went, err := one.run()

	if !went || err != nil {
		t.Fatalf("naming = %v, %v", went, err)
	}
	if len(one.asks) != 0 {
		t.Errorf("the operator was asked %v for a name that was never refused", one.asks)
	}
	if strings.Join(one.registers, ",") != "hound-haven" {
		t.Errorf("registered %v, want the name derived from the account's own", one.registers)
	}
	if !strings.Contains(said, "hound-haven.workers.dev") {
		t.Errorf("said %q, want the name this run registered", said)
	}
}

func TestANameCloudflareRefusesIsPutToTheOperatorUntilOneLands(t *testing.T) {
	// a workers.dev name is one pool for the whole of cloudflare, so the account's own name may be
	// somebody else's already — and no second name this console invented would be any likelier.
	one := &theName{
		held: deployment.Named{Kind: deployment.NameNone},
		answers: []deployment.Named{
			{Kind: deployment.NameTaken, Detail: "workers.api.error.subdomain_unavailable"},
			{Kind: deployment.NameTaken, Detail: "workers.api.error.subdomain_unavailable"},
			{Kind: deployment.NameRegistered, Name: "hound-haven-giving"},
		},
		typed: []string{"hound-haven-too", "hound-haven-giving"},
	}

	said, went, err := one.run()

	if !went || err != nil {
		t.Fatalf("naming = %v, %v", went, err)
	}
	if strings.Join(one.registers, ",") != "hound-haven,hound-haven-too,hound-haven-giving" {
		t.Errorf("registered %v, want the derived name and then each one typed", one.registers)
	}
	if len(one.asks) != 2 {
		t.Fatalf("%d questions were put for two refusals", len(one.asks))
	}
	// each question says what was refused and what cloudflare said about it, or the operator is
	// answering the same question twice with nothing to go on.
	if !strings.Contains(one.asks[0], "hound-haven") || !strings.Contains(one.asks[0], "subdomain_unavailable") {
		t.Errorf("the first question said %q", one.asks[0])
	}
	if !strings.Contains(one.asks[1], "hound-haven-too") {
		t.Errorf("the second question said %q, want the name it refused", one.asks[1])
	}
	if !strings.Contains(said, "hound-haven-giving.workers.dev") {
		t.Errorf("said %q, want the name that landed", said)
	}
}

func TestAnAccountNameNothingCanBeMadeOfPutsTheQuestionWithoutAskingCloudflare(t *testing.T) {
	one := &theName{
		held:    deployment.Named{Kind: deployment.NameNone},
		answers: []deployment.Named{{Kind: deployment.NameRegistered, Name: "hound-haven"}},
		typed:   []string{"hound-haven"},
	}

	said, went, err := namingFrom(one, "")

	if !went || err != nil {
		t.Fatalf("naming = %v, %v", went, err)
	}
	if len(one.asks) != 1 {
		t.Fatalf("%d questions were put", len(one.asks))
	}
	if strings.Join(one.registers, ",") != "hound-haven" {
		t.Errorf("cloudflare was asked to register %v, want the typed name alone", one.registers)
	}
	if !strings.Contains(said, "hound-haven.workers.dev") {
		t.Errorf("said %q", said)
	}
}

func TestANameQuestionTheOperatorClosedEndsThePressHavingCreatedNothing(t *testing.T) {
	one := &theName{
		held:    deployment.Named{Kind: deployment.NameNone},
		answers: []deployment.Named{{Kind: deployment.NameTaken, Detail: "unavailable"}},
	}

	said, went, err := one.run()

	if went || err != nil {
		t.Fatalf("naming = %q, %v, %v, want a press not made read as no failure", said, went, err)
	}
}

func TestAnAccountThisConsoleCouldNotNameEndsInSomethingToDo(t *testing.T) {
	// the states internal/cf sorts an answer into are four different things for an operator to do,
	// and a read that found nothing out is never an account with no name.
	for _, one := range []struct {
		held  deployment.Named
		names string
	}{
		{deployment.Named{Kind: deployment.NameRefused, Detail: "Authentication error"},
			"another account"},
		{deployment.Named{Kind: deployment.NameUnreachable, Detail: "no route to host"},
			"connection"},
		{deployment.Named{Kind: deployment.NameUnreadable, Detail: "a shape"}, "start"},
		{deployment.Named{Kind: deployment.NameFailed, Detail: "cloudflare said no"}, "start"},
	} {
		held := &theName{held: one.held}
		said, went, err := held.run()
		if went || err == nil {
			t.Fatalf("naming = %q, %v, %v, want the state that explains it", said, went, err)
		}
		if !strings.Contains(err.Error(), one.names) {
			t.Errorf("%s = %q, which says nothing about %q", one.held.Kind, err, one.names)
		}
		if !strings.Contains(err.Error(), one.held.Detail) {
			t.Errorf("%s = %q, which does not carry what cloudflare said", one.held.Kind, err)
		}
		if !strings.Contains(err.Error(), "nothing was created") {
			t.Errorf("%s = %q, which does not say what did not happen", one.held.Kind, err)
		}
	}
}

// a run of ./naming over what this case states, with the name derived from the account's own name
// handed in.
func namingFrom(one *theName, derived string) (string, bool, error) {
	return naming(
		one.held,
		func(name string) deployment.Named {
			one.registers = append(one.registers, name)
			at := len(one.registers) - 1
			if at >= len(one.answers) {
				at = len(one.answers) - 1
			}
			return one.answers[at]
		},
		derived,
		func(why string) (string, bool, error) {
			one.asks = append(one.asks, why)
			if len(one.typed) == 0 {
				return "", false, nil
			}
			typed := one.typed[0]
			one.typed = one.typed[1:]
			return typed, true, nil
		},
		nothingMade)
}

func TestTheNameIsSettledAfterBothQuestionsAndInFrontOfTheChain(t *testing.T) {
	// it is the first thing this run creates, so it stands where nothing else has been created yet
	// — past the two questions, whose closing ends the command having made nothing, and in front of
	// the chain, which is what needs a host to register the widget against.
	bound, _ := aPortHeld(t)
	deploy := &firstDeploy{
		bound: bound, made: true, went: true,
		named: "this Cloudflare account had no workers.dev name, so this run registered hound.workers.dev",
		ran:   first.Outcome{Kind: first.Deployed},
	}

	if err := deploy.run(t); err != nil {
		t.Fatalf("standingUp = %v", err)
	}
	if !deploy.names || !deploy.chained {
		t.Fatalf("named %v and ran the chain %v", deploy.names, deploy.chained)
	}
	// the line stands above the ledger, which is the one place it can be read: the chain draws over
	// the screen from the moment it starts.
	said := deploy.said.String()
	if !strings.Contains(said, "registered hound.workers.dev") {
		t.Errorf("said %q, want what this run registered", said)
	}
	if strings.Index(said, "registered hound.workers.dev") > strings.Index(said, "your deployment is at") {
		t.Errorf("said %q, want the name above the address the run ended on", said)
	}
}

func TestANameQuestionTheOperatorClosedGivesThePortBackAndDeploysNothing(t *testing.T) {
	bound, handedBack := aPortHeld(t)
	deploy := &firstDeploy{bound: bound, made: true, went: false}

	err := deploy.run(t)

	if err != nil {
		t.Errorf("standingUp = %v, want a press not made read as no failure", err)
	}
	if deploy.chained {
		t.Error("a deployment was stood up over a question the operator closed")
	}
	if !strings.Contains(deploy.said.String(), "nothing was created") {
		t.Errorf("said %q, want what did not happen", deploy.said.String())
	}
	if !handedBack() {
		t.Error("the port this run took was still held on the way out")
	}
}

func TestAnAccountAlreadyNamedSaysNothingAboveTheLedger(t *testing.T) {
	bound, _ := aPortHeld(t)
	deploy := &firstDeploy{
		bound: bound, made: true, went: true,
		ran: first.Outcome{Kind: first.Deployed},
	}

	if err := deploy.run(t); err != nil {
		t.Fatalf("standingUp = %v", err)
	}
	if said := deploy.said.String(); strings.Contains(said, "workers.dev name") {
		t.Errorf("said %q about an account this run did not touch", said)
	}
}

// what a first run left unfinished, read off the deployment and made before the console opens.
//
// a first run that stopped past the deploy is never carried past that point again: the deployment
// is standing from the moment the upload lands, so every later press weighs it against this release
// and goes to the carry door and then the console. no console screen registers the widget either
// (packages/console-ui/src/lib/sites-fold.tsx), so the press that told the operator to run this
// command again could not have helped them.

// the thirteen as a deployment that never reached the widget stage holds them.
func holdingNeitherHalf() deployment.VarsRead {
	return deployment.VarsRead{Kind: deployment.ValuesRead, Vars: []deployment.DeployedVar{
		{Name: "TURNSTILE_SITE_KEY", Kind: deployment.VarAbsent},
		{Name: "TURNSTILE_SECRET_KEY", Kind: deployment.VarAbsent},
	}}
}

// the thirteen as a deployment a run did finish holds them.
func holdingBothHalves() deployment.VarsRead {
	return deployment.VarsRead{Kind: deployment.ValuesRead, Vars: []deployment.DeployedVar{
		{Name: "TURNSTILE_SITE_KEY", Kind: deployment.VarValue, Value: "0x4"},
		{Name: "TURNSTILE_SECRET_KEY", Kind: deployment.VarValue, Value: "0x0secret"},
	}}
}

// a run of ./finishing with every act of it recorded.
type unfinished struct {
	read    deployment.VarsRead
	said    string
	settles bool
	stopped error
	ran     first.Outcome
	// order is every act the run reached, in the order it reached them.
	order []string
}

func (one *unfinished) run() string {
	return finishing(
		func() deployment.VarsRead {
			one.order = append(one.order, "read")
			return one.read
		},
		func() (string, bool, error) {
			one.order = append(one.order, "named")
			return one.said, one.settles, one.stopped
		},
		func() first.Outcome {
			one.order = append(one.order, "registered")
			return one.ran
		})
}

// a deployment holding neither half, over an account that already has a workers.dev name.
func aFinishThatLands() *unfinished {
	return &unfinished{read: holdingNeitherHalf(), settles: true}
}

func TestADeploymentAlreadyCarryingTheSpamPairIsReadAndNothingElse(t *testing.T) {
	// the ordinary case is a deployment already set up, and a line about work that did not happen
	// is noise on every run after the first.
	one := aFinishThatLands()
	one.read = holdingBothHalves()

	if said := one.run(); said != "" {
		t.Errorf("said %q about a deployment with nothing missing", said)
	}
	if ran := strings.Join(one.order, " "); ran != "read" {
		t.Errorf("a finish ran %q, want nothing read past the pair", ran)
	}
}

func TestADeploymentHoldingNeitherHalfIsRegisteredAndSaidSo(t *testing.T) {
	one := aFinishThatLands()

	said := one.run()

	if !strings.Contains(said, "spam protection") {
		t.Errorf("said %q, want what this run registered", said)
	}
	if ran := strings.Join(one.order, " "); ran != "read named registered" {
		t.Errorf("a finish ran %q, want the name settled in front of the widget", ran)
	}
}

func TestAFinishThatCouldNotLandSaysWhichStepStoppedIt(t *testing.T) {
	// the three are three different things for an operator to do about a deployment that answers
	// nowhere (../../internal/first's noOrigin), and the arms are the chain's own so the words are
	// the ones a deploy that stopped in the same place is answered in.
	one := aFinishThatLands()
	one.ran = first.Outcome{
		Kind:   first.NoWidget,
		Supply: &widget.Supply{Kind: widget.NoHosts},
		Detail: "this account has never registered a workers.dev subdomain",
	}

	said := one.run()

	if !strings.Contains(said, "never registered a workers.dev subdomain") {
		t.Errorf("said %q, want which of the three it was", said)
	}
	if !strings.Contains(said, terminal.Outcome(one.ran)) {
		t.Errorf("said %q, want the sentence this state is answered in", said)
	}
}

func TestTheNameAFinishRegisteredIsSaidAboveWhatItRegisteredItFor(t *testing.T) {
	one := aFinishThatLands()
	one.said = "this Cloudflare account had no workers.dev name, so this run registered hound.workers.dev"

	said := one.run()

	if !strings.Contains(said, "registered hound.workers.dev") {
		t.Errorf("said %q, want the name this run registered", said)
	}
	if strings.Index(said, "hound.workers.dev") > strings.Index(said, "spam protection") {
		t.Errorf("said %q, want the name above what it was registered for", said)
	}
}

func TestANameQuestionTheOperatorClosedStopsTheFinishAndRegistersNothing(t *testing.T) {
	one := aFinishThatLands()
	one.settles = false

	said := one.run()

	if said == "" {
		t.Error("a finish that stopped went unsaid, so a deployment turns nobody away unsaid")
	}
	if ran := strings.Join(one.order, " "); ran != "read named" {
		t.Errorf("a finish ran %q, want nothing registered against a name nobody gave", ran)
	}
}

func TestAnAccountThisConsoleCouldNotNameStopsTheFinishInItsOwnWords(t *testing.T) {
	one := aFinishThatLands()
	one.settles, one.stopped = false, errors.New("Cloudflare didn't answer, so spam protection")

	said := one.run()

	if !strings.Contains(said, "Cloudflare didn't answer") {
		t.Errorf("said %q, want what the step that stopped answered", said)
	}
	if strings.Contains(said, "nothing was deployed") {
		t.Errorf("said %q about a deployment that is standing and serving", said)
	}
}

func TestAReadThatDidNotLandClaimsNothingIsMissing(t *testing.T) {
	// a read that came back in none of its ways found nothing out, and a run that registered a
	// second widget on it would leave the deployment holding a pair nobody is challenging with.
	one := aFinishThatLands()
	one.read = deployment.VarsRead{Kind: deployment.ValuesUnreachable}

	if said := one.run(); said != "" {
		t.Errorf("said %q about a deployment this console could not read", said)
	}
	if ran := strings.Join(one.order, " "); ran != "read" {
		t.Errorf("a finish ran %q over a read that did not land", ran)
	}
}

// where the finish stands in a pass over a deployment that is already up: past the carry door,
// whichever way it was answered, and in front of the console.
//
// the operator typed one command and gets a deployment that is set up, whichever run set it up.

func TestADeploymentAlreadyCarryingThisReleaseIsStillFinished(t *testing.T) {
	// a first run that stopped past the deploy leaves a deployment on this very release, so no
	// door is put and the console opens straight onto it — which is the pass a finish has to reach.
	onto := aCarryThatLands(t)
	onto.deployed = onto.carrying
	onto.finished = "spam protection is set up"

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v", err)
	}
	if !onto.finishes {
		t.Fatal("a deployment already carrying this release was opened without being finished")
	}
	if !strings.Contains(onto.said.String(), "spam protection is set up") {
		t.Errorf("said %q, want what the finish did", onto.said.String())
	}
	if onto.served == nil {
		t.Error("the console this command exists to open was not served")
	}
}

func TestADoorTheOperatorShutAndOneTheyOpenedAreBothFinished(t *testing.T) {
	for _, answered := range []terminal.Confirmation{terminal.Confirmed, terminal.Declined} {
		onto := aCarryThatLands(t)
		onto.answered = answered
		onto.finished = "spam protection is set up"

		if err := onto.run(t); err != nil {
			t.Fatalf("%s: catchingUp = %v", answered, err)
		}
		if !onto.finishes || onto.served == nil {
			t.Errorf("%s finished %v and served %v", answered, onto.finishes, onto.served != nil)
		}
	}
}

func TestAFinishWithNothingToSayDrawsNoLine(t *testing.T) {
	onto := aCarryThatLands(t)
	onto.deployed = onto.carrying

	if err := onto.run(t); err != nil {
		t.Fatalf("catchingUp = %v", err)
	}
	if ran := strings.Join(onto.order, " "); ran != "weighed settled drew drew finished" {
		t.Errorf("an up-to-date pass ran %q, want no line drawn for a finish that said nothing", ran)
	}
}

func TestACarryThatDidNotLandFinishesNothing(t *testing.T) {
	onto := aCarryThatLands(t)
	onto.ran = effects.Carried{Kind: effects.ConsoleStopped}

	if err := onto.run(t); err == nil {
		t.Fatal("a carry that did not land ended cleanly")
	}
	if onto.finishes {
		t.Error("a carry that did not land was finished as though it had")
	}
}

// what the first question's screen names, which is every account-wide thing this run would make.

func TestAnAccountHoldingNoNameHasTheOneThisRunWouldRegisterNamedFirst(t *testing.T) {
	// cloudflare takes one name per account and every worker on it answers under that one
	// (../../internal/deployment/workersdev.go), so a run that registered one quietly would settle
	// an address across a Cloudflare account off the back of a password prompt.
	said := aboutToMake(
		account.Account{ID: "ac1", Name: "Acme Giving"},
		deployment.Named{Kind: deployment.NameNone})

	if !strings.Contains(said, "acme-giving.workers.dev") {
		t.Errorf("said %q, want the name this run would register", said)
	}
	if !strings.Contains(said, "every worker in this Cloudflare account") {
		t.Errorf("said %q, want what registering it settles", said)
	}
	if strings.Index(said, "acme-giving.workers.dev") > strings.Index(said, "a database") {
		t.Errorf("said %q, want the acts in the order this run reaches them", said)
	}
}

func TestAnAccountWhoseOwnNameMakesNoneNamesTheQuestionInstead(t *testing.T) {
	said := aboutToMake(
		account.Account{ID: "ac1", Name: "***"},
		deployment.Named{Kind: deployment.NameNone})

	if !strings.Contains(said, "workers.dev address") {
		t.Errorf("said %q, want the address this run would register", said)
	}
	if !strings.Contains(said, "you choose the name in a moment") {
		t.Errorf("said %q, want where the name comes from", said)
	}
}

func TestAnAccountAlreadyHoldingANameSaysNothingNew(t *testing.T) {
	// this run leaves a name that is there exactly as it is, so there is nothing to name.
	for _, held := range []deployment.Named{
		{Kind: deployment.NameHeld, Name: "acme"},
		{Kind: deployment.NameUnreachable, Detail: "no route to host"},
	} {
		said := aboutToMake(account.Account{ID: "ac1", Name: "Acme Giving"}, held)

		if strings.Contains(said, "workers.dev") {
			t.Errorf("%s said %q about a name this run would not register", held.Kind, said)
		}
	}
}

func TestWhatARunThatCouldNotNameTheAccountLostIsThePressesOwn(t *testing.T) {
	// a first deploy that cannot name the account has created nothing at all; a finish over a
	// deployment that is standing has only the widget left to make, and an operator told nothing
	// was deployed goes looking for a deployment that is there
	// (../../internal/terminal/outcome.go).
	held := deployment.Named{Kind: deployment.NameUnreachable, Detail: "no route to host"}

	made := unnamed(held, nothingMade)
	registered := unnamed(held, nothingRegistered)

	if !strings.Contains(made.Error(), "nothing was deployed") {
		t.Errorf("a first deploy said %q, want what it did not make", made)
	}
	if strings.Contains(registered.Error(), "nothing was deployed") {
		t.Errorf("a finish said %q about a deployment that is standing and serving", registered)
	}
	if !strings.Contains(registered.Error(), "spam protection") {
		t.Errorf("a finish said %q, want the one thing it did not register", registered)
	}
}
