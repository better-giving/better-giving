// Package account is which cloudflare account this deployment is in, as this machine remembers it.
//
// **an account id is not a credential.** it authorises nothing on its own, it is the identifier
// already in every cloudflare dashboard url, and a sign-in is still needed to do anything with it.
// what may never be written here is anything that does authorise something — no access token, no
// refresh token, none of the deployment's own secrets. the case in ./account_test.go asserts the
// whole of the file rather than its two keys, so a third thing arriving beside them fails there.
//
// **a machine the state directory cannot be written on still lets the operator carry on.** the
// choice is held in this process instead and Chosen answers it with Remembered false, which is a
// note the screen draws: the account is the one they just chose, and what did not happen is the
// remembering. it is true until the binary is restarted.
//
// **the session value belongs to the process rather than to a request**, and handlers run
// concurrently, so it is guarded rather than merely held.
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

// Choice is the account this deployment is in, and whether this machine will still know it after a
// restart.
type Choice struct {
	Account    Account
	Remembered bool
}

// Store is what this machine remembers about the account, on disk and for this run.
type Store struct {
	state   state.Store
	mutex   sync.Mutex
	session *Choice
}

// New is the account store over one directory of records.
func New(store state.Store) *Store { return &Store{state: store} }

// Chosen is the account this deployment is in, or nil while nothing has been chosen.
func (store *Store) Chosen() *Choice {
	if recorded := store.recorded(); recorded != nil {
		return &Choice{Account: *recorded, Remembered: true}
	}
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.session
}

// Choose records which account this deployment is in, and answers whether it will be remembered.
func (store *Store) Choose(account Account) bool {
	written, err := json.MarshalIndent(account, "", "\t")
	remembered := err == nil
	if remembered {
		remembered = store.state.Write(accountFile, append(written, '\n')) == nil
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()
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
