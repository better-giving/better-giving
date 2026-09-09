package terminal

import (
	"errors"
	"io"

	"github.com/charmbracelet/x/term"
)

// what the two prompts share: where a question may be put, and what an answer that never came is.
//
// **a question is put to an operator or it is not put at all.** a prompt draws over a terminal it
// holds for the length of the question, and a reader that is a pipe, a file or a closed descriptor
// is one it would draw at and never hear back from — so this is checked in front of the prompt
// rather than met as a form standing there with nobody at it. the press these belong to is one an
// operator is standing at; there is no unattended spelling of it.
//
// **an operator who closed the prompt gave no value and is not a failure to report.** ../first
// reports every failure as a value, and a prompt nobody answered is a press not made: that is false
// and no error. an error is the other thing — a question this console could not ask at all — and it
// is separate because a caller that meets one has something to say rather than something to end
// quietly.

// ErrNoTerminal is a prompt that could be put to nobody: what it would draw at is not a terminal,
// so nothing would ever be typed back.
var ErrNoTerminal = errors.New("this console asks for that at a terminal, and this is not one")

// attended is whether `in` is something an operator can be asked a question over.
func attended(in io.Reader) bool {
	held, file := in.(interface{ Fd() uintptr })
	return file && term.IsTerminal(held.Fd())
}
