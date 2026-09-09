package state

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// where this machine keeps what it remembers between runs, and how a record gets written into it.

func TestTheDirectoryIsUnderTheOperatingSystemsOwnConfigHome(t *testing.T) {
	t.Setenv(HomeVar, "")
	config, err := os.UserConfigDir()
	if err != nil {
		t.Skipf("this machine names no config directory: %v", err)
	}

	dir, err := Dir()
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}

	if dir != filepath.Join(config, "better-giving") {
		t.Errorf("dir = %q, want it under %q", dir, config)
	}
}

func TestAStatedHomeOverridesIt(t *testing.T) {
	elsewhere := t.TempDir()
	t.Setenv(HomeVar, elsewhere)

	dir, err := Dir()
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}

	if dir != elsewhere {
		t.Errorf("dir = %q, want the stated %q", dir, elsewhere)
	}
}

func TestARecordIsWrittenOnlyThisAccountCanRead(t *testing.T) {
	dir := t.TempDir()
	store := At(dir)

	if err := store.Write("session.json", []byte("{}\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	info, err := os.Stat(filepath.Join(dir, "session.json"))
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600 on a file holding a credential", info.Mode().Perm())
	}
}

func TestARecordWrittenOverAWiderOneNarrowsIt(t *testing.T) {
	// the mode a create states applies only where it creates the file, so writing a new token
	// straight into a record already there would leave it in whatever mode that one was in — and
	// narrowing afterwards leaves a window in which a live credential sits at the wider one.
	dir := t.TempDir()
	path := filepath.Join(dir, "session.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := At(dir).Write("session.json", []byte("new")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want the new file's own 0600 and not the old file's", info.Mode().Perm())
	}
	read, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(read) != "new" {
		t.Errorf("content = %q, want what was just written", read)
	}
}

func TestAFileLeftByARunThatDiedIsNotTakenOver(t *testing.T) {
	// one left behind would be created-already, and take its mode rather than 0600. the temp name
	// is the write's own, so a leftover of any name is simply not the file being written.
	dir := t.TempDir()
	store := At(dir)
	for _, stale := range []string{"session.json.pending", "session.json.123456"} {
		if err := os.WriteFile(filepath.Join(dir, stale), []byte("stale"), 0o666); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if err := store.Write("session.json", []byte("new")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	info, err := os.Stat(filepath.Join(dir, "session.json"))
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600 rather than an abandoned file's", info.Mode().Perm())
	}
	read, err := store.Read("session.json")
	if err != nil || string(read) != "new" {
		t.Errorf("read = %q (%v), want what was just written", read, err)
	}
}

func TestTwoWritersNeverPublishHalfOfEachOthersRecord(t *testing.T) {
	// under one shared temp name, a second writer removing and recreating the file between the
	// first's write and its rename publishes its bytes under the first's name. every answer below
	// has to be one whole record.
	dir := t.TempDir()
	store := At(dir)
	records := []string{strings.Repeat("a", 4096), strings.Repeat("b", 4096)}

	var wait sync.WaitGroup
	for round := 0; round < 40; round++ {
		for _, record := range records {
			wait.Add(1)
			go func() {
				defer wait.Done()
				if err := store.Write("session.json", []byte(record)); err != nil {
					t.Errorf("Write: %v", err)
				}
			}()
		}
	}
	wait.Wait()

	read, err := store.Read("session.json")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(read) != records[0] && string(read) != records[1] {
		t.Errorf("the record is %d bytes and is neither of the two written whole", len(read))
	}
}

func TestTheWriteLeavesNothingBesideTheRecord(t *testing.T) {
	// the rename is what makes a reader see the whole of one record or the whole of the other, and
	// it is a rename rather than a copy because the pending file is in the same directory.
	dir := t.TempDir()

	if err := At(dir).Write("session.json", []byte("{}")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "session.json" {
		names := []string{}
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Errorf("directory holds %s, want the record alone", strings.Join(names, ", "))
	}
}

func TestADirectoryThatIsNotThereYetIsMade(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "better-giving")

	if err := At(dir).Write("account.json", []byte("{}")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Errorf("mode = %v, want a directory only this account can open", info.Mode().Perm())
	}
}

func TestARecordReadsBackAsItWasWritten(t *testing.T) {
	dir := t.TempDir()
	store := At(dir)
	if err := store.Write("account.json", []byte(`{"id":"a1"}`)); err != nil {
		t.Fatalf("Write: %v", err)
	}

	read, err := store.Read("account.json")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}

	if string(read) != `{"id":"a1"}` {
		t.Errorf("read = %q, want what was written", read)
	}
}

func TestARecordThatIsNotThereReadsAsAbsentRatherThanAsAFailure(t *testing.T) {
	read, err := At(t.TempDir()).Read("session.json")

	if err != nil {
		t.Fatalf("err = %v, want a machine with nothing recorded to be an ordinary state", err)
	}
	if read != nil {
		t.Errorf("read = %q, want nothing", read)
	}
}

func TestForgettingARecordThatIsNotThereIsTheStateBeingAskedFor(t *testing.T) {
	store := At(t.TempDir())

	if err := store.Forget("session.json"); err != nil {
		t.Errorf("Forget: %v", err)
	}
}

func TestForgettingTakesTheRecordOffTheMachine(t *testing.T) {
	dir := t.TempDir()
	store := At(dir)
	if err := store.Write("session.json", []byte("{}")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	if err := store.Forget("session.json"); err != nil {
		t.Fatalf("Forget: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "session.json")); !os.IsNotExist(err) {
		t.Errorf("the record is still there: %v", err)
	}
}
