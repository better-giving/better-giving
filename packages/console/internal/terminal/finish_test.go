package terminal

import (
	"strings"
	"testing"
)

func TestTheWaitOverTheFinishSaysWhatIsBeingRegistered(t *testing.T) {
	// the account's own widget list walked, a widget made and both its halves written are seconds
	// of a terminal saying nothing, and a terminal showing nothing but a cursor reads as a console
	// that has hung (./waiting.go).
	said := RegisteringSpamProtection()

	if !strings.Contains(said, "spam protection") {
		t.Errorf("said %q, want what is being made in the words the run named it in", said)
	}
	if !strings.Contains(said, "registering") {
		t.Errorf("said %q, want what this console is doing", said)
	}
}
