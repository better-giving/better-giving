package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
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
	// aliased for ./main.go's reason: `update` in this package is the command in ./update.go.
	releases "github.com/better-giving/console/internal/update"
)

// what a ctrl-c does about a press this process is still holding.
//
// the wait exists because the deploy's middle step is a one-way door: a console that went away
// between the migration and the upload leaves the database ahead of the code that reads it, and the
// terminal it was closed from is the only place that can say so.

func TestAStopWaitsForThePressStillGoingAndNamesItOnce(t *testing.T) {
	readings := 0
	going := func() (string, bool) {
		readings++
		return "a deploy is still running (migrating)", readings < 3
	}
	var said strings.Builder

	waitForPress(&said, going, time.Millisecond)

	if readings != 3 {
		t.Errorf("readings = %d, want a wait that ended with the press", readings)
	}
	if !strings.Contains(said.String(), "a deploy is still running (migrating)") {
		t.Errorf("said %q, want the press named", said.String())
	}
	if strings.Count(said.String(), "\n") != 1 {
		t.Errorf("said %q, want one line and not one per reading", said.String())
	}
}

func TestAStopWithNoPressGoingWaitsForNothingAndSaysNothing(t *testing.T) {
	var said strings.Builder

	waitForPress(&said, func() (string, bool) { return "", false }, time.Hour)

	if said.String() != "" {
		t.Errorf("said %q, want a stop that says nothing about presses nobody made", said.String())
	}
}

// what `open` refuses on, and what it goes on serving through.
//
// the console is the screen an operator opens when something is wrong, so the only refusal is a
// cloudflare that answered plainly that no worker of this deployment's name is in the account.

// cloudflare answering every read with one status and one of its own error codes.
func cloudflareSaying(t *testing.T, status, code int) cf.Get {
	t.Helper()
	answering := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"errors":  []any{map[string]any{"code": code, "message": "said"}},
		})
	}))
	t.Cleanup(answering.Close)
	return cf.JSONGet(answering.URL, nil)
}

// a machine holding a sign-in, and the account it chose.
var (
	signedIn    = cf.BearerCredential("a-token")
	inAnAccount = &account.Choice{Account: account.Account{ID: "an-account"}}
)

func TestOpenRefusesWhereCloudflareSaysNoWorkerOfThisNameIsThere(t *testing.T) {
	if !certainlyNotDeployed(t.Context(), signedIn, inAnAccount, cloudflareSaying(t, 404, 10007)) {
		t.Error("a definite no from cloudflare is the one reading open refuses on")
	}
}

func TestOpenServesOnAReadThatDidNotLand(t *testing.T) {
	// the opposite of start and update, which refuse here: a remote migration stands behind those
	// two, and nothing at all stands behind this one.
	unreachable := func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route"}
	}

	if certainlyNotDeployed(t.Context(), signedIn, inAnAccount, unreachable) {
		t.Error("a cloudflare that did not answer is not a deployment that is not there")
	}
	if certainlyNotDeployed(t.Context(), signedIn, inAnAccount, cloudflareSaying(t, 403, 10000)) {
		t.Error("a sign-in cloudflare turned down is not a deployment that is not there")
	}
}

func TestOpenServesAMachineSignedOutAndOneWithNoAccountChosen(t *testing.T) {
	asked := 0
	counting := func(context.Context, string) cf.Answer {
		asked++
		return cf.Answer{Kind: cf.Unreachable}
	}

	if certainlyNotDeployed(t.Context(), cf.Credential{Kind: cf.NoCredential}, inAnAccount, counting) {
		t.Error("signed out is the connect panel and never a refusal")
	}
	if certainlyNotDeployed(t.Context(), signedIn, nil, counting) {
		t.Error("no account chosen is the connect panel and never a refusal")
	}
	if asked != 0 {
		t.Errorf("cloudflare was asked %d times about a machine with nothing to ask it about", asked)
	}
}

// the one line a newer console is named on, and the silence every other reading is.

// github answering with one release.
func releasing(t *testing.T, tag string) cf.Get {
	t.Helper()
	forge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": tag})
	}))
	t.Cleanup(forge.Close)
	return cf.JSONGet(forge.URL, nil)
}

// this binary built as a tagged release rather than as the `dev` every `go build` here leaves.
func built(t *testing.T, as string) {
	t.Helper()
	held := version
	version = as
	t.Cleanup(func() { version = held })
}

func TestALaunchNamesAConsoleNewerThanThisOneOnceAndSaysWhereItComesFrom(t *testing.T) {
	built(t, "0.3.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, releasing(t, "v0.4.0"))

	if !strings.Contains(said.String(), "0.4.0") {
		t.Errorf("said %q, want the release that is newer named", said.String())
	}
	if !strings.Contains(said.String(), release.ReleasesPage) {
		t.Errorf("said %q, want where it is installed from", said.String())
	}
	if strings.Count(said.String(), "\n") != 1 {
		t.Errorf("said %q, want one line", said.String())
	}
}

func TestALaunchHoldingTheLatestReleaseSaysNothing(t *testing.T) {
	built(t, "0.4.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, releasing(t, "v0.4.0"))

	if said.String() != "" {
		t.Errorf("said %q, want nothing to install said as nothing", said.String())
	}
}

func TestAGithubThatWouldNotAnswerSaysNothingAndEndsNoCommand(t *testing.T) {
	built(t, "0.3.0")
	var said strings.Builder

	sayNewer(t.Context(), &said, func(context.Context, string) cf.Answer {
		return cf.Answer{Kind: cf.Unreachable, Detail: "no route"}
	})

	if said.String() != "" {
		t.Errorf("said %q, want a host this console can do without to cost the command nothing",
			said.String())
	}
}

// what a command answers about its own arguments, and what the top level does about that answer.
//
// asking a command what it takes is a question answered rather than a run that failed, and an
// option it does not know is one sentence rather than the same sentence twice.

func TestAskingASubcommandWhatItTakesEndsItWithNoError(t *testing.T) {
	var help, wrong strings.Builder
	taken := taking("start", startTakes)
	port := taken.flags.Int("port", defaultPort, "the loopback port to serve on")

	on, err := taken.read([]string{"-h"}, &help, &wrong)

	if on || err != nil {
		t.Errorf("read(-h) = %v, %v, want a command that ends having answered", on, err)
	}
	if !strings.Contains(help.String(), startTakes) {
		t.Errorf("said %q, want what the command takes", help.String())
	}
	if !strings.Contains(help.String(), "port") {
		t.Errorf("said %q, want the flags themselves listed", help.String())
	}
	if wrong.String() != "" {
		t.Errorf("wrote %q to stderr, want a question answered on stdout", wrong.String())
	}
	if *port != defaultPort {
		t.Errorf("port = %d, want the flag left as it was", *port)
	}
}

func TestAnOptionASubcommandDoesNotKnowIsNamedOnceUnderWhatItDoesTake(t *testing.T) {
	var help, wrong strings.Builder
	taken := taking("update", updateTakes)

	on, err := taken.read([]string{"--yes"}, &help, &wrong)

	if on {
		t.Error("a command went on past an option it does not know")
	}
	if !errors.Is(err, errSaid) {
		t.Errorf("read(--yes) = %v, want a failure the top level does not name again", err)
	}
	if !strings.Contains(wrong.String(), "yes") {
		t.Errorf("said %q, want the option that was not understood named", wrong.String())
	}
	if !strings.Contains(wrong.String(), updateTakes) {
		t.Errorf("said %q, want what this command does take", wrong.String())
	}
	if strings.Count(wrong.String(), "yes") > 1 {
		t.Errorf("said %q, want the option named once", wrong.String())
	}
	if help.String() != "" {
		t.Errorf("wrote %q to stdout, want a mistyped option on stderr", help.String())
	}

	var again strings.Builder
	if code := exitCode(&again, err); code != 1 {
		t.Errorf("exit = %d, want a command that did not run to be a failure", code)
	}
	if again.String() != "" {
		t.Errorf("the top level said %q about a failure already named", again.String())
	}
}

// the three commands that take no option of their own, which read their arguments all the same.
//
// what a command takes is a question, and the failure they hold shut is a command that answers it
// by doing the thing: unread, `logout -h` would revoke the sign-in this machine holds, and
// `login --help` or `login now` would open a browser.

func TestACommandTakingNoOptionsStillAnswersWhatItTakesAndDoesNothing(t *testing.T) {
	for _, asked := range []struct{ name, says string }{
		{"login", loginTakes},
		{"logout", logoutTakes},
		{"version", versionTakes},
	} {
		for _, help := range []string{"-h", "--help"} {
			var out, wrong strings.Builder

			err := run([]string{asked.name, help}, &out, &wrong)

			if err != nil {
				t.Errorf("%s %s = %v, want a command that ends having answered", asked.name, help, err)
			}
			if !strings.Contains(out.String(), asked.says) {
				t.Errorf("%s %s said %q, want what the command takes", asked.name, help, out.String())
			}
			if wrong.String() != "" {
				t.Errorf("%s %s said %q to stderr, want a question answered on stdout",
					asked.name, help, wrong.String())
			}
			// the act itself leaves a line of its own on every one of the three, so a press that ran
			// is one this case can see (./login, ./logout, ./baked).
			for _, ran := range []string{"signed in", "no longer holds", "baked for worker"} {
				if strings.Contains(out.String(), ran) {
					t.Errorf("%s %s said %q, want a question answered and nothing done",
						asked.name, help, out.String())
				}
			}
		}
	}
}

func TestAnArgumentTheseThreeDoNotTakeIsRefusedRatherThanRun(t *testing.T) {
	for _, typed := range [][]string{
		{"login", "--yes"},
		{"login", "now"},
		{"logout", "-f"},
		{"version", "--porcelain"},
	} {
		var out, wrong strings.Builder

		err := run(typed, &out, &wrong)

		if !errors.Is(err, errSaid) {
			t.Errorf("run(%v) = %v, want a command that did not run, named once", typed, err)
		}
		// `flag` spells an option back in its own one-dash form, so what is looked for is the word
		// rather than the dashes the operator typed.
		word := strings.TrimLeft(typed[1], "-")
		if !strings.Contains(wrong.String(), word) {
			t.Errorf("run(%v) said %q, want %q named", typed, wrong.String(), word)
		}
		if out.String() != "" {
			t.Errorf("run(%v) said %q to stdout, want a command that did not run on stderr",
				typed, out.String())
		}
	}
}

func TestVersionStillSaysWhatThisBinaryIsAndWhatItWasBakedFor(t *testing.T) {
	var out, wrong strings.Builder

	if err := run([]string{"version"}, &out, &wrong); err != nil {
		t.Fatalf("version = %v, want what this binary is", err)
	}
	for _, want := range []string{version, commit, release.Baked.Name, release.Baked.DatabaseName} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("said %q, want %q in it", out.String(), want)
		}
	}
	if wrong.String() != "" {
		t.Errorf("said %q to stderr, want an answer that can be redirected", wrong.String())
	}
}

func TestAFailureNoCommandNamedIsNamedByTheTopLevel(t *testing.T) {
	var said strings.Builder
	if code := exitCode(&said, errors.New("no such command: nope")); code != 1 {
		t.Errorf("exit = %d, want 1", code)
	}
	if !strings.Contains(said.String(), "better-giving: no such command: nope") {
		t.Errorf("said %q, want the failure named", said.String())
	}

	var quiet strings.Builder
	if code := exitCode(&quiet, nil); code != 0 || quiet.String() != "" {
		t.Errorf("a command that ran = %d, %q, want a clean exit saying nothing", code, quiet.String())
	}
}

func TestAnExplicitHelpIsWrittenWhereItCanBeRedirected(t *testing.T) {
	for _, asked := range [][]string{{"help"}, {"-h"}, {"--help"}} {
		var out, wrong strings.Builder
		if err := run(asked, &out, &wrong); err != nil {
			t.Errorf("run(%v) = %v, want a question answered", asked, err)
		}
		if !strings.Contains(out.String(), "better-giving — the operator console") {
			t.Errorf("run(%v) said %q to stdout, want what this binary does", asked, out.String())
		}
		if wrong.String() != "" {
			t.Errorf("run(%v) said %q to stderr, want an answer that can be redirected", asked,
				wrong.String())
		}
	}
}

func TestNoCommandAndACommandThisBinaryDoesNotKnowStayOnStderr(t *testing.T) {
	for _, asked := range [][]string{nil, {"deploy"}} {
		var out, wrong strings.Builder
		if err := run(asked, &out, &wrong); err == nil {
			t.Errorf("run(%v) = nil, want a command that did not run", asked)
		}
		if !strings.Contains(wrong.String(), "better-giving — the operator console") {
			t.Errorf("run(%v) said %q to stderr, want the commands there are", asked, wrong.String())
		}
		if out.String() != "" {
			t.Errorf("run(%v) said %q to stdout, want a failure on stderr", asked, out.String())
		}
	}
}

// the port this run serves on, taken before the console is said to be at it.
//
// the address and the browser are the claim that the console is there, and a port another process
// is holding is a claim that reads as a success while this run has nothing bound at all.

// a loopback port nothing is holding, and one that is held for the length of the case.
func freePort(t *testing.T) int {
	t.Helper()
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no loopback port to take: %v", err)
	}
	port := held.Addr().(*net.TCPAddr).Port
	if err := held.Close(); err != nil {
		t.Fatalf("the port could not be given back: %v", err)
	}
	return port
}

func TestAPortAnotherConsoleIsHoldingIsNamedAndNothingIsSaidOrOpened(t *testing.T) {
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no loopback port to take: %v", err)
	}
	t.Cleanup(func() { _ = held.Close() })
	at := held.Addr().String()

	var said strings.Builder
	opened := 0
	bound, err := bind(&said, at, "", func(string) { opened++ })

	if bound != nil {
		t.Error("a port another process is holding was answered with a listener")
	}
	if err == nil {
		t.Fatal("a port another process is holding was answered with no error")
	}
	if !strings.Contains(err.Error(), "--port") {
		t.Errorf("said %q, want the way onto another port named", err)
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("said %q, want the likely cause named", err)
	}
	if said.String() != "" {
		t.Errorf("said %q before the port was taken, want nothing", said.String())
	}
	if opened != 0 {
		t.Errorf("a browser was opened %d times at a console that is not there", opened)
	}
}

func TestAPortThisRunCanTakeIsHeldBeforeTheAddressIsSaid(t *testing.T) {
	// the address is the one internal/server states, which is where the loopback-only guarantee
	// its Guard rests on is declared: this run spells it nowhere of its own.
	stated := server.Listen(nil, freePort(t)).Addr
	var said strings.Builder
	at := ""

	bound, err := bind(&said, stated, "Acme Giving", func(address string) { at = address })

	if err != nil {
		t.Fatalf("bind = %v, want the port taken", err)
	}
	t.Cleanup(func() { _ = bound.Close() })
	if !strings.Contains(said.String(), "http://"+stated) {
		t.Errorf("said %q, want the address the console is at", said.String())
	}
	if !strings.Contains(said.String(), "ctrl-c") {
		t.Errorf("said %q, want how the operator stops it", said.String())
	}
	// the account is remembered between runs and drawn on no screen after the first, so `open` —
	// which asks nothing and makes nothing — would otherwise serve a console of readings without
	// ever saying whose account they are about.
	if !strings.Contains(said.String(), "Acme Giving") {
		t.Errorf("said %q, want the account this console is operating", said.String())
	}
	if at != "http://"+stated {
		t.Errorf("the browser was opened at %q, want the address that was said", at)
	}
}

func TestANoOpenRunSaysTheAddressAndOpensNothing(t *testing.T) {
	at := net.JoinHostPort("127.0.0.1", strconv.Itoa(freePort(t)))
	var said strings.Builder

	bound, err := bind(&said, at, "", nil)

	if err != nil {
		t.Fatalf("bind = %v, want the port taken", err)
	}
	t.Cleanup(func() { _ = bound.Close() })
	if !strings.Contains(said.String(), "http://"+at) {
		t.Errorf("said %q, want the address the console is at", said.String())
	}
}

func TestAnArgumentNoSubcommandTakesIsRefusedRatherThanPassedOver(t *testing.T) {
	// `flag` stops at the first word that is not an option and hands back no error, so a `--yes`
	// typed past a `--` would otherwise walk to `start`'s one-way door unread (./start.go).
	for _, command := range []struct {
		name, says string
		typed      []string
	}{
		{"start", startTakes, []string{"now"}},
		{"open", openTakes, []string{"now"}},
		{"update", updateTakes, []string{"--", "--yes"}},
	} {
		var help, wrong strings.Builder
		taken := taking(command.name, command.says)

		on, err := taken.read(command.typed, &help, &wrong)

		if on {
			t.Errorf("%s went on past an argument it does not take", command.name)
		}
		if !errors.Is(err, errSaid) {
			t.Errorf("%s read(%v) = %v, want a failure the top level does not name again",
				command.name, command.typed, err)
		}
		last := command.typed[len(command.typed)-1]
		if !strings.Contains(wrong.String(), last) {
			t.Errorf("%s said %q, want %q named", command.name, wrong.String(), last)
		}
		if !strings.Contains(wrong.String(), command.says) {
			t.Errorf("%s said %q, want what this command does take", command.name, wrong.String())
		}
		if help.String() != "" {
			t.Errorf("%s wrote %q to stdout, want a command that did not run on stderr",
				command.name, help.String())
		}
	}
}

func TestAPortTheKernelChoseIsSaidAndOpenedAsTheOneItChose(t *testing.T) {
	// port 0 is the ask for whatever port is free, so what this run is answering on is the kernel's
	// answer to it: an address composed from the number that was asked for names nothing at all,
	// and the browser is opened at it.
	var said strings.Builder
	at := ""

	bound, err := bind(&said, "127.0.0.1:0", "", func(address string) { at = address })

	if err != nil {
		t.Fatalf("bind = %v, want a free port taken", err)
	}
	t.Cleanup(func() { _ = bound.Close() })
	where := "http://" + bound.Addr().String()
	if !strings.Contains(said.String(), where) {
		t.Errorf("said %q, want %q — the port this run took", said.String(), where)
	}
	if strings.Contains(said.String(), "127.0.0.1:0") {
		t.Errorf("said %q, want no address nothing is listening on", said.String())
	}
	if at != where {
		t.Errorf("the browser was opened at %q, want %q", at, where)
	}
}

// what `login` does instead of opening a browser, and what it says on the way out.
//
// a browser sign-in allowed under CLOUDFLARE_API_TOKEN is a credential internal/oauth's Credential
// never reads: the token is answered with ahead of any record this console holds, so the operator
// allows access, is told "signed in", and every read after it — the account list included — is made
// as the token. its Out refuses the same case in the same words.

func TestLoginOpensNoBrowserWhereTheEnvironmentHoldsTheCredential(t *testing.T) {
	said := insteadOfABrowser(true, signin.SignIn{Kind: signin.Token}, nil)

	if said == "" {
		t.Fatal("a browser was opened for a credential internal/oauth would never read back")
	}
	if !strings.Contains(said, oauth.TokenVar) {
		t.Errorf("said %q, want the variable that is the credential named", said)
	}
	if !strings.Contains(said, "browser") {
		t.Errorf("said %q, want it stated that a browser sign-in would not take its place", said)
	}
}

func TestLoginOpensNoBrowserWhereThisMachineAlreadyHoldsAWorkingSignIn(t *testing.T) {
	address := "o@acme.test"
	said := insteadOfABrowser(false,
		signin.SignIn{Kind: signin.OAuth, Email: &address},
		&account.Choice{Account: account.Account{ID: "ac1", Name: "Acme Giving"}})

	if said == "" {
		t.Fatal("a sign-in this machine already holds was taken again in a browser")
	}
	if !strings.Contains(said, address) {
		t.Errorf("said %q, want the identity this machine is signed in as", said)
	}
	if !strings.Contains(said, "Acme Giving") {
		t.Errorf("said %q, want the account this machine operates", said)
	}
	if !strings.Contains(said, "better-giving logout") {
		t.Errorf("said %q, want the press that changes which identity is held", said)
	}
}

func TestLoginOpensABrowserOnAMachineHoldingNoSignInAtAll(t *testing.T) {
	if said := insteadOfABrowser(false, signin.SignIn{Kind: signin.SignedOut}, nil); said != "" {
		t.Errorf("said %q, want the browser sign-in this press exists to be", said)
	}
}

func TestLoginNamesTheAccountItRecordedOnTheWayOut(t *testing.T) {
	// the picker erases the visible screen, and the one line `allow` prints is above it: without
	// this, a press that wrote a credential and an account to disk ends saying nothing at all.
	said := nowOperating(account.Account{ID: "ac1", Name: "Acme Giving"})

	if !strings.Contains(said, "Acme Giving") {
		t.Errorf("said %q, want the account that was recorded", said)
	}
	if !strings.Contains(said, "signed in") {
		t.Errorf("said %q, want the sign-in confirmed the way logout confirms its own act", said)
	}
}

// what a stop leaves behind, and what a machine with nowhere to keep anything is told.

func TestStoppingTheConsoleSaysTheDeploymentIsUntouchedAndHowToComeBack(t *testing.T) {
	if !strings.Contains(stillUp, "Cloudflare") {
		t.Errorf("said %q, want where the deployment actually runs", stillUp)
	}
	if !strings.Contains(stillUp, "better-giving open") {
		t.Errorf("said %q, want the press that serves the console again", stillUp)
	}
}

func TestAMachineWithNowhereToKeepAnythingIsToldWhereAndWhatToDo(t *testing.T) {
	said := noStore(errors.New("no home directory")).Error()

	if !strings.Contains(said, state.HomeVar) {
		t.Errorf("said %q, want the directory it could be told to use named", said)
	}
	if !strings.Contains(said, "nothing was changed") {
		t.Errorf("said %q, want what did not happen", said)
	}
	if !strings.Contains(said, "no home directory") {
		t.Errorf("said %q, want what the machine itself said", said)
	}
}

// what opens the operator's browser, and what a machine holding no such command is told.
//
// the sentence a sign-in in flight is drawn with reads this (../../internal/terminal/signin.go): a
// linux box with no xdg-open on it, answered off the platform alone, is an operator reading that a
// Cloudflare page has opened while nothing opened and nothing could.

func TestACommandThisMachineDoesNotHoldIsNoBrowserOpener(t *testing.T) {
	if opening := opener("better-giving-no-such-browser-opener", "http://127.0.0.1:5320"); opening != nil {
		t.Errorf("opener = %v, want nothing where this machine holds no such command", opening.Args)
	}
}

func TestACommandThisMachineDoesHoldIsOne(t *testing.T) {
	// this test binary itself, by the path it was run from: a name with a separator in it is taken
	// as the file it names, so what is asserted is the reading and never a lookup that found nothing.
	held, err := os.Executable()
	if err != nil {
		t.Skipf("this machine will not say what it is running: %v", err)
	}
	if opener(held, "http://127.0.0.1:5320") == nil {
		t.Error("a command this machine holds was read as one it does not")
	}
}

// what a stop leaves on the screen, where an operator redirecting this binary's answers is looking.

func TestAStopSaysWhatItLeftBehindWhereTheAnswersGo(t *testing.T) {
	var said strings.Builder

	if err := endRun(&said, &http.Server{}, &server.Presses{}); err != nil {
		t.Fatalf("endRun = %v, want a server that was never serving shut cleanly", err)
	}
	if !strings.Contains(said.String(), stillUp) {
		t.Errorf("said %q, want what a stop leaves behind on the writer this run answers on",
			said.String())
	}
}

// what a reading of the release list is worth doing about.
//
// a binary deploys only the bundle from its own bake, so an operator deploying from an out-of-date
// console carries out-of-date code onto their deployment. what stands in front of that is this
// reading, and the one case it puts nothing to the operator is the console another console already
// installed and ran.

func TestAConsoleNewerThanThisOneIsWorthAskingAbout(t *testing.T) {
	if did := about(releases.Read{Kind: releases.Newer, Version: "0.0.2"}, false); did != installIt {
		t.Errorf("about a newer console = %q, want the operator asked: a run that only mentions one "+
			"deploys the old code anyway", did)
	}
}

func TestAConsoleAnotherOneInstalledNamesTheNewerReleaseRatherThanAskingAgain(t *testing.T) {
	// the loop guard: this child read a release past its own after an install has already happened
	// in this run's lineage, so installing again would land in the same place and read the same
	// release, forever.
	if did := about(releases.Read{Kind: releases.Newer, Version: "0.0.2"}, true); did != nameIt {
		t.Errorf("about a newer console read by a console another one installed = %q, want it "+
			"named and the command carried on", did)
	}
}

func TestAConsoleThatIsCurrentAndAReadingNobodyCouldTakeInstallNothing(t *testing.T) {
	for _, kind := range []releases.Kind{releases.Current, releases.Unknown} {
		for _, marked := range []bool{false, true} {
			if did := about(releases.Read{Kind: kind}, marked); did != carryOn {
				t.Errorf("about a %q reading = %q, want the command carried on untouched", kind, did)
			}
		}
	}
}

func TestOnlyANewerReleaseIsWorthALine(t *testing.T) {
	for _, kind := range []releases.Kind{releases.Current, releases.Unknown} {
		if line := newer(releases.Read{Kind: kind}); line != "" {
			t.Errorf("a %q reading draws %q, want nothing at all", kind, line)
		}
	}
	line := newer(releases.Read{Kind: releases.Newer, Version: "0.0.2", Where: "somewhere"})
	if !strings.Contains(line, "0.0.2") || !strings.Contains(line, "somewhere") {
		t.Errorf("said %q, want the release and where it is installed from", line)
	}
}

// what a run asks before it installs a console over itself, and the three ways past the question.
//
// installing one can be undone and nothing on the account has been touched when it is put, so a
// question nobody was standing at is not a refusal to report: what would be lost by carrying on is
// this release's code, and what would be lost by ending the command is the press the operator
// typed.

// a run of ./aboutTheConsole with the question answered and the install recorded rather than made.
type consoleReading struct {
	read     releases.Read
	marked   bool
	answered terminal.Confirmation
	asks     int
	installs int
	stopped  error
	said     strings.Builder
}

func (run *consoleReading) run() (string, error) {
	return aboutTheConsole(run.read, run.marked, &run.said,
		func() terminal.Confirmation {
			run.asks++
			return run.answered
		},
		func() error {
			run.installs++
			return run.stopped
		})
}

func aNewerConsoleRead() *consoleReading {
	return &consoleReading{
		read:     releases.Read{Kind: releases.Newer, Version: "0.9.0", Where: "somewhere"},
		answered: terminal.Confirmed,
	}
}

func TestAConsoleTheOperatorAgreedToIsInstalledAndHandedTheRun(t *testing.T) {
	run := aNewerConsoleRead()

	line, err := run.run()

	if err != nil {
		t.Fatalf("aboutTheConsole = %v, want the newer console installed", err)
	}
	if run.asks != 1 || run.installs != 1 {
		t.Errorf("asked %d times and installed %d, want one of each", run.asks, run.installs)
	}
	if line != "" {
		t.Errorf("held %q for a door the newer console will draw for itself", line)
	}
}

func TestAConsoleTheOperatorDeclinedLeavesTheRunOnThisBinary(t *testing.T) {
	run := aNewerConsoleRead()
	run.answered = terminal.Declined

	line, err := run.run()

	if err != nil {
		t.Fatalf("aboutTheConsole = %v, want a press not made read as no failure", err)
	}
	if run.installs != 0 {
		t.Error("a console the operator declined was installed anyway")
	}
	if line != "" || run.said.String() != "" {
		t.Errorf("said %q and held %q about a console they were just asked about", run.said.String(), line)
	}
}

func TestAQuestionNobodyWasAtLeavesTheRunOnThisBinaryHavingNamedTheNewerConsole(t *testing.T) {
	run := aNewerConsoleRead()
	run.answered = terminal.Unattended

	line, err := run.run()

	if err != nil {
		t.Fatalf("aboutTheConsole = %v, want a question nobody was put in front of to end no run", err)
	}
	if run.installs != 0 {
		t.Error("a console nobody agreed to was installed over the one running")
	}
	if line != "" {
		t.Errorf("held %q, want the line said where the question was, not at a door", line)
	}
	if !strings.Contains(run.said.String(), "0.9.0") {
		t.Errorf("said %q, want the newer console named on the way past", run.said.String())
	}
}

func TestAConsoleAnotherOneInstalledIsNamedAndNeverAskedAbout(t *testing.T) {
	run := aNewerConsoleRead()
	run.marked = true

	line, err := run.run()

	if err != nil {
		t.Fatalf("aboutTheConsole = %v, want the command carried on", err)
	}
	if run.asks != 0 || run.installs != 0 {
		t.Errorf("asked %d times and installed %d over a console another one installed and ran",
			run.asks, run.installs)
	}
	if !strings.Contains(line, "0.9.0") {
		t.Errorf("held %q, want the newer console named at the door this run reaches", line)
	}
}

func TestAConsoleThatIsCurrentIsNeitherAskedAboutNorNamed(t *testing.T) {
	for _, kind := range []releases.Kind{releases.Current, releases.Unknown} {
		run := aNewerConsoleRead()
		run.read = releases.Read{Kind: kind}

		line, err := run.run()

		if err != nil || line != "" || run.asks != 0 || run.installs != 0 {
			t.Errorf("a %q reading = %q, %v, asked %d, installed %d, want the run untouched",
				kind, line, err, run.asks, run.installs)
		}
	}
}

func TestAnInstallThatDidNotLandEndsTheRunRatherThanDeployingTheOlderCode(t *testing.T) {
	// three lines above it said an install was happening, and a binary deploys only the bundle from
	// its own bake: a run that went on from here is the out-of-date code onto the deployment that
	// this whole path exists to prevent.
	run := aNewerConsoleRead()
	run.stopped = errors.New("the archive that came down carries no console")

	if _, err := run.run(); err == nil {
		t.Fatal("an install that did not land fell through to the deploy behind it")
	}
}

// which rows the account picker marks, out of the reads it took.
//
// the mark says this deployment is on that account, so the only reading that earns one is the one
// that found it there. an account read as holding none and an account nothing was found out about
// both leave the row bare, because a row that carries nothing is this console saying nothing either
// way (../../internal/terminal/account.go).

func TestOnlyTheAccountTheDeploymentWasFoundOnIsMarked(t *testing.T) {
	marked := deployedIn(effects.Addresses{
		"ac1": {Kind: deployment.Deployed, WorkersDev: "https://one.workers.dev"},
		"ac2": {Kind: deployment.NotDeployed},
	})

	if len(marked) != 1 || marked[0] != "ac1" {
		t.Errorf("the picker marks %v, want the account holding the deployment alone", marked)
	}
}

func TestReadsThatFoundOutNothingMarkNothing(t *testing.T) {
	// a read that did not land is off the reading itself, so what this has to answer is an empty
	// one: every row bare, and no row saying a deployment is not there.
	if marked := deployedIn(effects.Addresses{}); len(marked) != 0 {
		t.Errorf("the picker marks %v off reads that landed for no account", marked)
	}
}
