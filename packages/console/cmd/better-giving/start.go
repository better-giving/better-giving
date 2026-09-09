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
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/terminal"
	// aliased for ./main.go's reason: `update` in this package is the command in ./update.go.
	releases "github.com/better-giving/console/internal/update"
)

// the one front door: sign in, choose the account, stand the deployment up, and open the console at
// it.
//
// **it is one command because it is one errand**, which is ../../internal/first's argument for the
// chain and holds one step further out: an operator with nothing yet has to sign in, name an
// account, choose a password and a placement, wait out a deploy and then find the console — and
// every one of those but the deploy is a thing they would otherwise have to be told to do in order.
//
// **both questions are asked in front of everything that creates anything.** the password and the
// placement are taken before the first cloudflare write, so a prompt the operator closes costs
// nothing and leaves the account as it was found — which is the same argument the chain's own order
// rests on (CLAUDE.md's one-way door).
//
// **a closed prompt ends this command quietly.** it is a press not made rather than a failure to
// report (../../internal/terminal/prompt.go), so nothing is printed and the exit is clean; a
// question this console could not ask at all is the other thing and is an error.
//
// **neither the password nor the placement is a flag.** ../../internal/deployment/write.go states
// that no value reaches a path, an argument list or a sentence, and a password in argv is in the
// shell's history, in `ps` and in whatever collects that machine's logs. this command is
// interactive or it does not run.
//
// **a deployment that is already up is opened and never deployed over.** what says whether one is
// there is the worker's own address read off the account, and a read that did not land stops this
// command rather than starting a chain: the migration is a one-way door and taking it over a
// deployment this console could not see is not something the operator asked for.

func start(args []string) error {
	flags := flag.NewFlagSet("start", flag.ContinueOnError)
	port := flags.Int("port", defaultPort, "the loopback port to serve on")
	noOpen := flags.Bool("no-open", false, "serve without opening a browser")
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
	store := account.New(records)

	// in front of the sign-in and of both prompts, which is while nothing has been created: an
	// operator who would rather deploy what the newer release carries can stop here having made
	// nothing, and the same line printed after the chain would arrive too late to act on.
	sayNewer(ctx, os.Stdout, releases.Source())

	if flow.Credential(ctx).Kind == cf.NoCredential {
		if err := allow(flow, records); err != nil {
			return err
		}
	}

	in, held, err := operating(ctx, flow, store)
	if err != nil || !held {
		return err
	}

	credential := flow.Credential(ctx)
	door := deployment.Door{
		AccountID:  in.ID,
		WorkerName: release.Baked.Name,
		Get:        cf.APIGet(credential),
		Patch:      cf.APIMergePatch(credential),
		Settings:   cf.APIMultipart(credential),
	}

	standing := effects.OwnAddress(ctx, door)
	switch standing.Kind {
	case deployment.Deployed:
		fmt.Println(alreadyUp(standing))
		return serve(records, flow, *port, !*noOpen)
	case deployment.NotDeployed:
	default:
		return unread(standing, "better-giving start")
	}

	asked, made, err := ask()
	if err != nil || !made {
		return err
	}

	ran := chainAt(ctx, door, credential, records, asked)
	if ran.Kind != first.Deployed {
		return stopped(ran)
	}

	fmt.Println(nowUp(effects.OwnAddress(ctx, door)))
	return serve(records, flow, *port, !*noOpen)
}

// the account this run operates, chosen where this machine remembers none.
//
// False with no error is the operator closing the picker, which ends this command quietly.
func operating(
	ctx context.Context,
	flow *oauth.Flow,
	store *account.Store,
) (account.Account, bool, error) {
	if held := store.Chosen(); held != nil {
		return held.Account, true, nil
	}
	return chooseAccount(ctx, flow, store)
}

// the two an operator answers, taken in the order they are needed and both in front of the chain.
//
// False with no error is either prompt closed.
func ask() (first.Asked, bool, error) {
	password, given, err := terminal.AskPassword(os.Stdin, os.Stdout)
	if err != nil || !given {
		return first.Asked{}, false, err
	}
	placement, chose, err := terminal.AskPlacement(os.Stdin, os.Stdout)
	if err != nil || !chose {
		return first.Asked{}, false, err
	}
	// minted here rather than inside the chain so that a machine whose randomness does not work is
	// a press never started rather than one that stopped having made a database
	// (../../internal/first).
	secret, err := first.SessionSecret()
	if err != nil {
		return first.Asked{}, false,
			errors.New("this console could not generate the key that signs a staff session")
	}
	return first.Asked{Password: password, SessionSecret: secret, Placement: placement}, true, nil
}

// runs the chain while the ledger holds the terminal, and answers how it ended.
//
// **the chain is on a goroutine of its own because the ledger is on this one.**
// ../../internal/first's chain is sequential and blocking and ../../internal/terminal's Show holds
// the terminal until the run says it landed or stopped, so the two cannot be one goroutine. What
// crosses between them is one Send per report, which is what Ledger.At is.
//
// **a panic inside the run is this console stopping and never the account answering.** recover only
// catches a panic raised on its own goroutine, so the run carries one — and nothing but the kind
// travels back out of it: the press it died inside was holding a password and a cloudflare
// credential, and a value raised from within one may be spelling either.
func chainAt(
	ctx context.Context,
	door deployment.Door,
	credential cf.Credential,
	records state.Store,
	asked first.Asked,
) first.Outcome {
	drawn := terminal.Draw(terminal.ChainRows, os.Stdout)
	ended := make(chan first.Outcome, 1)
	go func() {
		ran := first.Outcome{Kind: first.ConsoleStopped}
		defer func() {
			_ = recover()
			if ran.Kind == first.Deployed {
				drawn.Landed()
			} else {
				drawn.Stopped()
			}
			ended <- ran
		}()
		ran = first.Chain(ctx, asked, effects.Chain(drawn.At, door, credential,
			cf.APISend, cf.APISchemaSend, cf.AssetsUpload, release.BundleSource(version), records))
	}()

	if err := drawn.Show(); err != nil {
		// the ledger is the drawing and not the run: a terminal it could not be drawn on leaves the
		// chain going, and the wait below is still what says how it ended.
		fmt.Fprintln(os.Stderr, err)
	}
	return <-ended
}

// what a press that did not land is answered with, which is the sentence and then the words the
// step that stopped wrote.
//
// The two are separate lines because they are separate readings: the sentence is this console's and
// the block under it is whatever answered, quoted whole so that it can be searched for
// (../../internal/terminal/outcome.go). Both presses answer this way, so ./update.go reports
// through it too.
func reported(sentence, said string) error {
	if said != "" {
		sentence += "\n\nwhy:\n" + said
	}
	return errors.New(sentence)
}

// what a chain that did not land is answered with.
func stopped(ran first.Outcome) error {
	return reported(terminal.Outcome(ran), terminal.Said(ran))
}

// a deployment that was already standing when this command ran, so nothing was deployed.
func alreadyUp(address deployment.Address) string {
	if where := address.Origin(); where != "" {
		return release.Baked.Name + " is already deployed, at " + where +
			": nothing was deployed, and the console below reads it"
	}
	return release.Baked.Name + " is already deployed and answers on no address this console can " +
		"read: nothing was deployed, and the console below reads what it can"
}

// where the deployment this run stood up answers.
func nowUp(address deployment.Address) string {
	if where := address.Origin(); where != "" {
		return "your deployment is at " + where
	}
	return release.Baked.Name + " is deployed and answers on no address this console can read"
}

// what a console that could not find out whether anything is deployed says, which is never a deploy.
//
// The three are three different things to do about it, and none of them is this command again on
// its own: a sign-in that may not read the account is not a network that dropped.
//
// `command` is the caller's own, because both presses make this read and they are repaired by
// different ones: `start` stands a deployment up and `update` only carries code over one
// (./update.go).
func unread(address deployment.Address, command string) error {
	cannot := "this console can't find out whether " + release.Baked.Name +
		" is already deployed, and won't deploy over one it can't see"
	switch address.Kind {
	case deployment.AddressRefused:
		return fmt.Errorf("cloudflare won't tell this sign-in what is in this account, so %s: %s",
			cannot, address.Detail)
	case deployment.AddressUnreadable:
		return fmt.Errorf("cloudflare answered about this account in a shape this console was not "+
			"written against, so %s: %s", cannot, address.Detail)
	default:
		return fmt.Errorf("cloudflare didn't answer, so %s. check this machine's connection, then "+
			"run %s again: %s", cannot, command, address.Detail)
	}
}
