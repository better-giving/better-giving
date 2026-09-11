// Package first is the press that stands a deployment up: one errand, one press, and nothing an
// operator has to type into a terminal.
//
// **it is one press because it is one errand, and because most of it cannot be made separately.**
// cloudflare holds a binding against a worker, so there is no worker to write the sign-in pair onto
// until the deploy has landed; the widget is registered against the host this deployment answers
// on, and internal/deployment writes this console's session at an address it reads for itself, so
// neither of those can be made before it either. what is left without this chain is a screen of
// controls an operator has to press in one order, most of them refusing until the one before has
// finished — which is a sequence stated as an interface.
//
// **the order is the one-way door's.** everything able to fail that can be made to run in front of
// the remote migration does (CLAUDE.md), and what cannot is what the door itself is for: the
// release is fetched and held against this binary and the account is read on this credential, both
// of which write nothing; then the database is made, because a deploy binds the worker to it; then
// the migration and everything past it. the two reads come first so that a press which cannot go on
// leaves the cloudflare account as it found it — a database made in front of them is one standing
// there for a deploy that never happened, which nothing in this console offers to clear up.
//
// **the widget's host is this deployment's own, read off the account once the deploy has landed.**
// the deployment serves the donor-facing page itself (CLAUDE.md → Product surface), so the one host
// this press has to cover is the worker it has just uploaded — derived from the account and that
// worker's name (internal/deployment/address.go), which is why it cannot be read before the upload.
// a deployment answering on no address this console can read is a widget registered against
// nothing, so that is a stop of its own rather than a chain that landed.
//
// **one of the ways it answers nowhere is a switch and the rest are somewhere for the operator to
// go.** a worker deployed with its own workers.dev turned off is turned on here and read again,
// because this run uploaded it minutes earlier and nobody has chosen where it answers
// (internal/deployment's Answering); an account with no workers.dev name, an account that would not
// say what its name is, and a worker that is not there at all are each stopped on instead.
//
// **the widget is registered after the deploy, and that is what removes the caveat about a secret
// held across minutes.** both its halves are vars, and a var is a read of the worker's bindings and
// one patch back — seconds, no build, no migration, no second trip past the door. Made in front of
// the deploy instead, its secret would sit in this process's memory for the minutes an upload takes.
// What makes either ordering survivable at all is that cloudflare keeps the secret and a get hands
// it back, so a console that died in the gap left a widget the next press adopts rather than a pair
// nobody can recover.
//
// **the widget's two halves go up in one write.** the settings patch carries the whole binding list,
// so a pair sent together lands together and the deployment gains one worker version rather than
// two — and there is no state where the secret is stored and the sitekey is not, which would serve a
// donation form that challenges nobody.
//
// **the sign-in pair is written in the first write past the deploy.** a deployment that is up and
// that nobody can sign in to is the worst place this chain can stop, so nothing that can fail
// stands between the upload and that write.
//
// **no credential is written to disk and none is kept here.** the password, the generated session
// key and the widget's secret each travel in the body of one request and nothing on the way holds
// them afterwards: what this package answers with is a stage and an outcome, and neither carries a
// value. The widget's secret is taken off every outcome that carries the supply it came in.
//
// **`BETTER_AUTH_SECRET` is generated and never asked for.** it signs the session a staff member
// gets back and nobody types it anywhere: a box for it would be a box whose only correct answer is
// a random string, and an operator who filled it in with a word they could remember would have
// weakened the one thing it is for. `ADMIN_PASSWORD` is the one an operator chooses, because it is
// the one they type — and nothing here trims it, because a leading or trailing space is a character
// of a credential.
//
// every effect is handed in, so every state below is reachable in ./first_test.go with no
// cloudflare account, no deployment and no network. every failure is a value: nothing here returns
// an error.
package first

import (
	"crypto/rand"
	"encoding/base64"
	"strings"

	"context"

	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/widget"
)

// Stage is which part of the chain is running, and is what the screen names as it goes.
type Stage string

const (
	// Database is the d1 database found on the account or made there.
	Database Stage = "database"
	// SigningIn is the pair that lets anyone reach /admin, stored at the address just deployed.
	SigningIn Stage = "signing-in"
	// Widget is the spam widget registered and both its halves written as vars.
	Widget Stage = "widget"
	// Connecting is the session this console reads everything else over.
	Connecting Stage = "connecting"
)

// Stages is every stage in the order the chain reaches them.
//
// Six of them are the deploy engine's own, reported through as they arrive rather than summarised:
// what an operator cannot tell apart from a hung process is a line that says the same sentence for
// the minutes an upload takes. ./first_test.go holds this list to internal/deploy's, so a stage the
// engine gained and this did not is a failing case rather than a line lit for nothing.
//
// **the database is made between the engine's second stage and its third**, which is why these are
// not the engine's six in a row. the order this file heads with is why.
var Stages = []Stage{
	Stage(deploy.Fetching),
	Stage(deploy.Checking),
	Database,
	Stage(deploy.Migrating),
	Stage(deploy.Uploading),
	Stage(deploy.Pushing),
	Stage(deploy.Verifying),
	SigningIn,
	Widget,
	Connecting,
}

// Kind is how the chain ended.
type Kind string

const (
	// Deployed is every step landing.
	Deployed Kind = "deployed"
	// NoDatabase is the database not there and not made, so nothing after it was attempted.
	NoDatabase Kind = "no-database"
	// NotDeployed is the deploy stopping, in its own words — a bundle that is not there among them.
	NotDeployed Kind = "not-deployed"
	// NoSignIn is a deployment that is up and that nobody can sign in to.
	NoSignIn Kind = "no-sign-in"
	// NoWidget is the spam widget not registered, so the deployment holds neither half of it.
	NoWidget Kind = "no-widget"
	// Unkept is the widget on the account and the deployment holding neither half of it.
	//
	// Its own kind: an operator who stops here has a widget nothing is verified against, and the
	// way out is the same press again — the widget is found by name rather than made a second time,
	// and its secret is read back off a get.
	Unkept Kind = "unkept"
	// NoSession is a deployment that is up and signable in to, and a console with no session on it.
	NoSession Kind = "no-session"
	// ConsoleStopped is the chain dying on the console's own goroutine, which is a claim about that
	// process and never about the account: it says the press failed part way through and that how
	// far it got is not known. It carries no member, ../run states why.
	ConsoleStopped Kind = "console-stopped"
)

// Outcome is how the chain ended and what the step that stopped it answered.
//
// Every arm the chain reaches carries that step's own answer whole: each of them already tells a
// refused sign-in from a cloudflare nothing could reach, and the screen draws that answer rather
// than one sentence about a press that failed. Deployed and ConsoleStopped are the two that reached
// no step and carry nothing.
type Outcome struct {
	Kind Kind `json:"kind"`
	// Made is where the database stands, on NoDatabase alone.
	Made *deployment.Standing `json:"made"`
	// Ran is how the deploy went, on NotDeployed alone.
	Ran *deploy.Run `json:"ran"`
	// Written is the write that did not land, on NoSignIn and Unkept.
	Written *deployment.Written `json:"written"`
	// Supply is the widget, on NoWidget and Unkept — the two arms of registering it and writing its
	// pair. Its secret is taken off it here.
	Supply *widget.Supply `json:"supply"`
	// Detail is why this deployment answers on no host the widget could be registered against, on
	// the NoWidget that never asked cloudflare for one. Empty on every other arm, the NoWidget
	// cloudflare answered included — that one carries Supply's own words.
	Detail string `json:"detail"`
	// Connection is the session that was not minted, on NoSession alone.
	Connection *deployment.Connection `json:"connection"`
}

// Asked is what one press was made with.
type Asked struct {
	// Password is the operator's own, handed straight through: nothing here trims it.
	Password string
	// SessionSecret is what signs a staff session, generated by the press rather than typed.
	SessionSecret string
	// Placement is where the database keeps its records, empty for cloudflare's own placement. It
	// reaches the create and nothing after it: cloudflare takes it at creation and never again
	// (internal/deployment), so a press over a database already there states it and changes
	// nothing.
	Placement string
}

// Effects is every effect the chain has, handed in.
type Effects struct {
	// Database finds the database this deployment runs on or makes it, and resolves the id a deploy
	// binds the worker to. The placement is the create's alone, for Asked.Placement's reason.
	Database func(ctx context.Context, placement string) deployment.Standing
	// Prepare is the release fetched and held against this binary, and the account read on this
	// credential — the two stages that write nothing. Its answer is the zero `Run` where both
	// landed.
	Prepare func(ctx context.Context, report func(deploy.Progress)) deploy.Run
	// Deploy is the bundle Prepare held applied and uploaded, reporting its own stages as it goes.
	Deploy func(ctx context.Context, databaseID string, report func(deploy.Progress)) deploy.Run
	// Own is where this deployment answers, read once the deploy has landed. It is derived from the
	// account and the worker's name rather than held (internal/deployment/address.go), so it is not
	// knowable before the upload — and the address whole rather than the origin, because a read that
	// found none says which of the five ways it did.
	Own func(ctx context.Context) deployment.Address
	// Answer turns this deployment's own workers.dev address on and reads where it answers then. It
	// is reached on the one state below that is a switch rather than somewhere for the operator to
	// go, and its answer is read exactly as Own's is — a switch cloudflare would not take included.
	Answer func(ctx context.Context) deployment.Address
	// Widget registers the spam widget against the hosts a form is served on, or adopts the one that
	// is there. The host is this deployment's own, which is the only one this press has: a site is
	// typed on the console's sites fold, and that press levels the widget behind it.
	Widget func(ctx context.Context, hosts []string) widget.Supply
	// Publish writes vars, which is a read of the worker's bindings and one patch back. It is made
	// twice: the sign-in pair, and the widget's two halves.
	Publish func(ctx context.Context, values map[string]string) deployment.Written
	// Connect mints this console's session and writes it onto the deployment.
	Connect func(ctx context.Context) deployment.Connection
	// At is how the chain says where it is, called on the goroutine the run is on; a call that
	// blocks holds the run up.
	//
	// `detail` is what the stage says it is on — the file being migrated, the bucket going up, how
	// much of the download or of the code has moved — and is empty where it is on nothing nameable.
	// `step` and `steps` are which part of how many where the stage counts them and 0 where it does
	// not. Both are the deploy engine's own, carried through rather than summarised
	// (internal/deploy's Progress), and the argument order is that struct's. The four stages this
	// chain owns count nothing and name nothing: each is one call.
	At func(stage Stage, detail string, step, steps int)
}

// how long a generated session key is, in bytes before it is spelled.
const secretBytes = 32

// SessionSecret is a fresh key for a deployment to sign staff sessions with.
//
// It is minted at the press rather than inside the chain so that a machine that cannot generate one
// is a press refused rather than a chain that stopped after making a database.
func SessionSecret() (string, error) {
	held := make([]byte, secretBytes)
	if _, err := rand.Read(held); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(held), nil
}

// Chain is the whole press, from the effects and what was asked.
func Chain(ctx context.Context, asked Asked, effects Effects) Outcome {
	at := func(stage Stage) {
		if effects.At != nil {
			effects.At(stage, "", 0, 0)
		}
	}

	through := func(progress deploy.Progress) {
		if effects.At != nil {
			effects.At(Stage(progress.Stage), progress.Detail, progress.Step, progress.Steps)
		}
	}

	if held := effects.Prepare(ctx, through); held.Kind != "" {
		return Outcome{Kind: NotDeployed, Ran: &held}
	}

	at(Database)
	standing := effects.Database(ctx, asked.Placement)
	if standing.Kind != deployment.DatabaseThere && standing.Kind != deployment.DatabaseMade {
		return Outcome{Kind: NoDatabase, Made: &standing}
	}

	ran := effects.Deploy(ctx, standing.UUID, through)
	if ran.Kind != deploy.Deployed {
		return Outcome{Kind: NotDeployed, Ran: &ran}
	}

	at(SigningIn)
	written := effects.Publish(ctx, map[string]string{
		"ADMIN_PASSWORD":     asked.Password,
		"BETTER_AUTH_SECRET": asked.SessionSecret,
	})
	if written.Kind != deployment.WriteSet {
		return Outcome{Kind: NoSignIn, Written: &written}
	}

	if stopped := Registering(ctx, effects); stopped.Kind != "" {
		return stopped
	}

	at(Connecting)
	connection := effects.Connect(ctx)
	if connection.Kind != deployment.Connected {
		return Outcome{Kind: NoSession, Connection: &connection}
	}
	return Outcome{Kind: Deployed}
}

// Registering is the widget stage on its own: where this deployment answers read off the account,
// the spam widget registered against it, and both its halves written as vars. The zero Outcome is
// every step of it landing.
//
// **it is exported because a first run that stopped in front of it is never carried past it by
// another chain.** the deployment is standing from the moment the deploy lands, so every later
// press weighs it against this release and goes to the carry door and then the console — and what
// reaches this stage again is a press of its own (../../cmd/better-giving/start.go's finishing).
// A second spelling of these three acts is two presses that register differently.
//
// Every arm it stops on is the chain's own, so a finish that stopped is answered in the words a
// deploy that stopped in the same place is (../terminal/outcome.go).
func Registering(ctx context.Context, effects Effects) Outcome {
	if effects.At != nil {
		effects.At(Widget, "", 0, 0)
	}

	own := effects.Own(ctx)
	if own.Kind == deployment.Deployed && own.Why == deployment.TurnedOff {
		own = effects.Answer(ctx)
	}
	origin := strings.TrimSpace(own.Origin())
	if origin == "" {
		// nothing is asked of cloudflare: what did not happen is the widget's registration, and a
		// widget made against no host would challenge nobody anywhere.
		return Outcome{Kind: NoWidget, Supply: hostless(), Detail: noOrigin(own)}
	}
	supply := effects.Widget(ctx, widget.Hosts([]string{origin}))
	if supply.Kind != widget.Supplied {
		return Outcome{Kind: NoWidget, Supply: kept(supply)}
	}
	published := effects.Publish(ctx, map[string]string{
		"TURNSTILE_SECRET_KEY": supply.Secret,
		"TURNSTILE_SITE_KEY":   supply.Sitekey,
	})
	// a value the deployment already holds is a var not written rather than one that failed, which
	// is what a second press over a deployment already carrying the pair answers.
	if published.Kind != deployment.WriteSet && published.Kind != deployment.WriteUnchanged {
		return Outcome{Kind: Unkept, Supply: kept(supply), Written: &published}
	}
	return Outcome{}
}

// the widget as an outcome may carry it, which is without the half cloudflare keeps.
//
// The secret is stripped rather than merely left unserialised: what holds an outcome is a run this
// process keeps until a page has drawn it, and a credential kept for that long is one nothing needs.
func kept(supply widget.Supply) *widget.Supply {
	supply.Secret = ""
	return &supply
}

// the widget as an outcome carries it where there was no host to register one against, which is the
// supply ../widget answers with for an empty host list.
//
// it is built here rather than asked for: the call would be one cloudflare is never made, and the
// arm has to carry a supply because the screen reads one off every no-widget (packages/console-ui).
func hostless() *widget.Supply {
	return &widget.Supply{Kind: widget.NoHosts, Domains: []string{}, Sitekeys: []string{}}
}

// why this deployment answers on no host the widget could be registered against.
//
// the five ways an address read ends are five different things for an operator to do, so the
// sentence names which of them it was rather than reporting one absence — a worker that is not
// there at all and one answering on nothing are opposite states wearing the same emptiness.
//
// **a worker that is up and answers on nothing is three of those states and not one**, and each is
// somewhere different to go: an address switched off is turned back on, an account with no
// workers.dev name of its own registers one, and an account that would not say what its name is was
// never asked successfully at all. ../deployment/address.go is what each of the three is, and no
// sentence here claims anything past it — the custom domains are not spoken for, since a worker
// answering on none and a read that did not land leave the same empty list.
func noOrigin(address deployment.Address) string {
	switch {
	case address.Kind == deployment.NotDeployed:
		return "Cloudflare holds no worker of this deployment's name"
	case address.Kind == deployment.Deployed:
		return deployedNowhere(address.Why)
	case address.Detail != "":
		return address.Detail
	default:
		return "this console could not read where this deployment answers"
	}
}

// why a worker that is in the account answers on no address, by which of the three it was.
func deployedNowhere(why deployment.NoWorkersDev) string {
	switch why {
	case deployment.TurnedOff:
		return "this deployment's workers.dev address is turned off"
	case deployment.Unregistered:
		return "this account has never registered a workers.dev subdomain"
	case deployment.Unknown:
		return "this deployment answers on a workers.dev address this account would not name"
	default:
		return "this deployment answers on no address a donor could be sent to"
	}
}
