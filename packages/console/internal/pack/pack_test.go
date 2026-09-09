package pack

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/bundle"
	"github.com/better-giving/console/internal/release"
)

// the config the release bakes and the binary carries, which both halves are held to.
func baked() release.Config {
	return release.Config{
		Name:                "better-giving",
		DatabaseName:        "better-giving",
		MigrationsDir:       "./migrations",
		Migrations:          []string{"0000_initial.sql", "0001_later.sql"},
		TurnstileWidgetName: "better-giving",
		Commit:              strings.Repeat("a", 40),
	}
}

// a tree shaped like the one the release packs from: wrangler's --outdir, the app's client build,
// its migrations directory, and the committed baked config.
func tree(t *testing.T, files map[string]string) Sources {
	t.Helper()
	root := t.TempDir()
	written, err := release.WriteManifest(baked())
	if err != nil {
		t.Fatalf("WriteManifest: %v", err)
	}
	held := map[string]string{
		"config.json": string(written),
		// wrangler names the entry index.js and writes every module it imports beside it, under
		// whatever path the importing module wrote — and a README.md of its own.
		"worker/index.js":               "export default {};\n",
		"worker/assets/context-a1.js":   "export const context = 1;\n",
		"worker/README.md":              "This folder contains the built output assets.\n",
		"client/embed.js":               "console.log(1);\n",
		"client/assets/app-b2.css":      ".a{color:red}\n",
		"client/_headers":               "/embed.js\n  cache-control: public\n",
		"migrations/0000_initial.sql":   "create table a (b text);\n",
		"migrations/0001_later.sql":     "alter table a add column c text;\n",
		"migrations/meta/_journal.json": "{}\n",
	}
	for name, body := range files {
		if body == "" {
			delete(held, name)
			continue
		}
		held[name] = body
	}
	for name, body := range held {
		at := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := os.WriteFile(at, []byte(body), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}
	return Sources{
		Worker:     filepath.Join(root, "worker"),
		Assets:     filepath.Join(root, "client"),
		Migrations: filepath.Join(root, "migrations"),
		Config:     filepath.Join(root, "config.json"),
	}
}

func packed(t *testing.T, from Sources) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := Into(&out, from); err != nil {
		t.Fatalf("Into: %v", err)
	}
	return out.Bytes()
}

// the whole of what this package exists for: the layout has one producer and one reader, and a
// bundle packed here is one internal/bundle reads back whole.
func TestABundleThisPacksIsOneTheBinaryReads(t *testing.T) {
	read := bundle.ReadFrom(bytes.NewReader(packed(t, tree(t, nil))), baked())

	if read.Kind != bundle.Held {
		t.Fatalf("kind = %q (%s), want %q", read.Kind, read.Detail, bundle.Held)
	}
	if read.Bundle.MainModule != "index.js" {
		t.Errorf("main module = %q, want index.js", read.Bundle.MainModule)
	}
	if read.Bundle.Modules[0].Specifier != "index.js" {
		t.Errorf("first module = %q, want index.js", read.Bundle.Modules[0].Specifier)
	}
	if len(read.Bundle.Modules) != 2 || read.Bundle.Modules[1].Specifier != "assets/context-a1.js" {
		t.Errorf("modules = %v, want the entry and assets/context-a1.js", specifiers(read.Bundle))
	}
	if got := read.Bundle.Headers; got != "/embed.js\n  cache-control: public\n" {
		t.Errorf("headers = %q", got)
	}
	if read.Bundle.Migrations["0001_later.sql"] != "alter table a add column c text;\n" {
		t.Errorf("migrations = %v", read.Bundle.Migrations)
	}
	if paths := assetPaths(read.Bundle); len(paths) != 2 ||
		paths[0] != "/assets/app-b2.css" || paths[1] != "/embed.js" {
		t.Errorf("assets = %v, want the two files the deployment serves", paths)
	}
}

// wrangler writes a README.md into its own --outdir, and every module of the bundle goes up as
// javascript — so a file that is not one is a script upload refused for a reason that says nothing
// about the release.
func TestNothingButTheWorkersJavascriptIsPackedAsAModule(t *testing.T) {
	read := bundle.ReadFrom(bytes.NewReader(packed(t, tree(t, nil))), baked())
	for _, module := range read.Bundle.Modules {
		if strings.HasSuffix(module.Specifier, ".md") {
			t.Errorf("module %q was packed", module.Specifier)
		}
	}
}

// the manifest is the committed config copied rather than derived again, which is what lets the two
// halves be held equal field for field — `commit` included.
func TestTheManifestIsTheBakedConfigThisBinaryCarries(t *testing.T) {
	read := bundle.ReadFrom(bytes.NewReader(packed(t, tree(t, nil))), baked())
	if read.Bundle.Manifest.Commit != baked().Commit {
		t.Errorf("commit = %q, want %q", read.Bundle.Manifest.Commit, baked().Commit)
	}
}

func TestAWorkerDirectoryStatingNoEntryIsRefused(t *testing.T) {
	var out bytes.Buffer
	err := Into(&out, tree(t, map[string]string{"worker/index.js": ""}))
	if err == nil || !strings.Contains(err.Error(), "index.js") {
		t.Fatalf("err = %v, want one naming the entry", err)
	}
}

func TestAMigrationTheManifestNamesAndTheTreeDoesNotIsRefused(t *testing.T) {
	var out bytes.Buffer
	err := Into(&out, tree(t, map[string]string{"migrations/0001_later.sql": ""}))
	if err == nil || !strings.Contains(err.Error(), "0001_later.sql") {
		t.Fatalf("err = %v, want one naming the migration", err)
	}
}

func specifiers(held bundle.Bundle) []string {
	names := []string{}
	for _, module := range held.Modules {
		names = append(names, module.Specifier)
	}
	return names
}

func assetPaths(held bundle.Bundle) []string {
	paths := []string{}
	for _, asset := range held.Assets {
		paths = append(paths, asset.Path)
	}
	return paths
}
