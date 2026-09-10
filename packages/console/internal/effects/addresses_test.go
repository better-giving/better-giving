package effects

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/signin"
)

// the read behind the account picker's marks: one per account, all at once, and whatever landed
// inside the ceiling.
//
// what it is for is a row an operator can read the account off — so the one thing it may never do
// is answer for an account it did not find out about, and the second thing is hold a `start` up
// while one account's read goes nowhere.

// a sign-in's accounts, by id, as every case below hands them over.
func reaching(ids ...string) []signin.Account {
	held := make([]signin.Account, 0, len(ids))
	for _, id := range ids {
		held = append(held, signin.Account{ID: id, Name: id})
	}
	return held
}

// the reads a case answers with, and what it recorded about how they were made.
type reads struct {
	mutex  sync.Mutex
	answer map[string]deployment.Address
	// slow are the accounts whose read never comes back inside the ceiling.
	slow map[string]bool
	made []string
}

func (held *reads) read(ctx context.Context, accountID string) deployment.Address {
	held.mutex.Lock()
	held.made = append(held.made, accountID)
	slow := held.slow[accountID]
	answer := held.answer[accountID]
	held.mutex.Unlock()

	if slow {
		<-ctx.Done()
		return deployment.Address{Kind: deployment.AddressUnreachable}
	}
	return answer
}

func (held *reads) count() int {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return len(held.made)
}

func TestTheDeploymentIsLookedForOnceOnEveryAccount(t *testing.T) {
	held := &reads{answer: map[string]deployment.Address{
		"a1": {Kind: deployment.Deployed, WorkersDev: "https://one.workers.dev"},
		"b2": {Kind: deployment.NotDeployed},
	}}

	found := eachAddress(context.Background(), reaching("a1", "b2"), held.read, time.Second)

	if held.count() != 2 {
		t.Errorf("%d reads were made, want one for each account: %v", held.count(), held.made)
	}
	if found["a1"].Kind != deployment.Deployed {
		t.Errorf("the account holding the deployment reads as %v", found["a1"])
	}
	if found["b2"].Kind != deployment.NotDeployed {
		t.Errorf("an account with no deployment on it reads as %v", found["b2"])
	}
}

func TestAnAccountWhoseReadGoesNowhereHoldsUpNoneOfTheOthers(t *testing.T) {
	held := &reads{
		answer: map[string]deployment.Address{"b2": {Kind: deployment.Deployed}},
		slow:   map[string]bool{"a1": true},
	}

	found := eachAddress(context.Background(), reaching("a1", "b2"), held.read, 50*time.Millisecond)

	if found["b2"].Kind != deployment.Deployed {
		t.Errorf("the account that answered is %v, want the read that landed kept", found["b2"])
	}
	if _, carried := found["a1"]; carried {
		t.Errorf("the account whose read never came back is on the list as %v", found["a1"])
	}
}

func TestAReadCloudflareRefusedFindsOutNothingAndSaysNothing(t *testing.T) {
	// an unmarked row is this console making no claim, so a refusal, a network that went away and
	// an answer in a shape nothing here was written against all leave the account off the list —
	// where a row saying no deployment is there would be a claim none of them supports.
	held := &reads{answer: map[string]deployment.Address{
		"a1": {Kind: deployment.AddressRefused},
		"b2": {Kind: deployment.AddressUnreachable},
		"c3": {Kind: deployment.AddressUnreadable},
	}}

	found := eachAddress(context.Background(), reaching("a1", "b2", "c3"), held.read, time.Second)

	if len(found) != 0 {
		t.Errorf("reads that found out nothing left %v on the list", found)
	}
}

func TestTheCeilingIsWhatThePickerWaitsOnAndNoLonger(t *testing.T) {
	// past it the picker draws with whatever landed rather than making the operator wait: the marks
	// are a help on the way to a choice and never the choice itself.
	held := &reads{slow: map[string]bool{"a1": true, "b2": true}}

	began := time.Now()
	found := eachAddress(context.Background(), reaching("a1", "b2"), held.read, 50*time.Millisecond)

	if took := time.Since(began); took > time.Second {
		t.Errorf("the reads held the picker for %v, want the ceiling", took)
	}
	if len(found) != 0 {
		t.Errorf("reads that never landed left %v on the list", found)
	}
}
