package terminal

import (
	"strings"
	"testing"

	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/release"
)

// the two row lists, held to the properties the compiler cannot see.
//
// what the compiler holds is that a row has both its labels and that every stage it names is a
// `first.Stage`. what it cannot see is either half of the arrangement: that the rows between them
// cover the binary's stages exactly once, and that they cover them in the order the binary reaches
// them. a row that named a stage twice, dropped one, or listed two out of turn compiles perfectly —
// and so does one that covered a stage its own children cover as well.

// every stage a list of rows covers, in the order the rows and their children name them.
func covering(rows []Row) []first.Stage {
	covered := []first.Stage{}
	for _, row := range rows {
		covered = append(covered, row.Stages...)
		for _, child := range row.Children {
			covered = append(covered, child.Stages...)
		}
	}
	return covered
}

// every row in a list and every child under one, which is every line this ledger can draw.
func drawable(rows []Row) []Row {
	held := []Row{}
	for _, row := range rows {
		held = append(held, row)
		held = append(held, row.Children...)
	}
	return held
}

func TestTheChainsRowsCoverEveryStageItReachesExactlyOnceAndInOrder(t *testing.T) {
	same(t, "the chain's covering", stages(covering(ChainRows)), stages(first.Stages))
}

func TestTheRedeploysRowsCoverTheDeployEnginesOwnSixExactlyOnceAndInOrder(t *testing.T) {
	same(t, "the redeploy's covering", stages(covering(UpdateRows)), stages(DeployStages))
}

func TestEveryRowSaysSomethingInBothOfItsStatesAndSaysDifferentThings(t *testing.T) {
	// the label is the whole of what a row states — no note beside it and no word after it — so a
	// row missing one of them says nothing in that state, and a row whose two are the same is a row
	// a reader cannot tell has finished. a child is a row of the same kind and is held to the same
	// thing: it is drawn exactly as one, indented.
	for _, row := range drawable(append(append([]Row{}, ChainRows...), UpdateRows...)) {
		switch {
		case row.Running == "" || row.Done == "":
			t.Errorf("a row covering %v says nothing in one of its two states", row.Stages)
		case row.Running == row.Done:
			t.Errorf("a row covering %v says %q in both states", row.Stages, row.Running)
		}
	}
}

func TestARowEitherCoversStagesItselfOrHasChildrenThatDo(t *testing.T) {
	// a row with children carries no counting of its own — the children carry it — so a row holding
	// both would light on a stage under a line that draws no note, and its children would sit under
	// a parent that is already saying something they cannot see. a row holding neither never lights
	// at all.
	for _, row := range append(append([]Row{}, ChainRows...), UpdateRows...) {
		switch {
		case len(row.Stages) == 0 && len(row.Children) == 0:
			t.Errorf("the row saying %q covers no stage and has no children, so it never lights", row.Running)
		case len(row.Stages) > 0 && len(row.Children) > 0:
			t.Errorf("the row saying %q covers %v itself and has children too", row.Running, row.Stages)
		case len(row.Children) == 1:
			// an indented line saying what the line above it already says is worse than the line
			// alone: a row is split because it is two waits, and one child is not two.
			t.Errorf("the row saying %q has one child, %q", row.Running, row.Children[0].Running)
		}
	}
}

func TestNoChildRepeatsTheWordsOfTheRowItIsDrawnUnder(t *testing.T) {
	for _, row := range append(append([]Row{}, ChainRows...), UpdateRows...) {
		for _, child := range row.Children {
			if child.Running == row.Running || child.Done == row.Done {
				t.Errorf("the child of %q says %q, which is the line above it", row.Running, child.Running)
			}
		}
	}
}

func TestTheDownloadAndTheUploadNameThisDeploymentInBothOfTheirStates(t *testing.T) {
	// the picker two screens earlier marked the account this deployment is already on by the name
	// this binary was baked with (./account.go), so a row calling it something else is a second word
	// for the one thing the operator is watching go up.
	for _, row := range []Row{assets, cloudflare} {
		if !strings.Contains(row.Running, release.Baked.Name) {
			t.Errorf("a row runs saying %q, want the deployment named as the picker named it", row.Running)
		}
		if !strings.Contains(row.Done, release.Baked.Name) {
			t.Errorf("a row closes saying %q, want the deployment named as the picker named it", row.Done)
		}
	}
}

func TestTheWaitOverTheAddressSaysWhatItIsWaitingFor(t *testing.T) {
	// a name the account registered on this run takes a minute or so to reach the machine asking,
	// and a terminal showing nothing but a cursor through it reads as a console that has hung
	// (./waiting.go).
	said := WaitingForTheAddress()

	if !strings.Contains(said, "address") {
		t.Errorf("said %q, want what is being waited for", said)
	}
	if !strings.Contains(said, "answering") {
		t.Errorf("said %q, want what is being waited for it to do", said)
	}
}
