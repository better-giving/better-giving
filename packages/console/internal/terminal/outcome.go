package terminal

import (
	"strings"

	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/widget"
)

// what a chain that did not land left behind, said in a terminal.
//
// **the repair is a command and never a press, which is the whole reason these sentences are not
// the browser's.** every sentence packages/console-ui/src/routes/_index.tsx draws ends on something
// the operator does on that page — press it again, reload it — and an operator standing at a
// terminal has no such page in front of them. so the states are the same states and the acts are
// this console's own: the command again, a sign-in, a delete on cloudflare's own dashboard.
//
// **what the chain reached is what the sentence is about, and never how the press was made.** an
// outcome carries the step that stopped it and nothing an operator typed (../first's `Outcome`), so
// there is no password and no placement to keep out of these lines — what does have to stay out is
// cloudflare's own words, which ./Said draws underneath rather than folding into a sentence that
// would then change shape with the answer.
//
// **every sentence past the deploy says the deployment is up.** the chain writes the password, the
// widget and the session after the upload, so a stop in any of them is a deployment that is
// standing and serving with one thing missing — and an operator told nothing was deployed goes
// looking for a deployment that is there.
//
// these are pure functions of an outcome, which is why they are here and not in
// ../../cmd/better-giving: ./outcome_test.go is what holds every kind ../first names to a sentence
// of its own.

// what an operator does about a press that stopped, which at a terminal is the press again.
const again = "Run better-giving start again."

// Repair is that act as the command that made the press, in the two shapes a sentence needs it.
//
// It is exported because the command package composes with it too: an install is made by both
// presses and repaired by different ones (../../cmd/better-giving/main.go's installing), and a
// sentence written there with its own act on the end is one that disagrees with the sentences in
// this file about the same predicament.
//
// **it is a value rather than a constant because the two presses are repaired differently.**
// `start` deploys and `update` installs a console, so a sentence about a deploy ends in `start`
// again (./redeploy.go) and one about an install that did not land ends in whichever press was
// making it (./install.go) — either naming the other is an operator sent to a press that does not
// repair what they are looking at.
type Repair struct {
	// Alone is the act as a sentence of its own.
	Alone string
	// After is the same act as the tail of a sentence that names something to do in front of it.
	After string
}

// Starting and Updating are the two presses, as the act on the end of a sentence about either.
var (
	Starting = Repair{Alone: again, After: "then run better-giving start again."}
	Updating = Repair{
		Alone: "Run better-giving update again.",
		After: "then run better-giving update again.",
	}
)

// where a sign-in that has gone is taken again, and the press behind it.
const signInAgain = "Run better-giving login, then better-giving start again."

// AnotherAccount is what an operator does about an account this sign-in may not act in.
//
// the two acts and not one: access is granted by somebody else and this console cannot ask for it,
// so the other way out is an account that already has it — which `login` is where the picker is
// (./account.go).
const AnotherAccount = "Ask an administrator of that account for administrator access, or run " +
	"better-giving login to choose another account."

// what a chain that ended in a kind this file does not know left behind.
//
// ./outcome_test.go holds every kind ../first names to a sentence of its own, so a kind added there
// and not here fails `go test` — and reaches this rather than a blank line under the ledger if one
// ever does.
const unaccounted = "This deploy did not finish, and this console has no account of how it " +
	"stopped. " + again

// Outcome is what a chain that did not land left behind, in one sentence an operator can act on.
//
// Empty for the chain that landed: what says a first deploy worked is the console opening on the
// deployment, so there is nothing left to say about it.
func Outcome(ran first.Outcome) string {
	switch ran.Kind {
	case first.Deployed:
		return ""
	case first.ConsoleStopped:
		// the console's own state and never the account's: nothing observed how far the press got,
		// so no step is named and there is nothing cloudflare said to draw.
		return "This console stopped part way through the deploy and doesn't know how far it got. " +
			"What reached Cloudflare before it stopped is what your deployment holds now. " + again +
			" It reads what is already there rather than assuming."
	case first.NoDatabase:
		return noDatabase(ran.Made)
	case first.NotDeployed:
		return notDeployed(ran.Ran, Starting)
	case first.NoSignIn:
		return noSignIn(ran.Written)
	case first.NoWidget:
		return noWidget(ran.Supply)
	case first.Unkept:
		return unkept(ran.Written)
	case first.NoSession:
		return release.Baked.Name + " is deployed and signable in to, and this console didn't get " +
			"a session, so it can't read anything the deployment says about itself. " + again +
			" It connects this console too."
	default:
		return unaccounted
	}
}

// Said is cloudflare's own words about the step that stopped, or empty where it wrote none.
//
// It is drawn under ./Outcome's sentence and never inside one: an answer quoted whole is an answer
// an operator can search for, and it is the one thing on an outcome no sentence here could have
// been written against.
func Said(ran first.Outcome) string {
	switch ran.Kind {
	case first.NoDatabase:
		if ran.Made != nil {
			return ran.Made.Detail
		}
	case first.NotDeployed:
		if ran.Ran == nil {
			return ""
		}
		// the migration is the one stage that says which file to open, and it is the stage where
		// that matters most: the door it stopped inside is one way.
		if ran.Ran.File != "" && ran.Ran.Detail != "" {
			return ran.Ran.File + ": " + ran.Ran.Detail
		}
		return ran.Ran.Detail
	case first.NoSignIn, first.Unkept:
		if ran.Written != nil {
			return ran.Written.Detail
		}
	case first.NoWidget:
		return widgetSaid(ran)
	case first.NoSession:
		if ran.Connection != nil {
			return ran.Connection.Detail
		}
	}
	return ""
}

// why the database was not there and not made.
func noDatabase(made *deployment.Standing) string {
	kind := deployment.StandingKind("")
	if made != nil {
		kind = made.Kind
	}
	switch kind {
	case deployment.DatabaseMany:
		// every remote path resolves the database by name, so a deploy made against an account
		// holding two would bind the worker to one of them without saying which (CLAUDE.md).
		return "Two databases in this account are called " + release.Baked.DatabaseName +
			", so nothing was deployed: a deploy would pick one without saying which. Delete or " +
			"rename the one that isn't this deployment's, then run better-giving start again."
	case deployment.DatabaseLimit:
		return "This account is at its limit for databases, so nothing was made and nothing was " +
			"deployed. Delete one at dash.cloudflare.com under Storage & Databases, or move the " +
			"account to a paid plan."
	case deployment.DatabaseRefused:
		return "Cloudflare won't let this sign-in create things in this account, so nothing was " +
			"made and nothing was deployed. " + AnotherAccount
	case deployment.DatabaseNoCredential:
		return "This machine isn't signed in to Cloudflare any more, so nothing was made and " +
			"nothing was deployed. " + signInAgain
	case deployment.DatabaseUnreachable:
		return "Cloudflare didn't answer, so nothing was made and nothing was deployed. Check " +
			"this machine's connection, then run better-giving start again."
	default:
		return "The database wasn't made, so nothing was deployed. " + again
	}
}

// how the deploy of this release's worker bundle ended.
//
// Drawn by both commands, so the act on the end of every sentence is `fix`'s and never this file's
// own (./Repair).
func notDeployed(ran *deploy.Run, fix Repair) string {
	if ran == nil {
		return nowhereNamed(fix)
	}
	switch ran.Kind {
	case deploy.NoBundle:
		return "This release carries nothing to deploy, so nothing was uploaded and nothing was " +
			"changed. Install the current release, " + fix.After
	case deploy.Mismatched:
		return "What this release carries was built from a different version of the app than this " +
			"console was, so nothing was uploaded and nothing was changed. Install the current " +
			"release, " + fix.After
	case deploy.Refused:
		return "Cloudflare won't let this sign-in deploy to this account, so nothing was " +
			"uploaded. " + AnotherAccount
	default:
		return bundleStopped(ran.At, fix)
	}
}

// a deploy that stopped where this console could not say.
func nowhereNamed(fix Repair) string {
	return "The deploy stopped, and this console has no account of where. " + fix.Alone
}

// what a stopped deploy left behind, by the stage it stopped in.
//
// **the two stages in front of the migration leave nothing behind at all, which is the whole reason
// they are in front of it** (CLAUDE.md): the release is fetched and the account is read before
// anything is written, so a press that could not go on leaves the account as it found it. the
// migration and everything past it may have changed the database, and each of those says so.
func bundleStopped(at deploy.Stage, fix Repair) string {
	switch at {
	case deploy.Fetching, deploy.Checking:
		return "The deploy stopped before any of it reached Cloudflare: nothing was changed and " +
			"nothing was uploaded. " + fix.Alone
	case deploy.Migrating:
		return "The deploy stopped in the step that sets up how records are kept, so part of that " +
			"may have been applied. Nothing was uploaded. " + fix.Alone +
			" It applies what is still pending rather than starting over."
	case deploy.Uploading, deploy.Pushing:
		// one sentence for the two halves of the upload: the static files and the app's code are
		// two waits to watch and one state to be left in, since a deployment is what the code
		// arriving makes and neither stage got that far.
		return "How records are kept was set up and the upload then stopped, so there may be " +
			"nothing deployed. " + fix.Alone
	case deploy.Verifying:
		// the press again is not the act here: `start` weighs what the deployment says about
		// itself before it offers to carry, so a worker that went up and answers on this release
		// is one a second run uploads nothing onto (../../cmd/better-giving/start.go's
		// alreadyCarrying). what is left is looking at what it is holding.
		return "It was uploaded and came back missing something it needs, so it is deployed and " +
			"may not serve anything. Run better-giving open: the console reads what the " +
			"deployment says about itself."
	default:
		return nowhereNamed(fix)
	}
}

// a deployment that is up and that nobody can sign in to, which is the worst place the chain stops.
func noSignIn(written *deployment.Written) string {
	if withheld(written) {
		return release.Baked.Name + " is deployed, and nobody can sign in to the dashboard yet: " +
			heldBack(written.Names) + " Run better-giving open: the value is named where it is " +
			"used, with a Remove press beside it."
	}
	return release.Baked.Name + " is deployed, and the password wasn't stored, so nobody can sign " +
		"in to the dashboard yet. Run better-giving start again to store it."
}

// the widget on the account and the deployment holding neither half of it.
//
// no press to send a withheld name to, unlike ./noSignIn's: the name is the spam group's, which no
// fold of the console draws a block over (packages/console-ui/src/every-group-drawn.spec.ts).
func unkept(written *deployment.Written) string {
	stood := release.Baked.Name + " is deployed, and the key that turns bots away wasn't stored on it"
	if withheld(written) {
		return stood + ": " + heldBack(written.Names)
	}
	return stood + ", so your donation form is open to bots. " + again +
		" The widget you already have is used rather than a second one made."
}

// what a deployment carrying every other thing the chain writes says about the half that is missing.
const upAndServing = "Your deployment is up and serving, and nothing is turning bots away"

// why the spam widget was not registered.
func noWidget(supply *widget.Supply) string {
	kind := widget.SupplyKind("")
	if supply != nil {
		kind = supply.Kind
	}
	switch kind {
	case widget.Ambiguous:
		return "Two widgets in this account carry this deployment's name, so this console won't " +
			"guess which of them is its own. " + upAndServing + ". Delete the one that isn't this " +
			"deployment's at dash.cloudflare.com under Turnstile, then run better-giving start again."
	case widget.NoHosts:
		// cloudflare was never asked: what stopped this is the address read, and ../first's noOrigin
		// is the answer ./Said draws underneath.
		return upAndServing + ": this console couldn't work out where it answers, so there was no " +
			"host to register spam protection against. " + again
	case widget.Unmade:
		return upAndServing + ": Cloudflare didn't register the spam protection. " + again
	case widget.Unlisted:
		if supply.Read != nil && supply.Read.Kind == widget.NoCredential {
			return upAndServing + ": this machine isn't signed in to Cloudflare any more, so the " +
				"spam protection wasn't registered. " + signInAgain
		}
		return upAndServing + ": this account's existing widgets couldn't be read, so the spam " +
			"protection wasn't registered. " + again
	default:
		return upAndServing + ": the spam protection wasn't registered. " + again
	}
}

// which of the widget's answers carries words of cloudflare's.
func widgetSaid(ran first.Outcome) string {
	if ran.Supply == nil {
		return ran.Detail
	}
	switch ran.Supply.Kind {
	case widget.NoHosts:
		// this console's own account of why the deployment answers on no host, which the chain
		// writes rather than reads (../first's noOrigin).
		return ran.Detail
	case widget.Unmade:
		if ran.Supply.Failure != nil {
			return ran.Supply.Failure.Detail
		}
	case widget.Unlisted:
		if ran.Supply.Read != nil {
			return ran.Supply.Read.Detail
		}
	}
	return ""
}

// whether the write did not happen because the deployment holds those names as credentials.
func withheld(written *deployment.Written) bool {
	return written != nil && written.Kind == deployment.WriteWithheld && len(written.Names) > 0
}

// the vars this deployment is holding in a form nothing reads back, as the tail of a sentence.
//
// a name and never a value: what is withheld is stored as a worker secret, so this console cannot
// read it and cannot write over it — and the names themselves are the enumeration's own
// (../release), not anything an operator typed.
func heldBack(names []string) string {
	which := "those names"
	if len(names) == 1 {
		which = "that name"
	}
	return "this deployment already holds " + strings.Join(names, ", ") + " in a form nothing can " +
		"read back, so nothing was stored under " + which +
		" and running better-giving start again stores nothing."
}
