// Package update is whether a console newer than this one exists, and putting it on the machine.
//
// **the operator finds out at the terminal they typed a command in, and the console acts on it.**
// the install is a line pasted once and nothing on the machine watches for a newer one, so a binary
// that never says so is one an operator goes on running until something else tells them — and the
// commands that act on it are the two that end in a console standing (../../cmd/better-giving).
//
// **it installs a console and never deploys one.** a binary deploys only the bundle from its own
// bake — internal/bundle refuses a manifest whose commit is not the baked one — so what a newer
// release carries cannot be uploaded by the binary holding this reading. that is why the two deploy
// commands install the newer console and hand it the run before they touch anything: an operator
// left on an older binary carries older code onto their deployment, which is the one thing those
// commands exist to do right.
//
// **a reading nobody could take says nothing rather than something wrong.** github is a third host
// this console does not need to work: no route to it, a rate limit, an answer in a shape nothing
// here was written against, and a binary carrying no version at all are one kind between them, and
// nothing is printed for any of them. the read is bounded and every failure is a value, so a
// command is never held up or ended by it.
//
// **a failure past a Newer reading is the other thing, and it ends the command.** the operator has
// been told the newer console is being installed, so a command that went on after it did not land
// would deploy the old code under a screen that just said otherwise. ./install.go answers every way
// that can go wrong with a value, and the caller refuses on all of them.
package update

import (
	"context"
	"net/http"
	"strings"
	"time"

	"golang.org/x/mod/semver"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// where the release list is read, which is github's own api rather than the page a human opens.
const api = "https://api.github.com"

// how long the read may take before this console gives up on it.
//
// far under the ten seconds a cloudflare read is bounded by: nothing on the screen depends on this
// answer, and a page held on a host that is not answering would be a console waiting on news it can
// do without.
const within = 4 * time.Second

// Kind is what the reading found out.
type Kind string

const (
	// Newer is a release carrying a version past this binary's.
	Newer Kind = "newer"
	// Current is this binary being the latest release or past it.
	Current Kind = "current"
	// Unknown is nothing found out: github unreached, an answer in another shape, a tag that is not
	// a version, or a binary carrying no version to compare.
	Unknown Kind = "unknown"
)

// Read is what the console says about updates, which is one line or nothing.
type Read struct {
	Kind Kind
	// Version is the release that is newer, on Newer alone.
	Version string
	// Where is the page it is installed from, on Newer alone: the line is printed only where there
	// is somewhere to go.
	Where string
}

// Source is the live read, bound to github and to the bound above.
func Source() cf.Get {
	send := cf.JSONSendWithin(api, map[string]string{
		"Accept": "application/vnd.github+json",
	}, within)
	return func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}
}

// LatestPath is the newest release of this repository, which github resolves for itself.
const LatestPath = "/repos/" + release.Repo + "/releases/latest"

// Latest is whether `held` — the version this binary was built as — is behind the newest release.
//
// The read is unauthenticated: the repository is public, and a token would be a credential this
// console asks for to find out something it can do without.
func Latest(ctx context.Context, get cf.Get, held string) Read {
	mine, ok := numbered(held)
	if !ok {
		// nothing is asked of github at all: a binary with no version has no release to be behind.
		return Read{Kind: Unknown}
	}

	answer := get(ctx, LatestPath)
	if answer.Kind != cf.Answered || answer.Status < 200 || answer.Status > 299 {
		return Read{Kind: Unknown}
	}
	body, isObject := answer.Body.(map[string]any)
	if !isObject {
		return Read{Kind: Unknown}
	}
	tag, isString := body["tag_name"].(string)
	if !isString {
		return Read{Kind: Unknown}
	}
	latest, ok := numbered(tag)
	if !ok {
		return Read{Kind: Unknown}
	}

	if !behind(mine, latest) {
		return Read{Kind: Current}
	}
	return Read{
		Kind:    Newer,
		Version: strings.TrimPrefix(tag, "v"),
		Where:   release.ReleasesPage,
	}
}

// one version in the spelling `golang.org/x/mod/semver` reads, or false where it is not one.
//
// The tag a release is cut under carries a leading `v` and the version itself does not, so the `v`
// is put back where it is missing and both spellings read as the same release.
//
// `dev` is what every `go build` in this repository leaves, so a contributor's binary is not a
// version here and asks github nothing.
func numbered(version string) (string, bool) {
	stated := strings.TrimSpace(version)
	if !strings.HasPrefix(stated, "v") {
		stated = "v" + stated
	}
	if !semver.IsValid(stated) {
		return "", false
	}
	return stated, true
}

// whether `mine` is behind `latest`, by semantic version precedence.
//
// The suffix orders as much as the numbers do: `0.0.1-alpha.2` is behind `0.0.1-alpha.3`, both are
// behind `0.0.1`, and `0.0.1` is behind `0.0.2-alpha.1`. Reading the numbers alone is every console
// installed in a pre-release series calling itself current for the length of the series, which is
// the whole of what the two deploy commands install a newer console to avoid.
//
// Numbers rather than words: `0.9.0` sorts after `0.10.0` as text, which is a console that never
// mentions the release an operator is behind. A version with fewer parts than the other is read as
// zero in the ones it does not state, so `0.4` and `0.4.0` are the same release. A build suffix is
// no part of the ordering at all: `+sha` says how a binary was cut, not which release it is.
func behind(mine, latest string) bool {
	return semver.Compare(mine, latest) < 0
}
