// Package state is where this machine keeps what it remembers between runs — which cloudflare
// account this deployment is in, which resources it has claimed, and the session it holds open to
// the deployment.
//
// **the directory is the operating system's own config home and not the repository.** the console
// is a binary an operator runs from wherever they are standing, so there is no checkout to write
// beside and nothing to add an ignore line to. HomeVar is the override, and it is what a test and a
// second deployment on one machine both use.
//
// **a record is written into a file that has just been created, and renamed over the old one.** the
// mode a create states applies only where it creates the file, so writing a new token straight into
// a record that is already there would put it in whatever mode that one was left in — and narrowing
// afterwards leaves a window in which a live credential sits at the wider one. the rename is atomic,
// which is the same property from the reading end: a reader sees the whole of one record or the
// whole of the other, never half of this one. the pending file is in the same directory because a
// rename across filesystems is a copy, and a copy is neither atomic nor made fresh.
//
// **the temp file's name is unique to the write rather than derived from the record's**, which is
// what makes two writers safe. under one shared name, a second process removing and recreating the
// file between the first's write and its rename publishes the second's bytes under the first's
// name. a name nobody else picks also cannot be a file left behind by a run that died — which would
// otherwise be created-already, and take its mode rather than 0600.
package state

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// HomeVar names the directory this machine's memory is kept in, in place of the config home.
const HomeVar = "BETTER_GIVING_HOME"

// what the directory is called under the config home.
const dirName = "better-giving"

// Dir is where this machine's memory lives, or why there is nowhere to put it.
func Dir() (string, error) {
	if stated := os.Getenv(HomeVar); stated != "" {
		return stated, nil
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(config, dirName), nil
}

// Store is one directory of records, addressed by filename.
type Store struct{ dir string }

// At is the store in a stated directory, which is what a test and Open both bind.
func At(dir string) Store { return Store{dir: dir} }

// Open is the store this machine keeps, or why there is nowhere to keep one.
func Open() (Store, error) {
	dir, err := Dir()
	if err != nil {
		return Store{}, err
	}
	return At(dir), nil
}

// Dir is the directory this store writes into, for a sentence that has to name it.
func (store Store) Dir() string { return store.dir }

// Write records `data` under `name`, replacing whatever was there.
//
// See the package comment for why it is a fresh file and a rename rather than a write in place.
func (store Store) Write(name string, data []byte) error {
	if err := os.MkdirAll(store.dir, 0o700); err != nil {
		return err
	}
	// created 0600 by os.CreateTemp, and under a name no other writer will pick.
	pending, err := os.CreateTemp(store.dir, name+".*")
	if err != nil {
		return err
	}
	written := pending.Name()
	if _, err := pending.Write(data); err != nil {
		pending.Close()
		_ = os.Remove(written)
		return err
	}
	// the bytes are pushed to the disk before the rename, so that a machine that lost power in the
	// gap wakes holding either the record that was there or the whole of the new one — a rename that
	// landed over content that had not is a credential file the next run reads as empty.
	if err := pending.Sync(); err != nil {
		pending.Close()
		_ = os.Remove(written)
		return err
	}
	if err := pending.Close(); err != nil {
		_ = os.Remove(written)
		return err
	}
	if err := os.Rename(written, filepath.Join(store.dir, name)); err != nil {
		_ = os.Remove(written)
		return err
	}
	return nil
}

// Read is what is recorded under `name`, or nil where there is nothing recorded.
//
// A machine with nothing remembered is the ordinary state of a first run, so it is an empty answer
// rather than an error; anything else that went wrong is one.
func (store Store) Read(name string) ([]byte, error) {
	read, err := os.ReadFile(filepath.Join(store.dir, name))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	return read, err
}

// Forget takes the record under `name` off this machine.
//
// A record that is not there is the state being asked for.
func (store Store) Forget(name string) error {
	err := os.Remove(filepath.Join(store.dir, name))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}
