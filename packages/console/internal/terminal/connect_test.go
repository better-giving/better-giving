package terminal

import (
	"strings"
	"testing"

	"github.com/better-giving/console/internal/deployment"
)

// what a connect that did not land is answered with, which is never a console served over it.

func TestEveryConnectThatDidNotLandEndsInSomethingToDo(t *testing.T) {
	seen := map[string]deployment.ConnectionKind{}
	for _, kind := range []deployment.ConnectionKind{
		deployment.ConnectNowhere,
		deployment.ConnectRefused,
		deployment.ConnectUnreachable,
		deployment.ConnectFailed,
		deployment.ConnectUnkept,
	} {
		said := toneless.ReplaceAllString(Unconnected(kind, "/home/op/.config/better-giving"), "")
		if !strings.Contains(said, "better-giving start") && !strings.Contains(said, "better-giving login") {
			t.Errorf("%s said %q, want the press that repairs it", kind, said)
		}
		if other, twice := seen[said]; twice {
			t.Errorf("%s and %s said the same thing: %q", kind, other, said)
		}
		seen[said] = kind
	}
}

func TestASessionThisMachineCouldNotKeepNamesTheFolder(t *testing.T) {
	said := Unconnected(deployment.ConnectUnkept, "/home/op/.config/better-giving")
	if !strings.Contains(said, "/home/op/.config/better-giving") {
		t.Errorf("said %q, want the folder the operator makes writable", said)
	}
}

func TestTheLineBeforeConnectingSaysOtherConsolesAreSignedOut(t *testing.T) {
	if !strings.Contains(ReplacingOtherConsoles, "other console") {
		t.Errorf("said %q, want what connecting costs a console already connected", ReplacingOtherConsoles)
	}
}
