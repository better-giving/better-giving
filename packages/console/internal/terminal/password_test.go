package terminal

import (
	"bytes"
	"errors"
	"io"
	"strconv"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/release"
)

func TestAPasswordNoDeploymentWouldAuthenticateAgainstIsRefusedInItsOwnWords(t *testing.T) {
	// the three are three different mistakes and not one absence, so each refusal names which one
	// it was. the lengths are taken off ../release rather than typed, so raising the minimum moves
	// these cases with it instead of leaving them asserting a bound nothing holds any more.
	shortest := release.MinAdminPasswordLength
	for _, one := range []struct{ typed, names string }{
		{"", "without a password"},
		{strings.Repeat(" ", shortest), "whitespace"},
		{strings.Repeat("a", shortest-1), strconv.Itoa(shortest)},
	} {
		said := Unusable(one.typed)
		if said == "" {
			t.Errorf("%q was not refused", one.typed)
			continue
		}
		if !strings.Contains(said, one.names) {
			t.Errorf("%q was refused with %q, which says nothing about %s",
				one.typed, said, one.names)
		}
		// the box refuses in the same sentence, so an operator at a terminal and a caller at the
		// http door are told the same thing.
		refused := refusing(one.typed)
		if refused == nil || refused.Error() != said {
			t.Errorf("the box refused %q with %v, not %q", one.typed, refused, said)
		}
	}
}

func TestAPasswordAtTheMinimumIsAcceptedAndNothingIsTrimmedOffIt(t *testing.T) {
	// whitespace is a legal password character, so a value that is a space and eleven letters is
	// twelve characters long and not eleven.
	for _, typed := range []string{
		strings.Repeat("a", release.MinAdminPasswordLength),
		" " + strings.Repeat("a", release.MinAdminPasswordLength-1),
	} {
		if said := Unusable(typed); said != "" {
			t.Errorf("%q was refused with %q", typed, said)
		}
		if refused := refusing(typed); refused != nil {
			t.Errorf("the box refused %q with %v", typed, refused)
		}
	}
}

func TestAPasswordIsCountedTheWayTheDeploymentCountsIt(t *testing.T) {
	// the sign-in path measures a javascript string, whose length is its utf-16 code units — so a
	// byte count here would take a password the deployment then refuses every sign-in against.
	// twelve accented characters are twelve code units and twenty-four bytes.
	typed := strings.Repeat("é", release.MinAdminPasswordLength)
	if len(typed) <= release.MinAdminPasswordLength {
		t.Fatalf("%q is %d bytes, which is not the case this is about", typed, len(typed))
	}
	if counted := TypedLength(typed); counted != release.MinAdminPasswordLength {
		t.Errorf("TypedLength = %d, want %d", counted, release.MinAdminPasswordLength)
	}
	if said := Unusable(typed); said != "" {
		t.Errorf("%q was refused with %q", typed, said)
	}

	// and one shorter still has to be refused, or the count is not being made at all.
	short := strings.Repeat("é", release.MinAdminPasswordLength-1)
	if said := Unusable(short); said == "" {
		t.Errorf("%q was accepted", short)
	}
}

func TestNoPasswordIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	// a test binary's own input is a pipe, which is exactly the state this refuses: a box drawn at
	// one is a box nothing is ever typed into, so the prompt says so rather than standing there.
	typed, given, err := AskPassword(strings.NewReader("anything\n"), io.Discard, "")
	if given || typed != "" {
		t.Errorf("AskPassword = %q, %v", typed, given)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskPassword refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
}

// what the caller has to say above the question, drawn on this prompt's own screen.
//
// this is the first screen of a press that makes things, and every prompt here erases the screen
// before it draws (./clear.go) — so a line the caller printed above the call would be gone at the
// moment the operator is answering, which is the moment it exists to inform.

func TestThePreambleIsDrawnOnTheQuestionsOwnScreen(t *testing.T) {
	held := &bytes.Buffer{}
	preamble := "deploying into your Cloudflare account Acme Giving (ac1). this makes:"

	_, given, err := AskPassword(strings.NewReader("anything\n"), held, preamble)

	if given {
		t.Error("a pipe was asked for a password")
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskPassword = %v, want %v", err, ErrNoTerminal)
	}
	if !strings.Contains(held.String(), preamble) {
		t.Errorf("said %q, want what this press is about to make named", held.String())
	}
}

func TestTheScreenIsErasedBeforeThePreambleIsDrawnOnIt(t *testing.T) {
	// the order is the whole of the fix: a preamble drawn before the erase is wiped by it, and the
	// operator answers the question with nothing above it saying what is about to be made. a buffer
	// sees no escape at all (./clear.go writes none at one), so what is asserted is the heading as a
	// value rather than the run of a prompt.
	preamble := "deploying into your Cloudflare account Acme Giving (ac1). this makes:"
	said := heading(true, preamble)

	if !strings.HasPrefix(said, clearScreen) {
		t.Errorf("heading = %q, want the screen erased before anything is drawn on it", said)
	}
	if !strings.Contains(said, preamble) {
		t.Errorf("heading = %q, want what this press is about to make named", said)
	}
	if drawn := heading(false, preamble); strings.Contains(drawn, "\033") {
		t.Errorf("heading at a run nobody is watching = %q, want a record with no escape in it", drawn)
	}
	if held := heading(true, ""); held != clearScreen {
		t.Errorf("heading = %q, want the erase alone where the caller has nothing to say", held)
	}
}

func TestNothingIsDrawnAboveTheQuestionWhereTheCallerHasNothingToSay(t *testing.T) {
	held := &bytes.Buffer{}
	_, _, _ = AskPassword(strings.NewReader("anything\n"), held, "")
	if held.String() != "" {
		t.Errorf("said %q, want a caller with nothing to say drawn as nothing", held.String())
	}
}
