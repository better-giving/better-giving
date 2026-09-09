package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/terminal"
)

// this release's code carried onto a deployment that is already standing.
//
// **it names one step and ./start.go is the front door.** the sign-in and the account are that
// command's to take, and an operator with neither is sent to `login` rather than asked here: this
// one makes nothing, stores nothing, serves nothing and opens no browser.
//
// **it refuses where nothing is deployed, and that is not tidiness.** ../../internal/effects' Carry
// uploads the worker whether or not one is there, so this command run on a fresh machine would put
// up a worker with no password stored, no spam protection registered and no session minted — a
// deployment nobody can sign in to and this command cannot repair. what says whether one is
// standing is the worker's own address read off the account, and a read that did not land refuses
// too (./start.go's unread): a redeploy over a deployment this console could not see is not
// something the operator asked for.
//
// **the door comes before the run.** what a deploy would apply to the live database is read and
// named, and the confirm in front of it is answered, before anything reaches cloudflare — and a
// read that did not land never falls through to the deploy, because a confirm in front of a list
// nobody read would be a confirmation of nothing and the migration is one way (CLAUDE.md).
//
// **there is no flag that skips the confirm and there is no --yes.** it is the same argument
// ../../internal/deployment/write.go makes about the password: this command is interactive or it
// does not run, and a press over a pipe is refused at the door
// (../../internal/terminal/confirm.go).

// what an operator with nothing deployed does, which is the command that stands one up.
var nothingToUpdate = "nothing is deployed under the name " + release.Baked.Name +
	" in this account, so there is nothing to carry this release onto: run better-giving start"

// what a deployment put up by a newer console is answered with.
//
// the list itself has already been named at the terminal (../../internal/terminal/confirm.go); what
// is left is the act, and it is an install rather than a press — a binary older than the database
// it is looking at has nothing it could deploy that would not carry the app backwards.
const aheadOfThisBinary = "this deployment's database records migrations this binary does not " +
	"carry, so nothing was uploaded: install the current release, then run better-giving update again"

func update(args []string) error {
	// no flag of its own, and the empty set is the statement: an argument this command does not
	// know is refused rather than passed over, so a `--yes` typed at the one-way door is a command
	// that did not run.
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}

	records, err := state.Open()
	if err != nil {
		return err
	}
	flow := signIn(records)
	// a console closed mid-sign-in leaves no listener on the callback port behind.
	defer flow.Stop()

	ctx := context.Background()
	credential := flow.Credential(ctx)
	if credential.Kind == cf.NoCredential {
		return errors.New(signedOut)
	}
	held := account.New(records).Chosen()
	if held == nil {
		return errors.New("this machine has no cloudflare account chosen: run better-giving login")
	}

	door := deployment.Door{
		AccountID:  held.Account.ID,
		WorkerName: release.Baked.Name,
		Get:        cf.APIGet(credential),
	}
	standing := effects.OwnAddress(ctx, door)
	switch standing.Kind {
	case deployment.Deployed:
	case deployment.NotDeployed:
		return errors.New(nothingToUpdate)
	default:
		return unread(standing, "better-giving update")
	}

	read := effects.Pending(ctx, credential, cf.APISend, held.Account.ID)
	if why := terminal.Unnamed(read); why != "" {
		return reported(why, read.Detail)
	}
	switch terminal.ConfirmMigration(os.Stdin, os.Stdout, read.Names, read.Ahead) {
	case terminal.Declined:
		// a door left shut is a press not made rather than a failure to report
		// (../../internal/terminal/prompt.go): nothing was applied and nothing was uploaded, and
		// the database stands exactly as it did.
		return nil
	case terminal.Ahead:
		return errors.New(aheadOfThisBinary)
	}

	ran := carryAt(ctx, effects.Carrying{
		AccountID:  held.Account.ID,
		Credential: credential,
		Sends:      cf.APISend,
		Schema:     cf.APISchemaSend,
		Settings:   cf.APIMultipart,
		Assets:     cf.AssetsUpload,
		Bundle:     release.BundleSource(version),
	})
	if ran.Kind != "deployed" {
		return reported(terminal.UpdateOutcome(ran), terminal.UpdateSaid(ran))
	}

	fmt.Println(nowLevel(standing))
	return nil
}

// runs the redeploy while the ledger holds the terminal, and answers how it ended.
//
// The arrangement is ./start.go's chainAt and every argument it makes holds here: the deploy is
// sequential and blocking while ../../internal/terminal's Show holds the terminal, so the two
// cannot be one goroutine; a panic inside the run is this console stopping and never the account
// answering, so the run carries its own recover; and nothing but the kind travels back out of it,
// because the press it died inside was holding a cloudflare credential.
func carryAt(ctx context.Context, made effects.Carrying) effects.Carried {
	drawn := terminal.Draw(terminal.UpdateRows, os.Stdout)
	made.At = drawn.Reporting
	ended := make(chan effects.Carried, 1)
	go func() {
		ran := effects.Carried{Kind: "console-stopped"}
		defer func() {
			_ = recover()
			if ran.Kind == "deployed" {
				drawn.Landed()
			} else {
				drawn.Stopped()
			}
			ended <- ran
		}()
		ran = effects.Carry(ctx, made)
	}()

	if err := drawn.Show(); err != nil {
		// the ledger is the drawing and not the run: a terminal it could not be drawn on leaves the
		// deploy going, and the wait below is still what says how it ended.
		fmt.Fprintln(os.Stderr, err)
	}
	return <-ended
}

// where the deployment this run carried the code onto answers.
//
// the address read in front of the press rather than one taken again: the worker is the same worker
// at the same name, so a second read would ask cloudflare a question this command already has the
// answer to.
func nowLevel(address deployment.Address) string {
	if where := address.Origin(); where != "" {
		return "your deployment is up to date, at " + where
	}
	return release.Baked.Name + " is up to date and answers on no address this console can read"
}
