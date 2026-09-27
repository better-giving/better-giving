// Package account is which cloudflare account this deployment is in, as this machine remembers it.
//
// **an account id is not a credential.** it authorises nothing on its own, it is the identifier
// already in every cloudflare dashboard url, and a sign-in is still needed to do anything with it.
// what may never be written here is anything that does authorise something — no access token, no
// refresh token, none of the deployment's own secrets. the case in ./account_test.go asserts the
// whole of the file rather than its two keys, so a third thing arriving beside them fails there.
//
// **a choice made in this run is this run's account until the binary exits.** it is held in this
// process beside the record and answered before it, so a `better-giving login` in another terminal
// that records a different account moves no server already running: the account `start` deployed
// to or carried is the one every later read and write goes under. the record is read only by a run
// that has chosen nothing.
//
// **a machine the state directory cannot be written on still lets the operator carry on.** the
// choice is held all the same and Chosen answers it with Remembered false, which is a note the
// screen draws: the account is the one they just chose, and what did not happen is the
// remembering.
//
// **the session value belongs to the process rather than to a request**, and handlers run
// concurrently, so it is guarded rather than merely held: Choose writes the record and sets the
// value under one lock, so overlapping choices cannot leave the run on one account and the disk on
// another.
package account

import (
	"encoding/json"
	"sync"

	"github.com/better-giving/console/internal/state"
)

// what the account is recorded under, beside the other things this machine remembers.
const accountFile = "account.json"

// Account is one cloudflare account this deployment can be in.
type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Choice is the account this deployment is in, and where it came from: Remembered is that this
// run's choice was written when it was made, or that a run which chose nothing read it from the
// record. it says nothing about what a restart finds, since another process may record a different
// account after it.
type Choice struct {
	Account    Account
	Remembered bool
}

// the two calls this store makes on a directory of records, which state.Store answers and a test
// answers with a write that fails while an older record still reads back.
type records interface {
	Read(name string) ([]byte, error)
	Write(name string, data []byte) error
}

// Store is what this machine remembers about the account, on disk and for this run.
type Store struct {
	state   records
	mutex   sync.Mutex
	session *Choice
}

// New is the account store over one directory of records.
func New(store state.Store) *Store { return &Store{state: store} }

// Chosen is the account this deployment is in, or nil while nothing has been chosen. the answer is
// the caller's own copy.
//
// a choice made in this run is answered before the record for the rest of the run, whether its
// write landed or not: a record another process writes afterwards does not move it.
func (store *Store) Chosen() *Choice {
	store.mutex.Lock()
	session := store.session
	store.mutex.Unlock()
	if session != nil {
		answer := *session
		return &answer
	}
	if recorded := store.recorded(); recorded != nil {
		return &Choice{Account: *recorded, Remembered: true}
	}
	return nil
}

// Choose records which account this deployment is in, and answers whether it will be remembered.
func (store *Store) Choose(account Account) bool {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	written, err := json.MarshalIndent(account, "", "\t")
	remembered := err == nil
	if remembered {
		remembered = store.state.Write(accountFile, append(written, '\n')) == nil
	}
	store.session = &Choice{Account: account, Remembered: remembered}
	return remembered
}

// the account on disk, or nil where there is none to read or what is there is not one.
func (store *Store) recorded() *Account {
	read, err := store.state.Read(accountFile)
	if err != nil || len(read) == 0 {
		return nil
	}
	var held Account
	if json.Unmarshal(read, &held) != nil || held.ID == "" {
		return nil
	}
	// an account with no name is still the account this deployment is in, and it is read by the id
	// an operator matches against cloudflare's own dashboard anyway.
	if held.Name == "" {
		held.Name = held.ID
	}
	return &held
}
