package terminal

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/x/ansi"

	"github.com/better-giving/console/internal/signin"
)

// every form this package puts, by what it asks, over the value it would answer into.
func everyForm() map[string]huh.Field {
	var (
		chosen Confirmation
		opens  bool
		typed  string
	)
	return map[string]huh.Field{
		"the carry":            choosingBetween(carrying(), &chosen),
		"the console question": asked(updatingConsole("0.9.0"), &opens),
		"the placement":        placementList(&typed),
		"the password":         passwordBox(&typed),
		"the workers.dev name": nameBox(&typed),
	}
}

func TestEveryPromptSaysCtrlCQuits(t *testing.T) {
	for what, field := range everyForm() {
		drawn := ansi.Strip(formFor(field, strings.NewReader(""), &bytes.Buffer{}).View())
		if !strings.Contains(drawn, "ctrl+c quit") {
			t.Errorf("%s drew %q, want ctrl+c quit on its help line", what, drawn)
		}
	}
	if drawn := ansi.Strip(choosing(holding(acme), Picker{}).View()); !strings.Contains(
		drawn, "ctrl+c quit") {
		t.Errorf("the account picker drew %q, want ctrl+c quit on its help line", drawn)
	}
}

func TestACtrlCAtEveryFormIsTheQuit(t *testing.T) {
	for what, field := range everyForm() {
		err := ran(formFor(field, strings.NewReader("\x03"), &bytes.Buffer{}))
		if !errors.Is(err, ErrQuit) {
			t.Errorf("a ctrl-c at %s = %v, want %v", what, err, ErrQuit)
		}
	}
}

func TestACtrlCAtEitherConfirmIsTheQuitAndNeverTheRefusal(t *testing.T) {
	// the operator ended the command, and a refusal would carry on to the console.
	if said := deciding(strings.NewReader("\x03"), &bytes.Buffer{}, carrying()); said != Quit {
		t.Errorf("a ctrl-c at the carry = %q, want %q", said, Quit)
	}
	if said := confirming(
		strings.NewReader("\x03"), &bytes.Buffer{}, updatingConsole("0.9.0"),
	); said != Quit {
		t.Errorf("a ctrl-c at the console question = %q, want %q", said, Quit)
	}
}

func TestACtrlCAtThePickerIsTheQuitAndAnEscapeStillClosesIt(t *testing.T) {
	drawn := choosing(holding(acme), Picker{SignOut: true})

	if _, answered, err := ended(pressing(drawn, pressStop), nil, []signin.Account{acme}); !errors.Is(
		err, ErrQuit) {
		t.Errorf("a ctrl-c at the picker = %q, %v, want %v", answered, err, ErrQuit)
	}
	if _, answered, err := ended(pressing(drawn, pressEsc), nil, []signin.Account{acme}); err != nil ||
		answered != PickerClosed {
		t.Errorf("an escape at the picker = %q, %v, want %q and no error", answered, err,
			PickerClosed)
	}
}
