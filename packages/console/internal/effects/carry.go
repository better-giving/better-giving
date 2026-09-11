package effects

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the redeploy: this repository's code carried onto a deployment that is already standing.
//
// it is here for ./effects.go's reason and not the chain's: this press and the chain resolve the
// same deployment off the same account, and a second copy of that wiring is how the two come to
// deploy differently.
//
// **it decides nothing about what a terminal says.** ./Carried is a reading, and the sentence drawn
// over it is ../terminal/redeploy.go's.

// Carried is how the press that carries the code onto a standing deployment ended.
//
// **the database is found and never made, which is the whole of what separates this from the
// chain.** so its own arm: a deployment answering at that address whose database has gone is a
// state no press repairs, and one reported as a deploy that failed sends an operator to read a
// cloudflare error about an upload that was never attempted.
type Carried struct {
	// Kind is one of ./CarriedKind's four.
	Kind CarriedKind `json:"kind"`
	// Found is why the database was not resolved, on no-database alone: `none`, `many`, `refused`,
	// `unreachable` or `no-credential`. The id itself reaches no page, for the reason
	// internal/deployment states.
	Found  string `json:"found"`
	Detail string `json:"detail"`
	// Ran is how the deploy went, on `deployed` and `not-deployed`.
	Ran *deploy.Run `json:"ran"`
}

// CarriedKind is how the press that carries the code onto a standing deployment ended.
//
// the four are constants rather than the words themselves, which is ../first's arrangement for the
// chain's own: two packages read this set and one of them decides whether a run is reported as a
// failure (../../cmd/better-giving/start.go's afterTheCarry), so a literal mistyped at either end
// compiles, passes `go vet`, and reports every carry that landed as one that did not.
type CarriedKind string

const (
	// Deployed is the bundle applied and uploaded over the database that was found.
	Deployed CarriedKind = "deployed"
	// NoDatabase is the database not resolved, so nothing after it was attempted. ./Carried's Found
	// is which absence it was.
	NoDatabase CarriedKind = "no-database"
	// NotDeployed is the deploy stopping, in its own words.
	NotDeployed CarriedKind = "not-deployed"
	// ConsoleStopped is the press dying on the console's own goroutine, which is a claim about this
	// process and never about the account: how far it got is not known.
	ConsoleStopped CarriedKind = "console-stopped"
)

// Carrying is what one redeploy is made with, bound to this account and this sign-in.
//
// The credential is closed over rather than handed on, which is internal/cf's arrangement for every
// credential this binary holds: each effect is a function, and nothing that decides what the screen
// says is ever holding one.
type Carrying struct {
	AccountID  string
	Credential cf.Credential
	Sends      func(cf.Credential) cf.Send
	Schema     func(cf.Credential) cf.Send
	Settings   func(cf.Credential) cf.MultipartUpload
	Assets     func(token string) cf.MultipartUpload
	Bundle     release.Source
	// Release is the release this press is putting on, which the upload records onto the worker
	// (../deploy's Options).
	Release string
	// At is how the run says where in the deploy it is, called on the goroutine the run is on; a
	// call that blocks holds the run up. It is the engine's whole progress rather than the stage:
	// the counts a stage reports are what a screen draws a bar from.
	At func(deploy.Progress)
}

// Carry is the redeploy: the database found, then the bundle applied and uploaded over it.
func Carry(ctx context.Context, made Carrying) Carried {
	if made.Credential.Kind == cf.NoCredential {
		// nothing is asked of cloudflare at all, and it is not a refusal: what an operator does
		// about it is sign in, which is a state the panel already draws.
		return Carried{
			Kind:   NoDatabase,
			Found:  "no-credential",
			Detail: made.Credential.Detail,
		}
	}

	send := made.Sends(made.Credential)
	get := func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}
	standing := deployment.Databases(ctx, get, made.AccountID, release.Baked.DatabaseName)
	if found := Absent(standing); found != "" {
		return Carried{Kind: NoDatabase, Found: found, Detail: standing.Detail}
	}

	ran := deploy.Deploy(ctx, deploy.Options{
		Send:       send,
		Migrate:    made.Schema(made.Credential),
		Upload:     made.Settings(made.Credential),
		Assets:     made.Assets,
		Releases:   made.Bundle.Client,
		BundleURL:  made.Bundle.URL,
		Account:    made.AccountID,
		DatabaseID: standing.UUID,
		Config:     release.Baked,
		Shape:      release.Upload,
		Release:    made.Release,
		Report: func(progress deploy.Progress) {
			if made.At != nil {
				made.At(progress)
			}
		},
	})
	if ran.Kind != deploy.Deployed {
		return Carried{Kind: NotDeployed, Ran: &ran}
	}
	return Carried{Kind: Deployed, Ran: &ran}
}

// Absent is why the database was not resolved, or empty where it was.
//
// Two rows of one name is one of them: every remote path resolves the database by name, so a deploy
// made against an account holding two would bind the worker to one of them without saying which
// (CLAUDE.md).
func Absent(standing deployment.DatabaseList) string {
	switch {
	case standing.Kind == deployment.Refused:
		return "refused"
	case standing.Kind != deployment.Listed:
		return "unreachable"
	case standing.Count > 1:
		return "many"
	case standing.Count == 0:
		return "none"
	default:
		return ""
	}
}
