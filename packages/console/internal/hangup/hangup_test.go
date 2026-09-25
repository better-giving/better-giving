package hangup

import (
	"fmt"
	"strings"
	"syscall"
	"testing"

	"github.com/better-giving/console/internal/hangup/hanguptest"
)

func TestAHangUpDuringAHoldDoesNotEndThePressAndEndsTheProcessAtTheRelease(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		release := Hold()
		hanguptest.HangUp()
		fmt.Println("the press went on")
		release()
		fmt.Println("the process went on")
	})
	if !strings.Contains(said, "the press went on") {
		t.Errorf("printed %q, want the press to outlive a hang-up it held", said)
	}
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want the held hang-up to end it at the release",
			said, ended)
	}
}

func TestAHangUpAfterTheReleaseEndsTheProcess(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		Hold()()
		hanguptest.HangUp()
		fmt.Println("the process went on")
	})
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want a hang-up past the release to end it", said,
			ended)
	}
}

func TestAHangUpUnderTwoHoldsWaitsForTheLastRelease(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		one, other := Hold(), Hold()
		hanguptest.HangUp()
		one()
		fmt.Println("the other press went on")
		other()
		fmt.Println("the process went on")
	})
	if !strings.Contains(said, "the other press went on") {
		t.Errorf("printed %q, want the press still holding to outlive the first release", said)
	}
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want the hang-up to end it at the last release",
			said, ended)
	}
}

func TestAHoldReleasedWithNoHangUpEndsNothing(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		Hold()()
		fmt.Println("the process went on")
	})
	if !strings.Contains(said, "the process went on") || ended != 0 {
		t.Errorf("printed %q and ended on %v, want a quiet release to leave the process running",
			said, ended)
	}
}
