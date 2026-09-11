package terminal

import (
	"io"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// the drawing that stands over a wait with nothing to report.
//
// **it exists because a terminal showing nothing but a cursor reads as a console that has hung.**
// ./ledger.go draws a run that says where it has got to; this is for the waits that say nothing at
// all until they are over — the reads behind the account picker's marks, and whatever else a later
// press waits on — so what it puts on the screen is one sentence and the spinner beside it.
//
// **it takes no sentence of its own and knows nothing about what is being waited on.** the words
// are the caller's, because the screen the wait belongs to is what can say what is being waited on
// (./account.go's LookingForDeployments and ReadingTheDeployment).
//
// **the spinner and the tone are ./ledger.go's own and nothing here is new on the terminal's
// palette**: one drawing style for a run's rows and for the waits in front of them, which is what
// keeps a `start` looking like one program.
//
// **it is drawn only where a terminal is watching**, which is ./clear.go's reading of the same end
// of the same prompt: a run redirected into a file is a record of what was asked, and a spinner
// redrawing itself in one is noise nothing renders.
//
// **it holds no input and reads no keystroke**, for ./ledger.go's reason. what an operator presses
// through a wait is the terminal's own interrupt, and a drawing in raw mode would take it instead
// of the process — bubbletea quits this drawing on that signal and the run carries on to the screen
// it was waiting to draw, where a second press is the ordinary way out of a prompt (./prompt.go).

// given is the caller saying the wait is over, which is the last message the program takes.
type given struct{}

// the model the wait draws: one sentence, a spinner, and nothing once it is over.
type waiting struct {
	said string
	spin spinner.Model
	over bool
}

func (drawn waiting) Init() tea.Cmd { return drawn.spin.Tick }

func (drawn waiting) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch message := message.(type) {
	case given:
		drawn.over = true
		return drawn, tea.Quit
	case spinner.TickMsg:
		spun, next := drawn.spin.Update(message)
		drawn.spin = spun
		return drawn, next
	}
	return drawn, nil
}

// **the wait un-draws itself on the way out, which is the opposite of what ./ledger.go's rows do.**
// a row closed is a sentence the operator has already read; a wait is a claim about now, and the
// screen it was standing on is about to be the screen the caller draws.
func (drawn waiting) View() string {
	if drawn.over {
		return ""
	}
	return drawn.spin.View() + " " + drawn.said
}

// Wait is one drawing of a wait, given up by ./Done.
//
// The zero value is a wait nothing ever drew, which answers ./Done and puts nothing on any
// terminal: a caller whose pass has nothing to wait on holds one of those rather than a nil the
// places it is given up would each have to check for.
type Wait struct {
	program *tea.Program
	// over is closed once the drawing has ended, so that ./Done hands the terminal back rather than
	// leaving a program still writing to it while the next screen draws.
	over chan struct{}
}

// WaitingOn draws `said` at `to` until ./Done, and nothing at all where `to` is not a terminal.
//
// The drawing is on a goroutine of its own: what the caller does next is the wait itself.
func WaitingOn(to io.Writer, said string) *Wait {
	if !onScreen(to) {
		return &Wait{}
	}
	program := tea.NewProgram(
		waiting{said: said, spin: turningSpinner()},
		tea.WithOutput(to), tea.WithInput(nil))

	drawn := &Wait{program: program, over: make(chan struct{})}
	go func() {
		defer close(drawn.over)
		// a terminal this could not be drawn on is not a failure to report: what the caller was
		// waiting on is happening either way, and the drawing was never the point.
		_, _ = program.Run()
	}()
	return drawn
}

// Done gives the wait up and blocks until nothing is drawing it any more.
//
// It answers on a wait that was never drawn, and on one already given up — the program's own
// context is closed by then, so the message goes nowhere and this returns: a caller reaching the
// screen behind it through more than one ending runs through this one line.
func (drawn *Wait) Done() {
	if drawn.program == nil {
		return
	}
	drawn.program.Send(given{})
	<-drawn.over
}
