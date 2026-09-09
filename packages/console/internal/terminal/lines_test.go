package terminal

import (
	"testing"

	"github.com/better-giving/console/internal/first"
)

// the two row lists, held to the properties the compiler cannot see.
//
// what the compiler holds is that a row has both its labels and that every stage it names is a
// `first.Stage`. what it cannot see is either half of the arrangement: that the rows between them
// cover the binary's stages exactly once, and that they cover them in the order the binary reaches
// them. a row that named a stage twice, dropped one, or listed two out of turn compiles perfectly.

func TestTheChainsRowsCoverEveryStageItReachesExactlyOnceAndInOrder(t *testing.T) {
	covered := []first.Stage{}
	for _, row := range ChainRows {
		covered = append(covered, row.Stages...)
	}
	same(t, "the chain's covering", stages(covered), stages(first.Stages))
}

func TestTheRedeploysRowsCoverTheDeployEnginesOwnFiveExactlyOnceAndInOrder(t *testing.T) {
	covered := []first.Stage{}
	for _, row := range UpdateRows {
		covered = append(covered, row.Stages...)
	}
	same(t, "the redeploy's covering", stages(covered), stages(DeployStages))
}

func TestEveryRowSaysSomethingInBothOfItsStatesAndSaysDifferentThings(t *testing.T) {
	// the label is the whole of what a row states — no note beside it and no word after it — so a
	// row missing one of them says nothing in that state, and a row whose two are the same is a row
	// a reader cannot tell has finished.
	for _, row := range append(append([]Row{}, ChainRows...), UpdateRows...) {
		switch {
		case row.Running == "" || row.Done == "":
			t.Errorf("a row covering %v says nothing in one of its two states", row.Stages)
		case row.Running == row.Done:
			t.Errorf("a row covering %v says %q in both states", row.Stages, row.Running)
		case len(row.Stages) == 0:
			t.Errorf("the row saying %q covers no stage, so it never lights", row.Running)
		}
	}
}
