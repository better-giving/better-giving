package terminal

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/first"
)

// the ledger as ./Marks states it: which row is closed, which the run is inside, and which it has
// not reached. every case here is that value and never a frame — what a frame carries beyond the
// marks is a spinner mid-turn and a tone, neither of which is a claim about a run.

// the marks a run makes of `rows` after reporting `reported` in order, and ending as `end` says.
func after(rows []Row, end End, reported ...reached) []Mark {
	drawn := drawing(rows)
	for _, report := range reported {
		drawn = drawn.folding(report)
	}
	return Marks(rows, drawn.at, end)
}

// a report of a stage that counts nothing, which is every one the chain owns.
func at(stage first.Stage) reached { return reached{stage: stage} }

func marks(held []Mark) string {
	words := make([]string, 0, len(held))
	for _, mark := range held {
		words = append(words, string(mark))
	}
	return strings.Join(words, " ")
}

func TestAChainRunClosesItsSixRowsOneAtATimeInTheChainsOrder(t *testing.T) {
	// the first stage lights the first row and closes nothing.
	same(t, "the chain at its first stage",
		marks(after(ChainRows, Underway, at(first.Stages[0]))),
		"working waiting waiting waiting waiting waiting")

	// the database is the second row, and the row in front of it is closed by the run being past it.
	same(t, "the chain at its database",
		marks(after(ChainRows, Underway, at(first.Stages[0]), at(first.Database))),
		"closed working waiting waiting waiting waiting")

	// every stage in turn ends on the last row running and the five before it closed.
	reported := []reached{}
	for _, stage := range first.Stages {
		reported = append(reported, at(stage))
	}
	same(t, "the chain at its last stage", marks(after(ChainRows, Underway, reported...)),
		"closed closed closed closed closed working")
}

func TestARedeployRunDrawsItsThreeRows(t *testing.T) {
	reported := []reached{}
	for _, stage := range DeployStages {
		reported = append(reported, at(stage))
	}
	same(t, "the redeploy at its last stage", marks(after(UpdateRows, Underway, reported...)),
		"closed closed working")
}

func TestAStageThatSkippedForwardClosesEveryRowBehindIt(t *testing.T) {
	// a row the run passed without a report of its own is a row that is finished, not one still
	// running: its running words are a claim about now and the run is already past it.
	same(t, "a skipped ledger",
		marks(after(ChainRows, Underway,
			at(first.Stage(deploy.Fetching)), at(first.Stage(deploy.Uploading)))),
		"closed closed working waiting waiting waiting")
}

func TestAStageReportedBehindTheRowAlreadyDrawnChangesNothing(t *testing.T) {
	// the ledger is never un-drawn: a row closed stays closed, so a late report of a stage under it
	// cannot take the run backwards past what an operator has already read.
	drawn := after(ChainRows, Underway,
		at(first.Stage(deploy.Uploading)),
		at(first.Stage(deploy.Fetching)),
		at(first.Database))

	same(t, "the ledger after a late report", marks(drawn),
		"closed closed working waiting waiting waiting")
}

func TestAStageNoRowCoversChangesNothing(t *testing.T) {
	// the redeploy's three rows cover the deploy engine's five, and the chain runs four more around
	// them that this ledger is not drawing.
	same(t, "the ledger for a stage no row covers",
		marks(after(UpdateRows, Underway, at(first.SigningIn))),
		"waiting waiting waiting")

	// and a stage no row covers does not un-draw the row the run is on either.
	same(t, "the ledger after a stage no row covers",
		marks(after(UpdateRows, Underway, at(first.Stage(deploy.Uploading)), at(first.Widget))),
		"closed closed working")
}

func TestARunThatLandedClosesEveryRow(t *testing.T) {
	same(t, "a landed ledger", marks(after(ChainRows, Landed, at(first.Stage(deploy.Fetching)))),
		"closed closed closed closed closed closed")
}

func TestAStoppedRunLeavesTheRowItStoppedOnUnclosed(t *testing.T) {
	// a press that stopped inside the upload never deployed to cloudflare, and a ledger that closed
	// its last row would say it did.
	same(t, "a stopped ledger",
		marks(after(ChainRows, Stopped,
			at(first.Stage(deploy.Fetching)), at(first.Stage(deploy.Uploading)))),
		"closed closed working waiting waiting waiting")
}

func TestARunThatStoppedBeforeReportingAnythingClosesNoRow(t *testing.T) {
	same(t, "a ledger nothing was reported to", marks(after(ChainRows, Stopped)),
		"waiting waiting waiting waiting waiting waiting")
}

func TestARowIsDrawnInTheWordsItsMarkPutsItIn(t *testing.T) {
	// the label is the whole statement: a row reads its running words until its work is behind the
	// run and its done words afterwards, with no status word beside either.
	drawn := drawing(ChainRows).folding(at(first.Database))
	said := drawn.View()
	for _, words := range []string{
		ChainRows[0].Done, ChainRows[1].Running, ChainRows[2].Running,
	} {
		if !strings.Contains(said, words) {
			t.Errorf("the ledger does not say %q: %q", words, said)
		}
	}
	if strings.Contains(said, ChainRows[0].Running) {
		t.Errorf("a closed row is still in its running words: %q", said)
	}
}

func TestARowCarriesTheShareTheStageCountsAndNoneWhereItCountsNothing(t *testing.T) {
	// the counted stages are the deploy engine's own — the bytes of a download, the migrations of a
	// file list, the buckets of an upload — and the four the chain owns are one call each. a share
	// drawn off a `Steps` of zero would be every one of those four claiming to be nought per cent
	// done for the whole of the moment they take.
	counted := drawing(ChainRows).folding(reached{
		stage: first.Stage(deploy.Fetching), step: 5, steps: 10,
	})
	if said := counted.View(); !strings.Contains(said, ChainRows[0].Running) || !strings.Contains(said, "50%") {
		t.Errorf("a counted row carries no share: %q", said)
	}

	uncounted := drawing(ChainRows).folding(at(first.Stage(deploy.Fetching)))
	if strings.Contains(uncounted.View(), "%") {
		t.Errorf("an uncounted row carries a share: %q", uncounted.View())
	}
}

func TestAStageThatCountsNothingClearsTheShareTheStageBeforeItCarried(t *testing.T) {
	// the download and the account read share one row: the first counts bytes and the second counts
	// nothing, so a share left standing would be the download's last reading under the read's words.
	drawn := drawing(ChainRows).
		folding(reached{stage: first.Stage(deploy.Fetching), step: 5, steps: 10}).
		folding(at(first.Stage(deploy.Checking)))
	if strings.Contains(drawn.View(), "%") {
		t.Errorf("the share outlived the stage that counted it: %q", drawn.View())
	}
}

func TestTheLedgerNamesNothingTheOperatorTyped(t *testing.T) {
	// the two things one press is made with are a password and a placement, and neither is a value
	// to print at somebody while it is in use — the password least of all, since it is the whole of
	// the deployment's credential entropy and a terminal keeps its scrollback (CLAUDE.md).
	drawn := drawing(ChainRows)
	for _, stage := range first.Stages {
		drawn = drawn.folding(reached{stage: stage, step: 3, steps: 9})
	}
	for _, typed := range []string{"correct horse battery staple", "weur", "eu"} {
		if strings.Contains(drawn.View(), typed) {
			t.Errorf("the ledger names %q", typed)
		}
	}
}

func TestTheProgramTakesEveryReportOnTheRunsOwnGoroutineAndEndsWhereItDoes(t *testing.T) {
	// what the pure marks above cannot say is that a report ever reaches them: the chain is
	// sequential and blocking on a goroutine of its own, and ./Ledger's At is the one call across
	// that seam. no sleep is needed to drive it — a report is handed to the program's own loop and
	// holds the run up until it is taken, which is what ../first says a watcher does.
	held := &bytes.Buffer{}
	drawn := Draw(ChainRows, held)
	go func() {
		drawn.Reporting(deploy.Progress{Stage: deploy.Fetching, Step: 2, Steps: 4})
		for _, stage := range first.Stages {
			drawn.At(stage, "", 0, 0)
		}
		drawn.Landed()
	}()
	if err := drawn.Show(); err != nil {
		t.Fatalf("Show = %v", err)
	}
	// the cheapest guard on ./Halted's wiring: a run that reported its end is over, and a caller
	// reading this one as a signal would wait on a press nobody is making.
	if drawn.Halted() {
		t.Error("a ledger the run ended was read as one a signal took")
	}

	for _, row := range ChainRows {
		if !strings.Contains(held.String(), row.Done) {
			t.Errorf("the ledger never said %q: %q", row.Done, held.String())
		}
	}
}

// a clock a case drives, so what a row's own timer says is a value rather than a wait.
type clock struct{ at time.Time }

func (held *clock) read() time.Time { return held.at }

func TestARunningRowSaysWhatItIsOnThenHowFarIntoItThenHowLongItHasBeenRunning(t *testing.T) {
	// three separate readings rather than a sentence, so each of them is omitted on its own where
	// the run has not said it.
	same(t, "a row on something, counted, and running a while",
		notes("the worker itself", "42%", "18s"), "  the worker itself  42%  18s")
	same(t, "a row on something and counting nothing", notes("the worker itself", "", ""),
		"  the worker itself")
	same(t, "a row counting and on nothing nameable", notes("", "42%", ""), "  42%")
	same(t, "a row that has said neither", notes("", "", ""), "")
}

func TestARunningRowCarriesWhatTheStageSaysItIsOn(t *testing.T) {
	drawn := drawing(UpdateRows).folding(reached{
		stage: first.Stage(deploy.Fetching), detail: "12.4 MB of 31.0 MB", step: 12, steps: 31,
	})
	if !strings.Contains(drawn.View(), "12.4 MB of 31.0 MB") {
		t.Errorf("the running row says nothing about what it is on: %q", drawn.View())
	}

	// and a stage that named nothing leaves the row in its own words alone.
	quiet := drawing(UpdateRows).folding(at(first.Stage(deploy.Fetching)))
	if strings.Contains(quiet.View(), "12.4") {
		t.Errorf("the detail outlived the stage that named it: %q", quiet.View())
	}
}

func TestATimerIsHowLongTheRowHasBeenRunningAndAppearsOnlyOnceThatIsWorthSaying(t *testing.T) {
	// **elapsed is a fact and never a share.** a row with nothing to count has nothing honest to
	// draw but its own age, and a bar that crept forward on a timer instead would be the estimate
	// this ledger refuses to make (./lines.go).
	started := time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC)
	ticking := &clock{at: started}
	drawn := drawing(ChainRows)
	drawn.now = ticking.read
	drawn = drawn.folding(at(first.Stages[0]))

	ticking.at = started.Add(2 * time.Second)
	same(t, "a row two seconds in", drawn.timer(), "")

	ticking.at = started.Add(18 * time.Second)
	same(t, "a row eighteen seconds in", drawn.timer(), "18s")
	if !strings.Contains(drawn.View(), "18s") {
		t.Errorf("the running row carries no timer: %q", drawn.View())
	}

	ticking.at = started.Add(64 * time.Second)
	same(t, "a row past the minute", drawn.timer(), "1m 04s")
}

func TestATimerIsTheRowsOwnAgeAndNotTheRunsSoItStartsAgainAtEveryRow(t *testing.T) {
	started := time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC)
	ticking := &clock{at: started}
	drawn := drawing(ChainRows)
	drawn.now = ticking.read
	drawn = drawn.folding(at(first.Stages[0]))

	ticking.at = started.Add(90 * time.Second)
	same(t, "a row a minute and a half in", drawn.timer(), "1m 30s")

	// the run moves to the next row, which has been running for none of that.
	drawn = drawn.folding(at(first.Database))
	same(t, "the row the run has just reached", drawn.timer(), "")

	ticking.at = started.Add(95 * time.Second)
	same(t, "that row five seconds in", drawn.timer(), "5s")
}

func TestAStageReportedUnderTheRowAlreadyDrawnLeavesItsTimerAlone(t *testing.T) {
	// the row is not reached again by a stage inside it, so its age is the whole time the operator
	// has been waiting on it rather than the time since its last stage.
	started := time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC)
	ticking := &clock{at: started}
	drawn := drawing(UpdateRows)
	drawn.now = ticking.read
	drawn = drawn.folding(at(first.Stage(deploy.Fetching)))

	ticking.at = started.Add(20 * time.Second)
	drawn = drawn.folding(at(first.Stage(deploy.Checking)))
	same(t, "a row whose second stage was reported", drawn.timer(), "20s")
}

// a ledger the terminal's own interrupt ended, told apart from one the run ended.
//
// the two are the same silent screen and mean opposite things: a run that reported its end is over,
// and a run whose ledger a signal took is still going — an upload the operator cannot see, on the
// far side of a one-way door (CLAUDE.md).

func TestALedgerTheRunEndedIsNotOneASignalTook(t *testing.T) {
	for _, end := range []End{Landed, Stopped} {
		drawn := drawing(ChainRows)
		drawn.end = end
		if halted(drawn, nil) {
			t.Errorf("a ledger the run ended as %q was read as a signal", end)
		}
	}
}

func TestALedgerASignalTookIsOneTheRunNeverEnded(t *testing.T) {
	// ctrl-c: the library's own handler catches it and ends the run with its own error.
	if !halted(drawing(ChainRows), tea.ErrInterrupted) {
		t.Error("a ctrl-c under a running ledger was read as a run that ended")
	}
	// a term signal quits the program instead, so the error is nil and the model is what says it:
	// the run never reported how it ended.
	if !halted(drawing(ChainRows), nil) {
		t.Error("a ledger quit with the run still going was read as a run that ended")
	}
}

func TestALedgerThatCouldNotBeDrawnAtAllIsNotASignal(t *testing.T) {
	// that one keeps its diagnostic: what the caller has to say about it is the terminal it could
	// not draw on, and not a press it is waiting for.
	if halted(nil, errors.New("could not open a new TTY")) {
		t.Error("a ledger that could not be drawn was read as a signal")
	}
}

func TestThePressALedgerLeftRunningIsNamedInTheOperatorsOwnWords(t *testing.T) {
	said := StillGoing("a deploy")
	if !strings.HasPrefix(said, "a deploy is still running") {
		t.Errorf("said %q, want the press named in the words the operator typed it as", said)
	}
	if !strings.Contains(said, "waiting for it to finish") {
		t.Errorf("said %q, want what this terminal is doing about it", said)
	}
	if !strings.Contains(said, "ctrl-c again") {
		t.Errorf("said %q, want the way out of the wait", said)
	}
}

// what a terminal is told once a ledger has ended, which is nothing in the ordinary case.
//
// the three readings ./Show and ./Halted leave a caller with, and the wiring both halves of `start`
// make of them (../../cmd/better-giving/start.go's chainAt and carryAt): the order is where a
// mistake would live, since a ledger a signal took is one ./Show answered with no error at all.

func TestALedgerThatCouldNotBeDrawnKeepsItsDiagnosticAndNamesNoPress(t *testing.T) {
	said, wrong := Settled(errors.New("could not open a new TTY"), false, "a deploy")

	if said != "" {
		t.Errorf("said %q about a press over a terminal that drew nothing", said)
	}
	if !strings.Contains(wrong, "could not open a new TTY") {
		t.Errorf("wrong = %q, want the terminal's own diagnostic kept", wrong)
	}
}

func TestALedgerASignalTookNamesThePressThatIsStillGoing(t *testing.T) {
	said, wrong := Settled(nil, true, "a deploy")

	if said != StillGoing("a deploy") {
		t.Errorf("said %q, want the press named as still running", said)
	}
	if wrong != "" {
		t.Errorf("wrong = %q, want a signal read as no failure", wrong)
	}
}

func TestALedgerTheRunEndedSaysNothingBesideTheRowsItDrew(t *testing.T) {
	said, wrong := Settled(nil, false, "a deploy")

	if said != "" || wrong != "" {
		t.Errorf("Settled = %q, %q, want the rows themselves to be what it said", said, wrong)
	}
}
