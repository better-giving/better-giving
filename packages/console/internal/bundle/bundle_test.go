package bundle

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/release"
)

// the config both halves of a deploy are checked against, which every case below alters one part
// of.
func baked() release.Config {
	return release.Config{
		Name:                "better-giving",
		DatabaseName:        "better-giving",
		MigrationsDir:       "./migrations",
		Migrations:          []string{"0000_initial.sql"},
		TurnstileWidgetName: "better-giving",
		Commit:              strings.Repeat("a", 40),
	}
}

// a bundle as the release packs one, with `files` written over the defaults.
func packed(t *testing.T, manifest any, files map[string]string) []byte {
	t.Helper()
	held := map[string]string{
		"worker/index.js":             "export default {};\n",
		"worker/assets/context.js":    "export const context = 1;\n",
		"assets/embed.js":             "console.log(1);\n",
		"assets/_headers":             "/embed.js\n  cache-control: public\n",
		"migrations/0000_initial.sql": "create table a (b text);\n",
	}
	for name, body := range files {
		if body == "" {
			delete(held, name)
			continue
		}
		held[name] = body
	}
	if manifest != nil {
		written, err := json.Marshal(manifest)
		if err != nil {
			t.Fatalf("Marshal: %v", err)
		}
		held["manifest.json"] = string(written)
	}

	var out bytes.Buffer
	zipped := gzip.NewWriter(&out)
	archive := tar.NewWriter(zipped)
	for name, body := range held {
		if err := archive.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatalf("WriteHeader: %v", err)
		}
		if _, err := archive.Write([]byte(body)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := zipped.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return out.Bytes()
}

func TestAReleaseCarryingNoSuchAssetIsMissingRatherThanUnreadable(t *testing.T) {
	// the two are different sentences: a source with no bundle is a version this binary cannot
	// deploy from at all, and a body that is not a bundle is a download that went wrong.
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer source.Close()

	read := Fetch(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(), nil)

	if read.Kind != Missing {
		t.Errorf("kind = %q (%s), want %q", read.Kind, read.Detail, Missing)
	}
}

func TestABundleIsFetchedAndCheckedInOne(t *testing.T) {
	body := packed(t, baked(), nil)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write(body)
	}))
	defer source.Close()

	read := Fetch(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(), nil)

	if read.Kind != Held || read.Bundle.MainModule != "index.js" {
		t.Errorf("kind = %q (%s), want the bundle", read.Kind, read.Detail)
	}
}

func TestAReleaseThatCannotBeReachedIsNotABundleThatIsNotThere(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "gateway", http.StatusBadGateway)
	}))
	defer source.Close()

	read := Fetch(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(), nil)

	if read.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", read.Kind, Unreachable)
	}
}

func TestAFetchStopsWhereTheOperatorStopsWaiting(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer source.Close()

	ctx, stop := context.WithCancel(context.Background())
	stop()
	read := Fetch(ctx, source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(), nil)

	if read.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", read.Kind, Unreachable)
	}
}

func TestAReleaseThatNeverFinishesAnsweringIsUnreachable(t *testing.T) {
	// the bundle is megabytes over the operator's own connection, so the bound is a generous one —
	// but a source that answers a header and then nothing would hold the press open for as long as
	// the tab is.
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer source.Close()

	read := fetchWithin(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz",
		baked(), 20*time.Millisecond, nil)

	if read.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", read.Kind, Unreachable)
	}
}

func TestABundleCarriesTheWorkerItsAssetsAndItsMigrations(t *testing.T) {
	read := ReadFrom(bytes.NewReader(packed(t, baked(), nil)), baked())

	if read.Kind != Held {
		t.Fatalf("kind = %q (%s), want %q", read.Kind, read.Detail, Held)
	}
	if read.Bundle.MainModule != "index.js" {
		t.Errorf("main module = %q, want index.js", read.Bundle.MainModule)
	}
	if len(read.Bundle.Modules) != 2 {
		t.Errorf("modules = %d, want the entry and the one it imports", len(read.Bundle.Modules))
	}
	if read.Bundle.Modules[0].Specifier != "index.js" {
		t.Errorf("the first module is %q, and the entry is what the upload names", read.Bundle.Modules[0].Specifier)
	}
	if got := read.Bundle.Migrations["0000_initial.sql"]; got != "create table a (b text);\n" {
		t.Errorf("migration = %q, want the file's own sql", got)
	}
}

func TestABundleCarryingNoSecondWorkerIsReadWhole(t *testing.T) {
	// the deployment serves the donor-facing page itself (CLAUDE.md → Product surface), so ./worker
	// and ./assets are the whole of a bundle and a directory beside them is nothing this binary
	// looks for.
	read := ReadFrom(bytes.NewReader(packed(t, baked(), nil)), baked())

	if read.Kind != Held {
		t.Fatalf("kind = %q (%s), want %q", read.Kind, read.Detail, Held)
	}
	if len(read.Bundle.Modules) == 0 || len(read.Bundle.Assets) == 0 {
		t.Errorf("read = %+v, want the worker and its assets", read.Bundle)
	}
}

func TestTheModuleSpecifierIsThePathTheImportingModuleWrote(t *testing.T) {
	// the part name of a module in the upload is the specifier as its importer wrote it, path
	// separators included — so a nested module keeps the directory in front of its name.
	read := ReadFrom(bytes.NewReader(packed(t, baked(), nil)), baked())

	specifiers := []string{}
	for _, module := range read.Bundle.Modules {
		specifiers = append(specifiers, module.Specifier)
	}
	if strings.Join(specifiers, " ") != "index.js assets/context.js" {
		t.Errorf("specifiers = %v, want the entry first and the rest under it", specifiers)
	}
}

func TestABundleOfAnotherShapeOfTheAppIsRefusedBeforeAnythingIsApplied(t *testing.T) {
	// the whole reason the check exists: the binary states the deployment's bindings and its
	// migration list, and a bundle built from another revision states different ones — applying its
	// migrations under this binary's upload is a database and a worker that disagree.
	theirs := baked()
	theirs.Migrations = append(theirs.Migrations, "0001_later.sql")
	theirs.Commit = strings.Repeat("b", 40)

	read := ReadFrom(bytes.NewReader(packed(t, theirs, nil)), baked())

	if read.Kind != Mismatched {
		t.Fatalf("kind = %q, want %q", read.Kind, Mismatched)
	}
	if strings.Join(read.Fields, ",") != "commit,migrations" {
		t.Errorf("fields = %v, want each field the two disagree on, named", read.Fields)
	}
}

func TestEveryBakedFieldIsComparedAndNotJustTheNames(t *testing.T) {
	for _, one := range []struct {
		field   string
		altered func(*release.Config)
	}{
		{"name", func(c *release.Config) { c.Name = "somebody-elses" }},
		{"database_name", func(c *release.Config) { c.DatabaseName = "somebody-elses" }},
		{"migrations_dir", func(c *release.Config) { c.MigrationsDir = "./elsewhere" }},
		{"turnstileWidgetName", func(c *release.Config) { c.TurnstileWidgetName = "other" }},
		{"commit", func(c *release.Config) { c.Commit = strings.Repeat("b", 40) }},
	} {
		theirs := baked()
		one.altered(&theirs)
		read := ReadFrom(bytes.NewReader(packed(t, theirs, nil)), baked())
		if read.Kind != Mismatched || strings.Join(read.Fields, ",") != one.field {
			t.Errorf("a bundle differing in %s read as %q %v", one.field, read.Kind, read.Fields)
		}
	}
}

func TestABundleThatIsNotOneIsUnreadableRatherThanEmpty(t *testing.T) {
	for _, one := range []struct {
		what   string
		source []byte
	}{
		{"not gzip at all", []byte("<html>404</html>")},
		{"no manifest", packed(t, nil, nil)},
		{"no worker entry", packed(t, baked(), map[string]string{"worker/index.js": ""})},
		{"a migration the manifest names is not in it", packed(t, baked(), map[string]string{"migrations/0000_initial.sql": ""})},
	} {
		read := ReadFrom(bytes.NewReader(one.source), baked())
		if read.Kind != Unreadable {
			t.Errorf("%s read as %q, want %q", one.what, read.Kind, Unreadable)
		}
	}
}

func TestTheManifestKeyIsTheHashCloudflareDerives(t *testing.T) {
	// `blake3(base64(bytes) + extensionWithoutDot)` cut to 32 characters, which is wrangler's own
	// `hashFile`. a wrong digest is not a refused request but an upload of the wrong files under
	// the right names, so the two values below are taken from that derivation rather than from this
	// implementation.
	if got := Hash([]byte("console.log(1);\n"), "embed.js"); got != "b938c21ba4ab7482e2f715d86b75ca0c" {
		t.Errorf("Hash of a js file = %q", got)
	}
	// a file with no extension appends nothing, rather than appending the name or a dot.
	if got := Hash([]byte("hello"), "LICENSE"); got != "324ea05bea4d7f75b8d9ed695e65b2ca" {
		t.Errorf("Hash of an extensionless file = %q", got)
	}
}

func TestTheAssetsAreTheFilesTheDeploymentServes(t *testing.T) {
	read := ReadFrom(bytes.NewReader(packed(t, baked(), nil)), baked())

	if len(read.Bundle.Assets) != 1 {
		t.Fatalf("assets = %v, want the one file under ./assets that is served", read.Bundle.Assets)
	}
	asset := read.Bundle.Assets[0]
	if asset.Path != "/embed.js" {
		t.Errorf("path = %q, want the path it is served at", asset.Path)
	}
	if asset.Hash != Hash(asset.Body, "embed.js") {
		t.Errorf("hash = %q, want the key its manifest entry carries", asset.Hash)
	}
	if !strings.HasPrefix(asset.ContentType, "text/javascript") {
		t.Errorf("content type = %q, want what a browser is served that file as", asset.ContentType)
	}
}

func TestTheHeadersFileTravelsInTheScriptsMetadataRatherThanAsAnAsset(t *testing.T) {
	// cloudflare's upload leaves it out of the manifest and takes its contents on the script's own
	// metadata, so a deployment whose rules were uploaded as an asset serves the rules and applies
	// none of them.
	read := ReadFrom(bytes.NewReader(packed(t, baked(), nil)), baked())

	if read.Bundle.Headers != "/embed.js\n  cache-control: public\n" {
		t.Errorf("headers = %q, want what ./assets/_headers holds", read.Bundle.Headers)
	}
	for _, asset := range read.Bundle.Assets {
		if asset.Path == "/_headers" {
			t.Error("_headers was uploaded as a file the deployment serves")
		}
	}
}

func TestNothingTheIgnoreFileNamesIsEverUploaded(t *testing.T) {
	// `.dev.vars` is the case that says why this is not tidiness: it is a file of secrets that sits
	// beside a build, and an asset is served to anyone who asks for it by name.
	read := ReadFrom(bytes.NewReader(packed(t, baked(), map[string]string{
		"assets/.assetsignore": "wrangler.json\n.dev.vars\n\n# a comment\nreports/\n",
		"assets/wrangler.json": "{}\n",
		"assets/.dev.vars":     "STRIPE_SECRET_KEY=sk_live_1\n",
		"assets/_redirects":    "/old /new\n",
		"assets/reports/a.txt": "a\n",
		"assets/kept.txt":      "kept\n",
	})), baked())

	paths := []string{}
	for _, asset := range read.Bundle.Assets {
		paths = append(paths, asset.Path)
	}
	if strings.Join(paths, " ") != "/embed.js /kept.txt" {
		t.Errorf("assets = %v, want only the files that are served", paths)
	}
}

func TestAFileNothingClaimsATypeForIsUploadedClaimingNone(t *testing.T) {
	read := ReadFrom(bytes.NewReader(packed(t, baked(), map[string]string{
		"assets/data.unknownext": "{}\n",
	})), baked())

	for _, asset := range read.Bundle.Assets {
		if asset.Path == "/data.unknownext" && asset.ContentType != NoContentType {
			t.Errorf("content type = %q, want the literal that claims none", asset.ContentType)
		}
	}
}

func TestEveryKindOfFileThisBuildEmitsIsServedAsWhatItIs(t *testing.T) {
	// the machine the binary runs on holds no mime database of this repository's making, and go's
	// own table stops at the web's oldest half — a font served as the literal that claims no type is
	// a font the browser will not use, and every screen of the deployment loses its typeface.
	for name, want := range map[string]string{
		"assets/root-BAI7Y5pc.css":           "text/css; charset=utf-8",
		"favicon.ico":                        "image/vnd.microsoft.icon",
		"embed.js":                           "text/javascript; charset=utf-8",
		"assets/RedHatText-Regular-Dm.woff2": "font/woff2",
		"assets/RedHatMono-Regular.WOFF2":    "font/woff2",
		"robots.txt":                         "text/plain; charset=utf-8",
		"assets/entry.client-Cq2f.js.map":    "application/json",
		"site.webmanifest":                   "application/manifest+json",
	} {
		if got := contentType(name); got != want {
			t.Errorf("%s is served as %q, want %q", name, got, want)
		}
	}
	if got := contentType("assets/data.unheardof"); got != NoContentType {
		t.Errorf("an extension nothing claims a type for = %q, want %q", got, NoContentType)
	}
}

func TestAnArchiveThatExpandsPastWhatOneDeployHoldsIsRefused(t *testing.T) {
	// the bound on the download is a bound on the compressed stream alone, and what a deploy holds
	// in memory is what those bytes expand to — which an archive states and nothing checks.
	_, err := unpacked(bytes.NewReader(packed(t, baked(), nil)), 64)

	if err == nil {
		t.Fatal("an archive expanding past the ceiling was read whole")
	}
	if !strings.Contains(err.Error(), "more than one deploy holds") {
		t.Errorf("err = %v, want the bound named rather than a truncated archive", err)
	}
}

func TestADownloadSaysHowMuchOfItHasArrived(t *testing.T) {
	body := packed(t, baked(), nil)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write(body)
	}))
	defer source.Close()

	arrived := [][2]int64{}
	read := Fetch(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(),
		func(read, of int64) { arrived = append(arrived, [2]int64{read, of}) })

	if read.Kind != Held {
		t.Fatalf("kind = %q (%s), want the bundle", read.Kind, read.Detail)
	}
	if len(arrived) == 0 {
		t.Fatal("nothing was said about a download the release stated the length of")
	}
	last := arrived[len(arrived)-1]
	if last[0] != int64(len(body)) || last[1] != int64(len(body)) {
		t.Errorf("the download ended at %d of %d, want the whole of the %d bytes sent", last[0], last[1], len(body))
	}
}

func TestADownloadOfNoStatedLengthSaysNothingAtAll(t *testing.T) {
	// a count with no total is a fraction of nothing, and a screen drawing it would fill a bar over
	// a download that has barely started.
	body := packed(t, baked(), nil)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// flushed first, so the answer is chunked and carries no length.
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		w.Write(body)
	}))
	defer source.Close()

	arrived := 0
	read := Fetch(context.Background(), source.Client(), source.URL+"/worker-1.2.3.tar.gz", baked(),
		func(int64, int64) { arrived++ })

	if read.Kind != Held {
		t.Fatalf("kind = %q (%s), want the bundle", read.Kind, read.Detail)
	}
	if arrived != 0 {
		t.Errorf("the download was reported %d times against a length nobody stated", arrived)
	}
}
