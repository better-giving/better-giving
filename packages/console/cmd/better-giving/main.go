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
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

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
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "better-giving: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return errors.New("name a command")
	}
	switch args[0] {
	case "start":
		return start(args[1:])
	case "update":
		return update(args[1:])
	case "open":
		return open(args[1:])
	case "login":
		return login()
	case "logout":
		return logout()
	case "version":
		fmt.Printf("better-giving %s (%s)\n", version, commit)
		fmt.Printf("baked for worker %q, database %q, at %s\n",
			release.Baked.Name, release.Baked.DatabaseName, release.Baked.Commit)
		return nil
	case "help", "-h", "--help":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("no such command: %s", args[0])
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `better-giving — the operator console

  start [--port N] [--no-open]  stand this deployment up, then open the console at it
  update                        carry this release's code onto the deployment you already have
  open [--port N] [--no-open]   serve the console and open it in a browser
  login                         sign in to cloudflare by allowing it in a browser
  logout                        give up the sign-in this machine holds
  version                       what this binary is, and what it was baked for
`)
}

// what an operator with nothing deployed is told, which is never a console.
var nothingToOpen = "nothing is deployed under the name " + release.Baked.Name +
	" in this account, so there is nothing for the console to read: run better-giving start"

// the console served against the deployment this machine operates.
//
// **it refuses only where it is certain nothing is deployed**: a sign-in held, an account chosen,
// and cloudflare saying plainly that no worker of this deployment's name is in it. every screen
// under the bar is a reading of that worker, so what would be served is a page about nothing.
//
// **a read that did not land still serves, and that is the opposite of ./start.go and
// ./update.go.** those two refuse there because a remote migration is behind them and a door that
// does not close again is not one to walk through blind. this command puts nothing on the account
// at all, and the console is the screen an operator opens when something is wrong — so refusing on
// a cloudflare that would not answer would shut them out of the very thing that explains it.
//
// **signed out, or no account chosen, serves too.** the connect panel is what the page draws then,
// and reaching it is the whole reason for opening the console at that point.
func open(args []string) error {
	flags := flag.NewFlagSet("open", flag.ContinueOnError)
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
	credential := flow.Credential(ctx)
	if certainlyNotDeployed(ctx, credential, account.New(records).Chosen(), cf.APIGet(credential)) {
		return errors.New(nothingToOpen)
	}

	// beside the address rather than at the top of the command: this one creates nothing and there
	// is nothing for the operator to stop, so the line is worth most standing next to the address
	// they are left looking at for the life of the run.
	sayNewer(ctx, os.Stdout, releases.Source())
	return serve(records, flow, *port, !*noOpen)
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
// what is named is an install and never a deploy — the binary carries the bundle from its own bake
// and no other — so the line says where the newer console comes from and what installing it buys.
func sayNewer(ctx context.Context, to io.Writer, get cf.Get) {
	read := releases.Latest(ctx, get, version)
	if read.Kind != releases.Newer {
		return
	}
	fmt.Fprintf(to,
		"version %s of this console is out: install it from %s to deploy what that release carries\n",
		read.Version, read.Where)
}

// serves the console on the loopback port and holds this process there until the operator stops it.
//
// One statement of what serving is, because two commands end in it: `open` is this and nothing
// else, and `start` is this after the deployment it opens on has been stood up. The state directory
// and the sign-in are handed in rather than opened again, so one run holds one of each.
func serve(records state.Store, flow *oauth.Flow, port int, opening bool) error {
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
	at := fmt.Sprintf("http://127.0.0.1:%d", port)

	// the signal is taken before the server starts, so a ctrl-c arriving in the first moments of the
	// run is one this process ends on rather than one the default behaviour kills it on.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	served := make(chan error, 1)
	go func() { served <- listening.ListenAndServe() }()

	fmt.Printf("the console is at %s — press ctrl-c to stop it\n", at)
	if opening {
		openBrowser(at)
	}

	select {
	case err := <-served:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		fmt.Println("\nstopping")
		// the signal is handed back before the wait rather than at the end of this function: while it
		// is diverted here every later interrupt is swallowed, and the second ctrl-c is the only way
		// out of a press that never ends.
		stop()
		return endRun(listening, presses)
	case <-closed:
		// the same end, asked for from the page rather than from this window: the operator closed
		// the console they were looking at, and this is the terminal that has to say so.
		fmt.Println("the console was closed from its page, stopping")
		stop()
		return endRun(listening, presses)
	}
}

// ends this run: the press it is holding, and then the server.
//
// one statement of it because two things end a run — a ctrl-c in this terminal and the close press
// on the page — and what they wait for and how long they give the server are the same either way.
func endRun(listening *http.Server, presses *server.Presses) error {
	waitForPress(os.Stdout, presses.Going, waited)
	closing, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return listening.Shutdown(closing)
}

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
	fmt.Fprintf(to, "%s — waiting for it to finish. press ctrl-c again to stop anyway\n", said)
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
// refuses. `start` picks only where this machine remembers none (./start.go).
func login() error {
	records, err := state.Open()
	if err != nil {
		return err
	}
	flow := signIn(records)
	defer flow.Stop()

	if err := allow(flow, records); err != nil {
		return err
	}
	_, _, err = chooseAccount(context.Background(), flow, account.New(records))
	return err
}

// allows this machine in a browser, and waits there until cloudflare has answered.
//
// Nothing about the credential is printed, here or anywhere: what a terminal is told is where the
// operator was sent and how it ended. A token in a scrollback is a token in a screen share and in
// whatever collects that machine's logs.
func allow(flow *oauth.Flow, records state.Store) error {
	phase, _, err := flow.Start()
	if err != nil {
		return err
	}
	fmt.Printf("allow it in your browser: %s\n", phase.Address)

	for {
		switch waiting := flow.Phase(); waiting.Name {
		case oauth.Idle:
			fmt.Println("signed in")
			return nil
		case oauth.Unfinished:
			if waiting.Why == oauth.NotKept {
				return fmt.Errorf("the sign-in was allowed and could not be kept in %s", records.Dir())
			}
			return fmt.Errorf("the sign-in did not finish: %s", waiting.Why)
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
// False with no error is the operator closing the picker, which is a choice not made rather than a
// failure to report.
func chooseAccount(
	ctx context.Context,
	flow *oauth.Flow,
	store *account.Store,
) (account.Account, bool, error) {
	credential := flow.Credential(ctx)
	get := cf.APIGet(credential)
	held := signin.Read(ctx, credential, flow.TokenSet(), get)
	if held.Kind != signin.OAuth && held.Kind != signin.Token {
		return account.Account{}, false, unusableSignIn(held)
	}

	picked, given, err := terminal.AskAccount(os.Stdin, os.Stdout, held.Accounts)
	if err != nil || !given {
		return account.Account{}, false, err
	}
	if !account.Verify(ctx, get, picked.ID) {
		return account.Account{}, false, fmt.Errorf(
			"this sign-in may not act inside %s: ask an administrator of that account for "+
				"administrator access, or run better-giving login to choose another account",
			picked.Name)
	}

	chosen := account.Account{ID: picked.ID, Name: picked.Name}
	// a machine the state directory cannot be written on still lets the operator carry on, and what
	// did not happen is the remembering (../../internal/account).
	if !store.Choose(chosen) {
		fmt.Printf("this machine could not write the account down, so it holds %s for this run alone\n",
			chosen.Name)
	}
	return chosen, true, nil
}

// what a machine holding no cloudflare sign-in is told, wherever it is met.
//
// One sentence because it is one state: every command but `login` needs a sign-in and none of them
// can take one, so the act is the same whether the absence was found in front of a picker or in
// front of a press (./update.go).
const signedOut = "this machine holds no cloudflare sign-in: run better-giving login"

// why a sign-in carries no account list to choose from.
//
// The three are three different things to do: sign in, ask for access, or find out why cloudflare
// is not answering this machine.
func unusableSignIn(held signin.SignIn) error {
	switch held.Kind {
	case signin.SignedOut:
		return errors.New(signedOut)
	case signin.Refused:
		return fmt.Errorf("cloudflare turned this sign-in down: %s", held.Detail)
	default:
		return fmt.Errorf("cloudflare would not say what this sign-in reaches: %s", held.Detail)
	}
}

// gives up the sign-in this machine holds, at cloudflare and on disk.
func logout() error {
	records, err := state.Open()
	if err != nil {
		return err
	}
	if err := signIn(records).Out(context.Background()); err != nil {
		return err
	}
	fmt.Println("this machine no longer holds a cloudflare sign-in")
	return nil
}

// opens the operator's browser at `at`, and says nothing where it cannot.
//
// the address is printed either way, which is the whole of what a failure here costs: a machine
// with no browser to open — an ssh session, a container — is one the operator reaches by hand.
func openBrowser(at string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", at)
	case "linux":
		command = exec.Command("xdg-open", at)
	default:
		return
	}
	_ = command.Start()
}
