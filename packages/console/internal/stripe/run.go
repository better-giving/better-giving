package stripe

import (
	"context"

	"github.com/better-giving/console/internal/run"
)

// the one setup run this process is holding, and how a page reads it.
//
// **the press answers as soon as the chain is under way and never with what the chain did.** the
// chain is several round trips against three hosts, and a request held open for them is a page that
// cannot say which part is running — so the press starts it and answers, and the page asks again.
//
// **a run that landed is consumed by the reading that observed it.** the whole of what says a press
// worked is the reading the fold is holding when it stops, so the answer is handed over and then
// dropped: a reload afterwards is a clean face rather than the last press reported again. a run
// that stopped is left where it is — a failure has to survive a reload — and the next press is what
// clears it.
//
// **one at a time.** two chains racing each other would leave the account holding whichever
// endpoint was created last and the deployment holding whichever secret was stored last, which are
// not necessarily the same one — a deployment verifying nothing, with every row on the screen
// reading fine.
//
// the guarding, the one-at-a-time and the outcome that survives a reading are internal/run's. What
// is here is the wire shape this fold reads: flat
// members rather than a progress nested inside a run, because that is what the page draws.

// how far the chain has got and what it has found out, which is what moves while the run goes.
type progress struct {
	act   Act
	stage Stage
	facts Facts
}

// Run is what the page reads off the press, which is a stage and its facts and never the chain.
type Run struct {
	// Kind is `running` or `ended`. Stage is the one the chain is in, and on an ended run the one
	// it stopped at — which is the line the failure is drawn under.
	Kind    string   `json:"kind"`
	Act     Act      `json:"act"`
	Stage   Stage    `json:"stage"`
	Facts   Facts    `json:"facts"`
	Outcome *Outcome `json:"outcome"`
}

// Runs is the run this process is holding, or the outcome of the last one nobody has pressed past.
type Runs struct {
	holder run.Holder[progress, Outcome]
}

// Start starts the chain against the live account, or reports the one already running.
//
// **ctx is the run's own and never the request's.** the press answers before the chain does, so a
// context that ends with the handler would cancel every call the run has left to make.
//
// The key is bound to the caller in `effects` before this is reached and is handed no further, so
// nothing that decides what the fold says is ever holding one — and a publish carries no key to
// bind, so the caller is never built for one.
func (runs *Runs) Start(ctx context.Context, asked Asked, effects Effects) (Run, bool) {
	// a publish starts at the write because there is nothing in front of it, so the lines in front
	// of it are never lit for a press that could not have reached them.
	stage := Naming
	if asked.Act == ActPublish {
		stage = Publishing
	}

	effects.At = func(stage Stage) {
		runs.holder.Update(func(at *progress) { at.stage = stage })
	}
	effects.Found = func(facts Facts) {
		runs.holder.Update(func(at *progress) { at.facts = facts })
	}

	started, going := runs.holder.Start(ctx,
		progress{act: asked.Act, stage: stage, facts: Facts{Elsewhere: []Endpoint{}}},
		func(ctx context.Context) Outcome { return Chain(ctx, asked, effects) },
		consoleStopped)
	return read(&started), going
}

// how a run whose chain died on the console's own goroutine ends.
//
// **it is its own arm and never one of the nine the chain reaches.** every one of those is a step
// answering, and a stop here answered nothing: the chain says where the process was and never what
// the account now holds, so an outcome borrowing a step's arm would be a claim about the processor
// that nothing observed. the way out is the same press again, which reads the account rather than
// assuming it.
//
// **it carries no member, and what the panic carried is in none of them.** a press here is holding
// a secret key, and a value raised from inside the chain is a value that may be spelling one — so
// nothing travels but the kind, and the sentence is the screen's (packages/console-ui).
func consoleStopped() Outcome {
	return Outcome{Kind: ConsoleStopped}
}

// Read is what this console is doing about the processor, or nil where it has never been asked.
//
// An ended run stays readable until the page has drawn it, which is what lets a failure be reported
// at all: the chain answers nothing to the request that started it, so the only place an outcome
// can be read is here.
func (runs *Runs) Read() *Run {
	held := runs.holder.Read()
	if held == nil {
		return nil
	}
	reading := read(held)
	return &reading
}

// Forget drops the outcome the page has drawn, so that the next reading is not the last press's.
//
// A run still going is left alone: what it is holding is the only account of a chain nothing else
// can see.
func (runs *Runs) Forget() { runs.holder.Forget() }

// one reading of the holder, in the flat shape the fold draws.
func read(held *run.Reading[progress, Outcome]) Run {
	kind := "ended"
	if held.Running {
		kind = "running"
	}
	return Run{
		Kind:    kind,
		Act:     held.Progress.act,
		Stage:   held.Progress.stage,
		Facts:   held.Progress.facts,
		Outcome: held.Outcome,
	}
}
