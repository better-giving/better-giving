package release

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// the reader ./cmd/bake writes ./config.json out of, against the shapes packages/app's own config
// can take.
//
// ./config_test.go is the other half and reads the same sources as text: it holds the *committed*
// json equal to them, so a rename that nobody rebakes fails there. what is asserted here is the
// derivation itself — a JSONC file with comments and trailing commas in it, an `env` block that
// declares a deployment of its own, and the refusals that stop a field nobody set from being
// written.

// the block every readable config carries, since a config declaring none is refused below.
const boundDatabase = `"d1_databases": [{ "binding": "DB", "database_name": "better-giving", "migrations_dir": "./migrations" }]`

func TestTheWorkerIsNamedOffAPlainWranglerConfig(t *testing.T) {
	declared, err := Declared(`{ "name": "better-giving", ` + boundDatabase + ` }`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.Name != "better-giving" {
		t.Errorf("name = %q, want %q", declared.Name, "better-giving")
	}
}

func TestAConfigIsReadThroughItsCommentsAndItsTrailingCommas(t *testing.T) {
	// character by character rather than by regular expression, because the only thing that decides
	// whether `//` opens a comment is whether a string is open around it — and a wrangler config
	// holds urls.
	declared, err := Declared(`{
		// the deployment's own name, and the url it answers on is derived from it
		"name": "better-giving", /* both comment forms */
		` + boundDatabase + `,
		"vars": { "PUBLIC_URL": "https://example.org/a//b" },
	}`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.Name != "better-giving" || declared.DatabaseName != "better-giving" {
		t.Errorf("read %q at %q", declared.Name, declared.DatabaseName)
	}
}

func TestACommaAValueHoldsSurvivesTheOneThatTrails(t *testing.T) {
	declared, err := Declared(`{
		"name": "better-giving",
		"d1_databases": [{ "binding": "DB", "database_name": "better-giving, ]", "migrations_dir": "./migrations" }],
	}`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.DatabaseName != "better-giving, ]" {
		t.Errorf("database_name = %q, want %q", declared.DatabaseName, "better-giving, ]")
	}
}

func TestTheDatabaseIsTheEntryBoundAsDB(t *testing.T) {
	declared, err := Declared(`{
		"name": "better-giving",
		"d1_databases": [
			{ "binding": "ARCHIVE", "database_name": "somebody-elses", "migrations_dir": "./elsewhere" },
			{ "binding": "DB", "database_name": "better-giving", "migrations_dir": "./migrations" }
		]
	}`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.DatabaseName != "better-giving" || declared.MigrationsDir != "./migrations" {
		t.Errorf("read %q at %q", declared.DatabaseName, declared.MigrationsDir)
	}
}

func TestTheOnlyEntryIsTakenWhereNothingIsBoundAsDB(t *testing.T) {
	declared, err := Declared(`{
		"name": "better-giving",
		"d1_databases": [{ "binding": "PRIMARY", "database_name": "better-giving", "migrations_dir": "./migrations" }]
	}`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.DatabaseName != "better-giving" {
		t.Errorf("database_name = %q, want %q", declared.DatabaseName, "better-giving")
	}
}

func TestTheTopLevelIsReadEvenWhereAnEnvironmentDeclaresOneOfItsOwn(t *testing.T) {
	// `env.test` in packages/app/wrangler.jsonc and `deploy:test` beside it are a terminal path
	// (DEPLOY.md), and the binary operates neither. a reader that resolved that block would bake
	// `better-giving-test` into a binary whose every press reaches `better-giving`.
	declared, err := Declared(`{
		"name": "better-giving",
		` + boundDatabase + `,
		"env": { "test": {
			"name": "better-giving-test",
			"d1_databases": [{ "binding": "DB", "database_name": "better-giving-test", "migrations_dir": "./migrations" }]
		} }
	}`)
	if err != nil {
		t.Fatalf("Declared: %v", err)
	}
	if declared.Name != "better-giving" || declared.DatabaseName != "better-giving" {
		t.Errorf("read %q at %q", declared.Name, declared.DatabaseName)
	}
}

func TestAConfigThatNamesNoWorkerIsRefused(t *testing.T) {
	// the name is what it is read for, and guessing it is how a binary comes to be baked for a
	// worker nobody has.
	_, err := Declared(`{ "main": "./worker.js" }`)
	if err == nil || !strings.Contains(err.Error(), "worker") {
		t.Errorf("err = %v, want one naming the worker", err)
	}
}

func TestAConfigThatDeclaresNoDatabaseIsRefused(t *testing.T) {
	_, err := Declared(`{ "name": "better-giving" }`)
	if err == nil || !strings.Contains(err.Error(), "database") {
		t.Errorf("err = %v, want one naming the database", err)
	}
}

func TestADatabaseEntryStatingNoMigrationsDirectoryIsRefused(t *testing.T) {
	_, err := Declared(`{
		"name": "better-giving",
		"d1_databases": [{ "binding": "DB", "database_name": "better-giving" }]
	}`)
	if err == nil || !strings.Contains(err.Error(), "migrations") {
		t.Errorf("err = %v, want one naming the migrations directory", err)
	}
}

func TestAConfigThatWillNotParseAtAllIsRefused(t *testing.T) {
	if _, err := Declared(`{ "name": `); err == nil {
		t.Error("a truncated config was read, and a bake would write fields nobody set")
	}
}

func TestTheWidgetNameIsReadOutOfTheModuleThatStatesIt(t *testing.T) {
	// the constant's name, its single quotes and its literal value are the interface — that module's
	// own header says so, and nothing imports it.
	name, err := WidgetNameIn("export const TURNSTILE_WIDGET_NAME = 'better-giving';\n")
	if err != nil {
		t.Fatalf("WidgetNameIn: %v", err)
	}
	if name != "better-giving" {
		t.Errorf("widget = %q, want %q", name, "better-giving")
	}
}

func TestAModuleStatingNoWidgetNameIsRefusedRatherThanGuessedAt(t *testing.T) {
	if _, err := WidgetNameIn("export const SOMETHING_ELSE = 1;\n"); err == nil {
		t.Error("a module stating no name was read, and the bake would carry a second statement of it")
	}
}

func TestTheMigrationsAreEveryScriptInTheDirectoryInTheOrderWranglerAppliesThem(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"0001_b.sql", "0000_a.sql", "meta", "notes.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}

	names, err := MigrationNames(dir)
	if err != nil {
		t.Fatalf("MigrationNames: %v", err)
	}
	if strings.Join(names, ",") != "0000_a.sql,0001_b.sql" {
		t.Errorf("migrations = %v, want the two .sql in order", names)
	}
}

// a config both halves of a drift comparison start from.
func baked() Config {
	return Config{
		Name:                "better-giving",
		DatabaseName:        "better-giving",
		MigrationsDir:       "./migrations",
		Migrations:          []string{"0000_a.sql", "0001_b.sql"},
		TurnstileWidgetName: "better-giving",
		Commit:              strings.Repeat("a", 40),
	}
}

func TestNothingHasDriftedWhereTheTwoSayTheSameThing(t *testing.T) {
	if drifted := DriftedFields(baked(), baked()); len(drifted) != 0 {
		t.Errorf("drifted = %v, want none", drifted)
	}
}

func TestTheCommitIsNotDrift(t *testing.T) {
	// it is the HEAD the committed file was baked at and legitimately differs from the one in the
	// tree now, which is the point of recording it.
	committed := baked()
	committed.Commit = strings.Repeat("b", 40)

	if drifted := DriftedFields(committed, baked()); len(drifted) != 0 {
		t.Errorf("drifted = %v, want none", drifted)
	}
}

func TestDriftNamesTheFieldARenameMoved(t *testing.T) {
	committed := baked()
	committed.Name = "renamed"

	if drifted := DriftedFields(committed, baked()); strings.Join(drifted, ",") != "name" {
		t.Errorf("drifted = %v, want [name]", drifted)
	}
}

func TestDriftNamesTheMigrationsWhereOneWasAddedAndNobodyRebaked(t *testing.T) {
	committed := baked()
	committed.Migrations = []string{"0000_a.sql"}

	if drifted := DriftedFields(committed, baked()); strings.Join(drifted, ",") != "migrations" {
		t.Errorf("drifted = %v, want [migrations]", drifted)
	}
}

func TestAReorderedMigrationListIsDriftBecauseTheOrderIsTheApplyOrder(t *testing.T) {
	// wrangler applies them by filename in order, so a list saying otherwise is a different list.
	committed := baked()
	committed.Migrations = []string{"0001_b.sql", "0000_a.sql"}

	if drifted := DriftedFields(committed, baked()); strings.Join(drifted, ",") != "migrations" {
		t.Errorf("drifted = %v, want [migrations]", drifted)
	}
}

func TestDriftNamesEveryFieldWhereThereIsNoCommittedConfigToRead(t *testing.T) {
	want := "database_name,migrations,migrations_dir,name,turnstileWidgetName"

	if drifted := DriftedFields(Config{}, baked()); strings.Join(drifted, ",") != want {
		t.Errorf("drifted = %v, want %v", drifted, want)
	}
}

func TestABakeOfThisTreeIsTheConfigThatIsCommitted(t *testing.T) {
	// the committed file is what ships inside the binary, and this is the case that fails when it
	// has not been rebaked. the commit is carried over rather than re-read: it is the HEAD the bake
	// ran at and legitimately differs from the one being committed now.
	root := repoRoot(t)
	fresh, err := Bake(root, Baked.Commit)
	if err != nil {
		t.Fatalf("Bake: %v", err)
	}

	written, err := WriteManifest(fresh)
	if err != nil {
		t.Fatalf("WriteManifest: %v", err)
	}
	if string(written) != string(configJSON) {
		t.Errorf("a bake of this tree is not ./config.json's own text — rebake with `go run ./cmd/bake`")
	}
}

func TestTheRepositoryIsFoundFromInsideThePackageBeingBaked(t *testing.T) {
	// a go test runs in the directory of the package under test, so this walks up from
	// internal/release — the same climb `go run ./cmd/bake` makes from packages/console.
	root, err := RepoRoot(".")
	if err != nil {
		t.Fatalf("RepoRoot: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "packages", "app", "wrangler.jsonc")); err != nil {
		t.Errorf("RepoRoot returned %q, which holds no packages/app/wrangler.jsonc", root)
	}
}
