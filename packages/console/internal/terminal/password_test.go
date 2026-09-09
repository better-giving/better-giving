package terminal

import (
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
	typed, given, err := AskPassword(strings.NewReader("anything\n"), io.Discard)
	if given || typed != "" {
		t.Errorf("AskPassword = %q, %v", typed, given)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskPassword refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
}
