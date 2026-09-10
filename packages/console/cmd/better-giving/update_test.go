package main

import (
	"errors"
	"strings"
	"testing"

	releases "github.com/better-giving/console/internal/update"
)

// what this command does about the reading it took, which is the whole of what it does.
//
// it installs a console and deploys nothing: it signs in to nothing, reads nothing about a
// deployment and opens no door, so the only thing that can be wrong here is what it does about the
// three ways a release reading can go.

// a run of ./updating with the install recorded rather than made.
type consoleUpdate struct {
	read     releases.Read
	installs int
	stopped  error
	said     strings.Builder
}

func (run *consoleUpdate) run() error {
	return updating(run.read, &run.said, func(releases.Read) error {
		run.installs++
		return run.stopped
	})
}

func aNewerConsole() *consoleUpdate {
	return &consoleUpdate{read: releases.Read{
		Kind: releases.Newer, Version: "0.9.0", Where: "somewhere",
	}}
}

func TestAConsoleBehindTheReleaseInstallsItAndNamesThePressThatDeploysIt(t *testing.T) {
	run := aNewerConsole()

	if err := run.run(); err != nil {
		t.Fatalf("updating = %v, want the newer console installed", err)
	}
	if run.installs != 1 {
		t.Errorf("the newer console was installed %d times, want once", run.installs)
	}
	if !strings.Contains(run.said.String(), "0.9.0") {
		t.Errorf("said %q, want the release this machine now holds", run.said.String())
	}
	// nothing carries on past this command: the console it installed is the one that deploys, and
	// an operator left with no press named has a newer console and an older deployment.
	if !strings.Contains(run.said.String(), "better-giving start") {
		t.Errorf("said %q, want the press that puts that release on the deployment",
			run.said.String())
	}
}

func TestAnInstallThatDidNotLandEndsThisCommandAsAFailure(t *testing.T) {
	run := aNewerConsole()
	run.stopped = errors.New("the archive that came down carries no console")

	err := run.run()

	if err == nil {
		t.Fatal("an install that did not land ended cleanly, which reads as a console now updated")
	}
	if strings.Contains(run.said.String(), "better-giving start") {
		t.Errorf("said %q, want no press named over an install that did not happen",
			run.said.String())
	}
}

func TestAConsoleAlreadyOnTheCurrentReleaseInstallsNothingAndSaysSo(t *testing.T) {
	run := &consoleUpdate{read: releases.Read{Kind: releases.Current}}

	if err := run.run(); err != nil {
		t.Fatalf("updating = %v, want a console that is current read as no failure", err)
	}
	if run.installs != 0 {
		t.Error("a console already on the current release installed one anyway")
	}
	if !strings.Contains(run.said.String(), "nothing was installed") {
		t.Errorf("said %q, want what did not happen", run.said.String())
	}
}

func TestAReadingNobodyCouldTakeInstallsNothingAndEndsNoCommand(t *testing.T) {
	// github is a third host this console does not need to work (../../internal/update), and a
	// binary carrying no version has no release to be behind: neither is a failure to report, and
	// neither is a console this command may claim is current.
	run := &consoleUpdate{read: releases.Read{Kind: releases.Unknown}}

	if err := run.run(); err != nil {
		t.Fatalf("updating = %v, want a reading nobody could take to end no command", err)
	}
	if run.installs != 0 {
		t.Error("a reading that found nothing out installed a console anyway")
	}
	if said := run.said.String(); said == "" || strings.Contains(said, "current release") {
		t.Errorf("said %q, want a console this command could not weigh said as one", said)
	}
}
