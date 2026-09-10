package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// one release, serving the console archive this platform installs and the checksums.txt that covers
// it.
//
// every field has a working default, so a case states only the thing it is about.
type published struct {
	// console is what the archive holds, which is the binary that would replace the running one.
	console []byte
	// asset is the name checksums.txt covers, and is this platform's archive unless a case names
	// another.
	asset string
	// sum is what checksums.txt publishes for that name, and is the archive's own unless a case
	// names another.
	sum string
	// inside is the name the archive packs the console under.
	inside string
}

// where this release's assets are, as `install` is handed them.
func (held published) serving(t *testing.T) string {
	t.Helper()

	inside := held.inside
	if inside == "" {
		inside = "better-giving"
	}
	archive := packed(t, inside, held.console)

	asset := held.asset
	if asset == "" {
		asset = Asset()
	}
	sum := held.sum
	if sum == "" {
		whole := sha256.Sum256(archive)
		sum = hex.EncodeToString(whole[:])
	}
	// two lines, because the real file covers every asset in the release: the bundle a deploy
	// uploads is checksummed beside the archives (.goreleaser.yaml's `checksum.extra_files`), so a
	// lookup that took the first line would take the wrong one.
	sums := "1111111111111111111111111111111111111111111111111111111111111111  worker-9.9.9.tar.gz\n" +
		sum + "  " + asset + "\n"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/checksums.txt":
			_, _ = w.Write([]byte(sums))
		case "/" + Asset():
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server.URL + "/"
}

// one release archive, packed the way .goreleaser.yaml packs one: a tar.gz holding the console at
// its root, with the licence beside it.
func packed(t *testing.T, name string, console []byte) []byte {
	t.Helper()

	var archive bytes.Buffer
	zipped := gzip.NewWriter(&archive)
	held := tar.NewWriter(zipped)
	for _, file := range []struct {
		name string
		body []byte
	}{
		{"LICENSE", []byte("the licence, which is not a console")},
		{name, console},
	} {
		if err := held.WriteHeader(&tar.Header{
			Typeflag: tar.TypeReg,
			Name:     file.name,
			Mode:     0o755,
			Size:     int64(len(file.body)),
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := held.Write(file.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := held.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zipped.Close(); err != nil {
		t.Fatal(err)
	}
	return archive.Bytes()
}

// the console that is running, written where a case is about to install over it.
func running(t *testing.T) string {
	t.Helper()

	into := filepath.Join(t.TempDir(), "better-giving")
	if err := os.WriteFile(into, []byte("the console that is running"), 0o755); err != nil {
		t.Fatal(err)
	}
	return into
}

func TestTheConsoleAReleaseCarriesIsPutWhereTheRunningOneIs(t *testing.T) {
	into := running(t)
	newer := []byte("the console the release carries")

	var steps []Step
	landed := install(context.Background(), http.DefaultClient,
		published{console: newer}.serving(t), into,
		func(done Step, _ Landed) { steps = append(steps, done) })

	if landed.Kind != Replaced {
		t.Fatalf("landed = %+v, want the newer console installed", landed)
	}
	held, err := os.ReadFile(into)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(held, newer) {
		t.Errorf("the file this binary runs from holds %q, want the console the release carries",
			held)
	}
	// an operator whose console cannot be executed is one this command left with nothing to run.
	info, err := os.Stat(into)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Errorf("the console was installed %v, which nothing can run", info.Mode())
	}
	if want := []Step{Downloaded, Checked, Installed}; !slices.Equal(steps, want) {
		t.Errorf("said %v as it went, want %v", steps, want)
	}
	if landed.Path != into || landed.Asset != Asset() {
		t.Errorf("landed = %+v, want the archive and the file it was put in named", landed)
	}
}

func TestTheNewerConsoleIsRenamedOntoTheRunningOneRatherThanWrittenInto(t *testing.T) {
	// the file a running console is executing is one the kernel refuses a write into, and the same
	// install run over a console that is not running would truncate it: what is held here is the
	// bytes the old file had, through a second name for that same file. a write into it changes
	// them and a rename onto it does not.
	into := running(t)
	was, err := os.ReadFile(into)
	if err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(filepath.Dir(into), "the-file-that-was-there")
	if err := os.Link(into, old); err != nil {
		t.Fatal(err)
	}

	landed := install(context.Background(), http.DefaultClient,
		published{console: []byte("the console the release carries")}.serving(t), into, nil)

	if landed.Kind != Replaced {
		t.Fatalf("landed = %+v, want the newer console installed", landed)
	}
	held, err := os.ReadFile(old)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(held, was) {
		t.Errorf("the file that was there holds %q, want the bytes it had: it was written into "+
			"rather than replaced", held)
	}
}

// what the console that is running still holds, which is every failure's own assertion: an install
// that did not land leaves the operator on the binary they typed the command to.
func untouched(t *testing.T, into string) {
	t.Helper()

	held, err := os.ReadFile(into)
	if err != nil {
		t.Fatal(err)
	}
	if string(held) != "the console that is running" {
		t.Errorf("the file this binary runs from holds %q, want the console that was there", held)
	}
}

func TestAnArchiveThatIsNotTheOneTheReleasePublishesInstallsNothing(t *testing.T) {
	into := running(t)
	elsewhere := "2222222222222222222222222222222222222222222222222222222222222222"

	var steps []Step
	landed := install(context.Background(), http.DefaultClient,
		published{console: []byte("a console nobody published"), sum: elsewhere}.serving(t), into,
		func(done Step, _ Landed) { steps = append(steps, done) })

	if landed.Kind != Mismatched {
		t.Errorf("landed = %+v, want %q", landed, Mismatched)
	}
	untouched(t, into)
	if slices.Contains(steps, Checked) || slices.Contains(steps, Installed) {
		t.Errorf("said %v as it went, want nothing past the download", steps)
	}
}

func TestAReleasePublishingNoConsoleForThisMachineInstallsNothing(t *testing.T) {
	// a release built for platforms this machine is not one of. it is told apart from a download
	// that did not land because there is nothing to try again: no console for this platform will
	// appear under that release however many times it is asked for.
	into := running(t)

	landed := install(context.Background(), http.DefaultClient,
		published{
			console: []byte("a console for another machine"),
			asset:   "better-giving_plan9_sparc.tar.gz",
		}.serving(t), into, nil)

	if landed.Kind != NoAsset {
		t.Errorf("landed = %+v, want %q", landed, NoAsset)
	}
	if !strings.Contains(landed.Detail, Asset()) {
		t.Errorf("said %q, want the archive this machine went looking for named", landed.Detail)
	}
	untouched(t, into)
}

func TestAConsoleThisRunCannotWriteBesideInstallsNothing(t *testing.T) {
	// an operator who installed into a directory this user may read and not write — /usr/local/bin
	// on a machine they are not an administrator of. the console that is running is left whole and
	// what they are told names the file it could not replace.
	if os.Geteuid() == 0 {
		t.Skip("root writes into a directory nobody else may, so there is no refusal to read here")
	}
	into := running(t)
	held := filepath.Dir(into)
	if err := os.Chmod(held, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(held, 0o700) })

	var steps []Step
	landed := install(context.Background(), http.DefaultClient,
		published{console: []byte("the console the release carries")}.serving(t), into,
		func(done Step, _ Landed) { steps = append(steps, done) })

	if landed.Kind != Unwritable {
		t.Errorf("landed = %+v, want %q", landed, Unwritable)
	}
	untouched(t, into)
	if slices.Contains(steps, Installed) {
		t.Errorf("said %v as it went, and nothing was installed", steps)
	}
}

func TestAnArchiveCarryingNoConsoleInstallsNothing(t *testing.T) {
	// a release that packed something else under this platform's name. the checksum matches — it is
	// the archive the release published — so what refuses it is the read of what is inside.
	into := running(t)

	landed := install(context.Background(), http.DefaultClient,
		published{console: []byte("something that is not a console"), inside: "readme"}.serving(t),
		into, nil)

	if landed.Kind != Unreadable {
		t.Errorf("landed = %+v, want %q", landed, Unreadable)
	}
	untouched(t, into)
}

func TestAReleaseThatAnsweredNothingInstallsNothing(t *testing.T) {
	into := running(t)
	nowhere := httptest.NewServer(http.HandlerFunc(http.NotFound))
	t.Cleanup(nowhere.Close)

	landed := install(context.Background(), http.DefaultClient, nowhere.URL+"/", into, nil)

	if landed.Kind != Unreachable {
		t.Errorf("landed = %+v, want %q", landed, Unreachable)
	}
	untouched(t, into)
}

func TestTheConsoleAConsoleInstalledIsMarkedAsOne(t *testing.T) {
	// the loop guard: the child reads the same release list its parent just read, so one that still
	// finds a newer console has to be able to tell that an install has already happened in this
	// lineage — otherwise it installs and hands over again, forever.
	marked := Marking([]string{"PATH=/usr/bin", "HOME=/home/operator"})

	if !slices.Contains(marked, UpdatedVariable+"=1") {
		t.Errorf("the newer console is run with %v, which says nothing about the install behind it",
			marked)
	}
	for _, kept := range []string{"PATH=/usr/bin", "HOME=/home/operator"} {
		if !slices.Contains(marked, kept) {
			t.Errorf("the newer console is run with %v, and %q was dropped on the way", marked, kept)
		}
	}
}

func TestAConsoleAlreadyMarkedIsHandedTheMarkOnceAndNotTwice(t *testing.T) {
	// an environment carrying it twice is one whose reading depends on which of the two is found
	// first, and this console decides a one-way thing on that reading.
	marked := Marking([]string{UpdatedVariable + "=1", "PATH=/usr/bin"})

	var held int
	for _, set := range marked {
		if strings.HasPrefix(set, UpdatedVariable+"=") {
			held++
		}
	}
	if held != 1 {
		t.Errorf("the newer console is run with %v, want the mark on it once", marked)
	}
}

func TestAConsoleNobodyInstalledIsNotMarked(t *testing.T) {
	t.Setenv(UpdatedVariable, "")
	if Marked() {
		t.Error("a console nobody installed reads as one that was, so it would never install another")
	}
	t.Setenv(UpdatedVariable, "1")
	if !Marked() {
		t.Error("a console another one installed reads as one nobody did, which is the install loop")
	}
}
