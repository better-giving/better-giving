package deployment

import (
	"context"
	"time"
)

// waiting out the edge after a run stores a processor key, which is the one lag a run's own later
// steps are made against.
//
// **the var write lands at once and the edge serves it some seconds later.** a run that stores a
// key and then asks the deployment to act with it is answered, for that stretch, by a deployment
// building its payment provider without one — `no_key` on ./recurring.go's press and on
// ./wallets.go's. that answer is a fact about timing and not about the key, so it is asked again;
// so is the recurring press the deployment answers `nothing_to_set_up`, which ./recurring.go's
// AwaitsKey reads as the same moment. every other answer, a refusal or nothing answering, is taken
// the first time.
//
// **the wait is a run's and never an operator's press.** a run's step is made seconds after its own
// write; the screen's own recurring and wallets presses (../server/errands.go) are made against
// whatever the deployment was already holding, so `no_key` there is no key set and waiting on it is
// waiting for nothing. which is why the wait is wrapped around a run's effects where they are bound
// (../server/stripe.go, ../server/paypal.go) rather than made inside the two presses.
//
// **the bound elapsing hands back the last answer, not a failure of its own.** the run ends on the
// awaiting-key outcome that answer already implies, which the next press finishes.

// Keyed is an answer that can say the deployment is not serving the key yet.
type Keyed interface {
	AwaitsKey() bool
}

// KeyBound is how long one wait for the edge to serve a key lasts, and KeyAsked how often it asks
// inside that.
const (
	KeyBound = 60 * time.Second
	KeyAsked = 2 * time.Second
)

// WaitingOnKey is ask made to wait out the edge: asked again every KeyAsked while it answers that the
// key is not served yet, for up to KeyBound from the first ask.
//
// `stopping` closing ends the wait and never an ask: one in flight finishes under its own context
// and its answer is handed back, which is the console being closed on a run that then ends with the
// awaiting-key outcome it has. a nil channel never stops it.
func WaitingOnKey[T Keyed](stopping <-chan struct{}, ask func(ctx context.Context) T) func(ctx context.Context) T {
	return waitingOnKey(stopping, ask, KeyBound, KeyAsked)
}

func waitingOnKey[T Keyed](
	stopping <-chan struct{}, ask func(ctx context.Context) T, within, every time.Duration,
) func(ctx context.Context) T {
	return func(ctx context.Context) T {
		waiting, stop := context.WithCancel(ctx)
		defer stop()
		go func() {
			select {
			case <-stopping:
				stop()
			case <-waiting.Done():
			}
		}()
		return UntilKeyed(waiting, func(context.Context) T { return ask(ctx) }, within, every)
	}
}

// UntilKeyed is ask's answer once it stops awaiting the key, asked again every `every` until it
// does, `within` elapses or ctx ends — and the last answer where it never stopped. `every` at or
// below zero asks once.
//
// Each ask is made under ctx rather than under the bound, so a press already in flight when the
// bound elapses finishes and is read, rather than cut off into an answer that says nothing about
// the key.
func UntilKeyed[T Keyed](
	ctx context.Context, ask func(ctx context.Context) T, within, every time.Duration,
) T {
	bound, stop := context.WithTimeout(ctx, within)
	defer stop()

	for {
		answer := ask(ctx)
		if !answer.AwaitsKey() || every <= 0 || bound.Err() != nil {
			return answer
		}
		select {
		case <-bound.Done():
			return answer
		case <-time.After(every):
		}
	}
}
