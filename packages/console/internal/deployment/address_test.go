package deployment

import (
	"context"
	"testing"
)

const worker = "better-giving"

var (
	enablement = "/accounts/" + account + "/workers/scripts/" + worker + "/subdomain"
	subdomain  = "/accounts/" + account + "/workers/subdomain"
	domains    = "/accounts/" + account + "/workers/domains"
)

func read(t *testing.T, answers map[string]any) Address {
	t.Helper()
	return PublicAddress(context.Background(), fake(t, answers), account, worker)
}

// 10007 on the worker's own setting is the ordinary state of every run before a first deploy, and
// a reader keying on the code alone would report it as a broken account.
func TestAnAddressIsNotAskedForAWorkerThatIsNotThere(t *testing.T) {
	got := read(t, map[string]any{enablement: failed(10007, "workers.api.error.script_not_found")})
	if got.Kind != NotDeployed {
		t.Fatalf("read %+v", got)
	}
}

func TestTheAddressIsTheAccountsSubdomainWhereTheWorkerAnswersOnOne(t *testing.T) {
	got := read(t, map[string]any{
		enablement: envelope(map[string]any{"enabled": true}),
		subdomain:  envelope(map[string]any{"subdomain": "hound-haven"}),
		domains:    envelope([]any{}),
	})
	if got.Kind != Deployed || got.WorkersDev != "https://better-giving.hound-haven.workers.dev" {
		t.Fatalf("read %+v", got)
	}
	if got.Origin() != got.WorkersDev {
		t.Fatalf("origin %q", got.Origin())
	}
}

// a worker declaring routes has workers.dev off by default, so an address assembled from the
// account's subdomain alone would name something nothing serves.
func TestTheAccountIsNotAskedForItsSubdomainWhenTheWorkerAnswersOnNone(t *testing.T) {
	got := read(t, map[string]any{
		enablement: envelope(map[string]any{"enabled": false}),
		domains: envelope([]any{
			map[string]any{"service": worker, "hostname": "give.hound-haven.org"},
			map[string]any{"service": "somebody-elses", "hostname": "elsewhere.example"},
		}),
		// the account's own subdomain answers, and asking for it at all would be the read this
		// ordering exists to skip.
		subdomain: envelope(map[string]any{"subdomain": "hound-haven"}),
	})
	if got.Kind != Deployed || got.WorkersDev != "" || got.Why != TurnedOff {
		t.Fatalf("read %+v", got)
	}
	if got.Origin() != "https://give.hound-haven.org" {
		t.Fatalf("origin %q", got.Origin())
	}
}

// 10007 on the account's subdomain is an account that has never registered one, which is a fork's
// first run rather than a failure.
func TestAnAccountWithNoSubdomainIsSaidSoRatherThanGuessedAt(t *testing.T) {
	got := read(t, map[string]any{
		enablement: envelope(map[string]any{"enabled": true}),
		subdomain:  failed(10007, "not found"),
		domains:    envelope([]any{}),
	})
	if got.Kind != Deployed || got.Why != Unregistered || got.Origin() != "" {
		t.Fatalf("read %+v", got)
	}
}

func TestAnAccountThatRefusedTheReadIsNotADeployment(t *testing.T) {
	got := read(t, map[string]any{enablement: failed(10000, "Authentication error")})
	if got.Kind != AddressRefused {
		t.Fatalf("read %+v", got)
	}
}

// null is this console not having found out; the empty list is cloudflare saying there are none.
func TestDomainsThatCouldNotBeReadAreNotAnEmptyList(t *testing.T) {
	got := read(t, map[string]any{
		enablement: envelope(map[string]any{"enabled": true}),
		subdomain:  envelope(map[string]any{"subdomain": "hound-haven"}),
		domains:    failed(10000, "Authentication error"),
	})
	if got.Kind != Deployed || got.ReadDomains {
		t.Fatalf("read %+v", got)
	}
}

func TestAnAddressIsReadOutAsTheThreeFactsAScreenDrawsFromIt(t *testing.T) {
	for _, one := range []struct {
		name  string
		held  Address
		wants AddressRead
	}{
		{
			name: "a worker answering on the account's own subdomain",
			held: Address{Kind: Deployed, WorkersDev: "https://w.acct.workers.dev", ReadDomains: true},
			wants: AddressRead{
				Kind: "deployed", WorkersDev: says("https://w.acct.workers.dev"), Domains: []string{},
			},
		},
		{
			name:  "a worker answering on neither, which says which of the three reasons",
			held:  Address{Kind: Deployed, Why: TurnedOff, ReadDomains: true},
			wants: AddressRead{Kind: "deployed", Why: says("turned-off"), Domains: []string{}},
		},
		{
			name: "custom domains that could not be read, which is not an account holding none",
			held: Address{Kind: Deployed, Why: TurnedOff},
			// nil rather than the empty list: a screen offering an address it did not read would
			// send an integrator at a host that may be somebody else's.
			wants: AddressRead{Kind: "deployed", Why: says("turned-off")},
		},
		{
			name:  "a worker that is not in the account",
			held:  Address{Kind: NotDeployed},
			wants: AddressRead{Kind: "not-deployed"},
		},
		{
			name:  "cloudflare turning this sign-in down",
			held:  Address{Kind: AddressRefused, Detail: "no access"},
			wants: AddressRead{Kind: "refused", Detail: "no access"},
		},
	} {
		t.Run(one.name, func(t *testing.T) {
			read := one.held.Read()
			if read.Kind != one.wants.Kind || read.Detail != one.wants.Detail {
				t.Errorf("read = %+v, want %+v", read, one.wants)
			}
			if !samePointer(read.WorkersDev, one.wants.WorkersDev) {
				t.Errorf("workersDev = %v, want %v", read.WorkersDev, one.wants.WorkersDev)
			}
			if !samePointer(read.Why, one.wants.Why) {
				t.Errorf("why = %v, want %v", read.Why, one.wants.Why)
			}
			if (read.Domains == nil) != (one.wants.Domains == nil) {
				t.Errorf("domains = %v, want %v", read.Domains, one.wants.Domains)
			}
		})
	}
}

func TestAConsoleHoldingNoSignInIsAnAddressReadThatSaysSo(t *testing.T) {
	// the press that reaches this is one made from a page drawn before the operator signed out, and
	// the fold's sentence for it is the one every other read that found nothing out gets.
	read := NoCredentialAddress("nothing to ask with")
	if read.Kind != "no-credential" || read.Detail != "nothing to ask with" {
		t.Errorf("read = %+v", read)
	}
}

func samePointer(held, want *string) bool {
	if held == nil || want == nil {
		return held == want
	}
	return *held == *want
}

func says(value string) *string { return &value }
