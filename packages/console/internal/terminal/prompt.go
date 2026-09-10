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
// **both ends of the prompt are that check and never the reader alone.** `better-giving start >
// start.log` leaves stdin the operator's keyboard and puts the form in the file: a prompt that
// asked about the reader alone would draw the question where nobody can see it and then wait on a
// keystroke for a question the operator was never shown. ./clear.go's onScreen is the other end of
// the same reading, and ./attended is where the two meet.
//
// **an operator who closed the prompt gave no value and is not a failure to report.** ../first
// reports every failure as a value, and a prompt nobody answered is a press not made: that is false
// and no error. an error is the other thing — a question this console could not ask at all — and it
// is separate because a caller that meets one has something to say rather than something to end
// quietly.

// **the sentence names the question it could not put.** the caller prints it as the whole of what
// that run said, so a pronoun standing for the question — "this console asks for that" — is a
// sentence in which nothing tells an operator which prompt ended the press. the shape is
// ../../cmd/better-giving/start.go's noOneAtTheDoor, which is the same predicament done well: the
// question, what was not made, and the way to put the question again. the question itself is each
// prompt's own words for what it wanted, so the three supply theirs.

// ErrNoTerminal is a prompt that could be put to nobody: what it would draw at is not a terminal,
// so nothing would ever be typed back.
//
// It is what a caller matches on and never what an operator reads: what they read is ./noTerminal's
// sentence, which names the question.
var ErrNoTerminal = errors.New("this console asks at a terminal, and this is not one")

// noTerminal is that state as an operator reads it, with the question this prompt was about to put.
//
// `asking` is the prompt's own words for the value it wanted, drawn into the sentence so that a run
// with either end in a file — piped in, or redirected out — says which question stopped it.
type noTerminal struct{ asking string }

func (why noTerminal) Error() string {
	return "this console asks for " + why.asking + " at a terminal, and this is not one, so " +
		"nothing was created and nothing was deployed: run this command again at a terminal the " +
		"question can be answered at"
}

// Unwrap is what keeps ./ErrNoTerminal the one thing a caller matches on, whichever prompt refused.
func (why noTerminal) Unwrap() error { return ErrNoTerminal }

// attended is whether a question may be put over this pair: typed at `in`, and seen at `to`.
func attended(in io.Reader, to io.Writer) bool {
	return bothEnds(in, to, term.IsTerminal)
}

// the same reading with what says whether a descriptor is a terminal handed in, because a test
// process has no terminal to stand at either end of a prompt (./prompt_test.go).
func bothEnds(in io.Reader, to io.Writer, isTerminal func(uintptr) bool) bool {
	return terminalEnd(in, isTerminal) && terminalEnd(to, isTerminal)
}

// terminalEnd is whether one end of a prompt is a terminal.
//
// the descriptor is not the reading: a pipe and a file carry one exactly as a terminal does, which
// is what ./clear_test.go holds the other reader of this to.
func terminalEnd(held any, isTerminal func(uintptr) bool) bool {
	file, carried := held.(interface{ Fd() uintptr })
	return carried && isTerminal(file.Fd())
}
