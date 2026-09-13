// Package effects is what the presses that reach cloudflare actually do, bound to one cloudflare
// account and one sign-in.
//
// **it is a package of its own so that the wiring is stated once.** ../../cmd/better-giving's
// `start` hands ../first the eight functions below, its `update` binds ./carry.go's redeploy and
// ./pending.go's read of what that would apply, and ./OwnAddress is where all of them and
// ../server/widget.go work out the address this deployment answers on. a second copy of any of it
// is how two presses come to deploy differently — one binding a database call the other does not,
// one reading the address off a name the other spells another way.
//
// **it decides nothing about what a terminal says.** where the run reports to is handed in as one
// function; everything else here is the same call to cloudflare whichever press made it.
package effects

import (
	"context"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/widget"
)

// Chain is every effect the chain has, bound to this account and this sign-in.
//
// The credential is closed over here and handed no further, which is internal/cf's arrangement for
// every credential this binary holds: each effect is a function, and nothing that decides what the
// screen says is ever holding one.
//
// **it is bound for one stage as well as for the whole chain.** a `start` over a deployment that is
// already standing finishes what a first run never landed by calling ../first's Registering with
// this same set (../../cmd/better-giving/start.go's finishAt), so what a finish registers and what
// a first deploy registers are one binding rather than two that can come to differ.
//
// `at` is where the run says it has got to, in the shape ../first's `Effects.At` states — `start`
// draws a row from it (../terminal), which is not anything this file knows about. It is called on
// the run's own goroutine, so a call that blocks holds the run up. It is nil where nothing is
// drawing a ledger, which is the press above: one stage, standing under a wait instead.
//
// `version` is the release this binary would put on, which the deploy records onto the worker it
// uploads (../deploy's Options) and ./OwnRelease reads back.
func Chain(
	at func(stage first.Stage, detail string, step, steps int),
	door deployment.Door,
	credential cf.Credential,
	sends func(cf.Credential) cf.Send,
	schema func(cf.Credential) cf.Send,
	assets func(token string) cf.MultipartUpload,
	bundle release.Source,
	version string,
	records state.Store,
) first.Effects {
	// what the fetch held, kept for the stages past the database that go up out of it. written by
	// one step and read by the next, which are one goroutine's: the chain is sequential and every
	// effect below runs on the run's own. it is kept rather than fetched twice because the chain
	// makes its database between the two halves of a deploy (internal/first).
	held := deploy.Prepared{}
	// the one statement of what this deployment's deploy is made with, read by both halves of it.
	options := func(databaseID string, report func(deploy.Progress)) deploy.Options {
		return deploy.Options{
			Send:       sends(credential),
			Migrate:    schema(credential),
			Upload:     door.Settings,
			Assets:     assets,
			Releases:   bundle.Client,
			BundleURL:  bundle.URL,
			Account:    door.AccountID,
			DatabaseID: databaseID,
			Config:     release.Baked,
			Shape:      release.Upload,
			Release:    version,
			Report:     report,
		}
	}

	return first.Effects{
		Prepare: func(ctx context.Context, report func(deploy.Progress)) deploy.Run {
			// the database has not been made when this runs, so the id the bindings name is not
			// known yet — and nothing this half does needs one: it fetches and it reads.
			read, run := deploy.Prepare(ctx, options("", report))
			held = read
			return run
		},
		Database: func(ctx context.Context, placement string) deployment.Standing {
			if credential.Kind == cf.NoCredential {
				// nothing is asked of cloudflare at all, and it is not a refusal: what an operator
				// does about it is sign in, which is a state the panel already draws.
				return deployment.Standing{
					Kind:   deployment.DatabaseNoCredential,
					Detail: credential.Detail,
				}
			}
			return deployment.ProvideDatabase(ctx, sends(credential), door.AccountID,
				release.Baked.DatabaseName, placement)
		},
		Deploy: func(ctx context.Context, databaseID string, report func(deploy.Progress)) deploy.Run {
			return deploy.Apply(ctx, options(databaseID, report), held)
		},
		Own: func(ctx context.Context) deployment.Address {
			return OwnAddress(ctx, door)
		},
		Answer: func(ctx context.Context) deployment.Address {
			return deployment.Answering(ctx, sends(credential), door.AccountID, door.WorkerName)
		},
		Widget: func(ctx context.Context, hosts []string) widget.Supply {
			return widget.Provide(ctx,
				widget.Calls{Send: sends(credential), AccountID: door.AccountID},
				release.Baked.TurnstileWidgetName, hosts)
		},
		Publish: func(ctx context.Context, values map[string]string) deployment.Written {
			return deployment.SetVars(ctx, door, deployment.Stored(values))
		},
		Connect: func(ctx context.Context) deployment.Connection {
			return Connect(ctx, door, credential, records)
		},
		At: at,
	}
}

// Connect is this console's session minted, written to the deployment and kept on this machine.
//
// one binding for the chain's last stage and for `start` over a deployment already standing
// (../../cmd/better-giving/start.go's connecting), so a first run and every run after it connect the
// same way.
func Connect(
	ctx context.Context,
	door deployment.Door,
	credential cf.Credential,
	records state.Store,
) deployment.Connection {
	return deployment.Connect(ctx, deployment.ConnectInputs{
		Door:       door,
		Credential: credential,
		Record:     func(mine session.Session) error { return session.Record(records, mine) },
		Now:        time.Now(),
	})
}

// OwnAddress is where this deployment answers, read off the account under the worker's own name.
//
// read rather than held: no deployment artifact is committed (CLAUDE.md), so the address is worked
// out from the account and that worker's name every time it is wanted, and it is not knowable until
// the worker naming it has been uploaded.
func OwnAddress(ctx context.Context, door deployment.Door) deployment.Address {
	return deployment.PublicAddress(ctx, door.Get, door.AccountID, door.WorkerName)
}
