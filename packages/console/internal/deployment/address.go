package deployment

import (
	"context"
	"net/url"

	"github.com/better-giving/console/internal/cf"
)

// where this deployment answers, derived and never typed.
//
// **the operator states no URL and no release carries one.** CLAUDE.md's rule is that no deployment
// artifact is committed, and a deployed hostname is named there among them — so the address is
// worked out from the account and the worker name every time it is shown, and nothing here writes
// it anywhere.
//
// **the worker is asked for by name.** nothing writes an address down, so a fork that renamed the
// deployment gets the address of what it renamed it to rather than one this console remembered.
//
// **a url is composed only after the worker's own workers.dev setting says it answers on one.** a
// worker declaring routes has workers.dev off by default, so an address assembled from the
// account's subdomain alone would name something nothing serves. the read order below is what
// enforces that rather than a check that could be moved: the account's subdomain is not asked for
// at all until the worker's setting has come back on.
//
// **10007 means two different things and is told apart by which read got it.** on the worker's own
// setting it is a worker that is not on the account, which is the ordinary state of every run
// before a first deploy; on the account's subdomain it is an account that has never registered one.
// a reader keying on the code alone would report a fork's first run as a broken account.

// AddressKind is which of the five ways an address read ended.
type AddressKind string

const (
	// Deployed is the worker being in the account, whatever it answers on.
	Deployed AddressKind = "deployed"
	// NotDeployed is the worker not being in the account, which is every run before a first deploy.
	NotDeployed AddressKind = "not-deployed"
	// AddressRefused is cloudflare turning this sign-in down for this account.
	AddressRefused AddressKind = "refused"
	// AddressUnreachable is nothing found out either way.
	AddressUnreachable AddressKind = "unreachable"
	// AddressUnreadable is an answer in a shape nothing here was written against.
	AddressUnreadable AddressKind = "unreadable"
)

// NoWorkersDev is why there is no workers.dev address, where there is none.
type NoWorkersDev string

const (
	// TurnedOff is a deployed worker with workers.dev off, the default once it has routes.
	TurnedOff NoWorkersDev = "turned-off"
	// Unregistered is an account that has never registered a workers.dev subdomain.
	Unregistered NoWorkersDev = "unregistered"
	// Unknown is a worker that answers on one and an account that would not say what it is called.
	Unknown NoWorkersDev = "unknown"
)

// Address is where this deployment answers, or which way that was not read.
type Address struct {
	Kind AddressKind
	// WorkersDev is the whole address and not a hostname, and is empty where the worker answers on
	// none. Why says which of the three reasons.
	WorkersDev string
	Why        NoWorkersDev
	// Domains is every custom domain this worker answers on, as addresses. ReadDomains is whether
	// cloudflare said: an empty list with ReadDomains false is a read that did not land, which is a
	// different sentence from cloudflare saying there are none.
	Domains     []string
	ReadDomains bool
	Detail      string
}

// Origin is where a console would reach this deployment, or empty where it would reach nothing.
//
// The account's own workers.dev address first, because it is derived from the account and answers
// for this worker alone; a custom domain is the answer where workers.dev is off, which is the
// default once a worker has routes. A worker that is deployed and answers on neither is empty
// rather than a guess — a console that invented a host would write a credential at somebody else's.
func (address Address) Origin() string {
	if address.Kind != Deployed {
		return ""
	}
	if address.WorkersDev != "" {
		return address.WorkersDev
	}
	if len(address.Domains) > 0 {
		return address.Domains[0]
	}
	return ""
}

// PublicAddress is where `workerName` in `accountID` answers, read out of the account.
func PublicAddress(ctx context.Context, get cf.Get, accountID, workerName string) Address {
	named := url.PathEscape(workerName)
	base := "/accounts/" + accountID + "/workers"

	enabled := cf.ReadShaped(get(ctx, base+"/scripts/"+named+"/subdomain"), func(value any) (bool, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return false, false
		}
		on, isBool := held["enabled"].(bool)
		return on, isBool
	})
	switch enabled.Kind {
	case cf.ResultMissing:
		return Address{Kind: NotDeployed}
	case cf.ResultRefused:
		return Address{Kind: AddressRefused, Detail: enabled.Detail}
	case cf.ResultUnreachable:
		return Address{Kind: AddressUnreachable, Detail: enabled.Detail}
	case cf.ResultUnreadable:
		return Address{Kind: AddressUnreadable, Detail: enabled.Detail}
	}

	// `environment=production` is the default environment of a service. a named environment of this
	// deployment is a worker of its own name — internal/release appends it — so the name above is
	// the whole of what identifies it and there is no second environment to ask for.
	listed := get(ctx, base+"/domains?service="+url.QueryEscape(workerName)+"&environment=production")
	hostnames, read := customDomains(listed, workerName)

	if !enabled.Value {
		return Address{
			Kind:        Deployed,
			Why:         TurnedOff,
			Domains:     hostnames,
			ReadDomains: read,
		}
	}

	// the account's own name is read by ./workersdev.go, which is the one reading of it: a second
	// one here would be a second answer to whether an account has a workers.dev name, on the two
	// paths that both turn on that question.
	name := AccountName(ctx, get, accountID)
	if name.Kind == NameHeld {
		return Address{
			Kind:        Deployed,
			WorkersDev:  "https://" + workerName + "." + name.Name + ".workers.dev",
			Domains:     hostnames,
			ReadDomains: read,
		}
	}
	why := Unknown
	if name.Kind == NameNone {
		why = Unregistered
	}
	return Address{Kind: Deployed, Why: why, Domains: hostnames, ReadDomains: read}
}

// the custom domains this worker answers on, as addresses, and whether cloudflare said.
//
// Cloudflare lists a hostname and this answers in addresses, because an address is what every
// caller needs — a page to show, and a session to write.
func customDomains(answer cf.Answer, workerName string) ([]string, bool) {
	read := cf.ReadShaped(answer, func(value any) ([]any, bool) {
		held, ok := value.([]any)
		return held, ok
	})
	if read.Kind != cf.ResultValue {
		return nil, false
	}
	addresses := []string{}
	for _, row := range read.Value {
		held, ok := row.(map[string]any)
		if !ok || held["service"] != workerName {
			continue
		}
		hostname, isText := held["hostname"].(string)
		if isText && hostname != "" {
			addresses = append(addresses, "https://"+hostname)
		}
	}
	return addresses, true
}

// AddressRead is one address read as a screen draws it.
//
// **it is the address read on the wire, and it is written where a press could not act on one.** the
// Stripe chain registers an endpoint at Origin, and a press that found no origin reports this so
// that the fold can say which of the five it was — a worker that has gone, one answering on nothing
// at all, and the three ways nothing was found out.
//
// Domains is nil where cloudflare would not say, which is a different sentence from the empty list
// that means it said there are none: a console offering an address it did not read would send an
// integrator at a host that may be somebody else's.
type AddressRead struct {
	Kind       string   `json:"kind"`
	WorkersDev *string  `json:"workersDev"`
	Why        *string  `json:"why"`
	Domains    []string `json:"domains"`
	Detail     string   `json:"detail"`
}

// Read is this address in the shape a screen reads it in.
func (address Address) Read() AddressRead {
	read := AddressRead{Kind: string(address.Kind), Detail: address.Detail}
	if address.Kind != Deployed {
		return read
	}
	if address.WorkersDev != "" {
		held := address.WorkersDev
		read.WorkersDev = &held
	} else if address.Why != "" {
		why := string(address.Why)
		read.Why = &why
	}
	if address.ReadDomains {
		read.Domains = address.Domains
		if read.Domains == nil {
			read.Domains = []string{}
		}
	}
	return read
}

// NoCredentialAddress is the address read this console holds no cloudflare sign-in to make.
//
// An address read of its own rather than a refusal of the press, because it is what a press that
// needed an address got: the fold has a sentence for a console that could not work out where this
// deployment answers, and this is one of the ways it could not.
func NoCredentialAddress(detail string) AddressRead {
	return AddressRead{Kind: "no-credential", Detail: detail}
}
