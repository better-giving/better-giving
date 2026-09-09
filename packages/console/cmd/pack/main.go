// Command pack writes the worker bundle a release carries beside the binary.
//
// Run by .github/workflows/release.yml, behind the app's build and `wrangler deploy --dry-run
// --outdir` and behind `go run ./cmd/bake --check` — the bundle is packed from what those wrote,
// and a baked config that has drifted from packages/app is a release that fails rather than a
// binary that refuses at the operator's first press.
//
// The archive is named for the version it is cut at, which is the whole of what picks it:
// internal/release's `BundleSource` derives the address from the binary's own version.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/better-giving/console/internal/bundle"
	"github.com/better-giving/console/internal/pack"
	"github.com/better-giving/console/internal/release"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	// the repository is walked up to rather than assumed, the way ../bake does it, so the command
	// answers the same from packages/console and from anywhere under it.
	root, err := release.RepoRoot(".")
	if err != nil {
		return err
	}
	app := filepath.Join(root, "packages", "app")

	worker := flag.String("worker", "", "wrangler's --outdir: the worker's entry and its modules")
	out := flag.String("out", "", "the archive to write")
	assets := flag.String("assets", filepath.Join(app, "build", "client"),
		"the app's client build, which is what the deployment serves")
	migrations := flag.String("migrations",
		filepath.Join(app, filepath.FromSlash(release.Baked.MigrationsDir)),
		"where the migration files the manifest names are")
	config := flag.String("config", release.ConfigFile(root), "the baked config, which becomes the manifest")
	flag.Parse()

	if *worker == "" || *out == "" {
		flag.Usage()
		return fmt.Errorf("--worker and --out are both needed")
	}

	from := pack.Sources{
		Worker: *worker, Assets: *assets, Migrations: *migrations, Config: *config,
	}
	if err := pack.File(*out, from); err != nil {
		return err
	}

	// read back with the reader an operator's binary uses, against the config this build carries —
	// so the release asset is proven to be one the binary it ships beside will take, rather than
	// one the first press finds out about.
	packed, err := os.Open(*out)
	if err != nil {
		return err
	}
	defer packed.Close()
	read := bundle.ReadFrom(packed, release.Baked)
	if read.Kind != bundle.Held {
		return fmt.Errorf("%s is not a bundle this binary reads: %s %s %v",
			*out, read.Kind, read.Detail, read.Fields)
	}

	fmt.Printf("packed %s — %d modules, %d assets, %d migrations\n",
		*out, len(read.Bundle.Modules), len(read.Bundle.Assets), len(read.Bundle.Migrations))
	return nil
}
