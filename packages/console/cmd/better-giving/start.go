package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/server"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/terminal"
)

// the one front door: sign in, choose the account, put this release on the deployment — standing
// one up where there is none and carrying the code onto one that is already there — and open the
// console at it.
//
// **a console newer than this one installs itself here and takes the run over, and that is the
// first thing this command does** (./main.go's carried, and ./update.go's header for the bug it
// closes). nothing this command opens, claims or asks may stand in front of it: the exec discards
// this process whole, so a state store opened, a loopback port claimed or a question answered ahead
// of it is work the operator did twice at best.
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
// **a closed prompt ends this command on a clean exit and one line.** it is a press not made rather
// than a failure to report (../../internal/terminal/prompt.go), so the exit is zero; the line says
// nothing was created, because a command that exited saying nothing would read as a deployment now
// standing — which is the argument ./update.go makes at its own door for the identical act
// (./closed). a question this console could not ask at all is the other thing and is an error.
//
// **neither the password nor the placement is a flag.** ../../internal/deployment/write.go states
// that no value reaches a path, an argument list or a sentence, and a password in argv is in the
// shell's history, in `ps` and in whatever collects that machine's logs. this command is
// interactive or it does not run.
//
// **a deployment that is already up is carried onto and then opened, and never stood up a second
// time.** what says whether one is there is the worker's own address read off the account, and a
// read that did not land stops this command rather than starting either path: the migration is a
// one-way door and taking it over a deployment this console could not see is not something the
// operator asked for. what the carry itself is, and the confirm that stands in front of it, is
// ./update.go's carryingOver and is the same order that command runs — nothing here tells an
// operator to go and type the other press.
//
// **the same confirm stands here, and there is no flag that skips it.** what a deploy would apply
// to the live database is read and named and answered before anything reaches cloudflare, on this
// press exactly as on ./update.go's: a door put on one press and not the other is the same one-way
// door with nobody in front of it. a door the operator shut still opens the console, because the
// deployment is standing and that is what they typed this command for.

func start(args []string, to, wrong io.Writer) error {
	taken := taking("start", startTakes)
	port := taken.flags.Int("port", defaultPort, "the loopback port to serve on")
	noOpen := taken.flags.Bool("no-open", false, "serve without opening a browser")
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	ctx := context.Background()
	// **in front of the store, the sign-in, the port and both prompts, which is while nothing has
	// been created.** a binary deploys only the bundle from its own bake, so a first deploy made
	// from an out-of-date console stands a deployment up on out-of-date code — the newer console is
	// installed and handed the run before any of that (./main.go's carried), and a re-exec discards
	// whatever a run did ahead of it. what comes back is a line, and only where a console another
	// one installed still reads a release past its own.
	//
	// **the line is held rather than printed here, because the two paths put it in two places.**
	// the confirm erases the visible screen before it names what it would apply
	// (../../internal/terminal/clear.go), so a line printed above this run is gone from the screen
	// at the moment the operator answers the one-way door: the carry hands it to the door and it is
	// drawn over it, which is ./update.go's own arrangement for the same line. the path that stands
	// a deployment up has no door to draw it over and says it in front of the chain.
	newerConsole, err := carried(ctx, to, terminal.Starting)
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

	store := account.New(records)

	if flow.Credential(ctx).Kind == cf.NoCredential {
		if given, err := allow(flow, records, "better-giving start", to); err != nil || !given {
			return closed(to, err)
		}
	}

	in, held, err := operating(ctx, flow, store, to)
	if err != nil || !held {
		return closed(to, err)
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
		// the account and the address are handed in rather than read again, which is ./update.go's
		// arrangement for the identical screen: the confirm erases the visible screen before it
		// draws, so what names the deployment has to be on that screen, and both are already in
		// this command's hand.
		onto := terminal.Deployment{Account: in.Name, Address: standing.Origin()}
		return catchingUp(to, onto,
			func() (net.Listener, error) { return beforeTheDeploy(*port) },
			func() effects.Migrations {
				return effects.Pending(ctx, credential, cf.APISend, in.ID)
			},
			func(read effects.Migrations) terminal.Confirmation {
				return terminal.ConfirmMigration(
					os.Stdin, os.Stdout, onto, read.Names, read.Ahead, newerConsole)
			},
			func() (effects.Carried, bool) {
				return carryAt(ctx, effects.Carrying{
					AccountID:  in.ID,
					Credential: credential,
					Sends:      cf.APISend,
					Schema:     cf.APISchemaSend,
					Settings:   cf.APIMultipart,
					Assets:     cf.AssetsUpload,
					Bundle:     release.BundleSource(version),
				})
			},
			func() string { return nowLevel(standing) },
			func(bound net.Listener) error {
				return serve(records, flow, *port, !*noOpen, to, bound)
			})
	case deployment.NotDeployed:
	default:
		return unread(standing, terminal.Starting)
	}

	if newerConsole != "" {
		fmt.Fprintln(to, newerConsole)
	}
	return standingUp(to,
		func() (net.Listener, error) { return beforeTheDeploy(*port) },
		func() (first.Asked, bool, error) { return ask(aboutToMake(in)) },
		func(asked first.Asked) (first.Outcome, bool) {
			return chainAt(ctx, door, credential, records, asked)
		},
		func() string { return nowUp(effects.OwnAddress(ctx, door)) },
		func(bound net.Listener) error { return serve(records, flow, *port, !*noOpen, to, bound) })
}

// the port this command serves on, taken in front of everything either path does and handed to the
// console at the end of it.
//
// **it is one function because the port is one rule and this command has two paths.** everything
// able to fail runs in front of the one-way door (CLAUDE.md), and a port another console is holding
// is exactly such a failure: met past a chain it is a first deploy that landed under an exit
// reading as a failure, and met past a carry it is the same over a database already moved forward.
// so the claim is in front of `going` on both paths, the same listener is handed to the console
// rather than taken again there — a port given back in between is one something else can claim in
// the gap — and it is given back on every way out that does not serve, or the next `start` meets a
// port a process that has ended is still holding (./start_test.go).
//
// `going` is the path itself, and True is it reaching the console.
func onThePortItTook(
	claiming func() (net.Listener, error),
	going func() (bool, error),
	console func(net.Listener) error,
) error {
	bound, err := claiming()
	if err != nil {
		return err
	}
	defer func() { _ = bound.Close() }()

	serving, err := going()
	if err != nil || !serving {
		return err
	}
	return console(bound)
}

// the order a first deploy runs in: the port taken, the two questions, the chain, and the console
// served on the port that was taken in front of all of it.
//
// **it is its own function because the order is the thing able to be wrong.** every act in it is a
// value the caller binds and each is held to what it answers where it lives (./beforeTheDeploy,
// ./ask, ./chainAt, ./afterTheChain, ./main.go's serve). what nothing held was the sequence they are
// put in: the port claimed in front of the first question rather than past the chain, and the
// questions in front of the chain rather than inside it (./start_test.go).
//
// `where` is read after the chain and not before it, because what it names is a deployment that did
// not exist when this run started.
func standingUp(
	to io.Writer,
	claiming func() (net.Listener, error),
	asking func() (first.Asked, bool, error),
	running func(first.Asked) (first.Outcome, bool),
	where func() string,
	console func(net.Listener) error,
) error {
	return onThePortItTook(claiming, func() (bool, error) {
		asked, made, err := asking()
		if err != nil || !made {
			return false, closed(to, err)
		}

		reporting, serving, err := afterTheChain(running(asked))
		if err != nil {
			return false, err
		}
		if reporting {
			fmt.Fprintln(to, where())
		}
		return serving, nil
	}, console)
}

// the order a carry onto a deployment already standing runs in: the port taken, what a deploy would
// apply read and named, the door answered, the carry, where it left the deployment, and the console
// served on the port that was taken in front of all of it.
//
// **it is ./update.go's order with a port in front of it and a console on the far side**, and the
// middle of it is that command's own function rather than a second statement of it: the confirm in
// front of the one-way door is the same door on both presses (./update.go's carryingOver).
//
// **the port is claimed in front of the read and the door, for ./onThePortItTook's reason.** a
// deployment already standing is one an operator meets a migration on, so the failure this order
// exists to keep in front of that door is the same one the first deploy keeps in front of its
// chain.
//
// `where` is read from the address this run already took rather than read again: the worker is the
// same worker at the same name on the far side of the carry.
func catchingUp(
	to io.Writer,
	onto terminal.Deployment,
	claiming func() (net.Listener, error),
	reading func() effects.Migrations,
	asking func(effects.Migrations) terminal.Confirmation,
	running func() (effects.Carried, bool),
	where func() string,
	console func(net.Listener) error,
) error {
	return onThePortItTook(claiming, func() (bool, error) {
		return carryingOver(to, onto, reading, asking, running, where)
	}, console)
}

// what this command does before it asks anything, which is everything able to fail while nothing
// has been created and nothing has been applied.
//
// **the loopback port is taken here and not on the far side of the deploy.** everything able to
// fail runs in front of the one-way door (CLAUDE.md) and this one was behind it: a port another
// console is already holding, met after the migration, the upload and every write, is a deploy that
// landed and a command that exits 1 with the console never served. the listener is handed to
// ./serve rather than taken again there, because a port given back in between is one something else
// can claim in the gap.
//
// **both of this command's paths claim it here and for that one reason** (./standingUp,
// ./catchingUp): the chain's migration and the carry's are the same one-way door, and a port met
// past either is met past a database already moved forward.
//
// **it is the port alone, and what is about to be made is named a step later.** every prompt in this
// package's terminal erases the screen before it draws, so the description belongs on the first
// question's own screen rather than above a call that wipes it (./ask, and
// ../../internal/terminal/password.go). the carry names its own object on the door's own screen for
// the same reason (../../internal/terminal/confirm.go).
func beforeTheDeploy(port int) (net.Listener, error) {
	return claim(server.Listen(nil, port).Addr)
}

// the account this deploy writes into, and the three things it puts there.
//
// **the account is the first line because it is the one thing no later screen states.** it is
// remembered between runs and drawn nowhere after the first, so an operator holding a personal
// account and an organisation's has nothing on the screen telling them which of the two this deploy
// is about to write into — and what the first stage makes is a database whose placement cannot be
// changed once it exists (../../internal/terminal/placement.go).
//
// **it is a statement and not a door.** the two questions it is drawn above create nothing and
// closing either ends this command having made nothing (./start.go's header), so what already
// stands in front of the first write is a press the operator has to make rather than one they have
// to stop.
//
// the three are ../../internal/first's chain in the order it reaches them: the database it makes or
// finds, the worker it uploads, and the spam widget registered against the address that worker
// answers on — which is why that one cannot be registered until the upload has landed.
func aboutToMake(in account.Account) string {
	return "deploying into your Cloudflare account " + in.Name + " (" + in.ID + "). " +
		"this makes:\n" +
		"  a database — where it keeps its records is the next question, " +
		"and it cannot be changed once the database exists\n" +
		"  the worker " + release.Baked.Name + " — it serves your donation page, /admin and the API\n" +
		"  spam protection — registered against the address that worker answers on"
}

// what a prompt the operator closed leaves on the screen, and the same nil it ended on.
//
// ./update.go's door argues the line for the identical act: a press that exited saying nothing would
// read as a deployment now standing. the exit stays clean, because a press not made is not a failure
// to report (../../internal/terminal/prompt.go) — and a question this console could not ask at all
// is the other thing, which says what happened itself.
func closed(to io.Writer, err error) error {
	if err == nil {
		fmt.Fprintln(to, "nothing was created and nothing was deployed")
	}
	return err
}

// how far this command goes once the chain has settled: whether the deployment's address is said,
// and whether the console is then served at it.
//
// **a chain that landed under a ledger a signal took says the address and serves nothing.** what
// the operator's ctrl-c asked to stop is this process holding their terminal, and never their
// knowledge of what the deploy did: they were told it was still going
// (../../internal/terminal's StillGoing), so a command that ended in silence would leave them
// unable to tell a deploy that landed from one that died — with a deployment now standing, which is
// the state they most need to know about. what they did not ask for is what stands on the other
// side of that wait: a port bound and a browser tab opened minutes later, with this process still
// holding the terminal they asked to be given back. so the address is printed and the exit is
// clean, which is no failure for the same reason a closed prompt above is none.
//
// **a chain that did not land is reported whether or not a signal took its ledger.** a ctrl-c is a
// stop the operator asked for and a deploy that stopped in the middle is not one: it leaves the
// database ahead of the code that reads it (CLAUDE.md) and nothing else in this run would say so.
func afterTheChain(ran first.Outcome, halted bool) (reporting, serving bool, err error) {
	if ran.Kind != first.Deployed {
		return false, false, stopped(ran)
	}
	return true, !halted, nil
}

// the account this run operates, chosen where this machine remembers none.
//
// False with no error is the operator closing the picker, which ends this command quietly.
func operating(
	ctx context.Context,
	flow *oauth.Flow,
	store *account.Store,
	to io.Writer,
) (account.Account, bool, error) {
	if held := store.Chosen(); held != nil {
		return held.Account, true, nil
	}
	return chooseAccount(ctx, flow, store, to)
}

// a machine whose randomness would not answer, which is a press never started.
//
// the act on the end of it because every other sentence this program ends on has one: the failure
// is a read of the operating system that came back empty, so the press again is the whole of what
// there is to do about it, and nothing was created (../../internal/first).
const noSessionKey = "this console could not generate the key that signs a staff session, so " +
	"nothing was created and nothing was deployed. Run better-giving start again."

// the two an operator answers, taken in the order they are needed and both in front of the chain.
//
// `preamble` is what this press is about to make, drawn on the first question's own screen because
// that is the screen the operator is looking at while they answer it.
//
// False with no error is either prompt closed.
func ask(preamble string) (first.Asked, bool, error) {
	password, given, err := terminal.AskPassword(os.Stdin, os.Stdout, preamble)
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
		return first.Asked{}, false, errors.New(noSessionKey)
	}
	return first.Asked{Password: password, SessionSecret: secret, Placement: placement}, true, nil
}

// runs the chain while the ledger holds the terminal, and answers how it ended and whether a signal
// took the drawing before it did (../../internal/terminal's Halted).
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
) (first.Outcome, bool) {
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

	shown := drawn.Show()
	halted := drawn.Halted()
	said, wrong := terminal.Settled(shown, halted, "a deploy")
	if wrong != "" {
		fmt.Fprintln(os.Stderr, wrong)
	}
	if said != "" {
		fmt.Println(said)
	}
	return <-ended, halted
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
// **every one of the three ends in something to do**, and the acts are the ones
// ../../internal/terminal/outcome.go already gives the same two states: this is the first failure
// either press can hit, before anything is created, and a refusal here is an access problem an
// operator can actually fix.
//
// `fix` is the caller's own press, because both presses make this read and they are repaired by
// different ones: `start` stands a deployment up and `update` only carries code over one
// (./update.go).
func unread(address deployment.Address, fix terminal.Repair) error {
	cannot := "this console can't find out whether " + release.Baked.Name +
		" is already deployed, and won't deploy over one it can't see"
	switch address.Kind {
	case deployment.AddressRefused:
		return fmt.Errorf("Cloudflare won't tell this sign-in what is in this account, so %s: %s. %s",
			cannot, address.Detail, terminal.AnotherAccount)
	case deployment.AddressUnreadable:
		return fmt.Errorf("Cloudflare answered about this account in a shape this console was not "+
			"written against, so %s: %s. %s", cannot, address.Detail, fix.Alone)
	default:
		return fmt.Errorf("Cloudflare didn't answer, so %s: %s. Check this machine's connection, %s",
			cannot, address.Detail, fix.After)
	}
}
