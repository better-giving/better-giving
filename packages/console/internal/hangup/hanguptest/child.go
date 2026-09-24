// Package hanguptest runs a test's body in a process of its own, for the cases that end the process
// a hang-up reaches.
//
// a hang-up nothing holds kills the process it is sent to, so the case asserting that cannot run in
// the test binary the rest of the suite is in: the test re-runs this binary on itself alone, and the
// parent reads what the child printed and which signal ended it.
package hanguptest

import (
	"errors"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"
)

// the variable a child is told which test it is by.
const childOf = "HANGUPTEST_CHILD"

// Child runs `body` in a child process when this process is the parent, and answers what the child
// printed to its stdout and the signal that ended it — zero for a child that exited. `t` is a
// top-level test: the child is picked by its name alone.
//
// in the child it runs `body` and exits 0, so a body that was meant to die and did not is read as
// a zero signal by the parent.
func Child(t *testing.T, body func()) (said string, ended syscall.Signal) {
	t.Helper()
	if os.Getenv(childOf) == t.Name() {
		body()
		os.Exit(0)
	}
	run := exec.Command(os.Args[0], "-test.run=^"+regexp.QuoteMeta(t.Name())+"$", "-test.count=1")
	run.Env = append(os.Environ(), childOf+"="+t.Name())
	var out, wrong strings.Builder
	run.Stdout, run.Stderr = &out, &wrong
	err := run.Run()
	var exited *exec.ExitError
	switch {
	case err == nil:
		return out.String(), 0
	case errors.As(err, &exited):
		if status, ok := exited.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return out.String(), status.Signal()
		}
	}
	t.Fatalf("the child ran as %v: %s", err, wrong.String())
	return "", 0
}

// HangUp sends this process the signal a closed terminal sends it, and gives the delivery time to
// land before the caller's next line runs.
func HangUp() {
	_ = syscall.Kill(os.Getpid(), syscall.SIGHUP)
	time.Sleep(200 * time.Millisecond)
}
