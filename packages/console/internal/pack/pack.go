// Package pack is the release's half of the bundle a deploy is made out of.
//
// **the layout has one producer and one reader, and this is the producer.** ../bundle is what an
// operator's binary reads a downloaded `worker-<version>.tar.gz` back with, and nothing but this
// package writes one — the two are held to each other by ./pack_test.go, which packs a tree and
// reads it back, so a name changed on one side fails `go test` rather than at an operator's press.
//
// **the manifest is the committed config copied and never derived again.** ../release/config.json
// is what the binary carries, and ../bundle compares every field of the two — `commit` included —
// so a manifest baked at release time would carry the tag's revision where the binary carries the
// one its config was baked at, and every deploy would refuse over a field neither half got wrong.
//
// **only the worker's javascript is a module.** ../deploy sends every module up as
// `application/javascript+module`, and `wrangler deploy --dry-run --outdir` writes a README.md of
// its own beside the entry — a file that goes up under that type is a script upload refused for a
// reason that says nothing about the release.
package pack

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/better-giving/console/internal/release"
)

// what the entry module is called, in wrangler's --outdir and inside the bundle alike. ../bundle
// states the same name for the reading half.
const mainModule = "index.js"

// Sources is where each part of one bundle is read from.
type Sources struct {
	// Worker is what `wrangler deploy --dry-run --outdir` wrote: the entry and every module under
	// it, at the paths the importing modules named them by.
	Worker string
	// Assets is the app's client build, which is the directory the deployment serves whole —
	// `_headers` and `.assetsignore` among the files, both of which ../bundle reads as
	// configuration rather than as something to upload.
	Assets string
	// Migrations is packages/app/migrations, of which the manifest's own list is taken.
	Migrations string
	// Config is packages/console/internal/release/config.json, which becomes manifest.json.
	Config string
}

// File is one bundle packed to `at`, the archive removed where the packing failed part way.
func File(at string, from Sources) error {
	out, err := os.Create(at)
	if err != nil {
		return err
	}
	if err := Into(out, from); err != nil {
		out.Close()
		os.Remove(at)
		return err
	}
	return out.Close()
}

// Into is one bundle written as the gzipped tar an operator's binary downloads.
//
// Every part is read before anything is written, so a tree missing one leaves no half-packed
// archive for a release step behind this one to ship.
func Into(out io.Writer, from Sources) error {
	files, err := gather(from)
	if err != nil {
		return err
	}

	zipped := gzip.NewWriter(out)
	archive := tar.NewWriter(zipped)
	for _, name := range slices.Sorted(maps.Keys(files)) {
		body := files[name]
		// no modification time and one mode, so the same tree packs to the same bytes: a checksum
		// an operator verifies is the release's own rather than the clock's.
		if err := archive.WriteHeader(&tar.Header{
			Name:     name,
			Mode:     0o644,
			Size:     int64(len(body)),
			Typeflag: tar.TypeReg,
		}); err != nil {
			return err
		}
		if _, err := archive.Write(body); err != nil {
			return err
		}
	}
	if err := archive.Close(); err != nil {
		return err
	}
	return zipped.Close()
}

// every file the bundle holds, by the path it holds it under.
func gather(from Sources) (map[string][]byte, error) {
	source, err := os.ReadFile(from.Config)
	if err != nil {
		return nil, err
	}
	manifest, err := release.Parse(source)
	if err != nil {
		return nil, fmt.Errorf("%s could not be read: %w", from.Config, err)
	}
	written, err := release.WriteManifest(manifest)
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{"manifest.json": written}

	modules, err := under(from.Worker, isModule)
	if err != nil {
		return nil, err
	}
	if _, held := modules[mainModule]; !held {
		return nil, fmt.Errorf("%s holds no %s — that is not a worker wrangler emitted", from.Worker, mainModule)
	}
	for at, body := range modules {
		files["worker/"+at] = body
	}

	assets, err := under(from.Assets, everything)
	if err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return nil, fmt.Errorf("%s holds no files — that is a deployment serving nothing", from.Assets)
	}
	for at, body := range assets {
		files["assets/"+at] = body
	}

	// the manifest's own list rather than the directory's, because the list is what a deployment's
	// `d1_migrations` table is compared against — a file the bake never saw would be applied by
	// nothing and would leave the bundle carrying sql no half of the deploy names.
	for _, name := range manifest.Migrations {
		sql, err := os.ReadFile(filepath.Join(from.Migrations, name))
		if err != nil {
			return nil, fmt.Errorf("the manifest names %s and %w", name, err)
		}
		files["migrations/"+name] = sql
	}
	return files, nil
}

// every file under dir that `take` allows, keyed by its slash-separated path from dir.
func under(dir string, take func(string) bool) (map[string][]byte, error) {
	files := map[string][]byte{}
	err := filepath.WalkDir(dir, func(at string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		from, err := filepath.Rel(dir, at)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(from)
		if !take(name) {
			return nil
		}
		body, err := os.ReadFile(at)
		if err != nil {
			return err
		}
		files[name] = body
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// whether a file in wrangler's --outdir is one of the worker's modules.
func isModule(name string) bool {
	extension := strings.ToLower(path.Ext(name))
	return extension == ".js" || extension == ".mjs"
}

func everything(string) bool { return true }
