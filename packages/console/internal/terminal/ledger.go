package terminal

import (
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/first"
)

// the ledger a press draws in a terminal: the rows of ./lines.go, lit and closed as the run reports
// where it is.
//
// **one call per report, on the goroutine the run is on.** what the chain hands its watcher is a
// stage, what that stage is on, and a pair of counts (../first's `Effects.At`), and ./Ledger's At is
// that call — it takes no lock and starts no goroutine, handing the report to the program's own
// loop, so a call made while nothing is drawing holds the run up exactly as ../first says it does.
//
// **the ledger is never un-drawn.** a row closed is a sentence an operator has already read, so a
// report naming a stage under it changes nothing, and a report that jumped forward closes what it
// jumped over rather than leaving rows behind the run standing in their running words for ever.
//
// **what a row is drawn as is ./Marks, and it takes no writer, no clock and no terminal.** the
// frame is bubbletea's and every mark and tone is lipgloss's; the model below is the shell that
// folds a report into the one index those marks come from, so what a case asserts is which row is
// closed, which is running and which has not been reached rather than a frame with a spinner in it.
// the one clock in this file is the model's own and is handed in, so how long a row has been
// running is a value a case drives rather than a wait it sits through.

// Mark is how a row stands in the ledger.
type Mark string

const (
	// Waiting is a row the run has not reached, drawn in its running words because that is what it
	// is about to be doing.
	Waiting Mark = "waiting"
	// Working is the row the run is inside.
	Working Mark = "working"
	// Closed is a row whose work the run is past.
	Closed Mark = "closed"
)

// End is how a run finished, or Underway while it has not.
type End string

const (
	// Underway is a press still going.
	Underway End = "underway"
	// Landed is a press that reached its end, which closes every row.
	Landed End = "landed"
	// Stopped is a press that ended inside a row.
	//
	// That row stays in its running words: a press that stopped inside the upload never deployed to
	// cloudflare, and a ledger that closed its last row would say it did.
	Stopped End = "stopped"
)

// Marks is how each row stands, given the row the run is inside and how the run ended.
//
// `at` is the row the last report named, and -1 before any report named one. A row before it is
// closed whether or not a stage inside it was ever reported: its running words are a claim about
// now, and the run is already past it.
func Marks(rows []Row, at int, end End) []Mark {
	marks := make([]Mark, len(rows))
	for row := range marks {
		switch {
		case end == Landed || row < at:
			marks[row] = Closed
		case row == at:
			marks[row] = Working
		default:
			marks[row] = Waiting
		}
	}
	return marks
}

// every mark and every tone this package puts on a terminal.
//
// the colours are the terminal's own numbered eight, so what is drawn is whatever the operator has
// themed their terminal to. nothing here comes from packages/operator's tokens, which dress the
// browser surfaces and hold no value a terminal could spend (CLAUDE.md).
var (
	check   = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).SetString("✓")
	turning = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	dimmed  = lipgloss.NewStyle().Faint(true)
)

// what stands where a mark does not, so every row's words start in the same column.
const unmarked = " "

// reached is one report of the run's.
type reached struct {
	stage       first.Stage
	detail      string
	step, steps int
}

// ending is the run saying it is over, which is the last message the program takes.
type ending struct{ end End }

// the model the program draws: which row the run is in, how far into it, and how it ended.
type ledger struct {
	rows []Row
	// covered is which row each stage belongs to, so a report is one lookup.
	covered map[first.Stage]int
	// at is the row the last report named, and -1 before any report named one.
	at int
	// detail is what that report said the stage is on, and step and steps are its counts — both
	// carried through rather than recomputed here.
	detail      string
	step, steps int
	// since is when the run reached the row it is on, which is what its timer is drawn from. it is
	// the row's own and starts again at every row.
	since time.Time
	// now is the clock the timer is read off, so a case drives it rather than waiting on one.
	now  func() time.Time
	end  End
	spin spinner.Model
}

// the model a ledger opens on: no row reached, and every stage looked up to the row that draws it.
func drawing(rows []Row) ledger {
	covered := map[first.Stage]int{}
	for at, row := range rows {
		for _, stage := range row.Stages {
			covered[stage] = at
		}
	}
	return ledger{
		rows:    rows,
		covered: covered,
		at:      -1,
		now:     time.Now,
		end:     Underway,
		spin:    spinner.New(spinner.WithSpinner(spinner.Line), spinner.WithStyle(turning)),
	}
}

// folds one report into the row the run is in.
//
// A stage no row covers is ignored, which is what a ledger of the redeploy's three rows does with
// the stages the chain runs around them. So is a stage under the row already drawn.
//
// A row the run has just reached starts its timer, and a second stage inside the row it is already
// on does not: what the timer says is how long the operator has been waiting on that row.
func (drawn ledger) folding(report reached) ledger {
	row, covered := drawn.covered[report.stage]
	if !covered || row < drawn.at {
		return drawn
	}
	if row != drawn.at {
		drawn.since = drawn.now()
	}
	drawn.at, drawn.detail, drawn.step, drawn.steps = row, report.detail, report.step, report.steps
	return drawn
}

func (drawn ledger) Init() tea.Cmd { return drawn.spin.Tick }

func (drawn ledger) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch message := message.(type) {
	case reached:
		return drawn.folding(message), nil
	case ending:
		drawn.end = message.end
		return drawn, tea.Quit
	case spinner.TickMsg:
		spun, next := drawn.spin.Update(message)
		drawn.spin = spun
		return drawn, next
	}
	return drawn, nil
}

func (drawn ledger) View() string {
	said := &strings.Builder{}
	for row, mark := range Marks(drawn.rows, drawn.at, drawn.end) {
		said.WriteString(drawn.line(drawn.rows[row], mark))
		said.WriteByte('\n')
	}
	return said.String()
}

// one row: the mark its state puts in front of it, and the words that state puts it in.
func (drawn ledger) line(row Row, mark Mark) string {
	switch mark {
	case Closed:
		return check.String() + " " + row.Done
	case Working:
		said := row.Running
		// dimmed as one piece, so the row's own words lead and everything the run says beside them
		// reads as a note on it.
		if beside := notes(drawn.detail, share(drawn.step, drawn.steps), drawn.timer()); beside != "" {
			said += dimmed.Render(beside)
		}
		if drawn.end != Underway {
			// a run that ended inside a row makes no claim about that row either way, so the mark
			// it carried while the run was live goes with the run.
			return unmarked + " " + said
		}
		return drawn.spin.View() + " " + said
	default:
		return dimmed.Render(unmarked + " " + row.Running)
	}
}

// Ledger is one press's rows, drawn as the run reports where it is.
type Ledger struct {
	program *tea.Program
}

// Draw is a ledger of `rows`, drawn to `to`.
//
// It reads no input at all. What an operator presses while waiting on a run is the terminal's own
// interrupt, and a ledger holding the keyboard would put the terminal in raw mode and take that
// keystroke instead of the process.
func Draw(rows []Row, to io.Writer) *Ledger {
	return &Ledger{
		program: tea.NewProgram(drawing(rows), tea.WithOutput(to), tea.WithInput(nil)),
	}
}

// Show draws the ledger until the run says it landed or stopped, and blocks until then.
//
// The run is on a goroutine of its own: ../first's chain is sequential and blocking, so it reports
// back through the calls below while this end holds the terminal.
func (drawn *Ledger) Show() error {
	_, err := drawn.program.Run()
	return err
}

// At is where the run has got to, in the shape ../first reports it.
//
// `detail` is what the stage says it is on and is empty where it is on nothing nameable; `step` and
// `steps` are which part of how many where the stage counts them and both 0 where it does not — the
// deploy engine's own arithmetic, carried through rather than recomputed here.
func (drawn *Ledger) At(stage first.Stage, detail string, step, steps int) {
	drawn.program.Send(reached{stage: stage, detail: detail, step: step, steps: steps})
}

// Reporting is At in the shape internal/deploy hands a watcher, so the redeploy's three rows are
// drawn by the same ledger the chain's six are.
func (drawn *Ledger) Reporting(progress deploy.Progress) {
	drawn.At(first.Stage(progress.Stage), progress.Detail, progress.Step, progress.Steps)
}

// Landed closes every row and ends the ledger, which is what a press that reached its end has done
// to all of them.
func (drawn *Ledger) Landed() { drawn.program.Send(ending{end: Landed}) }

// Stopped ends the ledger where the run ended, leaving the row it was inside in its running words.
func (drawn *Ledger) Stopped() { drawn.program.Send(ending{end: Stopped}) }

// what a running row says beside its own words, each of them left out where the run has not said it.
//
// **two spaces between them and not one, because they are separate readings rather than a
// sentence**: what the stage is on, how far into it the run is, and how long the row has been
// running are three different claims, and the middle one is the only one that is about progress.
func notes(said ...string) string {
	beside := ""
	for _, note := range said {
		if note != "" {
			beside += "  " + note
		}
	}
	return beside
}

// how long the run has been on the row it is inside, or nothing where that is not worth saying yet.
func (drawn ledger) timer() string {
	if drawn.at < 0 || drawn.since.IsZero() {
		return ""
	}
	return timed(drawn.now().Sub(drawn.since))
}

// how long a row waits before it says how long it has been waiting.
//
// a row most presses are past in under a second would otherwise flicker a timer on and off in front
// of an operator reading the words above it.
const timerAfter = 3 * time.Second

// one row's age as it is drawn: `18s`, and `1m 04s` once it is past the minute.
//
// **it is a fact and not a share.** it says how long the operator has been waiting on this row and
// nothing about how far the row has got — which is what makes it honest to draw on the stages that
// count nothing at all (./lines.go).
func timed(taken time.Duration) string {
	if taken < timerAfter {
		return ""
	}
	whole := int(taken / time.Second)
	if whole < 60 {
		return strconv.Itoa(whole) + "s"
	}
	seconds := strconv.Itoa(whole % 60)
	if len(seconds) == 1 {
		seconds = "0" + seconds
	}
	return strconv.Itoa(whole/60) + "m " + seconds + "s"
}

// how far into a counted stage the run is, as one of ./notes, or nothing where the stage counts
// nothing.
//
// **one form for every stage, because this end knows nothing about what any of them is counting.**
// the download counts bytes, the migration counts files and the upload counts buckets, so a "3 of
// 7" that read well for one of them would be tens of millions for another. what says which of them
// a share is of is the detail drawn beside it, in the stage's own words (internal/deploy).
func share(step, steps int) string {
	if steps <= 0 || step < 0 {
		return ""
	}
	// the download's step is a byte count, which is past what a 32-bit int holds once multiplied.
	at := int64(step) * 100 / int64(steps)
	if at > 100 {
		at = 100
	}
	return strconv.FormatInt(at, 10) + "%"
}
