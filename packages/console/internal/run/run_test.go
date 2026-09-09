package run

import (
	"context"
	"testing"
	"time"
)

// the holder every long press in this binary is watched through, from the two doors that reach it:
// the press that starts one, and the poll that watches it.

// how far a made-up chain has got, which is the shape a real one's progress is.
type where struct {
	Step  string
	Found int
}

// how a made-up chain ended.
type ended struct{ Kind string }

// how a chain that panicked ends, which every case but the two about one is written never to reach.
func gone() ended { return ended{Kind: "gone"} }

func TestNothingIsReadOffAHolderNobodyHasPressed(t *testing.T) {
	holder := &Holder[where, ended]{}
	if holder.Read() != nil {
		t.Error("a holder nobody has pressed reports a run")
	}
}

func TestASecondPressWhileOneIsGoingJoinsItRatherThanStartingAnother(t *testing.T) {
	gate := make(chan struct{})
	holder := &Holder[where, ended]{}

	first, started := holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended {
			<-gate
			return ended{Kind: "done"}
		}, gone)
	if !started || !first.Running {
		t.Fatalf("first = %+v, started = %v", first, started)
	}

	second, again := holder.Start(context.Background(), where{Step: "afresh"},
		func(context.Context) ended { return ended{Kind: "second"} }, gone)
	if again {
		t.Error("a second chain started, and the two would race each other through the same writes")
	}
	if !second.Running || second.Progress.Step != "one" {
		t.Errorf("second = %+v, want the one already going", second)
	}

	close(gate)
	settle(t, holder)
}

func TestAPressAnswersBeforeTheChainDoesAndTheProgressIsWhatMoves(t *testing.T) {
	gate := make(chan struct{})
	holder := &Holder[where, ended]{}

	started, _ := holder.Start(context.Background(), where{Step: "one"}, func(context.Context) ended {
		holder.Update(func(at *where) { at.Step = "two" })
		holder.Update(func(at *where) { at.Found = 7 })
		<-gate
		return ended{Kind: "done"}
	}, gone)
	if started.Progress.Step != "one" {
		t.Errorf("started = %+v, want the chain's first step", started)
	}

	waitFor(t, holder, func(read *Reading[where, ended]) bool {
		return read.Running && read.Progress.Step == "two" && read.Progress.Found == 7
	})

	close(gate)
	settle(t, holder)
	landed := holder.Read()
	if landed.Progress.Step != "two" || landed.Progress.Found != 7 {
		t.Errorf("landed = %+v, want the progress the chain stopped at", landed)
	}
}

func TestARunThatEndedIsReadUntilItIsForgotten(t *testing.T) {
	holder := &Holder[where, ended]{}
	holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended { return ended{Kind: "done"} }, gone)
	settle(t, holder)

	// a failure has to survive a reload, so a reading hands the outcome over and leaves it where it
	// is until something says it has been drawn.
	for at := 0; at < 2; at++ {
		read := holder.Read()
		if read == nil || read.Outcome == nil || read.Outcome.Kind != "done" {
			t.Fatalf("reading %d = %+v", at, read)
		}
	}

	holder.Forget()
	if holder.Read() != nil {
		t.Error("a run that was forgotten is reported again, so a reload draws the last press")
	}
}

func TestTheNextPressClearsTheOutcomeTheLastOneLeft(t *testing.T) {
	holder := &Holder[where, ended]{}
	holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended { return ended{Kind: "stopped"} }, gone)
	settle(t, holder)

	going, started := holder.Start(context.Background(), where{Step: "afresh"},
		func(context.Context) ended { return ended{Kind: "done"} }, gone)
	if !started || going.Outcome != nil {
		t.Errorf("going = %+v, started = %v, want the press that cleared the last outcome", going, started)
	}
	settle(t, holder)
	if landed := holder.Read(); landed.Outcome.Kind != "done" {
		t.Errorf("landed = %+v", landed)
	}
}

func TestARunStillGoingIsNotDroppedByAReadingThatObservedNoOutcome(t *testing.T) {
	gate := make(chan struct{})
	holder := &Holder[where, ended]{}
	holder.Start(context.Background(), where{Step: "one"}, func(context.Context) ended {
		<-gate
		return ended{Kind: "done"}
	}, gone)

	holder.Forget()
	if read := holder.Read(); read == nil || !read.Running {
		t.Errorf("reading = %+v, want the chain nothing else can see", read)
	}

	close(gate)
	settle(t, holder)
}

func TestAChainThatPanickedEndsTheRunRatherThanTheProcess(t *testing.T) {
	// recover reaches only the goroutine it is deferred on, so a chain that panicked without one
	// takes the process with it — and the press it was holding is never reported at all.
	holder := &Holder[where, ended]{}
	holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended { panic("the chain reached for something that was not there") },
		gone)

	settle(t, holder)
	landed := holder.Read()
	if landed.Outcome == nil || landed.Outcome.Kind != "gone" {
		t.Errorf("landed = %+v, want the outcome a chain that failed ends as", landed)
	}
}

func TestAPressAfterAChainThatPanickedStartsRatherThanJoiningIt(t *testing.T) {
	// the run left going is the second cost of an uncaught panic: every later press reads a chain
	// this process is not holding, and the console has no way back to the press it refuses.
	holder := &Holder[where, ended]{}
	holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended { panic("the chain reached for something that was not there") },
		gone)
	settle(t, holder)

	_, started := holder.Start(context.Background(), where{Step: "afresh"},
		func(context.Context) ended { return ended{Kind: "done"} },
		gone)
	if !started {
		t.Fatal("the press was refused, so a chain that panicked leaves the console holding a run forever")
	}
	settle(t, holder)
	if landed := holder.Read(); landed.Outcome.Kind != "done" {
		t.Errorf("landed = %+v", landed)
	}
}

// the run read until `until` holds, or the case failed for want of it.
func waitFor(t *testing.T, holder *Holder[where, ended], until func(*Reading[where, ended]) bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if read := holder.Read(); read != nil && until(read) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("the run never reached what the case waited for: %+v", holder.Read())
}

func settle(t *testing.T, holder *Holder[where, ended]) {
	t.Helper()
	waitFor(t, holder, func(read *Reading[where, ended]) bool { return !read.Running })
}

func TestAWatcherIsHandedTheRunAsItStandsAndTheChangeItIsAt(t *testing.T) {
	holder := &Holder[where, ended]{}
	gate := make(chan struct{})
	holder.Start(context.Background(), where{Step: "one"}, func(context.Context) ended {
		<-gate
		return ended{Kind: "done"}
	}, gone)

	read, version, _ := holder.Watch(0)
	if read == nil || !read.Running || read.Progress.Step != "one" {
		t.Fatalf("read = %+v, want the run as it stands", read)
	}
	if version == 0 {
		t.Error("the press moved nothing, so a page attaching mid-run would wait for a change it already missed")
	}

	close(gate)
	settle(t, holder)
}

func TestAWatcherLevelWithTheHolderWaitsAndOneBehindItDoesNot(t *testing.T) {
	holder := &Holder[where, ended]{}
	gate := make(chan struct{})
	holder.Start(context.Background(), where{Step: "one"}, func(context.Context) ended {
		<-gate
		return ended{Kind: "done"}
	}, gone)

	// the first watch is behind whatever the press already moved, so it is level only once it has
	// asked at the version that press answered with.
	_, version, _ := holder.Watch(0)
	_, _, changed := holder.Watch(version)
	select {
	case <-changed:
		t.Fatal("a watcher level with the holder was woken by a change nothing made")
	default:
	}

	holder.Update(func(at *where) { at.Step = "two" })
	select {
	case <-changed:
	case <-time.After(2 * time.Second):
		t.Fatal("the progress moved and nothing woke, so a stream would sit on a stale reading")
	}

	// the same version again: the holder has moved past it, so nothing is waited for at all.
	read, moved, behind := holder.Watch(version)
	if moved == version || read.Progress.Step != "two" {
		t.Fatalf("read = %+v at %d, want the change the update made", read, moved)
	}
	select {
	case <-behind:
	default:
		t.Error("a watcher behind the holder was told to wait, so the change it has not drawn waits on the next one")
	}

	close(gate)
	settle(t, holder)
}

func TestAWatcherIsWokenByTheRunEnding(t *testing.T) {
	holder := &Holder[where, ended]{}
	gate := make(chan struct{})
	holder.Start(context.Background(), where{Step: "one"}, func(context.Context) ended {
		<-gate
		return ended{Kind: "done"}
	}, gone)

	_, version, _ := holder.Watch(0)
	_, _, changed := holder.Watch(version)
	close(gate)
	select {
	case <-changed:
	case <-time.After(2 * time.Second):
		t.Fatal("the run ended and nothing woke, so a stream would hold a page on a run that stopped")
	}
	read, moved, _ := holder.Watch(version)
	if moved == version || read.Running || read.Outcome == nil {
		t.Fatalf("read = %+v at %d, want the outcome the run ended with", read, moved)
	}
}

func TestAWatcherIsWokenByAChainThatPanicked(t *testing.T) {
	// the recover path sets the outcome like any other ending, and a watcher not woken there is a
	// page left drawing a run this process stopped holding.
	holder := &Holder[where, ended]{}
	_, version, changed := holder.Watch(0)
	holder.Start(context.Background(), where{Step: "one"},
		func(context.Context) ended { panic("the chain reached for something that was not there") },
		gone)

	select {
	case <-changed:
	case <-time.After(2 * time.Second):
		t.Fatal("nothing woke, so a stream would hold a page on a chain that died")
	}
	settle(t, holder)
	read, moved, _ := holder.Watch(version)
	if moved == version || read.Outcome == nil || read.Outcome.Kind != "gone" {
		t.Fatalf("read = %+v at %d, want the outcome a chain that failed ends as", read, moved)
	}
}

func TestNothingIsWatchedOffAHolderNobodyHasPressed(t *testing.T) {
	holder := &Holder[where, ended]{}
	read, version, changed := holder.Watch(0)
	if read != nil || version != 0 {
		t.Errorf("read = %+v at %d, want nothing at all", read, version)
	}
	select {
	case <-changed:
		t.Error("a holder nobody has pressed woke a watcher")
	default:
	}
}
