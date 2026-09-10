package terminal

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/signin"
)

// what a press nobody is standing at is answered with, which is the question that could not be put.
//
// `better-giving start | tee setup.log` is a reasonable thing for a careful operator to do, and it
// is refused at the writer: stdin is still this operator's keyboard there, and what the form would
// be drawn on is the pipe. the sentence it dies against is the whole of that run's output, so a
// pronoun in it names nothing, and a sentence that ends without saying what was not created leaves
// them unable to tell a press that stopped in front of the first write from one that stopped inside
// it.
//
// the shape is ../../cmd/better-giving/update.go's noOneAtTheDoor: the question, what was not made,
// and the way to put the question again.

func TestEveryPromptNobodyIsAtNamesTheQuestionItCouldNotPut(t *testing.T) {
	for _, prompt := range []struct {
		name, question string
		refused        error
	}{
		{"AskPassword", "password", passwordRefusal(t)},
		{"AskPlacement", "database", placementRefusal(t)},
		{"AskAccount", "account", accountRefusal(t)},
	} {
		if prompt.refused == nil {
			t.Fatalf("%s asked a pipe a question", prompt.name)
		}
		said := prompt.refused.Error()
		if !errors.Is(prompt.refused, ErrNoTerminal) {
			t.Errorf("%s refused a pipe with %v, want %v", prompt.name, prompt.refused, ErrNoTerminal)
		}
		if !strings.Contains(said, prompt.question) {
			t.Errorf("%s said %q, want the question it could not put named", prompt.name, said)
		}
		if strings.Contains(said, "for that at a terminal") {
			t.Errorf("%s said %q, want no pronoun standing for the question", prompt.name, said)
		}
		if !strings.Contains(said, "nothing was created") {
			t.Errorf("%s said %q, want what was not made stated", prompt.name, said)
		}
		if !strings.Contains(said, "at a terminal the question can be answered at") {
			t.Errorf("%s said %q, want the act on the end of it", prompt.name, said)
		}
	}
}

func passwordRefusal(t *testing.T) error {
	t.Helper()
	_, _, err := AskPassword(strings.NewReader("anything\n"), io.Discard, "")
	return err
}

func placementRefusal(t *testing.T) error {
	t.Helper()
	_, _, err := AskPlacement(strings.NewReader("weur\n"), io.Discard)
	return err
}

func accountRefusal(t *testing.T) error {
	t.Helper()
	_, _, err := AskAccount(strings.NewReader("\n"), io.Discard, []signin.Account{
		{ID: "a1", Name: "Cause"},
	})
	return err
}

// both ends of a prompt, and the reading of each that says whether a question may be put over it.
//
// a test process holds no terminal to stand at either end, so what says whether a descriptor is one
// is handed in: the pairing is the whole of what this asserts, and the reading itself is
// term.IsTerminal at every call the program makes (./prompt.go).

// an end as the prompt meets one: something to read or write, carrying a descriptor.
type end struct{ fd uintptr }

func (held end) Read([]byte) (int, error)       { return 0, io.EOF }
func (held end) Write(said []byte) (int, error) { return len(said), nil }
func (held end) Fd() uintptr                    { return held.fd }

func TestAQuestionIsPutOnlyWhereItCanBeBothTypedAndSeen(t *testing.T) {
	// `better-giving update > update.log` leaves the keyboard where it was and puts the form in the
	// file: the reader alone answers half the question, and the half it does not answer is the one
	// that ends with an operator looking at a blank terminal while the process waits.
	const aTerminal, aFile = uintptr(1), uintptr(2)
	drawnAt := func(fd uintptr) bool { return fd == aTerminal }
	for _, pair := range []struct {
		says   string
		in, to uintptr
		want   bool
	}{
		{"an operator at both ends of it", aTerminal, aTerminal, true},
		{"a question drawn into a file", aTerminal, aFile, false},
		{"an answer that would come from a file", aFile, aTerminal, false},
		{"neither end a terminal", aFile, aFile, false},
	} {
		if put := bothEnds(end{pair.in}, end{pair.to}, drawnAt); put != pair.want {
			t.Errorf("%s = %v, want %v", pair.says, put, pair.want)
		}
	}
}

func TestAnEndWithNoDescriptorAtAllIsNoTerminal(t *testing.T) {
	// a bytes.Buffer carries no Fd, which is every prompt driven from a test and every run whose
	// output is held rather than drawn.
	if terminalEnd(&strings.Builder{}, func(uintptr) bool { return true }) {
		t.Error("a writer with no descriptor read as a terminal")
	}
}
