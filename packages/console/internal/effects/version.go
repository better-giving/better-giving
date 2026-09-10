package effects

import (
	"context"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// OwnRelease is the release the deployment says it was built from, and empty where this console
// could not find out.
//
// **it is what says whether `start` has anything to carry**, which is that command's whole reason
// for asking: a deployment already on this release is one the operator is not put in front of a
// door about, and every other reading is (../../cmd/better-giving/start.go).
//
// **the deployment is judged by what it says about itself and never by its migrations.** a release
// that moves no schema is still code the deployment does not have, so a pending list read as empty
// would report a deployment two releases behind as up to date. ../deployment's ReportRead.Version
// is the value, served by packages/app/src/lib/server/console/report.ts.
//
// **every way of not finding out is the same empty answer, and that is the safe one.** no session
// held on this machine, a session minted against another deployment, one this deployment refused, a
// read that did not land, and an envelope naming no version are five states with one thing to do
// about them: ask the operator. a console that guessed the other way would leave a deployment on
// old code with nothing on the screen about it.
//
// **the session is weighed against the address this run is asking about, and that is not a
// formality.** ../session records one under the baked worker name alone and every deployment of
// this fork carries that name, so a machine that connected the console to one account's deployment
// holds a session naming it for as long as it lasts. `start` puts the account picker on every run:
// an operator who switches account would otherwise have this read answer about the deployment they
// left — and a report of this release off that one would call the deployment they just chose up to
// date without anything having asked it. both strings are ../deployment's PublicAddress origin, so
// the comparison is exact and anything else lands on the answer that offers.
//
// `at` is where this run found the deployment answering, and a deployment answering nowhere this
// console can read is weighed against nothing at all: an empty address matching an empty origin
// would be any session on this machine standing in for it.
//
// The read is made over the session this machine holds (../session's Held), which is the same
// session the console's own screens read the deployment over. `reads` is handed in rather than
// taken as ../deployment's Reads(Calls), so a case can answer for a deployment that is not there.
func OwnRelease(
	ctx context.Context,
	records state.Store,
	at string,
	reads func(origin, token string) cf.Get,
) string {
	held := session.Held(records, release.Baked.Name, time.Now())
	if held == nil || at == "" || held.Origin != at {
		return ""
	}
	read := deployment.Report(ctx, reads(held.Origin, held.Token))
	if read.Kind != deployment.Reported || read.Version == nil {
		return ""
	}
	return *read.Version
}
