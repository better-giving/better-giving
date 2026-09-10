package terminal

import (
	"errors"
	"io"

	"github.com/charmbracelet/huh"
)

// where the database this deployment runs on keeps its records, taken off an operator.
//
// **cloudflare takes it at creation and never again, and neither field can be changed once the
// database exists** — the way out of a wrong one is an export, a delete, a create and an import,
// with the deployment down in between (../deployment/databases.go). so what is offered is the nine
// and nothing else: there is no value to type here that the create could refuse.
//
// **the nine are one choice and never two questions.** cloudflare reads a jurisdiction over a hint
// where a create names both, so a list split into a region and a restriction would let an operator
// state one and be given the other. one value is chosen and this is what it may be.

// placements are the nine an operator chooses between, in the order they are offered.
//
// cloudflare's own placement first and selected by default: it is right for every deployment with
// no residency rule, and a list opening on a region would be a permanent choice made by whoever did
// not read the label.
//
// **which of the two fields a value is is ../deployment's to sort, and the words here are what says
// which it is.** the six read as a preference and the two read as a restriction, in the label
// itself: an operator with a residency rule to satisfy is choosing between `Nearest to western
// Europe` and `The European Union only`, and the difference between them is the whole of what they
// came here for.
//
// ./placement_test.go holds every value here to ../deployment's own two lists, which is the one
// thing about this able to go wrong quietly: a value cloudflare takes and this list does not offer
// is a placement no operator at a terminal can ever choose.
var placements = []huh.Option[string]{
	huh.NewOption("Wherever Cloudflare puts it", ""),
	huh.NewOption("Nearest to western North America", "wnam"),
	huh.NewOption("Nearest to eastern North America", "enam"),
	huh.NewOption("Nearest to western Europe", "weur"),
	huh.NewOption("Nearest to eastern Europe", "eeur"),
	huh.NewOption("Nearest to Asia-Pacific", "apac"),
	huh.NewOption("Nearest to Oceania", "oc"),
	huh.NewOption("The European Union only", "eu"),
	huh.NewOption("FedRAMP regions only", "fedramp"),
}

// AskPlacement takes where the database should keep its records, from the nine.
//
// False with no error is the operator closing the prompt, as ./AskPassword's is.
func AskPlacement(in io.Reader, to io.Writer) (string, bool, error) {
	if !attended(in, to) {
		return "", false, noTerminal{"where the database keeps its records"}
	}
	clear(to)
	var where string
	asking := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("where the database keeps its records").
			Description("it cannot be changed once the database exists").
			Options(placements...).
			Value(&where),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return "", false, nil
	case err != nil:
		return "", false, err
	}
	return where, true, nil
}
