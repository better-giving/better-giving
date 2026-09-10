package release

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestABundleIsFetchedFromTheReleaseThisBinaryWasCutIn(t *testing.T) {
	source := BundleSource("1.4.0")
	want := "https://github.com/better-giving/better-giving/releases/download/v1.4.0/worker-1.4.0.tar.gz"
	if source.URL != want {
		t.Errorf("url = %q, want %q", source.URL, want)
	}
}

func TestAnOverrideNamingAnAddressIsTakenAsItIs(t *testing.T) {
	t.Setenv(BundleVariable, "http://127.0.0.1:9999/worker.tar.gz")
	if source := BundleSource("1.4.0"); source.URL != "http://127.0.0.1:9999/worker.tar.gz" {
		t.Errorf("url = %q", source.URL)
	}
}

func TestAnOverrideNamingAFileIsRead(t *testing.T) {
	// a bundle built on this machine, which is the whole reason the override exists.
	packed := filepath.Join(t.TempDir(), "worker-dev.tar.gz")
	if err := os.WriteFile(packed, []byte("a bundle"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv(BundleVariable, packed)

	source := BundleSource("1.4.0")
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, source.URL, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	answer, err := source.Client.Do(request)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer answer.Body.Close()
	read, _ := io.ReadAll(answer.Body)
	if string(read) != "a bundle" {
		t.Errorf("read %q from %q", read, source.URL)
	}
}

func TestAReleaseAddressIsFetchedWithNoFileTransportOnIt(t *testing.T) {
	// a client that could read this machine's files is one a redirect could point at them.
	if source := BundleSource("1.4.0"); source.Client != nil {
		t.Errorf("client = %v, want the deploy's own", source.Client)
	}
}

// where a release says what it carries, which is the one thing on the carry door an operator can
// read before they answer it (../terminal/confirm.go).

func TestAReleaseStatesWhatItCarriesOnItsOwnTagPage(t *testing.T) {
	want := "https://github.com/better-giving/better-giving/releases/tag/v1.4.0"
	if notes := Notes("1.4.0"); notes != want {
		t.Errorf("Notes = %q, want %q", notes, want)
	}
}

func TestAVersionThatNamesNoReleaseHasNoPageToPointAt(t *testing.T) {
	// `dev` is what every go build in this repository leaves (../../cmd/better-giving/main.go), and
	// the releases page carries no tag for it: a screen drawing this line anyway would offer an
	// operator a page that is not there.
	for _, held := range []string{"dev", "", "nightly", "v"} {
		if notes := Notes(held); notes != "" {
			t.Errorf("Notes(%q) = %q, want nothing to read where there is no release", held, notes)
		}
	}
}
