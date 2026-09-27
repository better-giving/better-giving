package hangup

import (
	"fmt"
	"strings"
	"syscall"
	"testing"
	"time"

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

func TestAHangUpDuringAHoldIsHeardAtOnceAndStillEndsTheProcessAtTheRelease(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		release := Hold()
		select {
		case <-Heard():
			fmt.Println("heard before any hang-up")
		default:
		}
		hanguptest.HangUp()
		select {
		case <-Heard():
			fmt.Println("the hang-up was heard")
		case <-time.After(time.Second):
		}
		release()
		fmt.Println("the process went on")
	})
	if strings.Contains(said, "heard before any hang-up") {
		t.Errorf("printed %q, want nothing heard until a hang-up arrives", said)
	}
	if !strings.Contains(said, "the hang-up was heard") {
		t.Errorf("printed %q, want a held hang-up heard while the hold is still taken", said)
	}
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want the held hang-up still to end it at the release",
			said, ended)
	}
}

// every press is a hold of its own, so a hang-up under the second is the common one.
func TestAHangUpUnderASecondHoldIsHeardAndEndsTheProcessAtItsRelease(t *testing.T) {
	said, ended := hanguptest.Child(t, func() {
		Hold()()
		release := Hold()
		hanguptest.HangUp()
		select {
		case <-Heard():
			fmt.Println("the hang-up was heard")
		case <-time.After(time.Second):
		}
		fmt.Println("the second press went on")
		release()
		fmt.Println("the process went on")
	})
	if !strings.Contains(said, "the hang-up was heard") ||
		!strings.Contains(said, "the second press went on") {
		t.Errorf("printed %q, want the second press to hear the hang-up and outlive it", said)
	}
	if strings.Contains(said, "the process went on") || ended != syscall.SIGHUP {
		t.Errorf("printed %q and ended on %v, want the held hang-up to end it at the release",
			said, ended)
	}
}
