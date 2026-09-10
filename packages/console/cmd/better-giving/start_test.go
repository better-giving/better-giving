package main

import (
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/deployment"
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

	taken, err := beforeTheChain(portHeldBy(t, holding))

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
	taken, err := beforeTheChain(freePort(t))

	if err != nil {
		t.Fatalf("beforeTheChain = %v, want the port taken", err)
	}
	t.Cleanup(func() { _ = taken.Close() })
	if taken.Addr().String() == "" {
		t.Error("the listener the chain is served on names no address")
	}
}

// what a prompt the operator closed leaves on the screen.
//
// ./update.go's door argues the line for the identical act: a command that exited saying nothing
// would read as a deployment now standing.

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
// it is the first failure either press can hit and the one with nothing on the end of it: a refusal
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
		err := unread(deployment.Address{Kind: read.kind, Detail: "said"}, terminal.Starting)
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
	// `start` stands a deployment up and `update` only carries code over one, so either sentence
	// naming the other press sends an operator somewhere that does not repair what they are at.
	err := unread(deployment.Address{Kind: deployment.AddressUnreadable}, terminal.Updating)
	if !strings.Contains(err.Error(), "better-giving update") {
		t.Errorf("said %v, want the press that made the read", err)
	}
	if strings.Contains(err.Error(), "better-giving start") {
		t.Errorf("said %v, want no press but the one that made the read", err)
	}
}

// what a deployment that was already standing is answered with, which is never a deploy.

func TestADeploymentAlreadyStandingNamesThePressThatCarriesThisReleaseOntoIt(t *testing.T) {
	said := alreadyUp(deployment.Address{Kind: deployment.Deployed, WorkersDev: "https://give.acme.test"})

	if !strings.Contains(said, "give.acme.test") {
		t.Errorf("said %q, want where the deployment answers", said)
	}
	if !strings.Contains(said, "better-giving update") {
		t.Errorf("said %q, want the press that carries this release onto it", said)
	}
	if !strings.Contains(said, "nothing was deployed") {
		t.Errorf("said %q, want the operator told this press deployed nothing", said)
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
