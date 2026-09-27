package account

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/state"
)

// which cloudflare account this deployment is in, as this machine remembers it.
//
// **an account id is not a credential.** it authorises nothing on its own and is the identifier
// already in every cloudflare dashboard url — so what is asserted below is the whole of the file
// rather than the two keys in it, and anything that does authorise something arriving beside them
// fails here.

func TestAMachineWithNothingChosenHasNothingToAnswerWith(t *testing.T) {
	store := New(state.At(t.TempDir()))
	if chosen := store.Chosen(); chosen != nil {
		t.Fatalf("a first run answered %+v", chosen)
	}
}

func TestAChoiceIsReadBackByTheNextRunOfTheConsole(t *testing.T) {
	dir := t.TempDir()
	if remembered := New(state.At(dir)).Choose(Account{ID: "an-account", Name: "hound-haven"}); !remembered {
		t.Fatal("a writable directory said the choice was not remembered")
	}

	chosen := New(state.At(dir)).Chosen()
	if chosen == nil {
		t.Fatal("the next run found nothing recorded")
	}
	if chosen.Account.ID != "an-account" || chosen.Account.Name != "hound-haven" || !chosen.Remembered {
		t.Fatalf("read back %+v", chosen)
	}
}

func TestTheRecordIsTheAccountAndNothingElse(t *testing.T) {
	dir := t.TempDir()
	New(state.At(dir)).Choose(Account{ID: "an-account", Name: "hound-haven"})

	written, err := os.ReadFile(filepath.Join(dir, "account.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != "{\n\t\"id\": \"an-account\",\n\t\"name\": \"hound-haven\"\n}\n" {
		t.Fatalf("the record holds %s", written)
	}
}

func TestThisRunsChoiceOutlastsAnotherProcessRecordingADifferentAccount(t *testing.T) {
	dir := t.TempDir()
	running := New(state.At(dir))
	if !running.Choose(Account{ID: "this-runs-account", Name: "hound-haven"}) {
		t.Fatal("a writable directory said the choice was not remembered")
	}
	// a second console on the same machine, the way `better-giving login` in another terminal is.
	New(state.At(dir)).Choose(Account{ID: "another-account", Name: "cat-corner"})

	chosen := running.Chosen()
	if chosen == nil || chosen.Account.ID != "this-runs-account" || !chosen.Remembered {
		t.Fatalf("the running console moved to %+v", chosen)
	}
}

func TestWritingThroughAnAnswerChangesNoOtherAnswer(t *testing.T) {
	store := New(state.At(t.TempDir()))
	store.Choose(Account{ID: "an-account", Name: "hound-haven"})

	answered := store.Chosen()
	answered.Account.ID = "a-caller's-edit"
	answered.Remembered = false

	chosen := store.Chosen()
	if chosen.Account.ID != "an-account" || !chosen.Remembered {
		t.Fatalf("one caller's edit reached the next answer: %+v", chosen)
	}
}

func TestAMachineThatCannotBeWrittenOnKeepsTheChoiceForThisRun(t *testing.T) {
	// a directory that cannot be made: the path names a file, so creating anything under it fails
	// the way a read-only home or a directory somebody else owns does.
	blocked := filepath.Join(t.TempDir(), "in-the-way")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := New(state.At(filepath.Join(blocked, "better-giving")))

	if store.Choose(Account{ID: "an-account", Name: "hound-haven"}) {
		t.Fatal("a directory that cannot be written said the choice was remembered")
	}
	chosen := store.Chosen()
	if chosen == nil || chosen.Account.ID != "an-account" {
		t.Fatalf("the operator was sent back to the picker: %+v", chosen)
	}
	if chosen.Remembered {
		t.Fatal("a choice nothing recorded was answered as remembered")
	}
}

// a directory whose older record still reads back and which refuses every write, the way a config
// directory that went read-only, or a full disk, holds on to the account.json it already had.
type refusingWrites struct{ held []byte }

func (dir refusingWrites) Read(string) ([]byte, error) { return dir.held, nil }
func (refusingWrites) Write(string, []byte) error      { return os.ErrPermission }

func TestAChoiceThatCouldNotBeWrittenIsAnsweredOverTheOlderRecord(t *testing.T) {
	store := &Store{state: refusingWrites{held: []byte(`{"id":"the-old-account","name":"old-haven"}`)}}

	if store.Choose(Account{ID: "the-new-account", Name: "hound-haven"}) {
		t.Fatal("a refused write said the choice was remembered")
	}
	chosen := store.Chosen()
	if chosen == nil || chosen.Account.ID != "the-new-account" {
		t.Fatalf("the operator chose the-new-account and the console answered %+v", chosen)
	}
	if chosen.Remembered {
		t.Fatal("a choice nothing recorded was answered as remembered")
	}
}

// a directory that takes every write and holds nothing, so the only shared state under test is the
// store's own.
type acceptingWrites struct{}

func (acceptingWrites) Read(string) ([]byte, error) { return nil, nil }
func (acceptingWrites) Write(string, []byte) error  { return nil }

// handlers answer Chosen while a choice is being made; -race is what fails this when either side
// goes unguarded.
func TestChoosingWhileHandlersAskIsSafe(t *testing.T) {
	store := &Store{state: acceptingWrites{}}
	var askers sync.WaitGroup
	for range 4 {
		askers.Add(1)
		go func() {
			defer askers.Done()
			for range 100 {
				store.Chosen()
			}
		}()
	}
	for range 100 {
		store.Choose(Account{ID: "an-account", Name: "hound-haven"})
	}
	askers.Wait()
}

// a directory that reports whether the store's lock was free while it was being written.
type watchingTheLock struct {
	store       *Store
	writtenFree *bool
}

func (watchingTheLock) Read(string) ([]byte, error) { return nil, nil }
func (dir watchingTheLock) Write(string, []byte) error {
	if dir.store.mutex.TryLock() {
		*dir.writtenFree = true
		dir.store.mutex.Unlock()
	}
	return nil
}

// two overlapping choices each write and then hold; were the lock free between the two steps, the
// run could end holding one account while the disk holds the other.
func TestAChoiceIsWrittenAndHeldUnderOneLock(t *testing.T) {
	var writtenFree bool
	store := &Store{}
	store.state = watchingTheLock{store: store, writtenFree: &writtenFree}

	store.Choose(Account{ID: "an-account", Name: "hound-haven"})
	if writtenFree {
		t.Fatal("the record was written while another choice could take the lock")
	}
}

func TestARunThatChoseNothingAnswersTheRecord(t *testing.T) {
	store := &Store{state: refusingWrites{held: []byte(`{"id":"the-old-account","name":"old-haven"}`)}}

	chosen := store.Chosen()
	if chosen == nil || chosen.Account.ID != "the-old-account" || !chosen.Remembered {
		t.Fatalf("the record on disk was answered as %+v", chosen)
	}
}
