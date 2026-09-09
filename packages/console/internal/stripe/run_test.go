package stripe

import (
	"context"
	"testing"
	"time"

	"github.com/better-giving/console/internal/deployment"
)

// the run this process holds, from the two doors that read it: the press that starts one, and the
// poll that watches it.

// effects whose repeating step waits to be let go, so a case can look at a run mid-chain.
func held(gate chan struct{}) (*effects, Effects) {
	one := working()
	bound := one.bound()
	bound.Repeating = func(context.Context) deployment.RecurringSetup {
		<-gate
		return one.repeating
	}
	return one, bound
}

func TestNothingIsReadOffAConsoleThatHasNeverBeenPressed(t *testing.T) {
	runs := &Runs{}
	if runs.Read() != nil {
		t.Error("a console nobody has pressed reports a run")
	}
}

func TestASecondPressWhileOneIsGoingJoinsItRatherThanStartingAnother(t *testing.T) {
	gate := make(chan struct{})
	_, effects := held(gate)
	runs := &Runs{}

	first, started := runs.Start(context.Background(), errand(), effects)
	if !started || first.Kind != "running" {
		t.Fatalf("first = %+v, started = %v", first, started)
	}

	second, again := runs.Start(context.Background(), errand(), effects)
	if again {
		t.Error("a second chain started, and the two would leave the account and the deployment holding different endpoints")
	}
	if second.Kind != "running" {
		t.Errorf("second = %+v, want the one already going", second)
	}

	close(gate)
	settle(t, runs)
}

func TestAPressAnswersBeforeTheChainDoesAndTheStageIsWhatMoves(t *testing.T) {
	gate := make(chan struct{})
	_, effects := held(gate)
	runs := &Runs{}

	started, _ := runs.Start(context.Background(), errand(), effects)
	if started.Stage != Naming {
		t.Errorf("stage = %q, want the chain's first step", started.Stage)
	}

	// the chain is stopped at the repeating step, which is what the poll is reading.
	waitFor(t, runs, func(run *Run) bool { return run.Kind == "running" && run.Stage == Repeating })
	reading := runs.Read()
	if reading.Facts.Named == nil || reading.Facts.Named.Account.ID != "acct_1" {
		t.Errorf("facts = %+v, want the account named at the first step", reading.Facts)
	}

	close(gate)
	settle(t, runs)
}

func TestAPublishStartsAtTheWriteSoNoLineIsLitForAStepItCannotReach(t *testing.T) {
	one := working()
	runs := &Runs{}
	started, _ := runs.Start(context.Background(),
		Asked{Act: ActPublish, PublishableKey: "pk_live_x"}, one.bound())

	if started.Stage != Publishing || started.Act != ActPublish {
		t.Errorf("started = %+v", started)
	}
	settle(t, runs)
}

func TestARunThatLandedIsConsumedByTheReadingThatObservedIt(t *testing.T) {
	one := working()
	runs := &Runs{}
	runs.Start(context.Background(), errand(), one.bound())
	settle(t, runs)

	landed := runs.Read()
	if landed == nil || landed.Kind != "ended" || landed.Outcome.Kind != Done {
		t.Fatalf("run = %+v", landed)
	}
	runs.Forget()
	if runs.Read() != nil {
		t.Error("a run that landed is reported again, so a reload draws the last press rather than a clean face")
	}
}

func TestARunThatStoppedStaysUntilTheNextPressClearsIt(t *testing.T) {
	one := working()
	one.processor.answers["GET /account"] = turnedDown(401, "Invalid API Key provided")
	runs := &Runs{}
	runs.Start(context.Background(), errand(), one.bound())
	settle(t, runs)

	// a failure has to survive a reload, so the reading that observed it hands it over and leaves
	// it where it is.
	for at := 0; at < 2; at++ {
		stopped := runs.Read()
		if stopped == nil || stopped.Outcome == nil || stopped.Outcome.Kind != Unnamed {
			t.Fatalf("reading %d = %+v", at, stopped)
		}
	}

	afresh := working()
	runs.Start(context.Background(), errand(), afresh.bound())
	if reading := runs.Read(); reading == nil || reading.Kind != "running" {
		t.Errorf("reading = %+v, want the press that cleared it", reading)
	}
	settle(t, runs)
	if landed := runs.Read(); landed == nil || landed.Outcome.Kind != Done {
		t.Errorf("landed = %+v", landed)
	}
}

func TestARunStillGoingIsNotDroppedByAReadingThatObservedNoOutcome(t *testing.T) {
	gate := make(chan struct{})
	_, effects := held(gate)
	runs := &Runs{}
	runs.Start(context.Background(), errand(), effects)

	runs.Forget()
	if reading := runs.Read(); reading == nil || reading.Kind != "running" {
		t.Errorf("reading = %+v, want the chain nothing else can see", reading)
	}

	close(gate)
	settle(t, runs)
}

// the run read until `until` holds, or the case failed for want of it.
func waitFor(t *testing.T, runs *Runs, until func(*Run) bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if run := runs.Read(); run != nil && until(run) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("the run never reached what the case waited for: %+v", runs.Read())
}

func settle(t *testing.T, runs *Runs) {
	t.Helper()
	waitFor(t, runs, func(run *Run) bool { return run.Kind == "ended" })
}

func TestARunThatPanickedEndsAsTheConsoleStoppingRatherThanAnAccountThatWouldNotList(t *testing.T) {
	// what the operator is owed is that this console failed part way through the press and does not
	// know how far it got. an outcome spelled as the account's endpoints not being readable is a
	// claim about the processor that nothing observed, and it sends a reader to the wrong account.
	runs := &Runs{}
	if _, started := runs.Start(context.Background(), errand(), Effects{}); !started {
		t.Fatal("the press started nothing")
	}
	settle(t, runs)

	outcome := runs.Read().Outcome
	if outcome == nil || outcome.Kind != ConsoleStopped {
		t.Fatalf("outcome = %+v, want the console's own stop", outcome)
	}
	// a press here is holding a secret key, and a value raised from inside the chain is a value that
	// may be spelling one — so the arm carries nothing at all.
	if outcome.Failure != nil || outcome.Address != nil || outcome.EndpointID != "" {
		t.Errorf("outcome = %+v, want an arm carrying nothing the panic could have spelled", outcome)
	}
}
