package deployment

import (
	"context"
	"net/http"
	"time"
)

// whether the address ./address.go composes has started answering, which is a question one run in
// the life of a deployment has to ask.
//
// **a workers.dev name the account registered a minute ago does not reach the machine asking yet.**
// the address is composed the moment the name is taken, so a console handed it straight away asks
// after something nothing on the network can find — and what that draws is the console's own
// unreachable gate, in place of the page an operator came for, over a deployment that is standing.
//
// **it is the registering run's question and no other run's.** cloudflare takes one name per
// account and every worker on it answers under that one (./workersdev.go), so an account that
// already held a name has been reachable under it for as long as it has held it — and a worker put
// up under one answers the moment the upload lands.
//
// **any answer at all is the address working, a refusal and a 404 included.** what is waited on is
// the address reaching the machine that asked; what a deployment says back to an unsigned request
// is a different question and one this has no sign-in to ask. only nothing answering is not yet.
//
// **the bound elapsing is never a deployment that failed.** the worker is up either way, so what a
// caller does with false is say so and carry on (../../cmd/better-giving/start.go's workingAt).

// Reaching is one ask made at an address: whether anything answered it at all.
type Reaching func(ctx context.Context, address string) bool

// how long one ask waits before it counts as nothing having answered.
//
// the bound this console's other address reads are made under (../effects/addresses.go), and well
// inside the wait these are made in: an ask that hangs is one the next one is made after it rather
// than the whole of what the operator was waiting through.
const reachWithin = 5 * time.Second

// a redirect is an answer and is not followed: what is being read is whether anything is there,
// and the host a deployment points a browser at is a second address this was never asking about.
var reaching = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// Reach is Reaching over the wire.
func Reach(ctx context.Context, address string) bool {
	bound, stop := context.WithTimeout(ctx, reachWithin)
	defer stop()

	ask, err := http.NewRequestWithContext(bound, http.MethodGet, address, nil)
	if err != nil {
		return false
	}
	answer, err := reaching.Do(ask)
	if err != nil {
		return false
	}
	_ = answer.Body.Close()
	return true
}

// AddressBound is how long a run waits for the address it registered a name for to start answering,
// and AddressAsked how often it asks inside that.
//
// **the bound is what an operator will sit through and not what the name will take.** how long a
// name takes to reach the machine asking is nobody here's to know, so what this is set against is
// the wait itself: two minutes of a spinner is a wait, and the console opens on the far side of it
// either way.
const (
	AddressBound = 2 * time.Minute
	AddressAsked = 2 * time.Second
)

// StartsWorking is whether `address` answered inside `within`, asked again every `every`
// until it does.
//
// False is the bound elapsing with nothing having answered, which is a line for the caller to say
// and never a press that failed.
func StartsWorking(
	ctx context.Context,
	reach Reaching,
	address string,
	within, every time.Duration,
) bool {
	bound, stop := context.WithTimeout(ctx, within)
	defer stop()

	for {
		if reach(bound, address) {
			return true
		}
		select {
		case <-bound.Done():
			return false
		case <-time.After(every):
		}
	}
}
