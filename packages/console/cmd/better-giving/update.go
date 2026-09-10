package main

import (
	"context"
	"fmt"
	"io"

	"github.com/better-giving/console/internal/terminal"
	releases "github.com/better-giving/console/internal/update"
)

// the console this machine runs, brought up to the newest release. it deploys nothing.
//
// **it is the whole of what this command is, and that is the point of it.** a binary deploys only
// the bundle from its own bake (../../internal/release's BundleSource), so the console and the
// deployment move together or not at all: what puts a release on a deployment is ./start.go, and it
// installs the newer console itself before it carries. this command is the half of that an operator
// can take on its own — before a deploy, on a machine with no deployment yet, or after reading that
// one is out.
//
// **it signs in to nothing and reads nothing.** no state store opened, no cloudflare sign-in taken,
// no account read and nothing asked of a deployment: what it needs is the release list and the file
// this binary runs from. an operator with no sign-in at all can run it, which is what makes it the
// first press of an install as well as the way out of an old one.
//
// **there is no door here and there is nothing behind one.** the one-way door stands in front of a
// remote migration (CLAUDE.md) and this command reaches no database — the confirm and the list of
// what a deploy would apply are ./start.go's, on the press that carries.
//
// **it does not hand the run over.** ./main.go's carried execs the console it installs because
// there is a command left to run; here there is not, so the install lands, the screen says which
// release this machine now holds and which press puts it on the deployment
// (../../internal/terminal/install.go's NowOnThenStart), and the process ends.

// what a console already holding the newest release is told.
//
// no act on the end of it, unlike most sentences in this program: nothing went wrong and nothing is
// left undone, so the whole of what there is to say is that the file on this machine was left as it
// was found.
const alreadyCurrent = "this console is already the newest release, so nothing was installed"

// what a console that could not find out is told.
//
// **it is not a failure and does not end this command.** ../../internal/update bounds the read and
// answers every way it could go wrong with a value: github is a third host this console does not
// need to work, and a binary built from a checkout carries no version to weigh against a release at
// all. neither is a state to exit 1 on, and neither is a console this command may call current.
//
// **both states are named, because only one of them is worth doing anything about.** a checkout
// build asked github nothing, so an operator told to check their connection would be looking for a
// fault this machine never had — and a console cut from a release is the one where that is the
// whole of what there is to try.
const noReading = "this console couldn't work out whether a newer one has been released, so " +
	"nothing was installed: a console built from a checkout carries no version to weigh against " +
	"a release, and a release this one could not read is the other way here. If this console came " +
	"from a release, check this machine's connection and run better-giving update again"

func update(args []string, to, wrong io.Writer) error {
	// no flag of its own, and the empty set is the statement: an argument this command does not
	// know is refused rather than passed over (./main.go's updateTakes).
	taken := taking("update", updateTakes)
	if on, err := taken.read(args, to, wrong); err != nil || !on {
		return err
	}

	ctx := context.Background()
	return updating(releases.Latest(ctx, releases.Source(), version), to,
		func(read releases.Read) error {
			_, err := installing(ctx, read, to, terminal.Updating)
			return err
		})
}

// what this command does about the reading it took: the install where this console is behind, and a
// line where it is not.
//
// **the install is a value the caller binds, and the sequence is what is left to be wrong.** what
// it does is ./main.go's installing, held to what it answers where it lives; what nothing else
// holds is that a stop ends this command rather than falling through to the line that says a newer
// console is now on this machine (./update_test.go).
//
// A stop is already a sentence naming what did not happen and the press to run again
// (../../internal/terminal/install.go's InstallStopped), so it is handed straight back and this
// command exits on it.
func updating(read releases.Read, to io.Writer, install func(releases.Read) error) error {
	switch read.Kind {
	case releases.Newer:
		if err := install(read); err != nil {
			return err
		}
		fmt.Fprintln(to)
		fmt.Fprintln(to, terminal.NowOnThenStart(read.Version))
		return nil
	case releases.Current:
		fmt.Fprintln(to, alreadyCurrent)
		return nil
	default:
		fmt.Fprintln(to, noReading)
		return nil
	}
}
