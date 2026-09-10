// Package deploy is this repository's worker put onto a cloudflare account with no wrangler, no
// node and no checkout on the machine that presses the button.
//
// **six stages, and their order is the one-way door packages/app's own deploy script keeps.**
// everything able to fail runs in front of the migration and the migration runs before the upload
// (CLAUDE.md), so: the bundle is fetched and held against what this binary was baked for, the
// account's own workers are read to see this credential reaches them, then the pending migrations
// are applied, then the static files go up, then the script that names them, then the deployment is
// read back. a stage that fails ends the run where it is — nothing rolls back, and the migrations a
// stopped run applied stay applied.
//
// **the files and the script are two stages because they are two waits.** the assets session opens,
// asks for as many buckets as it wants and ends in a completion token; the script is one long PUT
// that names that token. each counts its own parts and neither's count says anything about the
// other's, so a screen drawing them under one name has one line to reword as it goes
// (../terminal/lines.go).
//
// **the two in front of the door are a call of their own, and that is what lets the chain make its
// database between them.** `Prepare` writes nothing anywhere, so a release that is missing or packed
// from another revision stops a first press before anything exists in the cloudflare account;
// `Apply` is the door and everything past it, made with the bundle `Prepare` held. `Deploy` is the
// two of them in order, which is the whole of the press that redeploys a deployment already
// standing.
//
// **the upload is one fixed request rather than a wrangler config interpreted.** one org, one
// worker, one shape (CLAUDE.md's founding rule): the bindings, the runtime and the observability
// setting are ../release's `Upload`, held against packages/app/wrangler.jsonc by that package's own
// test. what changes between deploys is the database's id, the bundle, and the assets token.
//
// **secrets and vars survive the upload, and `keep_bindings` is the whole of why.** an upload that
// omits it deletes every plain-text var the deployment holds — the publishable key and the sitekey
// among them — which is `keep_vars: true` in packages/app/wrangler.jsonc read onto the raw api.
//
// **every deploy opens an assets upload session of its own.** the completion token a session ends
// with is single-use, so one held across presses is a second deploy refused for a reason that has
// nothing to do with the deploy.
//
// every failure is a value, the way ../cf's are: nothing here returns an error, and a screen has a
// different sentence for each of the ways below.
package deploy

import (
	"context"
	"math"
	"net/http"
	"strconv"

	"github.com/better-giving/console/internal/bundle"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/migrate"
	"github.com/better-giving/console/internal/release"
)

// Stage is which part of a deploy a run is in, and is what a screen names as it goes.
type Stage string

const (
	// Fetching is the release bundle downloaded and held against this binary's baked config.
	Fetching Stage = "fetching"
	// Checking is the account's own workers read on this credential, in front of the door.
	Checking Stage = "checking"
	// Migrating is every pending migration applied, which is the one-way door.
	Migrating Stage = "migrating"
	// Uploading is the static files, sent in the buckets cloudflare asks for.
	Uploading Stage = "uploading"
	// Pushing is the app's own code, sent in the one request that names those files and replaces
	// the worker — and then somewhere for that worker to answer.
	//
	// its own stage rather than the tail of ./Uploading because the two are two waits: the files go
	// up in as many requests as cloudflare asked for and the code in one long one, each counting
	// its own parts, and a screen drawing them under one name has to reword a single line as it
	// goes (../terminal/lines.go).
	Pushing Stage = "pushing"
	// Verifying is the deployment read back, to see it carries what went up.
	Verifying Stage = "verifying"
)

// Progress is where a run has got to, reported as it goes.
type Progress struct {
	Stage Stage
	// Detail is what the stage is on: how much of the download or of the code has moved, the
	// migration being applied, the bucket going up, the read a stage is making. It is empty on the
	// report that opens a stage, before there is anything for it to be on.
	Detail string
	// Step and Steps are which part of how many, where the stage counts them, and both 0 where it
	// does not. What counts them is the stage's own arithmetic and never this package's: the buckets
	// are how many cloudflare asked for, the migrations how many the database turned out to be
	// missing, and the download the length the release claimed — none of which is known before the
	// stage that reports it is under way.
	Step  int
	Steps int
}

// Kind is how a run ended.
type Kind string

const (
	// Deployed is the worker and its assets up, its migrations applied, and its bindings read back.
	Deployed Kind = "deployed"
	// NoBundle is a release carrying no worker bundle for this version, which is nothing to deploy.
	NoBundle Kind = "no-bundle"
	// Mismatched is a bundle built from another shape of the app, and Fields names how.
	Mismatched Kind = "mismatched"
	// Refused is cloudflare turning this sign-in down for this account.
	Refused Kind = "refused"
	// Cancelled is the operator no longer waiting, and At is the stage it was in.
	Cancelled Kind = "cancelled"
	// Stopped is a stage that failed, named by At and in cloudflare's own words.
	Stopped Kind = "stopped"
)

// Run is how one deploy went, and what it left behind whichever way it went.
type Run struct {
	Kind Kind `json:"kind"`
	// At is the stage the run was in when it ended, which is Verifying on a deploy that landed.
	At Stage `json:"at"`
	// Applied is every migration this run landed, in order. They stay applied whatever the kind:
	// the door they are behind is one way.
	Applied []string `json:"applied"`
	// File is the migration the run stopped on, and is empty where it stopped on none.
	File string `json:"file"`
	// Fields is what the bundle's manifest and this binary disagree on, on Mismatched alone.
	Fields []string `json:"fields"`
	Detail string   `json:"detail"`
}

// Options is what one deploy is made with.
//
// The three callables are handed in rather than bound here so that every state above can be looked
// at without a cloudflare account and without a network.
type Options struct {
	// Send is a json call to cloudflare's api on this account's credential.
	Send cf.Send
	// Migrate is that same call on that same credential, bound to the deadline a whole migration
	// file takes rather than the one a screen's read is held to (internal/cf's APISchemaSend). Send
	// where it is nil, which is the bound this app's first migration is cut part way through.
	Migrate cf.Send
	// Upload is a multipart call on the same credential, which the script goes up through.
	Upload cf.MultipartUpload
	// Assets is a multipart call on a token an upload session hands back, which is not the
	// account's credential and is minted per deploy.
	Assets func(token string) cf.MultipartUpload
	// Releases is what the bundle is downloaded with, and http.DefaultClient where it is nil.
	Releases *http.Client
	// BundleURL is where this binary's own version's bundle is, which the release states.
	BundleURL string
	// Account is the cloudflare account, and DatabaseID the uuid of the d1 database the bindings
	// name — resolved by name before a deploy, because a fork's database is its own.
	Account    string
	DatabaseID string
	// Config is what this binary was baked for, which the bundle's manifest is held against.
	Config release.Config
	// Shape is the fixed upload this app's worker goes up in.
	Shape release.UploadShape
	// Report is called as the run moves, on the goroutine the run is on; a call that blocks holds
	// the run up. Nil where nothing is watching.
	Report func(Progress)
}

// Deploy is every stage, in the order the one-way door puts them in: Prepare, then Apply.
func Deploy(ctx context.Context, options Options) Run {
	held, run := Prepare(ctx, options)
	if run.Kind != "" {
		return run
	}
	return Apply(ctx, options, held)
}

// Prepared is what Prepare held and what Apply goes up out of.
//
// It carries the bundle and says nothing about it: a caller's whole part in this is to hand back
// what it was given, and a release archive read out anywhere else is a second place to decide what
// a deploy is made of.
type Prepared struct {
	held bundle.Bundle
}

// what a run says about itself as it goes, or nothing where nobody is watching.
func reporter(options Options) func(Progress) {
	return func(progress Progress) {
		if options.Report != nil {
			options.Report(progress)
		}
	}
}

// how many steps the download's own count moves in.
//
// what is reported is one per step rather than one per read: a bundle is tens of megabytes and the
// reader hands back a few tens of kilobytes at a time, so a watcher held level with every read is
// thousands of frames for a count that moves twenty times.
//
// it is this engine's own resolution and not any screen's: what a watcher draws the count as is the
// watcher's, and a finer stream than it draws from costs it nothing.
const fetchSteps = 20

// how the download says how far it has got, thinned to one report per step of ./fetchSteps.
//
// the count is bytes and the total is what the release claimed, so a release that claimed no length
// reports nothing at all and the stage stays uncounted (../bundle's Watch).
func arriving(say func(Progress)) bundle.Watch {
	drawn := int64(-1)
	return func(read, of int64) {
		cell := read * fetchSteps / of
		if cell == drawn {
			return
		}
		drawn = cell
		say(Progress{Stage: Fetching, Detail: arrivedOf(read, of), Step: int(read), Steps: int(of)})
	}
}

// how much of a body has moved, in the figures the release's own size is quoted in.
//
// one form for the download and for the script upload alike (./upload.go's going): they are the two
// long calls a deploy makes and they are drawn in the same ledger, so a second spelling of the same
// fact would read as a second kind of fact.
func arrivedOf(read, of int64) string { return sized(read) + " of " + sized(of) }

// how many bytes a unit holds, and the units above a byte a size is said in.
//
// a thousand rather than 1024: the figure stands beside a download of a release whose own size is
// quoted decimally, and a binary megabyte would read four per cent short of the number the operator
// can check it against.
const perUnit = 1000

var units = []string{"KB", "MB", "GB"}

// one byte count as an operator reads it: whole bytes under a kilobyte, and one decimal place above.
func sized(count int64) string {
	if count < perUnit {
		return strconv.FormatInt(count, 10) + " B"
	}
	value := float64(count) / perUnit
	// the rounding the figure is drawn with decides the unit as well, because 999,999 bytes is
	// 1000.0 to one decimal place — which is the unit above spelled in the name of the one below.
	for unit := 0; ; unit++ {
		if math.Round(value*10)/10 < perUnit || unit == len(units)-1 {
			return strconv.FormatFloat(value, 'f', 1, 64) + " " + units[unit]
		}
		value /= perUnit
	}
}

// Prepare is the two stages that stand in front of the one-way door, and it opens none of it.
//
// The bundle is fetched and held against what this binary was baked for, then the account's own
// workers are read to see this credential still reaches them. Nothing here writes: a run that stops
// in either stage has left the cloudflare account exactly as it found it, which is what lets the
// chain make its database after this rather than in front of it (internal/first).
//
// The Run it answers with is the zero value where both landed, and the stage that stopped it
// otherwise; the bundle is meaningless on any Kind but that one.
func Prepare(ctx context.Context, options Options) (Prepared, Run) {
	say := reporter(options)

	say(Progress{Stage: Fetching})
	client := options.Releases
	if client == nil {
		client = http.DefaultClient
	}
	read := bundle.Fetch(ctx, client, options.BundleURL, options.Config, arriving(say))
	switch read.Kind {
	case bundle.Held:
	case bundle.Missing:
		return Prepared{}, Run{Kind: NoBundle, At: Fetching, Detail: read.Detail}
	case bundle.Mismatched:
		return Prepared{}, Run{Kind: Mismatched, At: Fetching, Fields: read.Fields,
			Detail: "that bundle was packed from another revision of the app"}
	default:
		return Prepared{}, Run{Kind: stoppedBy(ctx), At: Fetching, Detail: read.Detail}
	}

	if ctx.Err() != nil {
		return Prepared{}, Run{Kind: Cancelled, At: Fetching, Detail: ctx.Err().Error()}
	}

	say(Progress{Stage: Checking, Detail: "this account's workers"})
	if failure := reaches(ctx, options); failure.Kind != "" {
		return Prepared{}, Run{Kind: failure.Kind, At: Checking, Detail: failure.Detail}
	}
	return Prepared{held: read.Bundle}, Run{}
}

// Apply is the four stages from the one-way door on: every pending migration, then the static
// files, then the script that names them, then the deployment read back.
//
// `prepared` is what Prepare answered with, and the migrations it applies are the ones that
// bundle carries — so what goes through the door is what was checked in front of it.
func Apply(ctx context.Context, options Options, prepared Prepared) Run {
	say := reporter(options)

	say(Progress{Stage: Migrating})
	applied := migrate.Apply(ctx, schema(options), options.Account, options.DatabaseID,
		carried(prepared.held), func(name string, at, of int) {
			say(Progress{Stage: Migrating, Detail: name, Step: at, Steps: of})
		})
	run := Run{Applied: applied.Applied}
	switch applied.Kind {
	case migrate.Landed:
	case migrate.Refused:
		run.Kind, run.At, run.Detail = Refused, Migrating, applied.Detail
		return run
	case migrate.Cancelled:
		run.Kind, run.At, run.Detail = Cancelled, Migrating, applied.Detail
		return run
	default:
		run.Kind, run.At, run.File, run.Detail = Stopped, Migrating, applied.At, applied.Detail
		return run
	}

	if ctx.Err() != nil {
		run.Kind, run.At, run.Detail = Cancelled, Migrating, ctx.Err().Error()
		return run
	}

	say(Progress{Stage: Uploading})
	token, failure := uploadAssets(ctx, options, prepared.held, say)
	if failure.Kind != "" {
		run.Kind, run.At, run.Detail = failure.Kind, Uploading, failure.Detail
		return run
	}
	say(Progress{Stage: Pushing})
	if failure := uploadScript(ctx, options, prepared.held, token, say); failure.Kind != "" {
		run.Kind, run.At, run.Detail = failure.Kind, Pushing, failure.Detail
		return run
	}

	// somewhere for the worker just uploaded to answer, which is part of putting the code up rather
	// than a stage of its own: a screen naming it would be naming a step every deploy after the
	// first skips.
	say(Progress{Stage: Pushing, Detail: "where the deployment answers"})
	if failure := address(ctx, options); failure.Kind != "" {
		run.Kind, run.At, run.Detail = failure.Kind, Pushing, failure.Detail
		return run
	}

	if ctx.Err() != nil {
		run.Kind, run.At, run.Detail = Cancelled, Pushing, ctx.Err().Error()
		return run
	}

	say(Progress{Stage: Verifying, Detail: "the deployment's bindings"})
	if failure := verify(ctx, options); failure.Kind != "" {
		run.Kind, run.At, run.Detail = failure.Kind, Verifying, failure.Detail
		return run
	}
	run.Kind, run.At = Deployed, Verifying
	return run
}

// the call the schema changes are made on.
//
// Send is what a deploy that stated no other one gets, which is the ten seconds a screen's read is
// held to: enough for every call a deploy makes but the one that applies a file of ddl.
func schema(options Options) cf.Send {
	if options.Migrate != nil {
		return options.Migrate
	}
	return options.Send
}

// the migrations the bundle carries, in the order the manifest applies them.
func carried(held bundle.Bundle) []migrate.File {
	files := []migrate.File{}
	for _, name := range held.Manifest.Migrations {
		files = append(files, migrate.File{Name: name, SQL: held.Migrations[name]})
	}
	return files
}

// a stage that ended without an answer, told from one the operator stopped waiting on.
func stoppedBy(ctx context.Context) Kind {
	if ctx.Err() != nil {
		return Cancelled
	}
	return Stopped
}

// what a stage failed with, or the zero value where it did not.
type failure struct {
	Kind   Kind
	Detail string
}

// one cloudflare answer read as a stage's failure, or nothing where it answered.
func refusal(ctx context.Context, answer cf.Answer) failure {
	read := cf.ReadResult(answer)
	switch read.Kind {
	case cf.ResultValue:
		return failure{}
	case cf.ResultRefused:
		return failure{Kind: Refused, Detail: read.Detail}
	default:
		return failure{Kind: stoppedBy(ctx), Detail: cf.Said(answer)}
	}
}
