// Package signin is how this machine is signed in to cloudflare, and which accounts that sign-in
// carries.
//
// **the credential is ../oauth's and the reading of it is this package's.** nothing here decides
// where a credential comes from, and nothing here writes one down: a Credential is handed in, three
// reads are made with it, and what comes back is a state a screen draws.
//
// five answers, and each is a state rather than an error. what makes them worth telling apart is
// that the way out of each is different: signing in again fixes an expired credential and does
// nothing for a dropped network, and a sign-in is refused outright while a credential is set in the
// environment — so a screen that offered it there would be offering a refusal.
//
// **what is read, and what decides each:**
//
//	signed in   whether there is a credential at all.
//	kind        the credential's own kind, and whether the environment is where it came from. a
//	            global api key travels with an email and can only have been set in the environment;
//	            an inherited CLOUDFLARE_API_TOKEN is the other way in. that is the whole of what
//	            Token is for.
//	email       the address a global api key already carries, or `/user` for everything else. a
//	            credential that may not read the user behind it answers 9109, which is an address
//	            that cannot be shown and never a sign-in that failed.
//	accounts    `/accounts` intersected with the memberships this sign-in has accepted, both
//	            followed to their last page.
//
// **the account list is an intersection and not a list.** an account this credential can see is not
// an account it is a member of, and the id every command after the connect screen runs under has to
// be both. accounts states what happens when only one of the two lists comes back.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.
package signin

import (
	"context"
	"slices"
	"sync"

	"github.com/better-giving/console/internal/cf"
)

// Account is one cloudflare account this sign-in can be scoped to.
type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Kind is which of the five states this machine's sign-in is in.
type Kind string

const (
	// OAuth is a browser sign-in this binary holds itself, with the accounts it carries.
	OAuth Kind = "oauth"
	// Token is an api token set in the environment, or a global api key, with the same.
	Token Kind = "token"
	// SignedOut is a machine holding no sign-in at all.
	SignedOut Kind = "signed-out"
	// Refused is a sign-in that exists and cloudflare turned down.
	Refused Kind = "refused"
	// Unreachable is a cloudflare nothing was found out from, either way.
	Unreachable Kind = "unreachable"
)

// SignIn is how this machine is signed in, as a screen draws it.
//
// It carries an address and a list of accounts and never a credential: what reaches the page is
// only ever this.
type SignIn struct {
	Kind Kind `json:"kind"`
	// Email is the address this sign-in belongs to, or nil where cloudflare will not say.
	Email    *string   `json:"email"`
	Accounts []Account `json:"accounts"`
	// Detail is cloudflare's own words about a refusal or an unreachable read, and is empty on the
	// three that are answers about a sign-in.
	Detail string `json:"detail"`
}

// every code that means the memberships list is what was refused.
//
// 9106 is the permission a token was not given; 10000 is the account-scoped refusal reached from
// the other side. cloudflare's own client treats the two as one finding and so does accounts,
// because what an operator does about either is the same thing.
var noMembershipsCodes = []int{9106, 10000}

// cloudflare's code for a credential that may not read the user it belongs to.
const noUserDetailsCode = 9109

// what the console says when it was told no account this sign-in is a member of.
const noMemberships = "Cloudflare would not list the accounts this sign-in is a member of. " +
	"The credential may be missing the User → Memberships → Read permission, or " +
	"CLOUDFLARE_API_TOKEN, CLOUDFLARE_API_KEY or CLOUDFLARE_EMAIL may be set to a value it will " +
	"not accept."

// Read is how this machine is signed in, off a credential and the account reads made with it.
//
// The credential and the read are handed in so that every state above can be looked at without a
// cloudflare account and without a network. `tokenSet` is whether the environment is where the
// credential came from, which no answer from cloudflare can say.
func Read(ctx context.Context, credential cf.Credential, tokenSet bool, get cf.Get) SignIn {
	if credential.Kind == cf.NoCredential {
		return SignIn{Kind: SignedOut, Accounts: []Account{}}
	}

	var (
		listed  []Account
		failure SignIn
		address *string
	)
	var wait sync.WaitGroup
	wait.Add(2)
	// two round trips that need nothing from each other, so they are made at once: a screen waits
	// on the slower of them rather than on both in turn.
	go func() {
		defer wait.Done()
		listed, failure = accounts(ctx, get)
	}()
	var emailFailure SignIn
	go func() {
		defer wait.Done()
		address, emailFailure = email(ctx, credential, get)
	}()
	wait.Wait()

	if failure.Kind != "" {
		return failure
	}
	if emailFailure.Kind != "" {
		return emailFailure
	}

	kind := OAuth
	if credential.Kind == cf.KeyCredential || tokenSet {
		kind = Token
	}
	return SignIn{Kind: kind, Email: address, Accounts: listed}
}

// the memberships list, narrowed to the ones this sign-in actually holds.
//
// An invitation that is pending or was turned down names an account the credential is not a member
// of, so an intersection keeping it would offer a row that fails at the first command scoped to it.
const acceptedMemberships = "/memberships?status=accepted"

// the accounts this credential can be scoped to, which is both lists and neither alone.
//
// An account it can see that it is not a member of is a row that fails at the first thing it is
// used for, so the answer is the intersection. The two ways that cannot be taken:
//
//	the accounts list refused   there is nothing left to intersect and nothing to fall back on.
//	the memberships refused     where the accounts list named some anyway, those are the answer.
//	                            the intersection only ever narrows, so what is drawn is the wider
//	                            list and the account-scoped read behind a later command is what
//	                            refuses — which is a refusal that names the account, where this one
//	                            could not. with nothing named, the permission is the answer.
//
// An empty intersection is an empty list and never a failure: the connect screen draws the account
// chooser with no rows in it as a state of its own, and a sign-in that carries no usable account is
// a true thing to say about this machine.
func accounts(ctx context.Context, get cf.Get) ([]Account, SignIn) {
	// no page size stated on either: both lists are short, and cloudflare's ceiling on the number
	// is not the same one on the two paths — ../cf states why it belongs to the read.
	var listed, memberships cf.Paged
	var wait sync.WaitGroup
	wait.Add(2)
	go func() { defer wait.Done(); listed = cf.PagedList(ctx, get, "/accounts", 0) }()
	go func() { defer wait.Done(); memberships = cf.PagedList(ctx, get, acceptedMemberships, 0) }()
	wait.Wait()

	if listed.Failure != "" {
		return nil, failed(listed.Failure, listed.Detail)
	}

	seen := []Account{}
	for _, row := range listed.Rows {
		seen = append(seen, toAccount(row)...)
	}

	if memberships.Failure != "" {
		if !aboutPermission(memberships.Codes) {
			return nil, failed(memberships.Failure, memberships.Detail)
		}
		if len(seen) == 0 {
			return nil, SignIn{Kind: Refused, Detail: noMemberships, Accounts: []Account{}}
		}
		return seen, SignIn{}
	}

	held := map[string]bool{}
	for _, row := range memberships.Rows {
		if id := membershipAccountID(row); id != "" {
			held[id] = true
		}
	}
	kept := []Account{}
	for _, account := range seen {
		if held[account.ID] {
			kept = append(kept, account)
		}
	}
	return kept, SignIn{}
}

// the address this sign-in belongs to, where cloudflare will say.
//
// A global api key travels with the email it has to be sent alongside, so there is nothing to ask
// for. Every other credential is asked, and a 9109 is a sign-in that works and an address that
// cannot be read — the connect screen states the account either way and names whose access reached
// it only where there is a name.
func email(ctx context.Context, credential cf.Credential, get cf.Get) (*string, SignIn) {
	if credential.Kind == cf.KeyCredential {
		return &credential.Email, SignIn{}
	}

	answer := get(ctx, "/user")
	// a record with no email in it is an address that is not there, and not an answer in a shape
	// this was not written against.
	read := cf.ReadShaped(answer, func(value any) (*string, bool) {
		record, isObject := value.(map[string]any)
		if !isObject {
			return nil, false
		}
		if address, isText := record["email"].(string); isText && address != "" {
			return &address, true
		}
		return nil, true
	})
	if read.Kind == cf.ResultValue {
		return read.Value, SignIn{}
	}
	if slices.Contains(cf.ErrorCodes(answer.Body), noUserDetailsCode) {
		return nil, SignIn{}
	}
	return nil, failed(read.Kind, cf.Said(answer))
}

// a failed read, as one of the two states this package draws a failure as.
func failed(kind cf.ResultKind, detail string) SignIn {
	if kind == cf.ResultRefused {
		return SignIn{Kind: Refused, Detail: detail, Accounts: []Account{}}
	}
	return SignIn{Kind: Unreachable, Detail: detail, Accounts: []Account{}}
}

func aboutPermission(codes []int) bool {
	for _, code := range noMembershipsCodes {
		if slices.Contains(codes, code) {
			return true
		}
	}
	return false
}

func toAccount(row any) []Account {
	record, isObject := row.(map[string]any)
	if !isObject {
		return nil
	}
	// a row nothing can be scoped to is not a row: the id is what every command after the connect
	// screen runs under, and an account list with a blank one in it offers a choice that fails at
	// the first thing it is used for.
	id, isText := record["id"].(string)
	if !isText || id == "" {
		return nil
	}
	// an account with no name is still choosable and is read by its id, which is the string the
	// operator matches against cloudflare's own dashboard anyway.
	name, named := record["name"].(string)
	if !named || name == "" {
		name = id
	}
	return []Account{{ID: id, Name: name}}
}

// the account a membership row names, which is the id an accounts row is kept by.
//
// Read narrowed as well as asked for narrowed: the filter is a query parameter cloudflare is free
// to ignore, and a row it answered with anyway is one this console drops itself.
func membershipAccountID(row any) string {
	record, isObject := row.(map[string]any)
	if !isObject {
		return ""
	}
	if status, isText := record["status"].(string); !isText || status != "accepted" {
		return ""
	}
	account, isObject := record["account"].(map[string]any)
	if !isObject {
		return ""
	}
	id, isText := account["id"].(string)
	if !isText {
		return ""
	}
	return id
}
