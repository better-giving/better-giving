package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/better-giving/console/internal/release"
)

// how long one asset may take to arrive before it counts as a download that did not land.
//
// the generous bound ../bundle's download is given rather than the four seconds ./update.go's
// reading is held to: what travels here is a console binary over whatever connection the operator
// is on, and an operator who has been told an install is happening is waiting for it.
const downloadWithin = 5 * time.Minute

// how many bytes of an asset are read before it is not the file this console was looking for.
//
// the archive's own bound is on the compressed stream and ./maxConsole is on what it expands to,
// which is the ceiling on what one install costs a machine: a few hundred kilobytes of gzip is
// however many gigabytes of zeroes the packer chose.
const (
	maxChecksums = 1 << 20
	maxArchive   = 128 << 20
	maxConsole   = 256 << 20
)

// what the console is called, inside the archive and on the machine.
//
// .goreleaser.yaml's `builds.binary`, which is also the one file
// ../../../../scripts/install.sh looks for once it has unpacked.
const binaryName = "better-giving"

// Put is how far putting a newer console on this machine got.
type Put string

const (
	// Replaced is the newer console on this machine, in place of the binary that was running.
	Replaced Put = "replaced"
	// NoAsset is a release publishing no console for this platform, which is nothing to install.
	NoAsset Put = "no-asset"
	// Unreachable is an asset that did not arrive: no route to the release, a status that was not
	// an asset, or it took too long.
	Unreachable Put = "unreachable"
	// Mismatched is an archive that is not the one the release publishes a checksum for.
	Mismatched Put = "mismatched"
	// Unreadable is an archive that is not one, or one carrying no console.
	Unreadable Put = "unreadable"
	// Unwritable is the file this binary runs from left as it was, because it could not be replaced.
	Unwritable Put = "unwritable"
)

// Step is one part of an install that has landed, said as it lands.
type Step string

const (
	// Downloaded is the archive on this machine, unchecked.
	Downloaded Step = "downloaded"
	// Checked is that archive held against what the release publishes for it.
	Checked Step = "checked"
	// Installed is the console in the place of the one that is running.
	Installed Step = "installed"
)

// Doing is how far the install has got, called as each part of it lands.
//
// It is called on the caller's own goroutine, in the order the steps are named above, and never
// again once ./Install has answered.
type Doing func(done Step, at Landed)

// Landed is what installing the newer console did, and to what.
type Landed struct {
	Kind Put
	// Asset is the archive this platform's console is packed in, named whatever happened.
	Asset string
	// Path is the file this binary runs from, which is what an install replaces. Empty where this
	// console could not work out which file that is.
	Path string
	// Detail is why the install did not land, and is empty on Replaced.
	Detail string
}

// Asset is the archive this platform's console is packed in.
//
// **the name is .goreleaser.yaml's `archives.name_template`, and the two words in it are go's
// own.** `runtime.GOOS` and `runtime.GOARCH` spell darwin/linux and amd64/arm64, which is what that
// template interpolates and what ../../../../scripts/install.sh works out from `uname` — three
// spellings of one platform, and a download 404s wherever any of them disagrees.
func Asset() string {
	return binaryName + "_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz"
}

// Install is the console `version` names, downloaded, checked and put where this one is running
// from.
//
// **it replaces the binary that is actually running and never a path worked out from a home
// directory.** ../../../../scripts/install.sh puts the console in ~/.local/bin unless
// BETTER_GIVING_INSTALL_DIR said otherwise, so the operator may have installed it anywhere — and a
// symlink on the PATH is followed to the file it points at, because replacing the link itself
// leaves the real console where it was and the link naming one nobody asked for.
//
// **the version is pinned in the address and is never `releases/latest`.** what lands has to be the
// release the operator was just told about (./update.go): a `latest` that moved between the reading
// and the download is a console installed without ever being named.
func Install(ctx context.Context, version string, saying Doing) Landed {
	target, err := runningConsole()
	if err != nil {
		return Landed{Kind: Unwritable, Asset: Asset(), Detail: err.Error()}
	}
	return install(ctx, http.DefaultClient, release.Downloads(version), target, saying)
}

// the file this process is executing, with every symlink on the way to it resolved.
func runningConsole() (string, error) {
	held, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(held)
}

// the same install, against a release and a file both stated.
func install(ctx context.Context, client *http.Client, base, target string, saying Doing) Landed {
	at := Landed{Asset: Asset(), Path: target}

	// **the checksums come first, and that is the one place this parts from
	// ../../../../scripts/install.sh's order.** what the file names is what the release published,
	// so a release carrying no console for this platform is found out before a hundred megabytes are
	// downloaded to find the same thing out.
	sums, why := fetched(ctx, client, base+"checksums.txt", maxChecksums)
	if why != "" {
		return stopped(at, Unreachable, why)
	}
	want, published := checksum(string(sums), at.Asset)
	if !published {
		return stopped(at, NoAsset, "the release publishes no "+at.Asset)
	}

	archive, why := fetched(ctx, client, base+at.Asset, maxArchive)
	if why != "" {
		return stopped(at, Unreachable, why)
	}
	said(saying, Downloaded, at)

	got := sha256.Sum256(archive)
	if hex.EncodeToString(got[:]) != want {
		return stopped(at, Mismatched,
			"the archive that came down is not the one the release publishes a checksum for")
	}
	said(saying, Checked, at)

	console, why := unpacked(archive)
	if why != "" {
		return stopped(at, Unreadable, why)
	}
	if why := replacing(target, console); why != "" {
		return stopped(at, Unwritable, why)
	}
	said(saying, Installed, at)

	at.Kind = Replaced
	return at
}

func stopped(at Landed, kind Put, why string) Landed {
	at.Kind = kind
	at.Detail = why
	return at
}

func said(saying Doing, done Step, at Landed) {
	if saying != nil {
		saying(done, at)
	}
}

// one release asset, whole, or why there is none.
func fetched(ctx context.Context, client *http.Client, url string, most int64) ([]byte, string) {
	bound, stop := context.WithTimeout(ctx, downloadWithin)
	defer stop()

	request, err := http.NewRequestWithContext(bound, http.MethodGet, url, nil)
	if err != nil {
		return nil, err.Error()
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err.Error()
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, path.Base(url) + " answered " + response.Status
	}
	// one more byte than the bound, so a body that reached it is told apart from one that ended
	// there.
	body, err := io.ReadAll(io.LimitReader(response.Body, most+1))
	if err != nil {
		return nil, err.Error()
	}
	if int64(len(body)) > most {
		return nil, path.Base(url) + " is larger than a console release is"
	}
	return body, ""
}

// the sha256 one checksums.txt publishes for `asset`, and false where it names none.
//
// **the file covers every asset in the release** — the worker bundle included
// (.goreleaser.yaml's `checksum.extra_files`) — and each line is a sum and a name, as sha256sum
// writes them. a name may carry a leading `*` where the sum was taken in binary mode, which is why
// ../../../../scripts/install.sh matches one too.
func checksum(published, asset string) (string, bool) {
	for _, line := range strings.Split(published, "\n") {
		named := strings.Fields(line)
		if len(named) != 2 {
			continue
		}
		if strings.TrimPrefix(named[1], "*") == asset {
			return strings.ToLower(named[0]), true
		}
	}
	return "", false
}

// the console inside one release archive, or why there is none in it.
func unpacked(archive []byte) ([]byte, string) {
	zipped, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err.Error()
	}
	defer zipped.Close()

	// the bound is on the expansion rather than on any one file in it, so an archive that unpacks
	// to more than a console ends here rather than on this machine's memory.
	held := tar.NewReader(io.LimitReader(zipped, maxConsole))
	for {
		header, err := held.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err.Error()
		}
		if header.Typeflag != tar.TypeReg || path.Clean(header.Name) != binaryName {
			continue
		}
		console, err := io.ReadAll(held)
		if err != nil {
			return nil, err.Error()
		}
		return console, ""
	}
	return nil, "the archive holds no " + binaryName
}

// the console written beside the file it replaces and renamed onto it.
//
// **never written into the file this process is executing**, which is the move
// ../../../../scripts/install.sh makes and for the same reason: a binary open for execution is one
// the kernel refuses to write into, and truncating it where it does not would leave the operator
// holding half a console. a rename is one directory entry moved onto another, so a run that stops
// anywhere in here leaves the console that is running whole.
//
// the dot-prefixed name is that script's too, so anything left beside a console is recognisable as
// this.
func replacing(target string, console []byte) string {
	beside, err := os.CreateTemp(filepath.Dir(target), "."+binaryName+".*")
	if err != nil {
		return err.Error()
	}
	written := beside.Name()
	// on every way out of here, including the rename that landed — where there is nothing under
	// that name any more and nothing to remove.
	defer func() { _ = os.Remove(written) }()

	if _, err := beside.Write(console); err != nil {
		_ = beside.Close()
		return err.Error()
	}
	if err := beside.Close(); err != nil {
		return err.Error()
	}
	// what an operator runs it by, which a file os.CreateTemp made carries none of.
	if err := os.Chmod(written, 0o755); err != nil {
		return err.Error()
	}
	if err := os.Rename(written, target); err != nil {
		return err.Error()
	}
	return ""
}

// UpdatedVariable is the mark a console hands the newer one it just installed and ran.
//
// **it is what stops the install from happening twice.** the newer console starts the command over
// and reads the same release list this one just read, so a child that still finds a release past
// its own — installed where this machine's PATH does not reach it, or a release whose archive
// carries an older binary than its tag names — would install and hand over again, and again, with
// nothing on the screen but the same three lines. a marked child names the newer console and runs
// the command instead (../../cmd/better-giving/main.go's `about`).
const UpdatedVariable = "BETTER_GIVING_UPDATED"

// Marked is whether this console is one another console installed and handed the run to.
func Marked() bool { return os.Getenv(UpdatedVariable) != "" }

// Marking is `env` carrying that mark, which is what the newer console is run with.
//
// The mark is set rather than added to whatever was there: an environment carrying it twice is one
// whose reading depends on which of the two is found first, and what turns on that reading cannot
// be undone once it has gone round twice.
func Marking(env []string) []string {
	marked := make([]string, 0, len(env)+1)
	for _, set := range env {
		if name, _, stated := strings.Cut(set, "="); stated && name == UpdatedVariable {
			continue
		}
		marked = append(marked, set)
	}
	return append(marked, UpdatedVariable+"=1")
}
