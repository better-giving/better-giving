package terminal

import (
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/release"
)

// what a press that carries this repository's code onto a standing deployment left behind, and what
// a console that could not name what it would apply says instead.
//
// **the deploy engine's half is ./outcome.go's and is not written twice.** a redeploy that stopped
// inside the download, the migration or the upload is that engine in the same stage as a chain that
// stopped there, and what it left standing is the same thing — so ./notDeployed says it for both
// and only the act on the end differs, which is ./Repair.
//
// **the database half is this file's own, because the two halves of `start` do different things
// about it.** the chain would have made the database and the carry only looks for it, so every
// sentence here ends in nothing uploaded over a deployment that is still standing and still
// serving. the states themselves are worded to match the chain's, so an operator meeting one on
// either half of that press is sent to the same place.
//
// **every act on the end of one is `better-giving start`, because that is the press that carries.**
// `better-giving update` installs a console and reaches no deployment at all
// (../../cmd/better-giving/update.go), so a sentence about an upload naming it would send an
// operator to a press that cannot repair what they are looking at. ./Updating is what an install's
// own failures are repaired by, and nothing here is one.
//
// **a pending read that did not land has sentences of its own and never the press's.** nothing was
// asked of the deployment past the read, so what those say is that the door was never named — and
// a confirm in front of an unnamed door would be a confirmation of nothing (CLAUDE.md's one-way
// door).
//
// these are pure functions of a reading, which is why they are here and not in
// ../../cmd/better-giving: ./outcome_test.go holds every kind ../effects names to a sentence of its
// own.

// what a redeploy that ended in a kind this file does not know left behind.
//
// ./outcome_test.go holds every kind ../effects names to a sentence of its own, so a kind added
// there and not here fails `go test` — and reaches this rather than a blank line under the ledger
// if one ever does.
var unaccountedUpdate = "This update did not finish, and this console has no account of how it " +
	"stopped. " + Starting.Alone

// UpdateOutcome is what a redeploy that did not land left behind, in one sentence an operator can
// act on.
//
// Empty for the redeploy that landed: what says it worked is the address printed under it.
func UpdateOutcome(ran effects.Carried) string {
	switch ran.Kind {
	case effects.Deployed:
		return ""
	case effects.ConsoleStopped:
		// the console's own state and never the account's: nothing observed how far the press got,
		// so no step is named and there is nothing cloudflare said to draw.
		return "This console stopped part way through the update and doesn't know how far it got. " +
			"What reached Cloudflare before it stopped is what your deployment holds now. " +
			Starting.Alone + " It reads what is already there rather than assuming."
	case effects.NoDatabase:
		return NoDatabaseFound(ran.Found)
	case effects.NotDeployed:
		return notDeployed(ran.Ran, Starting)
	default:
		return unaccountedUpdate
	}
}

// UpdateSaid is cloudflare's own words about the step a redeploy stopped in, or empty where it
// wrote none.
//
// Drawn under ./UpdateOutcome's sentence and never inside one, for ./Said's reason.
func UpdateSaid(ran effects.Carried) string {
	switch ran.Kind {
	case effects.NoDatabase:
		return ran.Detail
	case effects.NotDeployed:
		if ran.Ran == nil {
			return ""
		}
		// the migration is the one stage that says which file to open, and it is the stage where
		// that matters most: the door it stopped inside is one way.
		if ran.Ran.File != "" && ran.Ran.Detail != "" {
			return Code(ran.Ran.File) + ": " + ran.Ran.Detail
		}
		return ran.Ran.Detail
	}
	return ""
}

// Unnamed is why this console could not name what a deploy would apply to the live database, and
// empty where it named it.
//
// A reading that did not land never falls through to the press: the confirm that stands in front of
// the one-way door would be answering a list nobody read, and the door is one way.
func Unnamed(read effects.Migrations) string {
	if read.Absent != "" {
		return NoDatabaseFound(read.Absent)
	}
	switch read.Applied {
	case cf.ResultValue:
		return ""
	case cf.ResultRefused:
		return "Cloudflare won't tell this sign-in what has been applied to this deployment's " +
			"database, so nothing was uploaded. " + AnotherAccount
	case cf.ResultMissing:
		// the database resolved a moment ago and is gone by the next call: the same absence the
		// list read answers, so it is said in the same words.
		return NoDatabaseFound("none")
	case cf.ResultUnreadable:
		return "Cloudflare answered about this deployment's database in a shape this console was " +
			"not written against, so nothing was uploaded. " + Starting.Alone
	default:
		return "Cloudflare didn't answer about this deployment's database, so nothing was " +
			"uploaded. Check this machine's connection, " + Starting.After
	}
}

// NoDatabaseFound is why the database this press deploys over was not resolved, and what that left
// standing.
//
// `found` is ../effects' Absent word: `none`, `many`, `refused`, `unreachable` or `no-credential`.
func NoDatabaseFound(found string) string {
	switch found {
	case "none":
		return "No database called " + release.Baked.DatabaseName + " is in this account, so " +
			"nothing was uploaded. This press deploys over what is already there and makes " +
			"nothing, so the database has to be there first."
	case "many":
		// every remote path resolves the database by name, so a deploy made against an account
		// holding two would bind the worker to one of them without saying which (CLAUDE.md).
		return "Two databases in this account are called " + release.Baked.DatabaseName +
			", so nothing was uploaded: a deploy would pick one without saying which. Delete or " +
			"rename the one that isn't this deployment's, " + Starting.After
	case "refused":
		return "Cloudflare won't tell this sign-in what is in this account, so nothing was " +
			"uploaded. " + AnotherAccount
	case "no-credential":
		return "This machine isn't signed in to Cloudflare any more, so nothing was uploaded. " +
			signInAgain
	default:
		return "Cloudflare didn't answer, so nothing was uploaded. Check this machine's " +
			"connection, " + Starting.After
	}
}
