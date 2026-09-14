package terminal

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/better-giving/console/internal/first"
)

// every style in the package rendered in `profile` for the rest of the case. lipgloss holds the
// profile on one package-wide renderer, so a case pinning it runs alone.
func pinned(t *testing.T, profile termenv.Profile) {
	t.Helper()
	was := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(profile)
	t.Cleanup(func() { lipgloss.SetColorProfile(was) })
}

// a stage list as one string, so a covering that disagrees is reported as the two lists rather than
// as an index.
func stages(held []first.Stage) string {
	words := make([]string, 0, len(held))
	for _, stage := range held {
		words = append(words, string(stage))
	}
	return strings.Join(words, " ")
}

// a block as one line, so that a case asserting a sentence asserts the words and not where ./say.go
// broke them.
func flowing(said string) string { return strings.ReplaceAll(said, "\n", " ") }

func same(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s =\n  %s\nwant\n  %s", what, got, want)
	}
}
