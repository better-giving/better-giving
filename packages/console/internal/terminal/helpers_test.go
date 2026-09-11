package terminal

import (
	"strings"
	"testing"

	"github.com/better-giving/console/internal/first"
)

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
