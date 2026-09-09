package terminal

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/deployment"
)

func TestEveryPlacementOfferedIsOneCloudflareTakes(t *testing.T) {
	// neither field can be changed once the database exists, so a value offered here that the
	// create refuses is a press stopped after everything else was typed.
	for _, one := range placements {
		if !deployment.PlacementKnown(one.Value) {
			t.Errorf("%q is offered and cloudflare places no database at it", one.Value)
		}
	}
}

func TestEveryPlacementCloudflareTakesIsOffered(t *testing.T) {
	// the other direction, which is the one that goes wrong quietly: a value added to
	// ../deployment's lists and not to this one is a placement no operator at a terminal can choose,
	// and nothing about that is visible from either file alone.
	offered := map[string]bool{}
	for _, one := range placements {
		offered[one.Value] = true
	}
	for _, one := range append(append([]string{""},
		deployment.LocationHints...), deployment.Jurisdictions...) {
		if !offered[one] {
			t.Errorf("cloudflare takes %q and no operator is offered it", one)
		}
	}
}

func TestEveryPlacementSaysWhichOfTheTwoFieldsItIs(t *testing.T) {
	// which of the two a value is is ../deployment's to sort, and the label is the whole of what
	// says which it is: an operator with a residency rule is choosing between a region cloudflare
	// prefers and a restriction it keeps.
	for _, one := range placements {
		if one.Key == "" || one.Key == one.Value {
			t.Errorf("%q is offered as %q, which says nothing about what it is", one.Value, one.Key)
		}
	}
}

func TestNoPlacementIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	where, given, err := AskPlacement(strings.NewReader("weur\n"), io.Discard)
	if given || where != "" {
		t.Errorf("AskPlacement = %q, %v", where, given)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskPlacement refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
}
