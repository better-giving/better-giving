// Package bundle is the release asset a deploy is made out of, and the check that says this binary
// may make it.
//
// **the worker is not built on the operator's machine and cannot be.** there is no checkout, no
// node and no wrangler where the binary runs, so the modules, the client assets and the migration
// files travel as a release asset the binary fetches by version — `worker-<version>.tar.gz` beside
// the binary in the same release.
//
// **it carries the one worker this repository deploys**: ./worker and ./assets are the whole of it,
// and a bundle carrying no ./worker/index.js is Unreadable — there is nothing for it to be but a
// bundle this binary will not deploy from.
//
// **the manifest and the config baked into the binary must agree, field for field, and a deploy
// refuses when they do not.** the binary states the bindings, the runtime and the migration list on
// the upload (../release's `Upload`); the bundle carries the modules and the sql. a bundle from
// another revision of the app is those two halves disagreeing — migrations applied under a worker
// that does not expect them, or a binding the code reaches for and the upload never sent. neither
// half can tell on its own, which is why the manifest is a copy of ../release/config.json and why
// every field of it is compared: `commit` alone already refuses a bundle from any other revision,
// and each of the others names what an operator is looking at.
//
// every failure is a value, the way ../cf's are: a bundle that is not there and a bundle that is
// not one are two states a screen has different sentences for, and neither is an error to unwind
// on.
package bundle

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/better-giving/console/internal/blake3"
	"github.com/better-giving/console/internal/release"
)

// what the entry module is called inside the bundle, under ./worker.
//
// wrangler's own `deploy --dry-run --outdir` names the entry `index.js` and writes every module it
// imports beside it; the release packs that directory whole. the name is stated here rather than
// carried by the manifest because the manifest is a copy of the baked config and holds no field the
// config does not.
const mainModule = "index.js"

// the three paths under ./assets that are configuration rather than files to serve.
//
// `_headers` is uploaded as part of the script's own metadata rather than as an asset, and the
// other two are read where the bundle is packed. cloudflare's own assets upload excludes all three
// (https://developers.cloudflare.com/workers/static-assets/headers/).
const (
	headersFile = "_headers"
	ignoreFile  = ".assetsignore"
	redirects   = "_redirects"
)

// Kind is which of the ways a bundle was or was not read.
type Kind string

const (
	// Held is the bundle, and a manifest that agrees with what this binary was baked for.
	Held Kind = "held"
	// Mismatched is a bundle built from another shape of the app, and Fields names how.
	Mismatched Kind = "mismatched"
	// Missing is a release carrying no such asset, which is every version that never shipped one.
	Missing Kind = "missing"
	// Unreachable is nothing found out either way: no route to the release, or it took too long.
	Unreachable Kind = "unreachable"
	// Unreadable is an answer that is not a bundle, or one missing a part a deploy needs.
	Unreadable Kind = "unreadable"
)

// Read is the bundle, or which way there is none.
type Read struct {
	Kind   Kind
	Bundle Bundle
	// Fields is every baked field the manifest and this binary disagree on, and is set on
	// Mismatched alone.
	Fields []string
	Detail string
}

// Bundle is everything one deploy uploads and applies.
type Bundle struct {
	// Manifest is what the release baked, which has already been held equal to this binary's own.
	Manifest release.Config
	// MainModule is the specifier the upload names as the worker's entry.
	MainModule string
	// Modules is the worker's own javascript, the entry first.
	Modules []Module
	// Assets is every file the deployment serves, which is what the upload session is opened over.
	Assets []Asset
	// Headers is what ./assets/_headers holds, which travels in the script's metadata rather than
	// as an asset. Empty where the bundle carries none.
	Headers string
	// Migrations is the sql of each file the manifest names, by filename.
	Migrations map[string]string
}

// Module is one of the worker's javascript modules.
type Module struct {
	// Specifier is the path as the importing module wrote it, path separators included, which is
	// the name its part carries in the upload.
	Specifier string
	Body      []byte
}

// Asset is one file the deployment serves.
type Asset struct {
	// Path is the path it is served at, leading slash included, which is its key in the manifest an
	// upload session is opened with.
	Path string
	// Hash is the 32 hex characters that manifest is keyed by.
	Hash string
	// ContentType is what it is served as, or NoContentType where nothing is claimed for it.
	ContentType string
	Body        []byte
}

// NoContentType is the literal the assets upload takes to mean that a file carries none.
const NoContentType = "application/null"

// how many bytes of a release asset are read before it is the download that is wrong.
//
// a bound on a body that never ends, and on the compressed stream alone: what an archive of that
// size expands to is the archive's to state, so the ceiling on what a deploy costs a machine is
// maxUnpacked below rather than this.
const maxBundle = 256 << 20

// how many bytes the archive may expand to before it is more than one deploy carries.
//
// the whole bundle is held in memory — it is uploaded from there, part by part — so this is the
// ceiling on what one deploy costs a machine. it is the bound the download's own does not give: a
// few hundred kilobytes of gzip is however many gigabytes of zeroes the packer chose.
const maxUnpacked = 512 << 20

// how long the download may take before it counts as unreachable.
//
// the same generous bound the uploads are made with rather than the one a screen's read is held to,
// because what travels is the worker and every static file the deployment serves. the caller's own
// context bounds it further wherever it has a shorter deadline.
const fetchTimeout = 5 * time.Minute

// Watch is how much of the download has arrived, called as the body is read.
//
// `of` is the length the answer claimed, and it is never called at all where the answer claimed
// none: a count with no total is a bar nothing can be drawn against. It is called on the goroutine
// the fetch is on, once per read the reader makes — a call that blocks holds the download up, and
// what a screen is told is the caller's to thin out.
type Watch func(read, of int64)

// Fetch is the bundle at one url, read and checked.
//
// The url is stated by the caller rather than derived here: which release a binary deploys from is
// the version it was built at, and the host that carries it belongs to the release rather than to
// this reading.
func Fetch(ctx context.Context, client *http.Client, url string, want release.Config, arriving Watch) Read {
	return fetchWithin(ctx, client, url, want, fetchTimeout, arriving)
}

// the same fetch, bound to a deadline stated rather than to the one a release is given.
func fetchWithin(ctx context.Context, client *http.Client, url string, want release.Config, within time.Duration, arriving Watch) Read {
	bound, stop := context.WithTimeout(ctx, within)
	defer stop()

	request, err := http.NewRequestWithContext(bound, http.MethodGet, url, nil)
	if err != nil {
		return Read{Kind: Unreachable, Detail: err.Error()}
	}
	response, err := client.Do(request)
	if err != nil {
		return Read{Kind: Unreachable, Detail: err.Error()}
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		return Read{Kind: Missing, Detail: "that release carries no " + path.Base(url)}
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return Read{Kind: Unreachable, Detail: "the release answered " + response.Status}
	}
	// the whole body reaches the reader below through this one, which is what lets the bytes be
	// counted as they arrive: a release that claimed no length is read uncounted rather than
	// reported against a total nobody stated.
	source := io.Reader(io.LimitReader(response.Body, maxBundle))
	if arriving != nil && response.ContentLength > 0 {
		source = &counting{from: source, of: response.ContentLength, say: arriving}
	}
	read := ReadFrom(source, want)
	// a download the deadline cut arrives as an archive that stops in the middle of a file, and what
	// is wrong then is the connection rather than the release: the two are a press to make again and
	// a version this binary cannot deploy from at all.
	if read.Kind == Unreadable && bound.Err() != nil {
		return Read{Kind: Unreachable, Detail: bound.Err().Error()}
	}
	return read
}

// a reader that says how much of the download has arrived, as it hands it on.
type counting struct {
	from io.Reader
	of   int64
	read int64
	say  Watch
}

func (counter *counting) Read(into []byte) (int, error) {
	got, err := counter.from.Read(into)
	if got > 0 {
		counter.read += int64(got)
		counter.say(counter.read, counter.of)
	}
	return got, err
}

// ReadFrom is one bundle read out of the bytes it was packed into, and checked against what this
// binary was baked for.
func ReadFrom(source io.Reader, want release.Config) Read {
	files, err := unpacked(source, maxUnpacked)
	if err != nil {
		return Read{Kind: Unreadable, Detail: err.Error()}
	}

	manifest, held := files["manifest.json"]
	if !held {
		return Read{Kind: Unreadable, Detail: "that bundle carries no manifest.json"}
	}
	var carried release.Config
	if err := json.Unmarshal(manifest, &carried); err != nil {
		return Read{Kind: Unreadable, Detail: "manifest.json: " + err.Error()}
	}
	// in front of everything the bundle carries, because a bundle from another shape of the app is
	// refused rather than half-read: what a screen says about it is which fields disagree.
	if drifted := driftedFields(carried, want); len(drifted) > 0 {
		return Read{Kind: Mismatched, Fields: drifted, Bundle: Bundle{Manifest: carried}}
	}

	bundle := Bundle{Manifest: carried, MainModule: mainModule, Migrations: map[string]string{}}
	if _, held := files["worker/"+mainModule]; !held {
		return Read{Kind: Unreadable, Detail: "that bundle carries no worker/" + mainModule}
	}
	for _, name := range sorted(files) {
		if specifier, under := strings.CutPrefix(name, "worker/"); under {
			bundle.Modules = append(bundle.Modules, Module{Specifier: specifier, Body: files[name]})
		}
	}
	// the entry first, because it is the one the upload's metadata names and a reader of the parts
	// should meet it before the modules under it.
	sort.SliceStable(bundle.Modules, func(one, two int) bool {
		return bundle.Modules[one].Specifier == mainModule && bundle.Modules[two].Specifier != mainModule
	})

	for _, name := range carried.Migrations {
		sql, held := files["migrations/"+name]
		if !held {
			return Read{Kind: Unreadable, Detail: "that bundle carries no migrations/" + name}
		}
		bundle.Migrations[name] = string(sql)
	}

	bundle.Headers = string(files["assets/"+headersFile])
	bundle.Assets = assets(files)
	return Read{Kind: Held, Bundle: bundle}
}

// every file the deployment serves, keyed and hashed the way an upload session is opened with them.
func assets(files map[string][]byte) []Asset {
	ignored := ignoredBy(files["assets/"+ignoreFile])
	held := []Asset{}
	for _, name := range sorted(files) {
		at, under := strings.CutPrefix(name, "assets/")
		if !under || at == headersFile || at == redirects || at == ignoreFile || ignored(at) {
			continue
		}
		body := files[name]
		held = append(held, Asset{
			Path:        "/" + at,
			Hash:        Hash(body, at),
			ContentType: contentType(at),
			Body:        body,
		})
	}
	return held
}

// Hash is the manifest key one file is uploaded under.
//
// It is the file's bytes base64-encoded with the extension of its name appended, hashed and cut to
// 32 characters — cloudflare's own derivation, and the reason ../blake3 is in this binary at all.
// The extension carries no dot.
func Hash(body []byte, name string) string {
	extension := strings.TrimPrefix(path.Ext(name), ".")
	digest := blake3.Sum([]byte(base64.StdEncoding.EncodeToString(body) + extension))
	return hex.EncodeToString(digest[:])[:32]
}

// what each extension packages/app's build emits is served as.
//
// **go's own table is the types built into the standard library plus whatever mime database the
// machine happens to hold, and the machine an operator runs this on may hold none.** the fonts are
// what that costs: a `.woff2` served as the literal claiming no type is a face the browser will not
// use, and every screen of the deployment falls back to a system one. the extensions this build
// emits are named here for that reason, and the standard library answers for anything an operator
// adds to packages/app/static that is not among them.
var contentTypes = map[string]string{
	".avif":        "image/avif",
	".css":         "text/css; charset=utf-8",
	".gif":         "image/gif",
	".html":        "text/html; charset=utf-8",
	".ico":         "image/vnd.microsoft.icon",
	".jpeg":        "image/jpeg",
	".jpg":         "image/jpeg",
	".js":          "text/javascript; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".mjs":         "text/javascript; charset=utf-8",
	".png":         "image/png",
	".svg":         "image/svg+xml",
	".txt":         "text/plain; charset=utf-8",
	".wasm":        "application/wasm",
	".webmanifest": "application/manifest+json",
	".webp":        "image/webp",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".xml":         "text/xml; charset=utf-8",
}

// what a file is served as, or the literal that claims nothing for it.
func contentType(name string) string {
	extension := strings.ToLower(path.Ext(name))
	if held, named := contentTypes[extension]; named {
		return held
	}
	if held := mime.TypeByExtension(extension); held != "" {
		return held
	}
	return NoContentType
}

// whether a path under ./assets is one the deployment's own ignore file leaves out.
//
// the forms gitignore gives that a build output uses: a name, a path, a glob, and a directory with
// a trailing slash. a line this does not understand matches nothing, which errs towards uploading a
// file rather than towards a deployment missing one.
func ignoredBy(source []byte) func(string) bool {
	patterns := []string{}
	for _, line := range strings.Split(string(source), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			patterns = append(patterns, strings.TrimPrefix(line, "/"))
		}
	}
	return func(at string) bool {
		for _, pattern := range patterns {
			if directory, isDir := strings.CutSuffix(pattern, "/"); isDir {
				if at == directory || strings.HasPrefix(at, directory+"/") {
					return true
				}
				continue
			}
			if at == pattern {
				return true
			}
			if matched, err := path.Match(pattern, path.Base(at)); err == nil && matched {
				return true
			}
		}
		return false
	}
}

// every field the bundle's manifest and this binary's baked config disagree on, in the json
// spelling each is stated under.
//
// the fields are named rather than counted: what an operator can do about a mismatch depends on
// which half is behind, and a migration list that differs is a different sentence from a rate
// limiter's namespace that moved.
func driftedFields(carried, want release.Config) []string {
	drifted := []string{}
	compared := []struct {
		field string
		same  bool
	}{
		{"name", carried.Name == want.Name},
		{"database_name", carried.DatabaseName == want.DatabaseName},
		{"migrations_dir", carried.MigrationsDir == want.MigrationsDir},
		{"migrations", reflect.DeepEqual(carried.Migrations, want.Migrations)},
		{"turnstileWidgetName", carried.TurnstileWidgetName == want.TurnstileWidgetName},
		{"commit", carried.Commit == want.Commit},
	}
	for _, one := range compared {
		if !one.same {
			drifted = append(drifted, one.field)
		}
	}
	sort.Strings(drifted)
	return drifted
}

// what a bundle expanding past the ceiling reads as, so that the failure names the bound rather
// than arriving as an archive that stops in the middle of a file.
var errTooLarge = errors.New("that bundle expands to more than one deploy holds in memory")

// every file the archive holds, by the path it holds it under, up to `ceiling` bytes of them.
func unpacked(source io.Reader, ceiling int64) (map[string][]byte, error) {
	zipped, err := gzip.NewReader(source)
	if err != nil {
		return nil, err
	}
	defer zipped.Close()

	files := map[string][]byte{}
	archive := tar.NewReader(&bounded{source: zipped, left: ceiling})
	for {
		entry, err := archive.Next()
		if err == io.EOF {
			return files, nil
		}
		if err != nil {
			return nil, err
		}
		if entry.Typeflag != tar.TypeReg {
			continue
		}
		// a name reaching above its own directory is an archive writing wherever it likes; nothing
		// here writes to disk, but a `..` in a key is a path no part of a deploy should be named by.
		name := path.Clean(entry.Name)
		if strings.HasPrefix(name, "..") || path.IsAbs(name) {
			continue
		}
		body, err := io.ReadAll(archive)
		if err != nil {
			return nil, err
		}
		files[name] = body
	}
}

// a reader that ends in errTooLarge rather than in the short read io.LimitReader gives, so that a
// bundle over the ceiling is told from an archive that was cut off in transit.
type bounded struct {
	source io.Reader
	left   int64
}

func (reader *bounded) Read(into []byte) (int, error) {
	if reader.left <= 0 {
		return 0, errTooLarge
	}
	if int64(len(into)) > reader.left {
		into = into[:reader.left]
	}
	read, err := reader.source.Read(into)
	reader.left -= int64(read)
	return read, err
}

func sorted(files map[string][]byte) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
