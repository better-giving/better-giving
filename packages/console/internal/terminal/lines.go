package terminal

import (
	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/first"
)

// the rows an operator waits on while a press runs, and the words each of them is drawn in.
//
// **a row is the thing an operator is waiting on, and a check the binary runs inside it is not a
// second thing.** the chain reports nine stages and the deploy engine five, but `checking` is one
// read of the cloudflare account made in front of the migration and `verifying` is the read back of
// what cloudflare is now holding — neither is anything an operator waits on apart from the download
// and the upload they belong to. so a row covers one or more stages, and both presses draw fewer
// rows than the binary reports stages.
//
// **a row rewords itself when its work is done, because the label is the whole statement.** there
// is no note under it and no status word beside it: a row reads `Downloading app assets` while that
// is happening and `App assets downloaded` once it is not, so the subject and its state are one
// sentence.
//
// **a row says what it does in what the operator came here to make.** they are standing up a place
// to take donations, so the words are about the app, the database and cloudflare rather than a
// binding, a migration file or a var. every stage behind a row is one the binary genuinely reaches
// and reports as it arrives (../first); nothing is interpolated and no row moves except when a
// stage does. what stands beside a row's own words is what the run has actually said: the stage's
// own count of its own parts, in its own words, and how long the row has been running — which is
// the row's age and claims nothing at all about how far into it the run has got.

// Row is one line an operator waits on: the stages it covers, what it says while a run is inside
// them, and what it says once the run is past them.
type Row struct {
	Stages  []first.Stage
	Running string
	Done    string
}

// the download, with the account read that stands behind it.
//
// `checking` is the cloudflare read and not a check of the download: what came down is held against
// this binary's own baked config inside `fetching` (../deploy). it is one get of the worker's
// settings on this sign-in, put in front of the migration so that a credential that stopped
// reaching the account is found in front of the one-way door — and by the time it runs the operator
// has signed in and chosen the account, so there is nothing for a row of its own to tell them.
//
// both presses draw this one row: the two stages are the same two and the words are the same words,
// because it is the same engine doing the same thing.
var assets = Row{
	Stages:  []first.Stage{first.Stage(deploy.Fetching), first.Stage(deploy.Checking)},
	Running: "Downloading app assets",
	Done:    "App assets downloaded",
}

// the upload, with the read back that closes it.
//
// `verifying` is a read of what cloudflare is holding and not of the deployment answering: a get of
// the worker's settings, checked for the bindings that went up (../deploy). it is the tail of the
// upload rather than a thing beside it, so it is drawn as the tail of the upload.
//
// drawn by both presses, as assets is and for the same reason.
var cloudflare = Row{
	Stages:  []first.Stage{first.Stage(deploy.Uploading), first.Stage(deploy.Verifying)},
	Running: "Deploying to Cloudflare",
	Done:    "Deployed to Cloudflare",
}

// ChainRows are the rows the first deploy draws, in the order the chain reaches them.
//
// **the order of this list is the chain's order, and so is the order of the stages inside a row.**
// a row lights when the run reaches its first stage and closes when the run leaves its last, so a
// list that disagreed with ../first's `Stages` would light rows out of turn. ./lines_test.go is
// what holds the two together.
//
// **every word here is fixed.** nothing the operator typed is named back at them: the press is made
// with a password and a placement, and neither is a value to print at somebody while it is in use.
var ChainRows = []Row{
	assets,
	// found on the account or made there, which is why the words are neither (../first):
	// `provisioned` reads as the database standing rather than as this press having made it, so a
	// second press over one already there is not a row claiming to have made it twice. the
	// migration is inside the row because an operator waiting for a place to keep donations is
	// waiting for one thing, and a database with none of its tables in it is not that thing yet.
	{
		Stages:  []first.Stage{first.Database, first.Stage(deploy.Migrating)},
		Running: "Provisioning D1 database",
		Done:    "D1 database provisioned",
	},
	cloudflare,
	{
		Stages:  []first.Stage{first.SigningIn},
		Running: "Storing dashboard password",
		Done:    "Dashboard password stored",
	},
	{
		Stages:  []first.Stage{first.Widget},
		Running: "Registering spam protection",
		Done:    "Spam protection registered",
	},
	// this console's own session, minted and written onto the deployment. it is a row because it is
	// the last minute of a press an operator is waiting on, and where it fails it is the whole of
	// what the press's outcome is about (../deployment/connect.go).
	{
		Stages:  []first.Stage{first.Connecting},
		Running: "Connecting console",
		Done:    "Console connected",
	},
}

// UpdateRows are the rows a redeploy draws, in the order the deploy engine reaches them.
//
// the press that carries this repository's code onto a deployment already standing is that engine
// and nothing else — no database made, no widget, no value written — so what it draws is the
// download, the migration and the upload, sharing the first and the last with ChainRows because it
// is the same engine being watched.
//
// **the migration is its own row here and is folded into the database row there, because the two
// presses run it over different databases.** the chain's is one made seconds earlier where every
// migration is part of standing it up; this one is a database in use, where a pending migration
// changes records that are already there — which is the whole of what the operator is waiting on
// and the whole of what they answered a confirm to allow (./ConfirmMigration).
//
// the password is not among them: this press stores nothing.
var UpdateRows = []Row{
	assets,
	{
		Stages:  []first.Stage{first.Stage(deploy.Migrating)},
		Running: "Updating database tables",
		Done:    "Database tables updated",
	},
	cloudflare,
}

// DeployStages are the deploy engine's own five, in the order it reaches them, spelled as the chain
// names them so that one renderer draws both presses.
//
// a list of its own rather than a slice of ../first's `Stages`, so that a stage added to the chain
// outside the deploy cannot quietly join it. ./lines_test.go holds it to the five UpdateRows cover.
var DeployStages = []first.Stage{
	first.Stage(deploy.Fetching),
	first.Stage(deploy.Checking),
	first.Stage(deploy.Migrating),
	first.Stage(deploy.Uploading),
	first.Stage(deploy.Verifying),
}
