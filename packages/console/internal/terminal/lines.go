package terminal

import (
	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/release"
)

// the rows an operator waits on while a press runs, the words each of them is drawn in, and the
// sentence over the one wait past them that draws no row at all (./WaitingForTheAddress).
//
// **a row is the thing an operator is waiting on, and a check the binary runs inside it is not a
// second thing.** the chain reports ten stages and the deploy engine six, but `checking` is one
// read of the cloudflare account made in front of the migration and `verifying` is the read back of
// what cloudflare is now holding — neither is anything an operator waits on apart from the download
// and the upload they belong to. so a row covers one or more stages — or the children that do — and
// both halves of `start` draw fewer rows than the binary reports stages.
//
// **a row whose stages are two waits of its own carries them as children, and that is the whole of
// what earns one.** the two waits are told apart by what they count: the static files end at every
// bucket cloudflare asked for and the app's code then starts again at none of its bytes sent, so
// one line drawn over both has to take a bar to full and back to nothing while rewording its own
// trailing note as it goes. a child is a row of the same kind — its own stages, its own two
// wordings, its own note, bar and share — drawn indented under its parent. `checking` and
// `verifying` earn none: neither counts anything and neither is a wait beside the one it closes.
//
// **a row either covers stages itself or has children that do, and never both.** a parent with
// children draws no note, no bar and no timer of its own: the children carry the counting and the
// parent line is the thing being waited on. ./lines_test.go holds both halves of that.
//
// **the children go when the parent closes, so what is left on the screen is one line per thing the
// operator waited on.** they are drawn only while their parent is the row the run is inside, which
// is what keeps a finished ledger the same shape it has always been.
//
// **a row rewords itself when its work is done, because the label is the whole statement.** there
// is no note under it and no status word beside it: a row reads `Provisioning D1 database` while
// that is happening and `D1 database provisioned` once it is not, so the subject and its state are
// one sentence. a child states itself the same way and never restates its parent.
//
// **a row says what it does in what the operator came here to make.** they are standing up a place
// to take donations, so the words are about the deployment, the database and cloudflare rather than
// a binding, a migration file or a var — and the two rows about the deployment name it as this
// binary was baked to name it (../release), which is the name the picker marked an account by two
// screens earlier (./account.go). every stage behind a row is one the binary genuinely reaches and
// reports as it arrives (../first); no row's progress is guessed and no row moves except when a
// stage does. what stands beside a row's own words is what the run has actually said: the stage's
// own count of its own parts, in its own words, the bar and the share that count is drawn as, and
// how long the row has been running — which is the row's age and claims nothing at all about how
// far into it the run has got. a row whose stage counts nothing carries no bar, because there is no
// honest one to draw.

// Row is one line an operator waits on: the stages it covers, what it says while a run is inside
// them, and what it says once the run is past them.
//
// Children are the two or more waits this one is made of, each a row of the same kind, drawn
// indented under it while the run is inside it. A row with children covers no stage itself and
// draws no note of its own; a row without them covers its own and draws its own.
type Row struct {
	Stages   []first.Stage
	Running  string
	Done     string
	Children []Row
}

// the download, with the account read that stands behind it.
//
// `checking` is the cloudflare read and not a check of the download: what came down is held against
// this binary's own baked config inside `fetching` (../deploy). it is one get of the worker's
// settings on this sign-in, put in front of the migration so that a credential that stopped
// reaching the account is found in front of the one-way door — and by the time it runs the operator
// has signed in and chosen the account, so there is nothing for a row of its own to tell them.
//
// both halves of `start` draw this one row: the two stages are the same two and the words are the
// same words, because it is the same engine doing the same thing.
var assets = Row{
	Stages:  []first.Stage{first.Stage(deploy.Fetching), first.Stage(deploy.Checking)},
	Running: "Downloading " + release.Baked.Name + " assets",
	Done:    release.Baked.Name + " assets downloaded",
}

// the upload, which is two waits and carries them as children.
//
// **the static files and the app's code are counted in different things and neither count says
// anything about the other's** (../deploy): the files go up in as many buckets as cloudflare asked
// for and end at every one of them taken, and the code then goes up in one long request that starts
// again at none of its bytes sent. one line over the two is a bar that fills, empties and fills
// again under a note reworded as it goes, which is why they are two lines here.
//
// `verifying` is a read of what cloudflare is holding and not of the deployment answering: a get of
// the worker's settings, checked for the bindings that went up (../deploy). it is the tail of the
// code going up rather than a thing beside it, so it is drawn as the tail of that child — the same
// reading ./assets makes of `checking`, one line further in.
//
// drawn by both halves of `start`, as assets is and for the same reason.
var cloudflare = Row{
	Running: "Deploying " + release.Baked.Name + " to Cloudflare",
	Done:    release.Baked.Name + " deployed to Cloudflare",
	Children: []Row{
		{
			Stages:  []first.Stage{first.Stage(deploy.Uploading)},
			Running: "Uploading the static files",
			Done:    "Static files uploaded",
		},
		{
			Stages:  []first.Stage{first.Stage(deploy.Pushing), first.Stage(deploy.Verifying)},
			Running: "Uploading the app's code",
			Done:    "The app's code uploaded",
		},
	},
}

// ChainRows are the rows the first deploy draws, in the order the chain reaches them.
//
// **the order of this list is the chain's order, and so is the order of the stages inside a row.**
// a row lights when the run reaches its first stage and closes when the run leaves its last, so a
// list that disagreed with ../first's `Stages` would light rows out of turn. ./lines_test.go is
// what holds the two together.
//
// **every word here is baked into this binary at build, and nothing the operator typed is named
// back at them.** the deployment two of these rows name is ../release's and is fixed at the bake,
// so a fork gets its own rows for free; the press itself is made with a password and a placement,
// and neither is a value to print at somebody while it is in use.
var ChainRows = []Row{
	assets,
	// the migration is inside the row because an operator waiting for a place to keep donations is
	// waiting for one thing, and a database with none of its tables in it is not that thing yet —
	// and it is a child of it because it is the second of two waits: the database is found or made
	// in one call and its tables are then made file by file, counted.
	//
	// `provisioned` reads as the database standing rather than as this press having made it, so a
	// second press over one already there is not a row claiming to have made it twice; the child
	// under it says found or made for that same reason (../first).
	{
		Running: "Provisioning D1 database",
		Done:    "D1 database provisioned",
		Children: []Row{
			{
				Stages:  []first.Stage{first.Database},
				Running: "Finding or making the database",
				Done:    "Database found or made",
			},
			{
				Stages:  []first.Stage{first.Stage(deploy.Migrating)},
				Running: "Creating the database tables",
				Done:    "Database tables created",
			},
		},
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
// halves of `start` run it over different databases.** the chain's is one made seconds earlier
// where every migration is part of standing it up; this one is a database in use, where a pending
// migration changes records that are already there — which is the whole of what the operator is
// waiting on, and part of the update they answered a confirm to allow (./ConfirmCarry).
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

// DeployStages are the deploy engine's own six, in the order it reaches them, spelled as the chain
// names them so that one renderer draws both halves of `start`.
//
// a list of its own rather than a slice of ../first's `Stages`, so that a stage added to the chain
// outside the deploy cannot quietly join it. ./lines_test.go holds it to the six UpdateRows cover.
var DeployStages = []first.Stage{
	first.Stage(deploy.Fetching),
	first.Stage(deploy.Checking),
	first.Stage(deploy.Migrating),
	first.Stage(deploy.Uploading),
	first.Stage(deploy.Pushing),
	first.Stage(deploy.Verifying),
}

// WaitingForTheAddress is what stands over the one wait past the rows above, drawn by the caller
// while it makes it (./waiting.go).
//
// **it is a wait and not a row because it belongs to no press.** the rows are stages a deploy
// reports as it reaches them; this stands after the last of them, on the one run in a deployment's
// life that registered the account's workers.dev name — and what it waits on is that name reaching
// the machine asking (../deployment/working.go), which reports nothing and counts nothing.
//
// **it names the address and what the operator is waiting for it to do, and nothing under that.**
// the naming a cloudflare account holds and how long one takes to reach the machine asking are this
// console's business and not theirs.
func WaitingForTheAddress() string {
	return "waiting for your deployment's address to start answering"
}
