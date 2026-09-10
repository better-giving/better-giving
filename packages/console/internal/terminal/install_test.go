package terminal

import (
	"bytes"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/update"
)

// every part of an install that lands, declared here rather than read off ../update, which
// publishes no list of its steps: a step added there and not to ./install.go draws a blank line
// under the sentence that said an install was happening.
var steps = []update.Step{update.Downloaded, update.Checked, update.Installed}

// every way one can fail to land, declared for ./outcome_test.go's reason and held the same way.
var stoppedInstalls = []update.Put{
	update.NoAsset,
	update.Unreachable,
	update.Mismatched,
	update.Unreadable,
	update.Unwritable,
}

// what one install this file draws about is: the archive it went looking for and the file it was
// putting there.
var installing = update.Landed{
	Asset: "better-giving_darwin_arm64.tar.gz",
	Path:  "/Users/operator/.local/bin/better-giving",
}

func TestEveryPartOfAnInstallSaysWhatItDid(t *testing.T) {
	for _, done := range steps {
		said := InstallStep(done, installing)
		if said == "" {
			t.Errorf("the %q part of an install draws nothing at all", done)
		}
		if !strings.HasPrefix(said, "  ") {
			t.Errorf("%q stands level with the sentence it belongs under, want it drawn under one",
				said)
		}
	}
}

func TestThePartsOfAnInstallNameTheArchiveAndTheFileItWasPutIn(t *testing.T) {
	// the two facts an operator cannot work out for themselves: which of the release's archives
	// this machine took, and which of the consoles on their PATH it replaced.
	if said := InstallStep(update.Downloaded, installing); !strings.Contains(said, installing.Asset) {
		t.Errorf("said %q, want the archive that came down named", said)
	}
	if said := InstallStep(update.Installed, installing); !strings.Contains(said, installing.Path) {
		t.Errorf("said %q, want the file the console was put in named", said)
	}
}

func TestEveryWayAnInstallCanStopSaysWhatItLeftBehind(t *testing.T) {
	for _, kind := range stoppedInstalls {
		said := InstallStopped(update.Landed{Kind: kind, Asset: installing.Asset,
			Path: installing.Path}, Updating)
		if said == "" {
			t.Errorf("an install that ended %q says nothing at all", kind)
		}
		if !strings.Contains(said, release.InstallLine) {
			t.Errorf("an install that ended %q says %q, want the install line as the way through",
				kind, said)
		}
		if !strings.Contains(said, "nothing was deployed") {
			t.Errorf("an install that ended %q says %q, want what it left undone", kind, said)
		}
		if !strings.Contains(said, Updating.Alone) {
			t.Errorf("an install that ended %q says %q, want the press it belongs to named",
				kind, said)
		}
		if said == unaccountedInstall(Updating) {
			t.Errorf("an install that ended %q has no sentence of its own", kind)
		}
	}
}

func TestNoTwoWaysAnInstallCanStopShareOneSentence(t *testing.T) {
	// a release that publishes nothing for this machine and a download that did not land are
	// different things to do about: one of them will never work and the other may work on the next
	// try.
	seen := map[string]update.Put{}
	for _, kind := range stoppedInstalls {
		said := InstallStopped(update.Landed{Kind: kind, Asset: installing.Asset,
			Path: installing.Path}, Updating)
		if already, twice := seen[said]; twice {
			t.Errorf("%q and %q are told apart by nothing", already, kind)
		}
		seen[said] = kind
	}
}

func TestAnInstallThatLandedHasNothingToStopAbout(t *testing.T) {
	if said := InstallStopped(update.Landed{Kind: update.Replaced}, Updating); said != "" {
		t.Errorf("an install that landed says %q about not landing", said)
	}
}

func TestTheConsoleBeingInstalledAndTheOneNowRunningAreBothNamedByVersion(t *testing.T) {
	if said := InstallingNewer("0.0.1-alpha.2"); !strings.Contains(said, "0.0.1-alpha.2") {
		t.Errorf("said %q, want the release being installed named", said)
	}
	if said := NowOn("0.0.1-alpha.2"); !strings.Contains(said, "0.0.1-alpha.2") {
		t.Errorf("said %q, want the release now running named", said)
	}
}

func TestAConsoleThatCouldNotWorkOutWhichFileItRunsFromNamesNoDanglingOne(t *testing.T) {
	// ../update answers Unwritable for the machine that would not say what this process is
	// executing, and there is no path to quote for it: a sentence ending in "at , so" reads as a
	// value that went missing on the way here (./confirm.go's answering).
	said := InstallStopped(update.Landed{Kind: update.Unwritable, Asset: installing.Asset}, Updating)

	if strings.Contains(said, "at ,") || strings.Contains(said, " at  ") {
		t.Errorf("said %q, want no clause naming a file this console never worked out", said)
	}
	if said == "" {
		t.Error("an install that could not name the file it replaces says nothing at all")
	}
}

// the question a run puts before it installs a newer console over itself.
//
// installing one can be undone and an older console deploys older code, so the question stands on
// the install — which is the opposite of ./confirm.go's door and argued at each of them.

func TestTheConsoleQuestionDrawsNothingWhereNobodyIsStandingAtIt(t *testing.T) {
	// the opposite of ./confirm.go's door, which names its list either way: this question carries
	// no list, and the caller names the newer console itself on the way past
	// (../../cmd/better-giving/main.go's aboutTheConsole) — so a line here is the same news twice
	// in whatever file the run was redirected into.
	held := &bytes.Buffer{}
	said := ConfirmNewer(strings.NewReader("y"), held, "0.9.0")

	if said != Unattended {
		t.Errorf("ConfirmNewer over a reader nobody is at = %q, want %q", said, Unattended)
	}
	if held.String() != "" {
		t.Errorf("said %q at a run nobody is standing at, which its caller says again", held.String())
	}
}

func TestTheConsoleQuestionStandsOnTheInstall(t *testing.T) {
	put := updatingConsole("0.9.0")

	if !put.opens {
		t.Error("a return at the console question leaves this run on the older console, which " +
			"deploys the older code this question exists to keep off the deployment")
	}
	if !strings.Contains(put.title, "0.9.0") {
		t.Errorf("the title is %q, want the release it is about", put.title)
	}
}

// what a console that installed a newer one and has nothing left to run leaves on the screen.

func TestAnInstallWithNothingLeftToRunNamesTheVersionAndThePressThatDeploysIt(t *testing.T) {
	said := NowOnThenStart("0.9.0")

	if !strings.Contains(said, "0.9.0") {
		t.Errorf("said %q, want the release this machine now holds", said)
	}
	if !strings.Contains(said, "better-giving start") {
		t.Errorf("said %q, want the press that puts it on the deployment", said)
	}
}
