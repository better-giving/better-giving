package release

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// what ./config.json is written out of, which ./cmd/bake is the command for.
//
// **an operator never types any of these and the binary cannot read them off a checkout.** every
// one of them is stated in a file in this repository — the worker name and the database in
// packages/app/wrangler.jsonc, the migrations off that directory, the widget's name in the module
// that states it — and a binary an operator downloads has none of those beside it. so the reading
// happens here, once, and the answer travels inside the binary.
//
// packages/app is reached by path and never as a package: this module declares nothing of the
// workspace and reading a file across the line is what every gate in this repository already does.
//
// ./config_test.go is the other half of the arrangement — it holds the *committed* json equal to
// these same sources, so a rename that nobody rebakes fails `go test` rather than shipping a binary
// looking for a worker nobody has, and `go run ./cmd/bake` is the way out.

// where this reads each fact from, named from the repository root so one convention covers all of
// them.
const (
	wranglerConfig = "packages/app/wrangler.jsonc"
	// read as text because it is TypeScript behind a `$lib` alias.
	widgetSource = "packages/app/src/lib/config/turnstile-widget.ts"
	bakedConfig  = "packages/console/internal/release/config.json"
)

// ConfigFile is the file a bake writes, which is the one the `//go:embed` in ./config.go takes.
func ConfigFile(root string) string { return filepath.Join(root, filepath.FromSlash(bakedConfig)) }

// Bake is the whole baked config, read off the tree at root and stamped with commit.
//
// Every failure is returned rather than defaulted: a bake that could not read one of these has to
// stop rather than write a field somebody guessed.
func Bake(root, commit string) (Config, error) {
	source, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(wranglerConfig)))
	if err != nil {
		return Config{}, err
	}
	baked, err := Declared(string(source))
	if err != nil {
		return Config{}, err
	}

	baked.Migrations, err = MigrationNames(
		filepath.Join(root, "packages", "app", filepath.FromSlash(baked.MigrationsDir)),
	)
	if err != nil {
		return Config{}, err
	}

	widget, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(widgetSource)))
	if err != nil {
		return Config{}, err
	}
	baked.TurnstileWidgetName, err = WidgetNameIn(string(widget))
	if err != nil {
		return Config{}, err
	}

	baked.Commit = commit
	return baked, nil
}

// Declared is the worker, the database and the migrations directory a wrangler config states, off
// its top level.
//
// **`env` is not read, and the rehearsal is why that has to be said.** packages/app/wrangler.jsonc
// declares an `env.test` block and packages/app declares a `deploy:test` that uploads it, which is
// a terminal path and no part of the console (DEPLOY.md). Decoding the top level alone is what
// leaves that block unread, and `d1_databases` is `notInheritable` in wrangler's own config
// resolution — so it names a database of its own, one the binary never resolves, offers to create
// or reports on.
func Declared(text string) (Config, error) {
	var file struct {
		Name string    `json:"name"`
		D1   []d1Entry `json:"d1_databases"`
	}
	if err := json.Unmarshal([]byte(StripJSONC(text)), &file); err != nil {
		return Config{}, fmt.Errorf("that wrangler config will not parse: %w", err)
	}
	if file.Name == "" {
		return Config{}, fmt.Errorf("that wrangler config names no worker")
	}

	entry := databaseEntry(file.D1)
	if entry == nil {
		return Config{}, fmt.Errorf("that wrangler config declares no d1_databases entry with a database_name")
	}
	if entry.MigrationsDir == "" {
		return Config{}, fmt.Errorf("that wrangler config states no migrations_dir for that database")
	}

	return Config{
		Name:          file.Name,
		DatabaseName:  *entry.DatabaseName,
		MigrationsDir: entry.MigrationsDir,
	}, nil
}

// one `d1_databases` entry, in the three fields a bake reads off it.
//
// The name is a pointer so that an entry stating none is told from one stating an empty string:
// the first is a block about some other kind of resource and the second is a config to refuse.
type d1Entry struct {
	Binding       string  `json:"binding"`
	DatabaseName  *string `json:"database_name"`
	MigrationsDir string  `json:"migrations_dir"`
}

// the entry this deployment is about, or nil where the block states none.
//
// The entry bound as `DB` is the deployment's own — that binding is the name every query in
// packages/app is written against. An entry is taken unbound only where there is exactly one,
// because a config with several and none bound as `DB` is one nothing can pick from without
// guessing.
func databaseEntry(block []d1Entry) *d1Entry {
	named := []d1Entry{}
	for _, one := range block {
		if one.DatabaseName != nil {
			named = append(named, one)
		}
	}

	entry := (*d1Entry)(nil)
	for at := range named {
		if named[at].Binding == "DB" {
			entry = &named[at]
			break
		}
	}
	if entry == nil && len(named) == 1 {
		entry = &named[0]
	}
	if entry == nil || *entry.DatabaseName == "" {
		return nil
	}
	return entry
}

// WidgetNameIn is the widget's name as text states it.
//
// The constant's name, its single quotes and its literal value are the interface, and the module
// holding it says so in its own header: nothing imports it, and this reader and
// packages/app/scripts/turnstile-keys.js both match it as text. It refuses rather than falling back
// to a literal — a second statement of the name is the thing this arrangement exists to avoid.
func WidgetNameIn(text string) (string, error) {
	match := regexp.MustCompile(`TURNSTILE_WIDGET_NAME\s*=\s*'([^']+)'`).FindStringSubmatch(text)
	if match == nil {
		return "", fmt.Errorf("that module states no TURNSTILE_WIDGET_NAME")
	}
	return match[1], nil
}

// MigrationNames is every migration in dir, in the order wrangler applies them.
//
// The filenames are what the binary compares a deployment's own `d1_migrations` table against, so
// the list is the whole of it: wrangler records them by filename and CLAUDE.md refuses a rename of
// one that has been applied anywhere. os.ReadDir is ordered by filename, which is that order.
func MigrationNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	return names, nil
}

// DriftedFields is the fields on which a committed config and a fresh bake disagree.
//
// The names are the ones the file spells, so a report names a field where somebody can find it, and
// they are returned in that order. `commit` is left out — it is the HEAD the committed file was
// baked at, and it legitimately differs from the one in the tree now.
func DriftedFields(committed, baked Config) []string {
	drifted := []string{}
	if committed.DatabaseName != baked.DatabaseName {
		drifted = append(drifted, "database_name")
	}
	if !slices.Equal(committed.Migrations, baked.Migrations) {
		drifted = append(drifted, "migrations")
	}
	if committed.MigrationsDir != baked.MigrationsDir {
		drifted = append(drifted, "migrations_dir")
	}
	if committed.Name != baked.Name {
		drifted = append(drifted, "name")
	}
	if committed.TurnstileWidgetName != baked.TurnstileWidgetName {
		drifted = append(drifted, "turnstileWidgetName")
	}
	return drifted
}

// Head is the commit the tree at root is at right now, which is what a bake records.
func Head(root string) (string, error) {
	command := exec.Command("git", "rev-parse", "HEAD")
	command.Dir = root
	at, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}
	return strings.TrimSpace(string(at)), nil
}

// RepoRoot is the repository the sources above are read from, walked up to from dir.
//
// It stops at the directory holding packages/app/wrangler.jsonc, which is the thing being read
// rather than a marker file that could move.
func RepoRoot(dir string) (string, error) {
	at, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(at, filepath.FromSlash(wranglerConfig))); err == nil {
			return at, nil
		}
		up := filepath.Dir(at)
		if up == at {
			return "", fmt.Errorf("no %s above %s", wranglerConfig, dir)
		}
		at = up
	}
}

// StripJSONC is JSONC reduced to JSON: comments blanked and trailing commas dropped, both
// string-aware.
//
// Character by character rather than by regular expression, because the only thing that decides
// whether `//` opens a comment is whether a string is open around it — and a wrangler config holds
// urls. A reader that got this wrong would refuse a file there is nothing wrong with.
func StripJSONC(source string) string {
	out := strings.Builder{}
	inString := false

	for at := 0; at < len(source); at++ {
		char := source[at]

		if inString {
			// an escape carries its next character whatever it is, so a `\"` does not close the
			// string.
			if char == '\\' && at+1 < len(source) {
				out.WriteByte(char)
				out.WriteByte(source[at+1])
				at++
				continue
			}
			if char == '"' {
				inString = false
			}
			out.WriteByte(char)
			continue
		}

		if char == '"' {
			inString = true
			out.WriteByte(char)
			continue
		}

		if char == '/' && at+1 < len(source) && source[at+1] == '/' {
			for at < len(source) && source[at] != '\n' {
				at++
			}
			at--
			continue
		}

		if char == '/' && at+1 < len(source) && source[at+1] == '*' {
			at += 2
			for at+1 < len(source) && !(source[at] == '*' && source[at+1] == '/') {
				at++
			}
			at++
			continue
		}

		// a comma before the close of an object or an array is legal JSONC and is not legal JSON,
		// and every hand-edited config eventually grows one. comments are already gone from `out`,
		// so trailing whitespace back to a comma is exactly that case — and the closing quote of a
		// string ending in one stands between it and this, which is what keeps a comma a value
		// holds.
		if char == '}' || char == ']' {
			trimmed := strings.TrimRight(out.String(), " \t\r\n")
			if strings.HasSuffix(trimmed, ",") {
				kept := strings.TrimSuffix(trimmed, ",")
				out.Reset()
				out.WriteString(kept)
			}
		}

		out.WriteByte(char)
	}

	return out.String()
}
