package main

import (
	"context"
	"errors"
	"fmt"
	"io"
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
// **a console newer than this one installs itself here and takes the run over, and that is the
// first thing this command does.** a binary deploys only the bundle from its own bake
// (../../internal/release's BundleSource), so this command run on an out-of-date console carries
// out-of-date code onto the deployment — the very thing it exists to do right. what reads, installs
// and re-execs is ./main.go's carried, and nothing this command opens, claims or signs in to may
// stand in front of it: the exec discards this process whole.
//
// **it names one step and ./start.go is the front door.** the sign-in and the account are that
// command's to take, and an operator with neither is sent to `login` rather than asked here: this
// one makes nothing, stores nothing, serves nothing and opens no browser.
//
// **the front door carries this release itself, through this file's own door and carry.** a `start`
// that finds a deployment already standing runs ./carryingOver and then opens the console at it
// (./start.go's catchingUp), so the order below is the order both presses take and the confirm in
// front of the one-way door stands on both.
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
// does not run, and a press over a pipe is named the list and then refused at the door
// (../../internal/terminal/confirm.go) — which ends this command as a failure, because nothing was
// applied and nobody chose that.

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

// what a run nobody is standing at is answered with, which is the same rule ./main.go's `start`
// keeps: this console is interactive or it does not run.
const noOneAtTheDoor = "this console asks before it applies a migration to the live database, so " +
	"nothing was applied and nothing was uploaded: run better-giving update at a terminal the " +
	"question can be answered at"

func update(args []string, to, wrong io.Writer) error {
	// no flag of its own, and the empty set is the statement: an argument this command does not
	// know is refused rather than passed over, so a `--yes` typed at the one-way door is a command
	// that did not run — and what it is answered with says there is no such flag and why
	// (./main.go's updateTakes).
	taken := taking("update", updateTakes)
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	ctx := context.Background()
	// **the first thing this command does, and the reason is the bug it exists to close.** a binary
	// deploys only the bundle from its own bake, so this command run on an out-of-date console
	// carries out-of-date code onto the deployment — the newer console is installed and handed the
	// run before anything is opened, claimed or signed in to (./main.go's carried). what comes back
	// is a line, and only where a console another one installed still reads a release past its own.
	newerConsole, err := carried(ctx, to, terminal.Updating)
	if err != nil {
		return err
	}

	records, err := state.Open()
	if err != nil {
		return noStore(err)
	}
	flow := signIn(records)
	// a console closed mid-sign-in leaves no listener on the callback port behind.
	defer flow.Stop()

	credential := flow.Credential(ctx)
	if credential.Kind == cf.NoCredential {
		return errors.New(signedOut)
	}
	held := account.New(records).Chosen()
	if held == nil {
		return errors.New("this machine has no Cloudflare account chosen: run better-giving login")
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
		return unread(standing, terminal.Updating)
	}

	// the account and the address are handed in rather than read again: the confirm erases the
	// visible screen before it draws, so what names the deployment has to be on that screen, and
	// both values are already in this command's hand.
	onto := terminal.Deployment{Account: held.Account.Name, Address: standing.Origin()}
	// nothing stands past the carry here, so what the order answers is read by nobody: this command
	// prints where the deployment is and ends, and ./start.go is where a console is on the far side
	// of it.
	_, err = carryingOver(to, onto,
		func() effects.Migrations {
			return effects.Pending(ctx, credential, cf.APISend, held.Account.ID)
		},
		// the newer console is drawn on the door's own screen rather than printed above this
		// command, because the confirm erases the visible screen before it names what it would
		// apply (./main.go's newer): an operator standing at a one-way door with an older binary is
		// the one who most needs it, and that is the moment they are standing there.
		func(read effects.Migrations) terminal.Confirmation {
			return terminal.ConfirmMigration(
				os.Stdin, os.Stdout, onto, read.Names, read.Ahead, newerConsole)
		},
		func() (effects.Carried, bool) {
			return carryAt(ctx, effects.Carrying{
				AccountID:  held.Account.ID,
				Credential: credential,
				Sends:      cf.APISend,
				Schema:     cf.APISchemaSend,
				Settings:   cf.APIMultipart,
				Assets:     cf.AssetsUpload,
				Bundle:     release.BundleSource(version),
			})
		},
		func() string { return nowLevel(standing) })
	return err
}

// the order a carry onto a deployment already standing runs in: what a deploy would apply read and
// named, the door answered, the carry itself, and where it left the deployment.
//
// **it is its own function because both presses run it and neither owns it.** this command is the
// whole of that order; ./start.go is the same order with a loopback port claimed in front of it and
// a console served on the far side (its catchingUp). it lives in this file because this file owns
// the carry and its header argues the door, and a door put on one press and not the other would be
// a migration applied on an answer that press never asked for.
//
// **every act is a value the caller binds and the sequence is the thing able to be wrong**, which
// is ./start.go's standingUp's argument for the identical arrangement: the read taken in front of
// the door rather than past it, the door answered before anything reaches cloudflare, and the
// account named on the one path that reaches an upload with no door in front of it (./undoored).
//
// True is whatever the caller has past the carry, which is ./start.go's console: a door the
// operator shut reaches it, because the deployment is standing and nothing was uploaded, and so
// does a carry that landed. False with no error is a carry whose ledger a signal took — what a
// ctrl-c asked to stop is the process holding the terminal (./start.go's afterTheChain) — and False
// with one is a read or a carry that did not land.
func carryingOver(
	to io.Writer,
	onto terminal.Deployment,
	reading func() effects.Migrations,
	asking func(effects.Migrations) terminal.Confirmation,
	running func() (effects.Carried, bool),
	where func() string,
) (bool, error) {
	read := reading()
	if why := terminal.Unnamed(read); why != "" {
		return false, reported(why, read.Detail)
	}
	said, on, err := atTheDoor(asking(read))
	if said != "" {
		fmt.Fprintln(to, said)
	}
	if err != nil {
		return false, err
	}
	if !on {
		return true, nil
	}
	if line := undoored(read.Names, onto); line != "" {
		fmt.Fprintln(to, line)
	}

	ran, halted := running()
	if err := afterTheCarry(ran); err != nil {
		return false, err
	}
	fmt.Fprintln(to, where())
	return !halted, nil
}

// what this command names in front of an upload that had no door in front of it, and nothing where
// the door already named it.
//
// **a release carrying no migration this database has not opens no door**
// (../../internal/terminal/confirm.go, gated), so the screen naming the account and the address is
// never drawn — and this is the one path in the program that reaches an upload with nothing named.
// an operator with a personal account and an organisation's would otherwise carry this release into
// whichever of the two this machine remembers, and find out from the address printed at the end.
func undoored(pending []string, onto terminal.Deployment) string {
	if len(pending) > 0 {
		return ""
	}
	return terminal.CarryingOnto(onto)
}

// what this command says about a redeploy that settled, which is nothing where it carried.
//
// **a signal that took the ledger is no reading in here, and ./carryingOver is where it is one.**
// what a halt decides is whether a console is served on the far side of the carry (./start.go's
// catchingUp) and never whether the carry landed: a ctrl-c is a stop the operator asked for and a
// deploy that stopped in the middle is not one — what that ctrl-c asked to stop was never the
// operator's knowledge of what the upload did.
func afterTheCarry(ran effects.Carried) error {
	if ran.Kind != effects.Deployed {
		return reported(terminal.UpdateOutcome(ran), terminal.UpdateSaid(ran))
	}
	return nil
}

// what this command does about the answer the door came back with.
//
// **the line and the error are separate because two of the four ends are not failures.** a door an
// operator shut is a press not made (../../internal/terminal/prompt.go) and has a line and no
// error — and it has a line at all because a command that exited saying nothing would read as a
// deployment now carrying this release. a door that was never put to anybody is the other one: the
// list was named, nobody was there to answer it, and a command that ended cleanly on that would be
// reporting a decision nobody made.
//
// **one answer opens the door and every other shuts it, the ones nobody named included.**
// ../../internal/terminal's Confirmation is a bare string and nothing checks that this switch names
// every value of it, so a default that went on would be a migration applied on an answer this
// console could not read — and that one cannot be undone (CLAUDE.md).
func atTheDoor(answered terminal.Confirmation) (said string, on bool, err error) {
	switch answered {
	case terminal.Confirmed:
		return "", true, nil
	case terminal.Declined:
		return "the database was left alone and nothing was uploaded", false, nil
	case terminal.Unattended:
		return "", false, errors.New(noOneAtTheDoor)
	case terminal.Ahead:
		return "", false, errors.New(aheadOfThisBinary)
	default:
		return "", false, fmt.Errorf("this console didn't understand the answer at the door (%q), "+
			"so nothing was applied and nothing was uploaded: run better-giving update again",
			answered)
	}
}

// runs the redeploy while the ledger holds the terminal, and answers how it ended and whether a
// signal took the drawing before it did (../../internal/terminal's Settled and Halted).
//
// **the halt is handed back because one caller has a console on the far side of the carry**, which
// is ./start.go's catchingUp: a port bound and a browser tab opened minutes after a ctrl-c is what
// the operator asked to be spared. this command holds nothing after the run and prints where the
// deployment is either way, so what it does with the reading is nothing at all (./carryingOver).
//
// The arrangement is ./start.go's chainAt and every argument it makes holds here: the deploy is
// sequential and blocking while ../../internal/terminal's Show holds the terminal, so the two
// cannot be one goroutine; a panic inside the run is this console stopping and never the account
// answering, so the run carries its own recover; and nothing but the kind travels back out of it,
// because the press it died inside was holding a cloudflare credential.
func carryAt(ctx context.Context, made effects.Carrying) (effects.Carried, bool) {
	drawn := terminal.Draw(terminal.UpdateRows, os.Stdout)
	made.At = drawn.Reporting
	ended := make(chan effects.Carried, 1)
	go func() {
		ran := effects.Carried{Kind: effects.ConsoleStopped}
		defer func() {
			_ = recover()
			if ran.Kind == effects.Deployed {
				drawn.Landed()
			} else {
				drawn.Stopped()
			}
			ended <- ran
		}()
		ran = effects.Carry(ctx, made)
	}()

	shown := drawn.Show()
	halted := drawn.Halted()
	said, wrong := terminal.Settled(shown, halted, "an update")
	if wrong != "" {
		fmt.Fprintln(os.Stderr, wrong)
	}
	if said != "" {
		fmt.Println(said)
	}
	return <-ended, halted
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
