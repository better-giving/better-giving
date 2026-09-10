package terminal

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestNothingIsClearedWhereNobodyIsWatching(t *testing.T) {
	// a run whose output is a buffer, a pipe or a file is a record of what was asked, and an escape
	// sequence in one is noise nothing renders.
	var held bytes.Buffer
	clear(&held)
	if held.Len() != 0 {
		t.Errorf("clear wrote %q at a buffer", held.String())
	}
}

func TestAnFdIsNotOnItsOwnAScreen(t *testing.T) {
	// the check is the terminal and not the descriptor: a pipe carries an Fd exactly as a terminal
	// does, and a run redirected into one is the ordinary way this console's output is kept.
	from, to, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer from.Close()
	defer to.Close()
	if onScreen(to) {
		t.Error("a pipe reads as a screen, so a redirected run would carry escape sequences")
	}
}

func TestClearingKeepsTheScrollback(t *testing.T) {
	// `3J` is the scrollback, and what ran ahead of a question is where an operator looks when a
	// later row goes wrong. this clears what is drawn and never what was said.
	if strings.Contains(clearScreen, "3J") {
		t.Errorf("clearScreen = %q, which erases what the run printed before the question",
			clearScreen)
	}
}

func TestTheMigrationsAreNamedIntoARecordWithoutClearingIt(t *testing.T) {
	// the confirm draws its list on the question's own screen, and the same list goes into a record
	// nobody is standing at — that one is a file somebody reads afterwards and holds no escape.
	var held bytes.Buffer
	if answered := ConfirmCarry(strings.NewReader(""), &held, onDeployment,
		[]string{"0014_thing.sql"}, nil, ""); answered != Unattended {
		t.Errorf("ConfirmCarry at a pipe = %q, want %q", answered, Unattended)
	}
	if strings.Contains(held.String(), "\033") {
		t.Errorf("the record carries an escape sequence: %q", held.String())
	}
	if !strings.Contains(held.String(), "0014_thing.sql") {
		t.Errorf("the record does not name what would have been applied: %q", held.String())
	}
}
