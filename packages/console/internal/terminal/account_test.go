package terminal

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/signin"
)

func TestNoAccountIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	// the same refusal ./placement.go's is put behind, and for the same reason: a form drawn at a
	// pipe is one nothing is ever typed back into.
	picked, given, err := AskAccount(strings.NewReader("\n"), io.Discard, []signin.Account{
		{ID: "a1", Name: "Cause"},
	})
	if given || picked.ID != "" {
		t.Errorf("AskAccount = %v, %v", picked, given)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskAccount refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
}

func TestNoAccountIsAskedForWhereThisSignInIsAMemberOfNone(t *testing.T) {
	// a select with no rows in it is a form an operator cannot leave by choosing anything, so the
	// list is weighed in front of the prompt rather than drawn empty at them.
	_, given, err := AskAccount(strings.NewReader("\n"), io.Discard, nil)
	if given {
		t.Error("AskAccount answered with an account off an empty list")
	}
	if !errors.Is(err, ErrNoAccounts) {
		t.Errorf("AskAccount met an empty list with %v, want %v", err, ErrNoAccounts)
	}
}

func TestTwoAccountsOfOneNameAreToldApartByTheirIDs(t *testing.T) {
	// the choice is irreversible in the sense that matters — every command after it runs under the
	// account it names — so two rows an operator cannot tell apart is the one thing this list may
	// not draw.
	offered := labelled([]signin.Account{
		{ID: "a1", Name: "Cause"},
		{ID: "b2", Name: "Cause"},
		{ID: "c3", Name: "Another"},
	})
	labels := map[string]bool{}
	for _, one := range offered {
		if labels[one.Key] {
			t.Errorf("two accounts are both offered as %q", one.Key)
		}
		labels[one.Key] = true
	}
	if labels["Another"] != true {
		t.Errorf("an account whose name is its own is offered as something else: %v", labels)
	}
}
