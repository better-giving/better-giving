package paypal

import (
	"context"

	"github.com/better-giving/console/internal/run"
)

// the one PayPal setup run this process is holding, and how a page reads it.
//
// ../stripe/run.go's arrangement and for its reasons: the press answers as soon as the chain is under
// way, a run that landed is consumed by the reading that observed it and one that stopped stays until
// the next press, and one runs at a time — two racing each other could leave the deployment holding
// the id of whichever listener was settled first, beside a pair from the second. the guarding is
// internal/run's; what is here is the flat wire shape the fold reads.

type progress struct {
	stage Stage
	facts Facts
}

// Run is what the page reads off the press, which is a stage and its facts and never the chain.
type Run struct {
	// Kind is `running` or `ended`. Stage is the one the chain is in, and on an ended run the one it
	// stopped at — which is the line the failure is drawn under.
	Kind    string   `json:"kind"`
	Stage   Stage    `json:"stage"`
	Facts   Facts    `json:"facts"`
	Outcome *Outcome `json:"outcome"`
}

// Runs is the run this process is holding, or the outcome of the last one nobody has pressed past.
type Runs struct {
	holder run.Holder[progress, Outcome]
}

// Start starts the chain, or reports the one already running.
//
// **ctx is the run's own and never the request's**, for ../stripe/run.go's reason. the pair is bound
// into `effects` before this is reached and is otherwise only in `asked`, which reaches no reading.
func (runs *Runs) Start(ctx context.Context, asked Asked, effects Effects) (Run, bool) {
	effects.At = func(stage Stage) {
		runs.holder.Update(func(at *progress) { at.stage = stage })
	}
	effects.Found = func(facts Facts) {
		runs.holder.Update(func(at *progress) { at.facts = facts })
	}

	started, going := runs.holder.Start(ctx,
		progress{stage: Authorizing, facts: Facts{Elsewhere: []Listener{}}},
		func(ctx context.Context) Outcome { return Chain(ctx, asked, effects) },
		// its own arm and carrying nothing, for ../stripe/run.go's `consoleStopped` reason: a value
		// raised inside a chain holding a client secret may be spelling it.
		func() Outcome { return Outcome{Kind: ConsoleStopped} })
	return read(&started), going
}

// Read is what this console is doing about PayPal, or nil where it has never been asked.
func (runs *Runs) Read() *Run {
	held := runs.holder.Read()
	if held == nil {
		return nil
	}
	reading := read(held)
	return &reading
}

// Forget drops the outcome the page has drawn. A run still going is left alone.
func (runs *Runs) Forget() { runs.holder.Forget() }

func read(held *run.Reading[progress, Outcome]) Run {
	kind := "ended"
	if held.Running {
		kind = "running"
	}
	return Run{
		Kind:    kind,
		Stage:   held.Progress.stage,
		Facts:   held.Progress.facts,
		Outcome: held.Outcome,
	}
}
