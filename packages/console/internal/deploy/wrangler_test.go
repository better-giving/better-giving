package deploy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// the top-level keys of packages/app/wrangler.jsonc that bind nothing. every other key is a binding
// block, so a block added there is read below whether or not anybody taught this file its name.
var unbinding = []string{
	"$schema", "name", "main", "compatibility_date", "compatibility_flags",
	"keep_vars", "observability", "triggers", "env",
}

// the upload's word for each binding block wrangler.jsonc may hold at its top level.
var uploadTypeOf = map[string]string{
	"d1_databases": "d1",
	"ratelimits":   "ratelimit",
	"ai":           "ai",
}

// the upload's bindings against every binding packages/app/wrangler.jsonc declares at its top
// level, by name and by type.
//
// a `wrangler deploy` from a checkout binds what that file declares and `better-giving start`
// binds what ./upload.go's bindings states, so a block added there and not here is a deployment
// the console put up without it — `env.AI` undefined on every request that reaches a model. the
// release record is the console's own and is on no wrangler config.
func TestTheUploadBindsEverythingThatConfigBinds(t *testing.T) {
	root, err := release.RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "packages", "app", "wrangler.jsonc"))
	if err != nil {
		t.Fatal(err)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal([]byte(release.StripJSONC(string(source))), &top); err != nil {
		t.Fatalf("that config will not parse: %v", err)
	}

	declared := []string{}
	for key, block := range top {
		if slices.Contains(unbinding, key) {
			continue
		}
		kind, known := uploadTypeOf[key]
		if !known {
			t.Errorf("that config declares %q, which the upload sends no binding for", key)
			continue
		}
		for _, name := range bindingNames(t, key, block) {
			declared = append(declared, kind+" "+name)
		}
	}

	sent := []string{}
	for _, one := range bindings(Options{Shape: release.Upload, DatabaseID: "a-database", Release: "1.2.3"}) {
		binding := one.(map[string]any)
		if binding["name"] == deployment.RecordedReleaseName {
			continue
		}
		sent = append(sent, binding["type"].(string)+" "+binding["name"].(string))
	}

	slices.Sort(declared)
	slices.Sort(sent)
	if !slices.Equal(declared, sent) {
		t.Errorf("that config binds %v and the upload sends %v", declared, sent)
	}
}

// the names one binding block declares: an object or a list of them, each naming its binding
// under `binding` or, for a rate limiter, under `name`.
func bindingNames(t *testing.T, key string, block json.RawMessage) []string {
	t.Helper()
	type entry struct {
		Binding string `json:"binding"`
		Name    string `json:"name"`
	}
	entries := []entry{}
	if err := json.Unmarshal(block, &entries); err != nil {
		var one entry
		if err := json.Unmarshal(block, &one); err != nil {
			t.Fatalf("%q is neither a binding nor a list of them: %v", key, err)
		}
		entries = append(entries, one)
	}
	names := []string{}
	for _, one := range entries {
		name := one.Binding
		if name == "" {
			name = one.Name
		}
		if name == "" {
			t.Fatalf("an entry of %q names no binding", key)
		}
		names = append(names, name)
	}
	return names
}
