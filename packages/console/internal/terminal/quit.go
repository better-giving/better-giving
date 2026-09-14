package terminal

import (
	"errors"
	"io"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

// the one way out of every prompt in this package, and the key that says so on each of them.
//
// **a ctrl-c at a prompt ends the command, and nothing past the prompt runs.** the operator is
// holding the terminal the question is drawn on, so the keystroke reaches the prompt rather than the
// process — and what they asked for is the command to stop, not the question answered as a refusal.
// a refusal carries on: past the carry door it opens the console, past the console question it
// deploys. so the prompt hands back ./ErrQuit, and ../../cmd/better-giving says how to pick the run
// up again and exits as a shell's own interrupt would.
//
// **an escape, and every other way a prompt ends without an answer, is not this.** those are a
// press not made and keep the reading each prompt gives them (./prompt.go).
//
// **the key is on the help line of every prompt, and the ledger and the waits do not carry it.** a
// ctrl-c over a press waits it out rather than quitting, which ./ledger.go's StillGoing says at the
// moment it happens, so a hint there would be a promise the screen breaks.

// ErrQuit is the operator's ctrl-c at a prompt: the command ends where it stands.
var ErrQuit = errors.New("the operator quit at a prompt")

// the binding a form ends on and the help line draws, one value for both so the key drawn is the
// key read.
var quitKey = key.NewBinding(key.WithKeys("ctrl+c"), key.WithHelp("ctrl+c", "quit"))

// the form a question is put in: the field, read from `in` and drawn at `to`, ending on ./quitKey
// and naming it on its help line.
func formFor(field huh.Field, in io.Reader, to io.Writer) *huh.Form {
	keys := huh.NewDefaultKeyMap()
	keys.Quit = quitKey
	return huh.NewForm(huh.NewGroup(quittable{field})).WithKeyMap(keys).WithInput(in).WithOutput(to)
}

// what running a form is worth to the prompt that put it: ./ErrQuit for the operator's ctrl-c, which
// is the one keystroke huh ends a form on unanswered, and the failure otherwise.
func ran(asking *huh.Form) error {
	if err := asking.Run(); err != nil {
		if errors.Is(err, huh.ErrUserAborted) {
			return ErrQuit
		}
		return err
	}
	return nil
}

// a field whose help line names the quit after its own keys.
//
// huh draws a group's help off the focused field's KeyBinds and holds no binding of the form's own
// there, so the key is added on the field.
type quittable struct{ huh.Field }

func (held quittable) KeyBinds() []key.Binding {
	return append(held.Field.KeyBinds(), quitKey)
}

// the field updated and kept wrapped: the group stores what Update hands back in place of the field
// it called, so an unwrapped return would drop the key from the help line after the first keystroke.
func (held quittable) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	updated, next := held.Field.Update(message)
	if field, ok := updated.(huh.Field); ok {
		held.Field = field
	}
	return held, next
}
