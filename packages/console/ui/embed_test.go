package ui

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// the committed dist/index.html is a placeholder, and these cases keep it one.
//
// what is checked is the embed itself — what a binary built from this tree would serve — and only
// while ./dist holds that one file: a working copy the release step or scripts/console-start.sh has
// copied a real build into is the release path, and its index.html is supposed to load assets.

// the commands that put the built screens into ./dist, exactly as the release spells them.
var buildCommands = []string{
	"pnpm --filter @better-giving/console-ui build",
	"rm -rf packages/console/ui/dist",
	"cp -R packages/console-ui/build/client packages/console/ui/dist",
}

// what is wrong with dist as the placeholder, or nothing when dist holds more than the placeholder.
func placeholderProblems(dist fs.FS) []string {
	entries, err := fs.ReadDir(dist, ".")
	if err != nil {
		return []string{"dist cannot be listed: " + err.Error()}
	}
	if len(entries) != 1 || entries[0].Name() != "index.html" {
		return nil
	}
	page, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		return []string{"index.html cannot be read: " + err.Error()}
	}
	text := string(page)
	var problems []string
	// a placeholder carries everything it shows: a script, a stylesheet or an asset path is a file
	// the embed does not hold, which is a page that loads and draws nothing.
	for _, refused := range []string{"/assets/", "<script", "<link", "src="} {
		if strings.Contains(text, refused) {
			problems = append(problems, "index.html contains "+refused)
		}
	}
	for _, command := range buildCommands {
		if !strings.Contains(text, command) {
			problems = append(problems, "index.html does not name `"+command+"`")
		}
	}
	return problems
}

func TestCommittedPlaceholderIsSelfContainedAndNamesTheBuild(t *testing.T) {
	dist, err := fs.Sub(built, "dist")
	if err != nil {
		t.Fatal(err)
	}
	for _, problem := range placeholderProblems(dist) {
		t.Errorf("packages/console/ui/dist: %s — it is the page a binary built without its screens serves", problem)
	}
}

func TestBuildCommandsAreTheReleaseWorkflows(t *testing.T) {
	workflow, err := os.ReadFile(filepath.Join("..", "..", "..", ".github", "workflows", "release.yml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, command := range buildCommands {
		if !strings.Contains(string(workflow), command) {
			t.Errorf("release.yml no longer runs `%s`: update buildCommands and dist/index.html to the step that does", command)
		}
	}
}

func TestPlaceholderCheckStandsAsideForACopiedBuild(t *testing.T) {
	copied := fstest.MapFS{
		"index.html":               {Data: []byte(`<script type="module" src="/assets/entry.client-x.js"></script>`)},
		"assets/entry.client-x.js": {Data: []byte("export {}")},
	}
	if problems := placeholderProblems(copied); problems != nil {
		t.Errorf("a copied build was held to the placeholder's rules: %v", problems)
	}
}

func TestPlaceholderCheckRefusesALoneBuildDocument(t *testing.T) {
	lone := fstest.MapFS{
		"index.html": {Data: []byte(`<link rel="modulepreload" href="/assets/root-x.js" />`)},
	}
	if problems := placeholderProblems(lone); len(problems) == 0 {
		t.Error("a build's index.html with none of its assets passed as the placeholder")
	}
}
