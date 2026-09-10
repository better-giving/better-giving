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
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/server"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/terminal"
)

// the one front door: sign in, name the account, put this release on the deployment — standing one
// up where there is none and offering to carry the code onto one that is behind — and open the
// console at it.
//
// **a console newer than this one is offered here and takes the run over, and that is the first
// thing this command does** (./main.go's carried, and ./update.go's header for why the two move
// together). nothing this command opens, claims or asks may stand in front of it: the exec discards
// this process whole, so a state store opened, a loopback port claimed or a question answered ahead
// of it is work the operator did twice at best. an operator who declines carries on with this
// binary, which deploys what this binary was baked with.
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
// standing — which is the argument ./atTheDoor makes for the identical act (./closed). a question
// this console could not ask at all is the other thing and is an error.
//
// **the console question above is the one exception and it is the reason it stands first.** closing
// it leaves the operator on this binary rather than ending the run: what they declined can be had
// again by typing this command, and nothing had been opened, claimed or created to abandon. every
// prompt past it is in front of something that would be, which is what makes a closed one the end
// of the run there.
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
// operator asked for.
//
// **the carry is offered and never taken for granted.** the deployment says which release it was
// built from and this run weighs that against the release this binary carries
// (../../internal/effects' OwnRelease): the same one is nothing to upload, so the address is
// printed and the console opens. every other reading — another release, no session held here, a
// read that did not land, an envelope naming no version — is a deployment this console cannot call
// current, and the operator answers for the upload at ./carryingOver's door.
//
// **that door is where the migration is named, and there is no flag that skips it.** what a deploy
// would apply to the live database is read and named and answered before anything reaches
// cloudflare, and this is the only press that reaches it: ./update.go installs a console and
// deploys nothing. a door the operator shut still opens the console, because the deployment is
// standing and that is what they typed this command for.
//
// **the third answer at that door is the account picker again, and the whole run is made over on
// the account it names** (./startingOver). the picker opens on the account this machine remembers,
// so the operator who most needs a way back is the one who kept it by reflex and met a door about a
// deployment they did not mean — and the pass they walked out of created nothing, uploaded nothing
// and gave its loopback port back, which is what makes going round again free.

func start(args []string, to, wrong io.Writer) error {
	taken := taking("start", startTakes)
	port := taken.flags.Int("port", defaultPort, "the loopback port to serve on")
	noOpen := taken.flags.Bool("no-open", false, "serve without opening a browser")
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	ctx := context.Background()
	// **in front of the store, the sign-in, the port and every prompt, which is while nothing has
	// been created.** a binary deploys only the bundle from its own bake, so a first deploy made
	// from an out-of-date console stands a deployment up on out-of-date code — the question about
	// the newer console is put before any of that (./main.go's carried), and the exec that follows
	// an operator agreeing discards whatever a run did ahead of it. what comes back is a line, and
	// only where a console another one installed still reads a release past its own.
	//
	// **the line is held rather than printed here, because the paths put it in three places.** the
	// confirm erases the visible screen before it names what it would apply
	// (../../internal/terminal/clear.go), so a line printed above this run is gone from the screen
	// at the moment the operator answers the one-way door: the carry hands it to the door and it is
	// drawn over it. the path that stands a deployment up has no door to draw it over and says it in
	// front of the chain, and a run whose console question could not be put has already said it
	// where that question was (./main.go's aboutTheConsole).
	newerConsole, err := carried(ctx, to)
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

	// what the picker's own reads found on each account, kept for the pass that runs under the
	// account they picked so that the deployment on it is not asked for twice
	// (./standingOn, ../../internal/effects' EachAddress). written by the pick and read by the pass
	// straight after it, which are one goroutine's — ./startingOver runs the two in turn and every
	// pass overwrites what the one before it read.
	found := effects.Addresses{}

	return startingOver(to,
		func() (account.Account, bool, error) {
			return operating(
				func() (account.Account, terminal.Answered, error) {
					in, read, answered, err := chooseAccount(ctx, flow, store, to)
					found = read
					return in, answered, err
				},
				func() error { return signingOut(ctx, flow, to) })
		},
		func(in account.Account) (bool, error) {
			credential := flow.Credential(ctx)
			door := deployment.Door{
				AccountID:  in.ID,
				WorkerName: release.Baked.Name,
				Get:        cf.APIGet(credential),
				Patch:      cf.APIMergePatch(credential),
				Settings:   cf.APIMultipart(credential),
			}

			// **one wait over every read this pass makes, drawn before the first of them and given
			// up in front of the screen that follows.** it draws on this process's own terminal and
			// never on `to`, which is ./main.go's rule for every drawing that holds the screen. the
			// deferred end is the backstop and never the ordinary one: the paths that draw give it
			// up themselves (./catchingUp's `settled`), and what is left for this line is a pass
			// that ended on a port it could not claim.
			silence := &terminal.Wait{}
			if readingAhead(found, in) {
				silence = terminal.WaitingOn(os.Stdout, terminal.ReadingTheDeployment())
			}
			defer silence.Done()

			standing := standingOn(found, in, func() deployment.Address {
				return effects.OwnAddress(ctx, door)
			})
			if standing.Kind == deployment.Deployed {
				// the account and the address are handed in rather than read again: the confirm
				// erases the visible screen before it draws, so what names the deployment has to be
				// on that screen, and both are already in this command's hand.
				onto := terminal.Deployment{Account: in.Name, Address: standing.Origin()}
				return catchingUp(to, onto, newerConsole, silence.Done,
					func() (net.Listener, error) { return beforeTheDeploy(*port) },
					func() string {
						return effects.OwnRelease(
							ctx, records, standing.Origin(), deployment.Reads(deployment.Calls))
					},
					func() effects.Migrations {
						return effects.Pending(ctx, credential, cf.APISend, in.ID)
					},
					func(at terminal.Deployment, read effects.Migrations) terminal.Confirmation {
						return terminal.ConfirmCarry(
							os.Stdin, os.Stdout, at, version, read.Names, read.Ahead, newerConsole)
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
			}
			// every path from here draws on the screen the wait is standing on: the failure this
			// console cannot deploy past, the held line about a newer console, and the first-run
			// questions, which erase the screen before they draw.
			silence.Done()
			if standing.Kind != deployment.NotDeployed {
				return false, unread(standing)
			}

			if newerConsole != "" {
				fmt.Fprintln(to, newerConsole)
			}
			return false, standingUp(to,
				func() (net.Listener, error) { return beforeTheDeploy(*port) },
				func() (first.Asked, bool, error) { return ask(aboutToMake(in)) },
				func(asked first.Asked) (first.Outcome, bool) {
					return chainAt(ctx, door, credential, records, asked)
				},
				func() string { return nowUp(effects.OwnAddress(ctx, door)) },
				func(bound net.Listener) error {
					return serve(records, flow, *port, !*noOpen, to, bound)
				})
		})
}

// the run as many times as the operator asks for it: an account chosen, and the whole reading made
// against it.
//
// **the way back out of the carry door is the account picker, and what it puts up again is this
// pass in full.** the picker opens on the account this machine remembers, so the operator most
// likely to want it is the one who kept that account by reflex and met a door about a deployment
// they did not mean — and every reading past the picker is about the account it named, so a pass
// that reused any of it would be answering about the deployment they just walked away from.
//
// **nothing is carried between passes and nothing has to be.** a pass the operator went back on
// uploaded nothing and created nothing (./carryingOver), and the loopback port it claimed was given
// back on the way out of it (./onThePortItTook) — so the next pass claims it again, and a port
// something else took in the gap is met in front of that pass's own door rather than past it.
//
// A picker closed on a later pass ends the run exactly as one closed on the first does: a press not
// made, said as one, on a clean exit (./closed).
func startingOver(
	to io.Writer,
	picking func() (account.Account, bool, error),
	against func(account.Account) (bool, error),
) error {
	for {
		in, held, err := picking()
		if err != nil || !held {
			return closed(to, err)
		}
		again, err := against(in)
		if err != nil || !again {
			return err
		}
	}
}

// where the deployment on the account just chosen answers, out of the reads the picker already
// made.
//
// **the picker reads every account to mark its rows, and the account picked is one of the ones it
// read** — so this pass runs against that reading rather than asking cloudflare the same question a
// second time, which is the argument this command already makes for not reading the address again
// across a carry (./catchingUp's `where`).
//
// **a read that did not land is absent from that list, and there this pass reads for itself.** the
// picker leaves an account off rather than claiming anything about it
// (../../internal/effects' EachAddress), and what stands behind this reading is whether a migration
// is about to be offered — so a pass that treated an absent account as a deployment that is not
// there would stand a second one up beside one that already exists.
func standingOn(
	found effects.Addresses,
	in account.Account,
	read func() deployment.Address,
) deployment.Address {
	if standing, carried := found[in.ID]; carried {
		return standing
	}
	return read()
}

// whether this pass reaches cloudflare at all between the account being picked and the screen it
// draws next, which is what the wait in front of that screen stands over
// (../../internal/terminal's ReadingTheDeployment).
//
// **a pass that fetches nothing draws nothing.** a wait that appeared and vanished in the same
// frame is noise, and that pass is a real one: the picker's own read landed and said there is no
// deployment on this account, so ./standingOn asks nobody anything and the first-run questions draw
// straight away.
//
// **the two readings that do fetch are the picker's read that did not land and the deployment it
// found.** the first is ./standingOn reading the address for itself; the second is ./catchingUp's
// weighing and ./carryingOver's reading, which are the release the deployment is on and the
// migrations waiting on it — both made before the door erases the screen to draw.
//
// an address the picker read that says neither is the third thing and fetches nothing: this pass
// stops on what it was already holding (./unread).
func readingAhead(found effects.Addresses, in account.Account) bool {
	standing, carried := found[in.ID]
	return !carried || standing.Kind == deployment.Deployed
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

// the order a carry onto a deployment already standing runs in: the port taken, the deployment
// weighed against this release, and — where it is behind — what a deploy would apply read and
// named, the door answered, the carry, and where it left the deployment. the console is served on
// the port that was taken in front of all of it either way.
//
// **the up-to-date reading is the first act and it decides whether the rest happens.** a deployment
// already on this release has nothing to upload, so a door put in front of the operator there is a
// question about a press that would change nothing — and the console at the address is what they
// typed this command for.
//
// `newerConsole` is the held line naming a console newer than this one, drawn here because that
// path opens no door to draw it over (../../internal/terminal/confirm.go): the operator holding it
// is the one whose install landed off this machine's PATH, and a run that put it nowhere leaves
// them on a console that cannot deploy what the release they are reading about carries.
//
// **the port is claimed in front of that reading and the door, for ./onThePortItTook's reason.** a
// deployment already standing is one an operator meets a migration on, so the failure this order
// exists to keep in front of that door is the same one the first deploy keeps in front of its
// chain — and a run that weighed the deployment first would be asking about an upload it could not
// have served the console after.
//
// `where` is read from the address this run already took rather than read again: the worker is the
// same worker at the same name on either path, and on the far side of the carry.
//
// **what the deployment says it is on is a string here and a bool one line later.** the door names
// it (../../internal/terminal/confirm.go) and ./alreadyCarrying weighs it, and a reading reduced to
// the bool at the moment it is taken is one the screen can never draw.
//
// `settled` gives up the wait standing over this pass's reads (../../internal/terminal's
// ReadingTheDeployment), and it is called in front of the first thing either path here draws: the
// door erases the visible screen before it names what it would apply, so a spinner still turning is
// written into the screen the operator answers on, and the up-to-date path's two lines would be
// drawn over one.
//
// True is the operator back at the account picker, which is the third way out of the door: nothing
// was uploaded on this pass and no console was served on it (./startingOver).
func catchingUp(
	to io.Writer,
	onto terminal.Deployment,
	newerConsole string,
	settled func(),
	claiming func() (net.Listener, error),
	weighing func() string,
	reading func() effects.Migrations,
	asking func(terminal.Deployment, effects.Migrations) terminal.Confirmation,
	running func() (effects.Carried, bool),
	where func() string,
	console func(net.Listener) error,
) (bool, error) {
	again := false
	err := onThePortItTook(claiming, func() (bool, error) {
		deployed := weighing()
		if alreadyCarrying(deployed) {
			settled()
			if newerConsole != "" {
				fmt.Fprintln(to, newerConsole)
			}
			fmt.Fprintln(to, where())
			return true, nil
		}
		onto.Release = deployed

		serving, back, err := carryingOver(to, settled, onto, reading, asking, running, where)
		again = back
		return serving, err
	}, console)
	return again, err
}

// whether the deployment is already on the release this binary carries.
//
// **empty is every way of not finding out and is never a match**, which is ../../internal/effects'
// OwnRelease's own arrangement: a console that could not read the deployment may not claim it is
// current, so what it does instead is ask.
func alreadyCarrying(deployed string) bool {
	return deployed != "" && deployed == version
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
// ./atTheDoor argues the line for the identical act: a press that exited saying nothing would read
// as a deployment now standing. the exit stays clean, because a press not made is not a failure
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

// the account this run operates, put to the operator on every run.
//
// **it is asked even where this machine remembers one, and the remembering is what makes that
// cheap.** the account is drawn on no other screen of a `start` that carries — the picker opens on
// the one already held, so keeping it is a return — and what stands behind this question is a
// database that cannot be moved once it exists and an upload into whichever of an operator's
// accounts this machine last wrote down. a machine that has ever operated two deployments is one
// where that memory is a guess.
//
// **the row that signs this machine out ends the run here rather than going on.** it is
// ./main.go's `logout` reached from the screen the operator is already standing at, and what
// follows a sign-out is a run with no cloudflare to deploy into: false with no error, which the
// caller draws as a press that made nothing. a sign-out that did not happen is the other thing and
// is handed back — ../../internal/oauth's Out refuses a credential set in this console's
// environment, and an operator told nothing would believe this machine gave one up.
//
// False with no error is also the operator closing the picker, which ends this command quietly.
//
// Both acts are values the caller binds, which is ./standingUp's arrangement and its reason: what
// each of them does answers for itself where it lives (./main.go's chooseAccount and signingOut),
// and what nothing else holds is which ending reaches which of them.
func operating(
	picking func() (account.Account, terminal.Answered, error),
	out func() error,
) (account.Account, bool, error) {
	chosen, answered, err := picking()
	switch {
	case err != nil:
		return account.Account{}, false, err
	case answered == terminal.SigningOut:
		return account.Account{}, false, out()
	case answered != terminal.AccountChosen:
		return account.Account{}, false, nil
	}
	return chosen, true, nil
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
// (../../internal/terminal/outcome.go). An install that did not land answers this way too, so
// ./main.go's installing reports through it for both presses.
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
// this press can hit, before anything is created, and a refusal here is an access problem an
// operator can actually fix.
//
// The act is this command again, which is the whole of what an operator does about it: `start` is
// the one press that reaches a deployment at all (./update.go).
func unread(address deployment.Address) error {
	cannot := "this console can't find out whether " + release.Baked.Name +
		" is already deployed, and won't deploy over one it can't see"
	switch address.Kind {
	case deployment.AddressRefused:
		return fmt.Errorf("Cloudflare won't tell this sign-in what is in this account, so %s: %s. %s",
			cannot, address.Detail, terminal.AnotherAccount)
	case deployment.AddressUnreadable:
		return fmt.Errorf("Cloudflare answered about this account in a shape this console was not "+
			"written against, so %s: %s. %s", cannot, address.Detail, terminal.Starting.Alone)
	default:
		return fmt.Errorf("Cloudflare didn't answer, so %s: %s. Check this machine's connection, %s",
			cannot, address.Detail, terminal.Starting.After)
	}
}

// what a deployment a newer console put up is answered with.
//
// the list itself has already been named at the terminal (../../internal/terminal/confirm.go); what
// is left is the act, and it is an install rather than a press — a binary older than the database
// it is looking at has nothing it could deploy that would not carry the app backwards.
const aheadOfThisBinary = "this deployment's database records migrations this binary does not " +
	"carry, so nothing was uploaded: run better-giving update to install the current console, " +
	"then better-giving start again"

// what a run nobody is standing at is answered with, which is the rule this whole command keeps:
// this console is interactive or it does not run.
const noOneAtTheDoor = "this console asks before it applies a migration to the live database, so " +
	"nothing was applied and nothing was uploaded: run better-giving start at a terminal the " +
	"question can be answered at"

// the order a carry onto a deployment already standing runs in: what a deploy would apply read and
// named, the door answered, the carry itself, and where it left the deployment.
//
// **it is its own function because the order is the thing able to be wrong**, which is
// ./standingUp's argument for the identical arrangement: every act is a value the caller binds and
// each is held to what it answers where it lives, and what nothing else holds is the sequence — the
// read taken in front of the door rather than past it, and the door answered before anything
// reaches cloudflare.
//
// `serving` is whatever the caller has past the carry, which is ./catchingUp's console: a door the
// operator shut reaches it, because the deployment is standing and nothing was uploaded, and so
// does a carry that landed. False with no error is a carry whose ledger a signal took — what a
// ctrl-c asked to stop is the process holding the terminal (./afterTheChain) — and False with one
// is a read or a carry that did not land.
//
// `again` is the operator taking the third way out of the door, which serves no console here and
// leaves the account picker to the caller (./startingOver).
//
// `settled` is ./catchingUp's, given up on the far side of the read this function opens with.
func carryingOver(
	to io.Writer,
	settled func(),
	onto terminal.Deployment,
	reading func() effects.Migrations,
	asking func(terminal.Deployment, effects.Migrations) terminal.Confirmation,
	running func() (effects.Carried, bool),
	where func() string,
) (serving, again bool, err error) {
	read := reading()
	// the last read of the pass, so the wait over them all is given up here: what follows is the
	// door, which erases the screen before it draws (./catchingUp's `settled`), or the failure that
	// read leaves instead.
	settled()
	if why := terminal.Unnamed(read); why != "" {
		return false, false, reported(why, read.Detail)
	}
	said, went, err := atTheDoor(asking(onto, read))
	if said != "" {
		fmt.Fprintln(to, said)
	}
	if err != nil {
		return false, false, err
	}
	if went != through {
		// one answer runs the carry and every other leaves the deployment as it stands, the ones
		// nobody named included (./atTheDoor): ./shut opens the console at a deployment that is
		// already serving, and ./elsewhere hands the run back to the account picker
		// (./startingOver).
		return went == shut, went == elsewhere, nil
	}

	ran, halted := running()
	if err := afterTheCarry(ran); err != nil {
		return false, false, err
	}
	fmt.Fprintln(to, where())
	return !halted, false, nil
}

// what this command says about a carry that settled, which is nothing where it carried.
//
// **a signal that took the ledger is no reading in here, and ./carryingOver is where it is one.**
// what a halt decides is whether a console is served on the far side of the carry (./catchingUp)
// and never whether the carry landed: a ctrl-c is a stop the operator asked for and a deploy that
// stopped in the middle is not one — what that ctrl-c asked to stop was never the operator's
// knowledge of what the upload did.
func afterTheCarry(ran effects.Carried) error {
	if ran.Kind != effects.Deployed {
		return reported(terminal.UpdateOutcome(ran), terminal.UpdateSaid(ran))
	}
	return nil
}

// doorway is which way out of the carry door this run took.
//
// It is what the answer is worth to this command and never the answer itself: the operator chose
// between the words the door drew (../../internal/terminal/confirm.go), and this is the three things
// there are to do about what they chose.
type doorway string

const (
	// through is the carry running.
	through doorway = "through"
	// shut is nothing uploaded and the console opened at the deployment that is already standing.
	shut doorway = "shut"
	// elsewhere is nothing uploaded, no console, and the account picker put up again
	// (./startingOver).
	elsewhere doorway = "elsewhere"
)

// what this command does about the answer the door came back with.
//
// **the line and the error are separate because three of the five ends are not failures.** a door an
// operator shut is a press not made (../../internal/terminal/prompt.go) and has a line and no
// error — and it has a line at all because a run that went on to the console saying nothing would
// read as a deployment now carrying this release. a door they left for the account picker is the
// same reading of a smaller act: nothing was uploaded, and the pass they are about to make is drawn
// over the sentence saying so. a door that was never put to anybody is the other one: the list was
// named, nobody was there to answer it, and a command that ended cleanly on that would be reporting
// a decision nobody made.
//
// **one answer opens the door and every other shuts it, the ones nobody named included.**
// ../../internal/terminal's Confirmation is a bare string and nothing checks that this switch names
// every value of it, so a default that went on would be a migration applied on an answer this
// console could not read — and that one cannot be undone (CLAUDE.md).
func atTheDoor(answered terminal.Confirmation) (said string, went doorway, err error) {
	switch answered {
	case terminal.Confirmed:
		return "", through, nil
	case terminal.Declined:
		return "the database was left alone and nothing was uploaded", shut, nil
	case terminal.Elsewhere:
		return "nothing was uploaded", elsewhere, nil
	case terminal.Unattended:
		return "", shut, errors.New(noOneAtTheDoor)
	case terminal.Ahead:
		return "", shut, errors.New(aheadOfThisBinary)
	default:
		return "", shut, fmt.Errorf("this console didn't understand the answer at the door (%q), "+
			"so nothing was applied and nothing was uploaded: run better-giving start again",
			answered)
	}
}

// runs the carry while the ledger holds the terminal, and answers how it ended and whether a signal
// took the drawing before it did (../../internal/terminal's Settled and Halted).
//
// **the halt is handed back because there is a console on the far side of the carry**
// (./catchingUp): a port bound and a browser tab opened minutes after a ctrl-c is what the operator
// asked to be spared.
//
// The arrangement is ./chainAt's and every argument it makes holds here: the deploy is sequential
// and blocking while ../../internal/terminal's Show holds the terminal, so the two cannot be one
// goroutine; a panic inside the run is this console stopping and never the account answering, so
// the run carries its own recover; and nothing but the kind travels back out of it, because the
// press it died inside was holding a cloudflare credential.
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

// where the deployment this run carried the code onto answers, and where one that needed no carry
// already does.
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
