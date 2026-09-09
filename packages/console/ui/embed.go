// Package ui is the built react app, carried inside the binary.
//
// **one embed directive and it names `all:dist`, which is the whole of what makes the binary
// self-contained.** the prefix is what includes the files vite writes whose names begin with `_` or
// `.`, which the default rules leave out — a bundle missing one of those is a page that loads and
// then draws nothing. packages/console-ui/src/never-deployed.spec.ts reads this file and holds both
// facts, because a second directive is how a second directory quietly becomes load-bearing.
//
// **./dist holds one committed placeholder and nothing else**: an embed of an empty directory is a
// build error, so without that file a checkout nobody has built the ui in would not compile at all.
// `.gitignore` is where that pair is stated.
//
// **the release is what puts the built app here, and nothing else does.** the ui is
// packages/console-ui, a package of its own on the pnpm workspace that this module is not on;
// `pnpm --filter @better-giving/console-ui build` writes it to that package's build/client, and
// .github/workflows/release.yml copies that over ./dist in front of the binary's own build.
// locally the copy is a step somebody does by hand — so a binary built from a fresh checkout
// serves the placeholder and says so on the page.
//
// the page is served for every path the router does not know, because a client route is a path only
// the browser resolves — packages/console/internal/server states which paths are the exception.
package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var built embed.FS

// Handler serves the built app, answering with its document for any path that is not a file in it.
func Handler() http.Handler {
	files, err := fs.Sub(built, "dist")
	if err != nil {
		// unreachable while the directive above names a directory that is there: the build fails
		// first. it is answered rather than panicked on so that a broken binary still says so.
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "this binary carries no ui", http.StatusInternalServerError)
		})
	}
	serve := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isBuiltFile(files, r.URL.Path) {
			serve.ServeHTTP(w, r)
			return
		}
		r = r.Clone(r.Context())
		r.URL.Path = "/"
		serve.ServeHTTP(w, r)
	})
}

// whether the build holds a file at this path, which is what tells an asset from a client route.
func isBuiltFile(files fs.FS, at string) bool {
	name := path.Clean(strings.TrimPrefix(at, "/"))
	if name == "." || name == "/" {
		return true
	}
	if !fs.ValidPath(name) {
		return false
	}
	info, err := fs.Stat(files, name)
	return err == nil && !info.IsDir()
}
