// Package run is the one press this process is holding, and how a page reads it.
//
// **a press that takes minutes answers as soon as the chain is under way and never with what the
// chain did.** the first deploy is a database, a bundle, a remote migration, an upload and five
// writes; the processor's setup is several round trips against three hosts. a request held open for
// either is a page that cannot say which part is running — so the press starts it and answers, and
// how far it got is read off this holder afterwards: `Read` for one reading, `Watch` for a page
// held level with the run as it moves.
//
// **one at a time, per holder.** two chains racing each other leave the account and the deployment
// holding whichever call finished last, which are not necessarily the same one — a deployment
// verifying nothing, with every row on the screen reading fine.
//
// **a run that ended stays readable until something says it has been drawn.** the chain answers
// nothing to the request that started it, so the only place an outcome can be read is here; what
// each fold does with that reading is its own — Forget is the door for a press whose whole account
// of itself is the reading the fold is holding when it stops.
//
// the state is guarded rather than owned by a goroutine: what reads it is an http handler on
// whatever goroutine the server hands it, and the run itself is on one of its own.
//
// the two type parameters are the progress a screen names while the chain goes and the outcome it
// draws when it stops. The wire shape stays each fold's own: what crosses to a browser is spelled
// by the handler that answers, so one holder serves two presses that report themselves differently.
package run

import (
	"context"
	"sync"
)

// Reading is a run as it stands: whether it is still going, how far it got, and how it ended.
type Reading[Progress any, Outcome any] struct {
	Running  bool
	Progress Progress
	// Outcome is nil while the chain is going, and set on every reading of one that ended.
	Outcome *Outcome
}

// Holder is the run this process is holding, or the outcome of the last one nobody has pressed
// past. The zero value holds nothing and is ready to take a press.
type Holder[Progress any, Outcome any] struct {
	mutex    sync.Mutex
	running  bool
	progress Progress
	ended    *Reading[Progress, Outcome]
	// version counts the changes this holder has made, and changed is closed and replaced on each
	// of them. Both are the mutex's, like everything above: a watcher takes the reading and the
	// channel in one hold, which is what makes a change between the two impossible to miss.
	version uint64
	changed chan struct{}
}

// Start runs `chain` from `at`, or reports the run already going and starts nothing.
//
// **ctx is the run's own and never the request's.** the press answers before the chain does, so a
// context that ended with the handler would cancel every call the run has left to make; each of
// those calls carries a deadline of its own, which is what bounds the run.
//
// `failed` is the outcome a chain that panicked ends as, and it is asked for rather than made here
// because what a stopped run says is each fold's own vocabulary. It is called on the run's own
// goroutine, holds no lock, and is handed nothing the panic carried.
//
// The last press's outcome goes with the new one starting, which is what makes the next press the
// way out of a run that stopped.
func (holder *Holder[Progress, Outcome]) Start(
	ctx context.Context,
	at Progress,
	chain func(context.Context) Outcome,
	failed func() Outcome,
) (Reading[Progress, Outcome], bool) {
	holder.mutex.Lock()
	if holder.running {
		going := holder.read()
		holder.mutex.Unlock()
		return going, false
	}
	holder.running, holder.progress, holder.ended = true, at, nil
	holder.moved()
	started := holder.read()
	holder.mutex.Unlock()

	go func() {
		outcome := holder.chase(ctx, chain, failed)
		holder.mutex.Lock()
		defer holder.mutex.Unlock()
		holder.running = false
		holder.ended = &Reading[Progress, Outcome]{Progress: holder.progress, Outcome: &outcome}
		holder.moved()
	}()

	return started, true
}

// the chain's own outcome, or the one a chain that panicked ends as.
//
// **a panic here is nobody else's to catch**: recover reaches only the goroutine it is deferred on,
// so a chain without this one takes the process down — and were it survived anywhere else, the run
// would stay going and every later press would join a chain nothing is running.
//
// **what the panic carried reaches no reading.** a press this console makes is holding a password
// and a cloudflare credential, and a value raised from inside one is a value that may be spelling
// either; the outcome is the fold's own fixed one, and the recovered value is dropped where it is.
func (holder *Holder[Progress, Outcome]) chase(
	ctx context.Context,
	chain func(context.Context) Outcome,
	failed func() Outcome,
) (outcome Outcome) {
	defer func() {
		if recovered := recover(); recovered != nil {
			outcome = failed()
		}
	}()
	return chain(ctx)
}

// Update moves the progress a page reads, and is called on the goroutine the run is on.
//
// The change is made under the lock rather than handed a copy, so a chain reporting two things
// about itself never writes back a progress that lost the other.
func (holder *Holder[Progress, Outcome]) Update(change func(*Progress)) {
	holder.mutex.Lock()
	defer holder.mutex.Unlock()
	change(&holder.progress)
	holder.moved()
}

// Read is what this process is doing about the press, or nil where it has never been asked.
func (holder *Holder[Progress, Outcome]) Read() *Reading[Progress, Outcome] {
	holder.mutex.Lock()
	defer holder.mutex.Unlock()
	if holder.running {
		going := holder.read()
		return &going
	}
	return holder.ended
}

// Forget drops the outcome the page has drawn, so that the next reading is not the last press's.
//
// A run still going is left alone: what it is holding is the only account of a chain nothing else
// can see.
func (holder *Holder[Progress, Outcome]) Forget() {
	holder.mutex.Lock()
	defer holder.mutex.Unlock()
	if !holder.running {
		holder.ended = nil
	}
}

// Watch is the run as it stands, the change it is at, and when the next change lands.
//
// **it is the whole reading every time and never what moved**, which is what lets a page attach in
// the middle of a run, or attach again after a reload, and draw from the first thing it is handed
// — there is nothing to replay and nothing to have missed.
//
// `seen` is the change the caller has already drawn. A caller the holder has moved past is handed a
// channel that is closed already, so it draws what it is behind on rather than waiting for a change
// that has landed; a caller level with the holder is handed the one that closes on the next.
//
// **it registers nothing.** the channel is the holder's own, closed and replaced on each change, so
// a watcher that stops watching leaves nothing here to clean up and a hundred of them cost what one
// does.
func (holder *Holder[Progress, Outcome]) Watch(seen uint64) (*Reading[Progress, Outcome], uint64, <-chan struct{}) {
	holder.mutex.Lock()
	defer holder.mutex.Unlock()
	if holder.changed == nil {
		holder.changed = make(chan struct{})
	}
	changed := holder.changed
	if seen != holder.version {
		changed = closedChannel
	}
	if holder.running {
		going := holder.read()
		return &going, holder.version, changed
	}
	return holder.ended, holder.version, changed
}

// a change made, which is what wakes every watcher. The caller holds the lock.
func (holder *Holder[Progress, Outcome]) moved() {
	holder.version++
	if holder.changed != nil {
		close(holder.changed)
	}
	holder.changed = make(chan struct{})
}

// what a watcher the holder has moved past waits on, which is nothing at all.
var closedChannel = func() chan struct{} {
	made := make(chan struct{})
	close(made)
	return made
}()

// the run as it stands. The caller holds the lock.
func (holder *Holder[Progress, Outcome]) read() Reading[Progress, Outcome] {
	return Reading[Progress, Outcome]{Running: true, Progress: holder.progress}
}
