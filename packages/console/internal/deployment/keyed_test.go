package deployment

import (
	"context"
	"testing"
	"time"
)

// an answer numbered by the ask that drew it, so a case can say which one came back.
type keyAnswer struct {
	awaiting bool
	ask      int
}

func (one keyAnswer) AwaitsKey() bool { return one.awaiting }

// an ask answering `awaiting` for its first `lagging` calls and keyed after, and the count of calls.
func lagging(lagging int) (func(context.Context) keyAnswer, *int) {
	asks := 0
	return func(context.Context) keyAnswer {
		asks++
		return keyAnswer{awaiting: asks <= lagging, ask: asks}
	}, &asks
}

func TestAnAnswerAwaitingTheKeyIsAskedAgainUntilTheEdgeServesIt(t *testing.T) {
	ask, asks := lagging(2)

	got := UntilKeyed(context.Background(), ask, time.Minute, time.Millisecond)

	if got.awaiting || *asks != 3 {
		t.Errorf("answer = %+v after %d asks, want the keyed answer on the third", got, *asks)
	}
}

// the bound elapsing is the note the screen already draws, and never a failure of its own.
func TestTheBoundElapsingHandsBackTheLastAnswer(t *testing.T) {
	ask, asks := lagging(1 << 30)

	got := UntilKeyed(context.Background(), ask, 20*time.Millisecond, time.Millisecond)

	if !got.awaiting || got.ask != *asks || *asks < 2 {
		t.Errorf("answer = %+v after %d asks, want the last of several, still awaiting", got, *asks)
	}
}

func TestAnAnswerNotAwaitingTheKeyIsTakenTheFirstTime(t *testing.T) {
	ask, asks := lagging(0)

	got := UntilKeyed(context.Background(), ask, time.Minute, time.Millisecond)

	if got.awaiting || *asks != 1 {
		t.Errorf("answer = %+v after %d asks, want the first", got, *asks)
	}
}

func TestAContextEndedBetweenAsksEndsTheWaitAtOnce(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := make(chan struct{})
	asks := 0
	ask := func(context.Context) keyAnswer {
		asks++
		if asks == 1 {
			close(first)
		}
		return keyAnswer{awaiting: true, ask: asks}
	}
	go func() {
		<-first
		cancel()
	}()

	ended := make(chan keyAnswer, 1)
	go func() { ended <- UntilKeyed(ctx, ask, time.Minute, time.Minute) }()
	select {
	case got := <-ended:
		if !got.awaiting || got.ask != 1 {
			t.Errorf("answer = %+v, want the one ask made before the context ended", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the wait outlived its context")
	}
}

func TestNoPauseBetweenAsksAsksOnce(t *testing.T) {
	ask, asks := lagging(1 << 30)

	got := UntilKeyed(context.Background(), ask, time.Minute, 0)

	if !got.awaiting || *asks != 1 {
		t.Errorf("answer = %+v after %d asks, want one ask and its answer", got, *asks)
	}
}

// the one case made against KeyAsked's real pause, which is why it runs in parallel with the
// others.
func TestWaitingOnKeyAsksAgainAfterAPause(t *testing.T) {
	t.Parallel()
	ask, asks := lagging(1)

	got := WaitingOnKey(nil, ask)(context.Background())

	if got.awaiting || *asks != 2 {
		t.Errorf("answer = %+v after %d asks, want the keyed answer on the second", got, *asks)
	}
}

// a stop ends the wait and never the call: an ask in flight when it lands finishes under its own
// context and is the answer handed back.
func TestAStopEndsTheWaitAndLetsTheAskInFlightFinish(t *testing.T) {
	stopping := make(chan struct{})
	gate := make(chan struct{})
	asking := make(chan struct{})
	asks := 0
	var cut error
	ask := func(ctx context.Context) keyAnswer {
		asks++
		close(asking)
		<-gate
		cut = ctx.Err()
		return keyAnswer{awaiting: true, ask: asks}
	}

	ended := make(chan keyAnswer, 1)
	go func() {
		ended <- waitingOnKey(stopping, ask, time.Minute, time.Minute)(context.Background())
	}()
	<-asking
	close(stopping)
	close(gate)

	select {
	case got := <-ended:
		if !got.awaiting || asks != 1 || cut != nil {
			t.Errorf("answer = %+v after %d asks with the ask's context ended by %v, want the one "+
				"ask finished and handed back", got, asks, cut)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the wait outlived the stop")
	}
}
