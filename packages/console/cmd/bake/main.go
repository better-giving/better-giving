// Command bake writes what the binary is baked to know about this deployment.
//
// Run it by hand — `go run ./cmd/bake` from packages/console — whenever one of its sources changes;
// nothing in this repository runs it, and internal/release/config_test.go is what tells you it is
// due. `--check` writes nothing and exits 1 on the same difference, for a caller that wants the
// answer without the write.
package main

import (
	"fmt"
	"os"
	"slices"

	"github.com/better-giving/console/internal/release"
)

func main() {
	if err := bake(slices.Contains(os.Args[1:], "--check")); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func bake(check bool) error {
	// the repository is walked up to rather than assumed, so the command answers the same from
	// packages/console and from anywhere under it.
	root, err := release.RepoRoot(".")
	if err != nil {
		return err
	}
	commit, err := release.Head(root)
	if err != nil {
		return err
	}
	baked, err := release.Bake(root, commit)
	if err != nil {
		return err
	}
	written, err := release.WriteManifest(baked)
	if err != nil {
		return err
	}

	at := release.ConfigFile(root)
	if !check {
		if err := os.WriteFile(at, written, 0o644); err != nil {
			return err
		}
		fmt.Printf("baked %s at %s\n", at, baked.Commit)
		return nil
	}

	source, err := os.ReadFile(at)
	if err != nil {
		return err
	}
	committed, err := release.Parse(source)
	if err != nil {
		return fmt.Errorf("%s could not be read: %w", at, err)
	}
	drifted := release.DriftedFields(committed, baked)
	if len(drifted) == 0 {
		return nil
	}
	return fmt.Errorf("%s is not what packages/app declares — run `go run ./cmd/bake`: %v", at, drifted)
}
