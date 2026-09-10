package terminal

import (
	"bytes"
	"testing"
)

// the small drawing that stands over a wait with nothing to report.

func TestNothingIsDrawnWhereNobodyIsWatching(t *testing.T) {
	// a run whose output is a buffer, a pipe or a file is a record of what was asked, and a spinner
	// redrawing itself in one is noise nothing renders — which is ./clear.go's reading of the same
	// end of the same prompt.
	var held bytes.Buffer

	drawn := WaitingOn(&held, "looking for something")
	drawn.Done()

	if held.Len() != 0 {
		t.Errorf("WaitingOn wrote %q at a buffer", held.String())
	}
}

func TestGivingUpAWaitNobodyWasWatchingIsStillTheEndOfIt(t *testing.T) {
	// Done is what the caller reaches the picker through, so a wait that was never drawn has to
	// answer it rather than block on a program that never started.
	drawn := WaitingOn(&bytes.Buffer{}, "looking for something")

	drawn.Done()
	// twice, because the caller gives the wait up on the way out of a read that may have ended on
	// the ceiling or on the reads landing, and both of those ends run through the same line.
	drawn.Done()
}

func TestAWaitNothingEverDrewIsStillAWaitToGiveUp(t *testing.T) {
	// the caller with nothing to wait on holds one of these rather than a nil to check for at every
	// place the drawing is given up (../../cmd/better-giving/start.go's readingAhead).
	(&Wait{}).Done()
}
