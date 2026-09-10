package release

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// where a deploy fetches this binary's own worker bundle from.
//
// **the bundle is an asset of the release the binary was cut in, and the version is the whole of
// what picks it.** a binary deploys only the bundle from its own bake — the manifest is a copy of
// ./config.json and every field of it is compared before anything is applied (internal/bundle) — so
// an address derived from anything but this binary's version would be a deploy of code it was never
// held against.
//
// **the override is for a contributor holding a bundle they just packed, and is documented
// nowhere an operator reads.** an operator's binary reaches the release and nothing else; a
// contributor building one locally has no release to reach, and the alternative is a deploy path
// that can only be exercised by cutting a tag.

// BundleVariable is the override, which names either an address or a file on this machine.
const BundleVariable = "BETTER_GIVING_BUNDLE"

// Repo is this repository on github, stated once because two paths lead to it: the bundle a deploy
// uploads is an asset of a release under this name, and whether a newer console exists is a read of
// that same repository's latest release (internal/update).
const Repo = "better-giving/better-giving"

// ReleasesPage is where a release is downloaded and installed from by hand, which is where a
// console older than the latest one points.
const ReleasesPage = "https://github.com/" + Repo + "/releases"

// Downloads is where one release keeps its assets, which is this repository's own.
//
// **two things a binary fetches by version come out of it, so the address is derived once**: the
// worker bundle a deploy uploads (./BundleSource) and the console archive an out-of-date binary
// installs (../update). The tag is `v` and the version, which is what the release is cut under.
func Downloads(version string) string {
	return ReleasesPage + "/download/v" + version + "/"
}

// InstallLine is the one line this console is installed with by hand, which is
// ../../../../scripts/install.sh served from the newest release.
//
// **it is where a path that could not install a console for the operator ends.** that script is an
// asset of every release for exactly this reason (.goreleaser.yaml's `release.extra_files`), so the
// address resolves whatever the newest release turns out to be.
const InstallLine = "curl -fsSL " + ReleasesPage + "/latest/download/install.sh | sh"

// Source is where one deploy's bundle is, and what reaches it.
type Source struct {
	URL string
	// Client is nil for a release address, which is the deploy's own client. It is set only for a
	// file on this machine, because reading one takes a transport the standard client does not
	// carry — and a client that could read this machine's files is one a redirect could point at
	// them, so the release address is never fetched with it.
	Client *http.Client
}

// BundleSource is where the bundle for `version` is.
//
// The asset carries the version without the `v` its release is tagged with (./Downloads).
func BundleSource(version string) Source {
	override := os.Getenv(BundleVariable)
	if override == "" {
		return Source{URL: Downloads(version) + "worker-" + version + ".tar.gz"}
	}
	if strings.HasPrefix(override, "http://") || strings.HasPrefix(override, "https://") {
		return Source{URL: override}
	}

	// a path, read through a transport of its own: the root is the whole filesystem, so a relative
	// path is resolved against the directory the binary was run in the way a shell would.
	packed, err := filepath.Abs(override)
	if err != nil {
		packed = override
	}
	transport := &http.Transport{}
	transport.RegisterProtocol("file", http.NewFileTransport(http.Dir("/")))
	return Source{
		URL:    "file://" + filepath.ToSlash(packed),
		Client: &http.Client{Transport: transport},
	}
}
