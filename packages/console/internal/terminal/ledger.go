package terminal

import (
	"errors"
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
// folds a report into the one place those marks are read from, so what a case asserts is which row
// is closed, which is running and which has not been reached rather than a frame with a spinner in
// it. a row's children are marked by that same call over that row's own list, so a child is closed,
// running or waiting by the same reading (./lines.go argues which rows have them). the one clock in
// this file is the model's own and is handed in, so how long a line has been running is a value a
// case drives rather than a wait it sits through.

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
//
// It is read of a row's children as well, over that row's own list and the child the run is inside,
// which is the same reading one line further in.
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

// what a child is drawn in from, so its own mark sits under its parent's words.
const nested = "  "

// place is where a report landed: the row, and which of that row's children where it has them.
//
// `child` is -1 for a row that covers its own stages, which is every row without children
// (./lines.go holds a row to one or the other). A place is read in the order the run reaches it,
// which is why a row's children are numbered from 0 and a row without them is not.
type place struct{ row, child int }

// nowhere is the place a ledger opens on, which is no row reached.
var nowhere = place{row: -1, child: -1}

// whether `one` is behind `other`, which is a report the ledger is already past.
func behind(one, other place) bool {
	if one.row != other.row {
		return one.row < other.row
	}
	return one.child < other.child
}

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
	// covered is where each stage is drawn, so a report is one lookup.
	covered map[first.Stage]place
	// at is where the last report landed, and ./nowhere before any report landed.
	at place
	// detail is what that report said the stage is on, and step and steps are its counts — both
	// carried through rather than recomputed here.
	detail      string
	step, steps int
	// since is when the run reached the line it is on, which is what that line's timer is drawn
	// from. it is that line's own and starts again at every one of them, a child included.
	since time.Time
	// now is the clock the timer is read off, so a case drives it rather than waiting on one.
	now  func() time.Time
	end  End
	spin spinner.Model
}

// the model a ledger opens on: no row reached, and every stage looked up to the line that draws it.
func drawing(rows []Row) ledger {
	covered := map[first.Stage]place{}
	for at, row := range rows {
		for _, stage := range row.Stages {
			covered[stage] = place{row: at, child: -1}
		}
		for under, child := range row.Children {
			for _, stage := range child.Stages {
				covered[stage] = place{row: at, child: under}
			}
		}
	}
	return ledger{
		rows:    rows,
		covered: covered,
		at:      nowhere,
		now:     time.Now,
		end:     Underway,
		spin:    spinner.New(spinner.WithSpinner(spinner.Line), spinner.WithStyle(turning)),
	}
}

// folds one report into the line the run is in.
//
// A stage no row covers is ignored, which is what a ledger of the redeploy's three rows does with
// the stages the chain runs around them. So is a stage behind the line already drawn.
//
// A line the run has just reached starts its timer, and a second stage inside the line it is
// already on does not: what the timer says is how long the operator has been waiting on that line.
// A row's children are lines of their own by this reading, so the run moving from one to the next
// starts the next one's timer.
func (drawn ledger) folding(report reached) ledger {
	where, covered := drawn.covered[report.stage]
	if !covered || behind(where, drawn.at) {
		return drawn
	}
	if where != drawn.at {
		drawn.since = drawn.now()
	}
	drawn.at, drawn.detail, drawn.step, drawn.steps = where, report.detail, report.step, report.steps
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

// the ledger as it stands: every row, and under the one the run is inside its children where it has
// them.
//
// **a row's children are drawn only while that row is the one the run is inside.** they are what it
// is made of rather than things beside it, so a ledger past them is one line for the whole wait —
// which is the shape a finished ledger has always had (./lines.go).
func (drawn ledger) View() string {
	said := &strings.Builder{}
	for row, mark := range Marks(drawn.rows, drawn.at.row, drawn.end) {
		held := drawn.rows[row]
		// a row with children says nothing beside its own words: the children carry the counting,
		// and the same reading drawn on both would be one claim made twice, a line apart.
		beside := ""
		if mark == Working && len(held.Children) == 0 {
			beside = drawn.beside()
		}
		said.WriteString(drawn.line(held, mark, "", beside))
		said.WriteByte('\n')
		if mark != Working {
			continue
		}
		for under, childMark := range Marks(held.Children, drawn.at.child, drawn.end) {
			beside := ""
			if childMark == Working {
				beside = drawn.beside()
			}
			said.WriteString(drawn.line(held.Children[under], childMark, nested, beside))
			said.WriteByte('\n')
		}
	}
	return said.String()
}

// what the line the run is inside says beside its own words, in the tones each reading is drawn in.
//
// each note in its own tone rather than the block in one, so that the line's own words lead and
// everything the run says beside them reads as a note on it. the bar carries two tones of its own
// and could not be nested inside a third: a style ends at its own reset, which would take the
// dimming off everything drawn after it.
func (drawn ledger) beside() string {
	return notes(
		toned(dimmed, drawn.detail),
		counting(drawn.step, drawn.steps),
		toned(dimmed, drawn.timer()),
	)
}

// one line: the mark its state puts in front of it, the words that state puts it in, and what the
// run says beside them where it is the line the run is inside.
//
// `under` is what the line is drawn in from, which is nothing for a row and ./nested for a child.
func (drawn ledger) line(row Row, mark Mark, under, beside string) string {
	switch mark {
	case Closed:
		return under + check.String() + " " + row.Done
	case Working:
		said := row.Running + beside
		if drawn.end != Underway {
			// a run that ended inside a row makes no claim about that row either way, so the mark
			// it carried while the run was live goes with the run.
			return under + unmarked + " " + said
		}
		return under + drawn.spin.View() + " " + said
	default:
		return dimmed.Render(under + unmarked + " " + row.Running)
	}
}

// Ledger is one press's rows, drawn as the run reports where it is.
type Ledger struct {
	program *tea.Program
	// stopped is whether the drawing ended on a signal rather than on the run saying how it ended,
	// written by ./Show and read by the command it hands the terminal back to.
	stopped bool
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
//
// **a signal that took the drawing is not an error to report, and ./Halted is how the caller
// hears about it.** the library's own words for one name the program rather than the press, and
// what an operator at that terminal has to be told is that the run is still going.
func (drawn *Ledger) Show() error {
	final, err := drawn.program.Run()
	drawn.stopped = halted(final, err)
	if drawn.stopped {
		return nil
	}
	return err
}

// Halted is whether the drawing ended on a signal rather than on the run saying how it ended, which
// is a press still running with nothing left drawing it. False until ./Show has returned.
func (drawn *Ledger) Halted() bool { return drawn.stopped }

// whether the ledger stopped on something other than the run reporting its end.
//
// **two readings, because the two signals arrive differently.** the library takes them both while
// this ledger draws (it holds no input of its own, so nothing else can): a ctrl-c ends Run with its
// own error, and a term signal quits the program with no error at all — so what settles that one is
// the model handed back, which carries an end only where the run reported one.
//
// **an error of any other kind is a ledger that could not be drawn and is not this.** that terminal
// gets its diagnostic and the run behind it is answered for as it always was.
func halted(final tea.Model, err error) bool {
	if errors.Is(err, tea.ErrInterrupted) {
		return true
	}
	if err != nil {
		return false
	}
	drawn, ours := final.(ledger)
	return ours && drawn.end == Underway
}

// StillGoing is what a terminal says about the press a signal left running: the press in the words
// the operator typed it as, the wait this stop is making of it, and the way out of that wait.
//
// The same statement as ../../cmd/better-giving's waitForPress, at the other end of the same
// argument: an upload takes the minutes it takes, and a console that went away inside one leaves
// the database ahead of the code that reads it (CLAUDE.md).
func StillGoing(press string) string {
	return press + " is still running — waiting for it to finish. press ctrl-c again to stop anyway"
}

// Settled is what a terminal is told once a ledger has ended: the line the press it left running
// puts there, and the diagnostic a terminal it could not be drawn on left behind. Both are empty in
// the ordinary case, which is a run that reported its end — the rows themselves are what that one
// said.
//
// One statement of it because both halves of `start` make the same three readings of ./Show and
// ./Halted (../../cmd/better-giving/start.go's chainAt and carryAt), and the order is where a
// mistake would live: a ledger a signal took is one ./Show answered with no error at all.
//
// **the ledger is the drawing and not the run:** a terminal it could not be drawn on leaves the
// press going, and the wait the caller makes after this is still what says how it ended.
//
// **a ctrl-c took the drawing and the press carries on with nothing drawing it, so the wait under
// it says itself:** the door in the middle of one of these is one way (CLAUDE.md), and a silent
// terminal through an upload is where a second ctrl-c gets pressed.
//
// `press` is the run in the words the operator typed it as, as ./StillGoing takes it.
func Settled(shown error, halted bool, press string) (said, wrong string) {
	switch {
	case shown != nil:
		return "", shown.Error()
	case halted:
		return StillGoing(press), ""
	default:
		return "", ""
	}
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

// how long the run has been on the line it is inside, or nothing where that is not worth saying
// yet.
func (drawn ledger) timer() string {
	if drawn.at.row < 0 || drawn.since.IsZero() {
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

// how many cells a row's bar is drawn from.
//
// it stands among ./notes beside a row's own words rather than on a line of its own, so it is short
// enough to leave the detail and the timer beside it on one line of an ordinary terminal.
const barCells = 12

// the cells a bar is drawn from: the ones the run is past, and the ones it is not.
const (
	barFull  = "\u2501"
	barEmpty = "\u2500"
)

// how far into a counted stage the run is, drawn and said, as one of ./notes.
//
// **the bar and the share are one note and not two**, because how far into the row the run has got
// is one claim: the figure states it and the bar is the same claim at a glance. what they are drawn
// from is ./share alone, so neither can say what the other does not.
func counting(step, steps int) string {
	said := share(step, steps)
	if said == "" {
		return ""
	}
	return bar(step, steps) + " " + toned(dimmed, said)
}

// the bar a counted stage carries, as many cells full as the run is through it.
//
// **a stage that has counted every step draws every cell.** a bar last seen part full under a row
// that then turns into a check reads as a job something interrupted, and every stage this ledger
// counts reports its own last step at the whole of it (../deploy, ../migrate). the arithmetic
// truncates exactly as ./share does, so the last cell fills where the last per cent does and the
// two never disagree.
func bar(step, steps int) string {
	full := 0
	if steps > 0 && step > 0 {
		// int64 for ./share's reason: the download's step is a byte count, and multiplying it is
		// past what a 32-bit int holds.
		full = min(int(int64(step)*barCells/int64(steps)), barCells)
	}
	return toned(turning, strings.Repeat(barFull, full)) +
		toned(dimmed, strings.Repeat(barEmpty, barCells-full))
}

// one note in its own tone, and nothing at all where there is no note to draw.
//
// a style rendered over an empty string is a pair of escape codes around nothing, which ./notes
// would then space the row's words away from.
func toned(style lipgloss.Style, said string) string {
	if said == "" {
		return ""
	}
	return style.Render(said)
}

// how far into a counted stage the run is as a figure, or nothing where the stage counts nothing.
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
