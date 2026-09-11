// Command better-giving is the operator console: one binary holding the ui, run on the operator's
// own machine against a deployment that already exists.
//
// **it serves nothing to anybody else and is never deployed.** `start` and `open` both end by
// binding the loopback address and opening a tab at it; packages/console/internal/server states what
// that server refuses and why.
// packages/console-ui/src/never-deployed.spec.ts holds the absences on the react side.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/server"
	"github.com/better-giving/console/internal/signin"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/terminal"
	// aliased because `update` in this package is the command in ./update.go: what the import
	// answers is whether a newer console exists, which is a release and not a redeploy.
	releases "github.com/better-giving/console/internal/update"
	"github.com/better-giving/console/ui"
)

// what this binary was built at, where a build stated them with `-ldflags "-X main.version=…"`;
// nothing in this repository passes any, so a build made here leaves these words. the `version`
// subcommand is the one thing that reads them.
var (
	version = "dev"
	commit  = "none"
)

// where `open` listens unless told otherwise.
//
// below the four vite dev servers this repository runs (5321 the app's, 5322 the console's ui,
// 5323 the gallery's, 5324 the form's), so a contributor with any of them up meets no collision.
const defaultPort = 5320

func main() {
	os.Exit(exitCode(os.Stderr, run(os.Args[1:], os.Stdout, os.Stderr)))
}

// what this process exits with, having named the failure unless the command already named it.
//
// **a failure a command met inside its own arguments is written once, by the command** (./options):
// `flag` names the option it did not understand and lists what the command does take, and a second
// sentence here would be the same failure under a second heading.
func exitCode(to io.Writer, err error) int {
	if err == nil {
		return 0
	}
	if !errors.Is(err, errSaid) {
		terminal.Say(to, fmt.Sprintf("%s: %v", terminal.Cmd(), err))
	}
	return 1
}

// errSaid is a failure the command that met it has already put on the screen.
var errSaid = errors.New("this command has already said what went wrong")

// `to` is where a command's own answer goes and `wrong` where a failure does, so that an operator
// who asked this binary a question can redirect the answer.
//
// **what is left on this process's own terminal is the four that hold the screen, and nothing
// else.** the password, placement and account prompts read the keyboard and draw over the terminal
// they hold (../../internal/terminal/prompt.go); the ledger draws over that screen and un-draws it
// again, taking the line it settles on and the diagnostic beside it with it
// (../../internal/terminal/ledger.go); the confirm in front of the one-way door erases the
// screen before it names what it would apply (../../internal/terminal/confirm.go); and the waits
// draw a spinner over the reads a screen stands on and un-draw it again — the ones behind the
// account picker's marks, and the ones between the account being picked and the screen after it
// (../../internal/terminal/waiting.go). none of the four is a thing an arbitrary writer could be, so
// each names this process's own stdout and stderr where it is reached (./start.go's ask, chainAt
// and carryAt, the door `start` itself puts, ./carried's question, ./lookingForDeployments and
// ./start.go's waitingOver and finishAt).
// every other line a command says takes `to`, so an operator redirecting what this binary answers
// keeps the run drawn where they are standing, which is the only place it means anything.
func run(args []string, to, wrong io.Writer) error {
	if len(args) == 0 {
		usage(wrong)
		return errors.New("name a command")
	}
	switch args[0] {
	case "start":
		return start(args[1:], to, wrong)
	case "update":
		return update(args[1:], to, wrong)
	case "open":
		return open(args[1:], to, wrong)
	case "login":
		return login(args[1:], to, wrong)
	case "logout":
		return logout(args[1:], to, wrong)
	case "version":
		return baked(args[1:], to, wrong)
	case "help", "-h", "--help":
		// asked for, so it is this binary answering rather than refusing: it goes where an answer
		// goes and ends the command clean.
		usage(to)
		return nil
	default:
		usage(wrong)
		return fmt.Errorf("no such command: %s", args[0])
	}
}

// the presses this binary answers to, in the order ./run reads them, and what each is for.
var commands = []struct{ takes, does string }{
	{"start [--port N] [--no-open]",
		"put this release on your deployment, then open the console at it"},
	{"update", "install the newest console on this machine"},
	{"open [--port N] [--no-open]", "serve the console and open it in a browser"},
	{"login", "sign in to Cloudflare, and choose the account this machine operates"},
	{"logout", "give up the sign-in this machine holds"},
	{"version", "what this binary is, and what it was baked for"},
}

// what this binary is, with the presses under it and what each of them is for beside it.
//
// **the column is counted over the words and never over what is drawn.** each press is set off as
// code (../../internal/terminal/ledger.go) and a tone is escape codes of no display width, so a
// column measured off the drawn span would be short by however many characters the terminal
// swallows — and the descriptions would land in as many different places as there are presses.
func usage(to io.Writer) {
	terminal.Say(to, terminal.Cmd()+" — the operator console")
	column := 0
	for _, one := range commands {
		column = max(column, utf8.RuneCountInString(one.takes)+2)
	}
	rows := make([]string, 0, len(commands))
	for _, one := range commands {
		rows = append(rows, "  "+terminal.Code(one.takes)+
			strings.Repeat(" ", column-utf8.RuneCountInString(one.takes))+one.does)
	}
	terminal.Lines(to, rows...)
}

// how a subcommand reads what was typed after its name.
//
// **one place, because three of the library's own defaults are wrong here.** `flag` writes a parse
// failure itself and then hands it back to be written again by ./exitCode, under a heading naming a
// set that may hold no flag at all; it answers `-h` with an error, which ends a command that was
// merely asked what it takes on a non-zero exit; and it walks past the first word that is not an
// option saying nothing (./read). so the library writes nothing and what a command says about its
// own arguments is written once, below.
type options struct {
	flags *flag.FlagSet
	// says is what this command takes, in its own words, drawn above the options themselves.
	says string
}

// what each command answers when it is asked what it takes, or handed something it does not know.
var (
	startTakes = terminal.Cmd("start") + " puts this release on your deployment and opens the " +
		"console at it: it stands one up where there is none, and offers to carry this release " +
		"onto one that is already behind. Before it carries it names every migration it would " +
		"apply to the live database and waits for your answer, and there is no flag that answers " +
		"for you: a migration cannot be undone. It takes:"
	openTakes = terminal.Cmd("open") + " serves the console against the deployment you already " +
		"have. It takes:"
	updateTakes = terminal.Cmd("update") + " takes no options. It installs the newest console on " +
		"this machine and deploys nothing: what puts a release on your deployment is " +
		terminal.Cmd("start") + "."
	// **the three that take nothing read what was typed after them all the same.** ./read is where
	// `-h` is answered and a word this command does not know is refused, and a command that skipped
	// it answers `better-giving logout -h` by revoking the sign-in this machine holds.
	loginTakes = terminal.Cmd("login") + " takes no options. It signs this machine in to " +
		"Cloudflare and takes the account every command after it runs under."
	logoutTakes = terminal.Cmd("logout") + " takes no options. It gives up the sign-in this " +
		"machine holds, at Cloudflare and on this machine."
	versionTakes = terminal.Cmd("version") + " takes no options. It says what this binary is and " +
		"what it was baked for."
)

func taking(name, says string) *options {
	return &options{flags: flag.NewFlagSet(name, flag.ContinueOnError), says: says}
}

// read parses `args` and answers whether the command goes on.
//
// False with no error is a help request: what the command takes was asked for and answered, which
// is not a run that failed. False with ./errSaid is an option this command does not know, named
// where a failure goes and named there once.
//
// **a word that is not an option is refused the same way, and that is the library's third wrong
// default.** `flag` stops at the first one and hands back no error at all, so a `--yes` typed past
// a `--` would reach ./start.go's one-way door having been read by nobody — and no command here
// takes an argument for it to have been.
func (taken *options) read(args []string, help, wrong io.Writer) (bool, error) {
	taken.flags.SetOutput(io.Discard)
	taken.flags.Usage = func() {}
	switch err := taken.flags.Parse(args); {
	case errors.Is(err, flag.ErrHelp):
		taken.say(help)
		return false, nil
	case err != nil:
		terminal.Say(wrong, fmt.Sprintf("%s: %v", terminal.Cmd(), err))
		taken.say(wrong)
		return false, errSaid
	case taken.flags.NArg() > 0:
		terminal.Say(wrong, fmt.Sprintf("%s: %s takes no argument, and was handed %q",
			terminal.Cmd(), terminal.Code(taken.flags.Name()), taken.flags.Arg(0)))
		taken.say(wrong)
		return false, errSaid
	default:
		return true, nil
	}
}

// what this command takes, with the options themselves under it.
func (taken *options) say(to io.Writer) {
	terminal.Say(to, taken.says)
	taken.flags.SetOutput(to)
	taken.flags.PrintDefaults()
}

// what an operator with nothing deployed is told, which is never a console.
var nothingToOpen = "nothing is deployed under the name " + release.Baked.Name +
	" in this account, so there is nothing for the console to read: run " + terminal.Cmd("start")

// the console served against the deployment this machine operates.
//
// **it refuses only where it is certain nothing is deployed**: a sign-in held, an account chosen,
// and cloudflare saying plainly that no worker of this deployment's name is in it. every screen
// under the bar is a reading of that worker, so what would be served is a page about nothing.
//
// **a read that did not land still serves, and that is the opposite of ./start.go.** that press
// refuses there because a remote migration is behind it and a door that does not close again is not
// one to walk through blind. this command puts nothing on the account
// at all, and the console is the screen an operator opens when something is wrong — so refusing on
// a cloudflare that would not answer would shut them out of the very thing that explains it.
//
// **signed out, or no account chosen, serves too.** the connect panel is what the page draws then,
// and reaching it is the whole reason for opening the console at that point.
func open(args []string, to, wrong io.Writer) error {
	taken := taking("open", openTakes)
	port := taken.flags.Int("port", defaultPort, "the loopback port to serve on")
	noOpen := taken.flags.Bool("no-open", false, "serve without opening a browser")
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	records, err := state.Open()
	if err != nil {
		return noStore(err)
	}
	flow := signIn(records)
	// a console closed mid-sign-in leaves no listener on the callback port behind.
	defer flow.Stop()

	ctx := context.Background()
	credential := flow.Credential(ctx)
	if certainlyNotDeployed(ctx, credential, account.New(records).Chosen(), cf.APIGet(credential)) {
		return errors.New(nothingToOpen)
	}

	// beside the address rather than at the top of the command: this one creates nothing and there
	// is nothing for the operator to stop, so the line is worth most standing next to the address
	// they are left looking at for the life of the run.
	sayNewer(ctx, to, releases.Source())
	return serve(records, flow, *port, !*noOpen, to, nil, true)
}

// what a machine with nowhere to keep what this console remembers is told.
//
// **one sentence for all five commands**, because it is one state: the account this machine
// operates, the Cloudflare sign-in and the session held open to the deployment all live in that
// directory, so a machine that has none is one no command here can run on.
//
// what is named is the directory the operator can state themselves: `os.UserConfigDir` failing is
// precisely the case in which there is no path to quote, and the raw words it wrote are the one
// thing this console did not choose (../../internal/state's HomeVar).
func noStore(err error) error {
	return fmt.Errorf("this console keeps what it remembers in this machine's configuration "+
		"folder and couldn't work out where that is, so nothing was changed. Set %s to a folder "+
		"it may write to, then run the command again: %v", terminal.Code(state.HomeVar), err)
}

// whether cloudflare says plainly that no worker of this deployment's name is in the account.
//
// **anything short of that definite no is false**, which is the whole of open's rule above: a
// machine holding no sign-in, one with no account chosen, and a read cloudflare did not answer are
// all consoles that go on being served.
// `reads` is bound to `credential` by the caller rather than taken from it here, which is what lets
// a case answer for an account without a cloudflare (./main_test.go).
func certainlyNotDeployed(
	ctx context.Context,
	credential cf.Credential,
	chosen *account.Choice,
	reads cf.Get,
) bool {
	if credential.Kind == cf.NoCredential || chosen == nil {
		return false
	}

	standing := effects.OwnAddress(ctx, deployment.Door{
		AccountID:  chosen.Account.ID,
		WorkerName: release.Baked.Name,
		Get:        reads,
	})
	return standing.Kind == deployment.NotDeployed
}

// names a console newer than this one, where there is one.
//
// **it can only print.** ../../internal/update bounds the read and answers every way it could go
// wrong with a value, so there is no path out of here that ends a command or holds it long: a
// github that is not answering is worth less than the command the operator typed.
//
// **it is `open`'s alone.** `start` puts the question and hands the run to what it installs
// (./carried), because a binary carries the bundle from its own bake and no other, and `update` is
// that install as a press of its own (./update.go); `open` deploys nothing, so naming where the
// newer console comes from is the whole of what it can do about one.
func sayNewer(ctx context.Context, to io.Writer, get cf.Get) {
	terminal.Say(to, newer(releases.Latest(ctx, get, version)))
}

// the same line as a value, or empty where this console is the current one.
//
// **it is a value because one caller does not print it at all.** the confirm in front of the
// one-way door erases the visible screen before it names what it would apply
// (../../internal/terminal/confirm.go), so a line printed ahead of that call is off the screen at
// the moment the operator answers — which is the moment it exists to inform. that caller draws it
// over the door instead (./start.go's carryingOver).
//
// **`start` reaches it in the two cases where the question is over**: a console another console
// installed and ran, still reading a release past its own (./nameIt), and a question this run could
// not put to anybody. every other newer reading leaves this process, is declined, or ends the
// command (./aboutTheConsole). `open` deploys nothing and draws it whenever there is one.
func newer(read releases.Read) string {
	if read.Kind != releases.Newer {
		return ""
	}
	return fmt.Sprintf(
		"version %s of this console is out: install it from %s to deploy what that release carries",
		read.Version, terminal.Code(read.Where))
}

// what `start` does about a console newer than this one, which is ask, and then install it and hand
// it the run.
//
// **it is the first thing that command does and everything else is behind it** (./start.go): no
// state store open, no loopback port claimed, no sign-in taken and nothing asked of cloudflare.
// ./asNewer replaces this process, so whatever a run did ahead of it is discarded with it — and a
// listener held across one is a port nothing gives back.
//
// **the question is put because the install carries the deployment with it.** a binary deploys only
// the bundle from its own bake (../../internal/release's BundleSource), so agreeing installs the
// newer console and hands it this same command — which is the release that then goes onto the
// deployment. an operator who has a reason to stay on this one says so and the run carries on.
//
// what comes back is the line naming that console, which the marked child alone has (./about):
// every other way past a newer reading answers where the reading was taken.
func carried(ctx context.Context, to io.Writer) (string, error) {
	read := releases.Latest(ctx, releases.Source(), version)
	return aboutTheConsole(read, releases.Marked(), to,
		func() terminal.Confirmation {
			return terminal.ConfirmNewer(os.Stdin, os.Stdout, read.Version)
		},
		func() error { return installed(ctx, read, to) })
}

// what a run does about the reading it took, with the question and the install bound by the caller.
//
// **a failure past an install ends the command and never falls through to a deploy.** the operator
// has three lines above them saying an install was happening, so a run that went on is the
// out-of-date code onto the deployment that this whole path exists to prevent.
//
// **a question nobody was standing at carries on and is not a failure.** it is the one prompt in
// this binary whose act can be undone — the operator installs the console they had back and nothing
// on their account moved — so a run ended here would cost them the press they typed to spare them
// something reversible. what it does instead is name the newer console where the question was
// (./newer), because nothing else in that run will.
func aboutTheConsole(
	read releases.Read,
	marked bool,
	to io.Writer,
	asking func() terminal.Confirmation,
	install func() error,
) (string, error) {
	switch about(read, marked) {
	case nameIt:
		return newer(read), nil
	case installIt:
		switch asking() {
		case terminal.Confirmed:
			return "", install()
		case terminal.Declined:
			return "", nil
		default:
			terminal.Say(to, newer(read))
			return "", nil
		}
	default:
		return "", nil
	}
}

// carrying is what a reading is worth doing about, and one of the three is nothing.
//
// It is what a reading is worth and never what was decided: the operator answers for the install
// itself (./aboutTheConsole), and this is what says whether there is anything to put to them.
type carrying string

const (
	// carryOn is a console that is current, or a reading nobody could take
	// (../../internal/update).
	carryOn carrying = "carry-on"
	// installIt is a newer console this run offers to install and hand itself to.
	installIt carrying = "install"
	// nameIt is a newer console read by a console that another console installed and ran.
	//
	// **it is named and never installed again.** the mark says an install has already happened in
	// this run's lineage, so a child still reading `Newer` installed somewhere this machine's PATH
	// does not reach — and a second install lands in the same place, reads the same release and
	// does it again, with nothing on the screen but the same three lines
	// (../../internal/update/install.go's UpdatedVariable).
	nameIt carrying = "name"
)

func about(read releases.Read, marked bool) carrying {
	if read.Kind != releases.Newer {
		return carryOn
	}
	if marked {
		return nameIt
	}
	return installIt
}

// the newer console downloaded, checked and put where this one is, with every part of it named as
// it lands.
//
// **what happens next is the caller's, because the two presses have different amounts left to do.**
// ./start.go hands the run to what was installed (./installed) and ./update.go has nothing left to
// run at all — so this ends at the file being in place, and the line naming the console now on this
// machine is written by whichever of the two is writing the rest of the run.
//
// The sentence a stop is reported with names the install line and `fix`'s own press, because both
// presses install this way and each is run again by a command of its own
// (../../internal/terminal/install.go).
func installing(
	ctx context.Context,
	read releases.Read,
	to io.Writer,
	fix terminal.Repair,
) (releases.Landed, error) {
	terminal.Say(to, terminal.InstallingNewer(read.Version))
	landed := releases.Install(ctx, read.Version, func(done releases.Step, at releases.Landed) {
		terminal.Line(to, terminal.InstallStep(done, at))
	})
	if landed.Kind != releases.Replaced {
		return landed, reported(terminal.InstallStopped(landed, fix), landed.Detail)
	}
	return landed, nil
}

// the newer console installed and handed this run, which is what `start` does about one.
//
// **it returns only where the operator is left on this binary**: every way the install can fail, and
// the exec that could not happen. on the way it works this process is already gone (./asNewer).
func installed(ctx context.Context, read releases.Read, to io.Writer) error {
	landed, err := installing(ctx, read, to, terminal.Starting)
	if err != nil {
		return err
	}
	terminal.Lines(to)
	terminal.Say(to, terminal.NowOn(read.Version))
	return asNewer(landed.Path, terminal.Starting)
}

// the newer console taking this run over, in this process and with the words it was typed with.
//
// **it is an exec and not a child process.** the console it replaces is holding the terminal the
// operator is standing at, and every prompt below reads that keyboard directly
// (../../internal/terminal/prompt.go): a process in between is a ctrl-c that reaches the wrong one
// and a run nobody can stop. macos and linux are the whole supported set
// (../../../../scripts/install.sh), which is what lets this be one call.
//
// os.Args goes over unchanged, so the newer console runs the command that was typed rather than one
// this one worked out. the mark on the environment is what stops it installing another
// (../../internal/update/install.go's UpdatedVariable).
func asNewer(console string, fix terminal.Repair) error {
	err := syscall.Exec(console, os.Args, releases.Marking(os.Environ()))
	// reached only where the exec did not happen: on the way it does, this process is already gone.
	return fmt.Errorf("this console installed %s and could not run it: %v. %s",
		terminal.Code(console), err, fix.Alone)
}

// serves the console on the loopback port and holds this process there until the operator stops it.
//
// One statement of what serving is, because two commands end in it: `open` is this and nothing
// else, and `start` is this once the deployment it opens on carries this release — stood up by that
// command, or found already standing and carried onto. The state directory and the sign-in are
// handed in rather than opened again, so one run holds one of each.
//
// `taken` is a loopback listener the caller already holds, and nil is this run taking one here.
// `start` takes its own in front of the deploy, on both the path that stands a deployment up and
// the path that carries this release onto one (./start.go's beforeTheDeploy), because a port
// something else is answering on is a failure that belongs in front of the one-way door rather than
// on the far side of it; every other way in has nothing to deploy and takes the port at the moment
// it serves.
//
// `naming` is whether this run's own line says whose cloudflare account the console is operating.
// False is the one way in that has just said it: a carry draws the account at the head of the
// door's screen and nothing erases that screen afterwards
// (../../internal/terminal/confirm.go's object), and ./start.go's catchingUp is what knows
// whether a door was drawn at all.
func serve(
	records state.Store,
	flow *oauth.Flow,
	port int,
	opening bool,
	to io.Writer,
	taken net.Listener,
	naming bool,
) error {
	// what a stop has to wait for: the presses this server holds outlive the requests that start
	// them, so nothing else on the machine knows one is running.
	presses := &server.Presses{}
	// the close press, as the one thing that ends this run from outside the terminal it was typed
	// in. the guard is here rather than in the handler: the page may be pressed twice, and closing
	// a channel that is already closed is a panic in this process.
	closed := make(chan struct{})
	var once sync.Once
	listening := server.Listen(server.New(server.Options{
		UI:       ui.Handler(),
		Version:  version,
		Commit:   commit,
		Flow:     flow,
		Accounts: account.New(records),
		Records:  records,
		Presses:  presses,
		Close:    func() { once.Do(func() { close(closed) }) },
	}), port)

	// the signal is taken before the server starts, so a ctrl-c arriving in the first moments of the
	// run is one this process ends on rather than one the default behaviour kills it on.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	browser := openBrowser
	if !opening {
		browser = nil
	}
	whose := ""
	if held := account.New(records).Chosen(); naming && held != nil {
		whose = held.Account.Name
	}
	bound := taken
	if bound == nil {
		var err error
		if bound, err = bind(to, listening.Addr, whose, browser); err != nil {
			return err
		}
	} else {
		saying(to, bound, whose, browser)
	}

	served := make(chan error, 1)
	// Serve and not ListenAndServe: the port is already this process's — taken above, or handed in
	// by a caller that took it earlier still — so that nothing claims the console is there until it
	// is.
	go func() { served <- listening.Serve(bound) }()

	select {
	case err := <-served:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		// the break above the word lands under the terminal's own `^C`, which the operator's
		// press leaves on the line the cursor is sitting on.
		terminal.Say(to, "\nstopping")
		// the signal is handed back before the wait rather than at the end of this function: while it
		// is diverted here every later interrupt is swallowed, and the second ctrl-c is the only way
		// out of a press that never ends.
		stop()
		return endRun(to, listening, presses)
	case <-closed:
		// the same end, asked for from the page rather than from this window: the operator closed
		// the console they were looking at, and this is the terminal that has to say so.
		terminal.Say(to, "the console was closed from its page, stopping")
		stop()
		return endRun(to, listening, presses)
	}
}

// takes the address this run serves on, and says where the console is once it is this process's.
//
// **the order is the whole of this function.** the address and the browser are this console's claim
// that it is there, so neither is spent until this process holds the port: a port something else is
// answering on would otherwise be that claim above a raw go net string, with a tab opened at
// whatever console is already there.
//
// **`at` is the address ../../internal/server's Listen states and this run spells none of its own.**
// that package declares the loopback-only binding its Guard rests on, and a second spelling here
// would be the live one with the declaration doing nothing.
//
// **what is said is read back off the listener rather than composed from `at`.** port 0 is the ask
// for whatever port is free, so the number this run is answering on is the kernel's answer to it
// and an address built from the ask names nothing at all.
//
// **the account is named in this line rather than in one of its own.** it is remembered between
// runs and drawn on no screen of a run that asks nothing, so `open` — which makes nothing — would
// otherwise serve every screen of a console without ever saying whose account those screens are
// about.
//
// **`whose` is empty where nothing is to be said, which is two different states.** this machine has
// chosen no account, which `open` serves on purpose; or the screen this line lands under has just
// named it, which is the carry door (./serve's `naming`). the line is the same either way — the
// account said once on a screen or not at all.
//
// `openAt` is nil where the run was told not to open a browser, which is the same claim without the
// tab.
func bind(to io.Writer, at, whose string, openAt func(string)) (net.Listener, error) {
	bound, err := claim(at)
	if err != nil {
		return nil, err
	}
	saying(to, bound, whose, openAt)
	return bound, nil
}

// takes the port and nothing else, which is what a caller that is not about to serve on it wants.
//
// ./start.go takes its listener in front of the deploy chain and hands it to ./serve minutes later,
// so the claim and the saying are two acts: the address said at the moment the port is taken would
// be a console that is not there for the length of a deploy.
func claim(at string) (net.Listener, error) {
	bound, err := net.Listen("tcp", at)
	if err != nil {
		return nil, unbound(at, err)
	}
	return bound, nil
}

// says where the console is, once this process holds the port it is answering on.
func saying(to io.Writer, bound net.Listener, whose string, openAt func(string)) {
	where := "http://" + bound.Addr().String()
	operating := ""
	if whose != "" {
		operating = ", operating Cloudflare account " + whose
	}
	terminal.Say(to, "the console is at "+terminal.Code(where)+operating+
		" — press ctrl-c to stop it")
	if openAt != nil {
		openAt(where)
	}
}

// why this run could not take the address it was asked to serve on.
//
// the errno and never the words: what a refused bind spells reads differently on each platform,
// and the one an operator meets is a console they already have running.
func unbound(at string, err error) error {
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("%s is in use, most likely by a console this machine is already "+
			"running: stop that one, or run this again with %s on another port",
			terminal.Code(at), terminal.Code("--port"))
	}
	return fmt.Errorf("this console could not listen on %s: %v", terminal.Code(at), err)
}

// ends this run: the press it is holding, and then the server.
//
// one statement of it because two things end a run — a ctrl-c in this terminal and the close press
// on the page — and what they wait for and how long they give the server are the same either way.
//
// **what survives the stop is said last of all.** DEPLOY.md tells the operator to leave the console
// running, which is the sentence that makes stopping it read as consequential — and the terminal is
// the only place that can say the deployment did not go with it.
func endRun(to io.Writer, listening *http.Server, presses *server.Presses) error {
	waitForPress(to, presses.Going, waited)
	closing, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	shut := listening.Shutdown(closing)
	terminal.Say(to, stillUp)
	return shut
}

// what a stop leaves behind, which is a deployment this process was never holding up.
//
// the relationship rather than a claim that a deployment is there: `open` serves a console on a
// machine that could not read the account at all (./open), so a line asserting a standing
// deployment would be a reading this run never took.
var stillUp = "your deployment runs on Cloudflare and stopping this console left it alone. " +
	"run " + terminal.Cmd("open") + " to bring the console back"

// how often a stop asks again whether the press it is waiting for has ended.
const waited = 500 * time.Millisecond

// waits for the press this process is holding, having named it once.
//
// **a deploy is a remote migration and then an upload, and the door between them is one way
// (CLAUDE.md).** a console that went away in that gap leaves the database ahead of the code that
// reads it, and the only place that can say so is the terminal it is being closed from — so a stop
// names what is running and stays until it ends.
//
// **the wait has no deadline of its own, and the way out of it is a second ctrl-c.** an upload takes
// the minutes it takes, and a stop that gave up on its own clock would be the failure it exists to
// prevent, arriving on time.
func waitForPress(to io.Writer, going func() (string, bool), every time.Duration) {
	said, running := going()
	if !running {
		return
	}
	terminal.Say(to, said+" — waiting for it to finish. press ctrl-c again to stop anyway")
	for {
		time.Sleep(every)
		if _, running := going(); !running {
			return
		}
	}
}

// the sign-in this machine holds, and the flow that changes it.
//
// One per run, built here rather than inside the server, because `login` and `logout` are the same
// sign-in reached without a server at all.
func signIn(records state.Store) *oauth.Flow {
	return oauth.New(oauth.Options{Store: records, Open: openBrowser})
}

// signs this machine in and takes the account every command after it runs under.
//
// The picker is here because the sign-in is: allowing it in a browser is what hands this machine a
// list of accounts, and an operator left holding one with no account chosen is one whose next press
// refuses. `start` puts the same question on every run of its own (./start.go), and this one is
// drawn without the row that signs this machine out: giving up a sign-in is not an ending for the
// press that takes one.
//
// **the browser is opened only where there is a sign-in to take**, which is ./insteadOfABrowser: a
// credential in the environment is one no browser sign-in could replace, and a sign-in this machine
// already holds is one there is no reason to take again. either way the picker is the whole of what
// this press still does, which is what the connect panel sends an operator here for.
//
// **it says what it recorded on the way out.** the picker erases the visible screen
// (../../internal/terminal/clear.go) and the sign-in's own line is printed above it, so a press
// that wrote a credential and an account to disk would otherwise end with nothing of its own on the
// screen — while `logout` confirms a smaller act.
func login(args []string, to, wrong io.Writer) error {
	taken := taking("login", loginTakes)
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	records, err := state.Open()
	if err != nil {
		return noStore(err)
	}
	flow := signIn(records)
	defer flow.Stop()

	ctx := context.Background()
	store := account.New(records)

	held, get := reading(ctx, flow)
	if line := insteadOfABrowser(flow.TokenSet(), held, store.Chosen()); line != "" {
		terminal.Say(to, line)
	} else {
		if given, err := allow(flow, records, "better-giving login", to); err != nil || !given {
			return err
		}
		held, get = reading(ctx, flow)
	}

	chosen, answered, err := choosing(ctx, held, get, store, to, terminal.Picker{})
	if err != nil || answered != terminal.AccountChosen {
		return err
	}
	terminal.Say(to, nowOperating(chosen))
	return nil
}

// what `login` says in place of the browser it does not open, and empty where a browser is what
// this press is.
//
// **a token in the environment is a credential a browser sign-in cannot replace.**
// ../../internal/oauth's Credential answers with that token ahead of any record this console holds,
// so a sign-in allowed in a browser here would be written down and then never read — with the
// operator told it worked and every call after it, the account list included, made as the token.
// its Out refuses the same case, names the same variable, and this follows it.
//
// **a sign-in this machine already holds is not taken again either.** the connect panel sends an
// operator here to record an account, and re-authorising in a browser to change one remembered
// value is bookkeeping this console can do without. what changes which identity is held is
// `logout`, and that is what the line names.
//
// a sign-in cloudflare turns down is neither: it is empty here, so the browser opens and this press
// is the repair it has always been.
func insteadOfABrowser(tokenSet bool, held signin.SignIn, chosen *account.Choice) string {
	if tokenSet {
		return terminal.Code(oauth.TokenVar) + " is set in this console's environment, so that " +
			"token is the sign-in every command here uses and a browser sign-in would not take " +
			"its place. Choose the account it reaches, or unset it and run " +
			terminal.Cmd("login") + " again."
	}
	if held.Kind != signin.OAuth && held.Kind != signin.Token {
		return ""
	}
	line := "this machine is already signed in to Cloudflare"
	if held.Email != nil {
		line += " as " + *held.Email
	}
	if chosen != nil {
		line += ", operating " + chosen.Account.Name
	}
	return line + ". Choose the account it operates, or run " + terminal.Cmd("logout") +
		" to sign in as somebody else."
}

// what `login` leaves on the screen, which is the account every command after it runs under.
func nowOperating(chosen account.Account) string {
	return "this machine is signed in to Cloudflare, and will operate " + chosen.Name
}

// allows this machine in a browser, and waits there until cloudflare has answered.
//
// Nothing about the credential is printed, here or anywhere: what a terminal is told is where the
// operator was sent and how it ended. A token in a scrollback is a token in a screen share and in
// whatever collects that machine's logs.
//
// **how it ended is a sentence and never the state's own word**
// (../../internal/terminal/signin.go), and the press it names is `command` — the caller's own,
// because a sign-in asked for by `start` is not repaired by `login`.
//
// **false with no error is the operator's own cancel**, which cloudflare reports as the request
// turned down (../../internal/oauth/flow.go): a press not made rather than a failure to report, as
// every closed prompt in this binary is (../../internal/terminal/prompt.go).
func allow(flow *oauth.Flow, records state.Store, command string, to io.Writer) (bool, error) {
	phase, _, err := flow.Start()
	if err != nil {
		return false, err
	}
	// the wait is stated because what follows this line is a poll that prints nothing for as long
	// as ../../internal/oauth waits, and an operator cannot tell that from a console that has hung.
	// how long that is comes off the flow rather than out of a sentence: the wait is overridable.
	terminal.Say(to, terminal.SignInWaiting(opensABrowser(), phase.Address, flow.Waits()))

	for {
		switch waiting := flow.Phase(); waiting.Name {
		case oauth.Idle:
			terminal.Say(to, "signed in")
			return true, nil
		case oauth.Unfinished:
			said := terminal.SignInUnfinished(waiting.Why, records.Dir(), command)
			if waiting.Why == oauth.Refused {
				terminal.Say(to, said)
				return false, nil
			}
			return false, errors.New(said)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// takes which cloudflare account this deployment is in, and records it.
//
// **the order is the browser handler's** (../../internal/server/account.go): the list is read off
// cloudflare rather than remembered, the operator picks from what it says now, the account is
// verified so that a refusal arrives here rather than at the first thing a deploy creates, and only
// then is it written down.
//
// **it is `start`'s picker and it carries three things ./login's does not**: the account this
// machine already operates, which the list opens on; the row that gives that sign-in up; and the
// accounts this deployment was found on, which mark their own rows. only a browser sign-in can be
// given up — a credential set in this console's environment is one ../../internal/oauth's Out
// refuses, and ./insteadOfABrowser says the same thing about the same case — so the row is offered
// on that kind alone.
//
// **the reads behind the marks are handed back as well as drawn**, because the account the operator
// picks is one of the ones they were made for: ./start.go's standingOn is what runs the pass under
// that pick against the reading this screen already took.
func chooseAccount(
	ctx context.Context,
	flow *oauth.Flow,
	store *account.Store,
	to io.Writer,
) (account.Account, effects.Addresses, terminal.Answered, error) {
	held, get := reading(ctx, flow)
	remembered := ""
	if chosen := store.Chosen(); chosen != nil {
		remembered = chosen.Account.ID
	}

	found := lookingForDeployments(ctx, get, held.Accounts)
	chosen, answered, err := choosing(ctx, held, get, store, to, terminal.Picker{
		Remembered: remembered,
		SignOut:    held.Kind == signin.OAuth,
		Deployed:   deployedIn(found),
	})
	return chosen, found, answered, err
}

// the reads that mark the picker's rows, with something on the screen while they are made.
//
// **the wait is drawn because these are the silent seconds this screen has.** they are one round
// trip per account and nothing else is happening, and a terminal showing nothing but a cursor reads
// as a console that has hung. it is given up in front of the picker, which draws a screen of its
// own (../../internal/terminal/clear.go).
//
// **it draws on this process's own terminal and never on `to`**, which is ./run's rule for every
// drawing that holds the screen: it stands in the seconds in front of the picker, and a wait drawn
// into a redirected run would leave the terminal the picker is about to draw over showing nothing.
func lookingForDeployments(
	ctx context.Context,
	get cf.Get,
	accounts []signin.Account,
) effects.Addresses {
	drawn := terminal.WaitingOn(os.Stdout, terminal.LookingForDeployments())
	defer drawn.Done()
	return effects.EachAddress(ctx, get, accounts)
}

// which of the accounts read the deployment was actually found on, which is the only reading the
// picker marks a row from.
//
// an account whose read said there is no deployment there is on the reading and off this list, and
// one nothing was found out about is on neither: both leave a row unmarked, because a row that
// carries nothing is this console saying nothing either way
// (../../internal/terminal/account.go's labelled).
func deployedIn(found effects.Addresses) []string {
	held := make([]string, 0, len(found))
	for id, standing := range found {
		if standing.Kind == deployment.Deployed {
			held = append(held, id)
		}
	}
	return held
}

// what this machine's sign-in reaches, and the read every call about it is made with.
//
// The two together because the second is bound to the credential the first was read on: a list
// drawn off one sign-in and verified against another would be two identities inside one press.
// ./login reads once and picks from what it read, so the reading is its own step.
func reading(ctx context.Context, flow *oauth.Flow) (signin.SignIn, cf.Get) {
	credential := flow.Credential(ctx)
	get := cf.APIGet(credential)
	return signin.Read(ctx, credential, flow.TokenSet(), get), get
}

// the picker, the verify and the writing down, over a sign-in that has already been read.
//
// The answer is handed back rather than acted on: a picker the operator closed and the row that
// signs this machine out are two different endings, and what each of them ends is the caller's
// (./login, ./start.go's operating).
func choosing(
	ctx context.Context,
	held signin.SignIn,
	get cf.Get,
	store *account.Store,
	to io.Writer,
	asked terminal.Picker,
) (account.Account, terminal.Answered, error) {
	if held.Kind != signin.OAuth && held.Kind != signin.Token {
		return account.Account{}, terminal.PickerClosed, unusableSignIn(held)
	}

	picked, answered, err := terminal.AskAccount(os.Stdin, os.Stdout, held, asked)
	if err != nil || answered != terminal.AccountChosen {
		return account.Account{}, answered, err
	}
	if !account.Verify(ctx, get, picked.ID) {
		return account.Account{}, terminal.PickerClosed, fmt.Errorf(
			"this sign-in may not act inside %s: ask an administrator of that account for "+
				"administrator access, or run %s to choose another account",
			picked.Name, terminal.Cmd("login"))
	}

	chosen := account.Account{ID: picked.ID, Name: picked.Name}
	// a machine the state directory cannot be written on still lets the operator carry on, and what
	// did not happen is the remembering (../../internal/account).
	if !store.Choose(chosen) {
		terminal.Say(to, "this machine could not write the account down, so it holds "+
			chosen.Name+" for this run alone")
	}
	return chosen, terminal.AccountChosen, nil
}

// what a machine holding no cloudflare sign-in is told, wherever it is met.
//
// One sentence because it is one state: every command that reaches cloudflare needs a sign-in and
// none of them can take one, so the act is the same wherever the absence is found.
var signedOut = "this machine holds no Cloudflare sign-in: run " + terminal.Cmd("login")

// why a sign-in carries no account list to choose from.
//
// The three are three different things to do: sign in, ask for access, or find out why cloudflare
// is not answering this machine.
func unusableSignIn(held signin.SignIn) error {
	switch held.Kind {
	case signin.SignedOut:
		return errors.New(signedOut)
	case signin.Refused:
		return fmt.Errorf("Cloudflare turned this sign-in down: %s", held.Detail)
	default:
		return fmt.Errorf("Cloudflare would not say what this sign-in reaches: %s", held.Detail)
	}
}

// gives up the sign-in this machine holds, at cloudflare and on disk.
func logout(args []string, to, wrong io.Writer) error {
	taken := taking("logout", logoutTakes)
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	records, err := state.Open()
	if err != nil {
		return noStore(err)
	}
	return signingOut(context.Background(), signIn(records), to)
}

// the act itself, which is this command and the row `start`'s picker draws (./start.go's
// operating).
//
// One statement of it because the two are one act: an operator who reached for the row rather than
// the command has given up the same sign-in, and a second spelling here is how the two come to
// leave this machine in different states.
func signingOut(ctx context.Context, flow *oauth.Flow, to io.Writer) error {
	if err := flow.Out(ctx); err != nil {
		return err
	}
	terminal.Say(to, "this machine no longer holds a Cloudflare sign-in")
	return nil
}

// what this binary is, and what it was baked for.
//
// it reads its arguments for ./loginTakes' reason: a command that takes nothing still answers what
// it takes, and a word it does not know is refused rather than passed over.
func baked(args []string, to, wrong io.Writer) error {
	taken := taking("version", versionTakes)
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	terminal.Lines(to,
		fmt.Sprintf("%s %s (%s)", terminal.Cmd(), version, commit),
		fmt.Sprintf("baked for worker %q, database %q, at %s",
			release.Baked.Name, release.Baked.DatabaseName, release.Baked.Commit))
	return nil
}

// opens the operator's browser at `at`, and says nothing where it cannot.
//
// the address is printed either way, which is the whole of what a failure here costs: a machine
// with no browser to open — an ssh session, a container — is one the operator reaches by hand.
func openBrowser(at string) {
	if command := browserOpener(at); command != nil {
		_ = command.Start()
	}
}

// the command that opens this machine's browser, and nil where this console knows of none.
//
// One list of platforms, because two things read it: what opens the tab, and what says which of the
// two sentences a sign-in in flight is drawn with (../../internal/terminal/signin.go). A second list
// would be a machine told a page had opened for it on the day the two drifted apart.
func browserOpener(at string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return opener("open", at)
	case "linux":
		return opener("xdg-open", at)
	default:
		return nil
	}
}

// `name` as a command this machine can actually run, and nil where it holds none.
//
// **the platform having a name for this is not the machine holding the command.** a headless linux
// box, or a container with no desktop on it, has no xdg-open: exec.Command looks the name up as it
// builds and keeps the failure on the value it hands back, so a caller that read the platform alone
// would answer "a Cloudflare page has opened in your browser" on a machine where nothing opened and
// nothing could (../../internal/terminal/signin.go).
func opener(name, at string) *exec.Cmd {
	opening := exec.Command(name, at)
	if opening.Err != nil {
		return nil
	}
	return opening
}

// whether this machine is one ./openBrowser opens a tab on.
func opensABrowser() bool { return browserOpener("") != nil }
