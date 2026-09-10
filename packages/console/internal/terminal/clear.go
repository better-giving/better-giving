package terminal

import (
	"io"

	"github.com/charmbracelet/x/term"
)

// the screen a question is put on.
//
// **a question gets the screen to itself.** what runs ahead of the first prompt prints a build's
// worth of output — the bundle it packs, the modules wrangler names, the address the sign-in was
// allowed at — and a question drawn under all of it reads as the tail of a log rather than as the
// one thing waiting on the operator. so every prompt in this package erases the screen before it
// draws, and what is on it is what is being asked.
//
// **the scrollback is left alone.** the sequence below is the visible screen and the cursor and
// nothing else: what the run printed before the question is still there to scroll back to, which is
// where an operator looks when a later row goes wrong.
//
// **it is written only where a terminal is reading it.** a run whose output is a pipe or a file is
// a record of what was asked, and an escape sequence in one is noise nothing renders.

// erasing the screen and putting the cursor at the top of it. `3J` is deliberately absent: that is
// the scrollback, and this clears what is drawn and not what was said.
const clearScreen = "\033[H\033[2J"

// clear puts the next thing drawn at the top of an empty screen.
func clear(to io.Writer) {
	if !onScreen(to) {
		return
	}
	_, _ = io.WriteString(to, clearScreen)
}

// onScreen is whether `to` is drawn at a terminal, which is the half of ./prompt.go's `attended`
// that answers for the end the question is drawn on.
func onScreen(to io.Writer) bool {
	return terminalEnd(to, term.IsTerminal)
}
