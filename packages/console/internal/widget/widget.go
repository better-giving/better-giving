// Package widget is this deployment's turnstile widget: found on the account, made where there is
// none, and its hostnames brought level with the sites the deployment serves.
//
// **the console updates the widget's own domain list, so it asks no operator to promise it did.** a
// `PUT /accounts/{id}/challenges/widgets/{sitekey}` replaces the widget's hostnames, and rotating
// its secret is a different request at a different address — so levelling costs no new pair, no
// re-store and no deploy. the dashboard's add-site dialog asks an operator to tick that they put
// the host on the widget, because nothing on the deployment can read cloudflare's copy of that list;
// this console can read it and write it, so the same tick here would be asking somebody to promise
// something the press in front of them just did.
//
// **nothing is reported that cannot be verified. what is reported is what this console did.** a
// Already answer means this console read the widget's domains and they match the site list, not
// that a donor will pass a challenge. the states where it could not look — an account that refused,
// a cloudflare nothing could reach, a widget nobody has created — are their own answers and none of
// them reads as confirmation.
//
// **the account's own list stands in front of every create.** a second create under the same name
// mints a second widget with its own sitekey and its own secret, and nothing dedupes on the name —
// so a create run twice leaves a pair the deployment holds against a widget nobody is challenging
// with. Two of one name is refused rather than guessed between: the list redacts the secret, so the
// two are indistinguishable from out here, and levelling the wrong one leaves every donor
// challenged against a list nobody edited.
//
// **the secret goes from cloudflare to the deployment and is never anywhere else.** it is read off
// a create's or a get's answer, handed to internal/deployment's secrets write, and dropped. it is
// in no sentence a screen draws and in no answer that crosses to the browser, which is what the
// `json:"-"` on Supply.Secret states — and why a call that succeeded in a shape nothing here was
// written against carries no detail at all: all three requests answer with the widget whole, the
// update included, so nothing off a body this console could not read may travel.
//
// **the list is the read a screen could be drawn from and the get is not.** the list redacts the
// secret and `/challenges/widgets/{sitekey}` answers with it, so listing is the read that can never
// put a credential in something rendered.
//
// **a state this console cannot get out of is cloudflare's own screen to get out of.** every
// failure below is cloudflare refusing, cloudflare answering something else, or cloudflare not
// answering at all, and the console draws no box for either half of the pair — the errand an
// operator is left with is the one at dash.cloudflare.com under Turnstile.
//
// every failure is a value, the way ../cf's are: nothing here returns an error, and a screen has a
// different sentence for each of the ways below.
package widget

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// the mode a donation form's widget is created in, and the one this console creates.
const mode = "managed"

// how many rows the account's list is asked for at once.
//
// cloudflare states a floor of 5 and a ceiling of 1000 for this list and refuses a number over the
// ceiling outright
// (https://developers.cloudflare.com/api/resources/turnstile/subresources/widgets/methods/list/). a
// hundred is inside both and is one round trip for any account this console is pointed at, and the
// walk in internal/cf is what makes a bigger one right rather than this number.
const pageSize = 100

// Calls is the account this console is operating, and the one credential every call here is made on.
//
// The send is handed in rather than bound here so that every state below can be looked at without a
// cloudflare account and without a network.
type Calls struct {
	Send      cf.Send
	AccountID string
}

// Path is every turnstile widget on an account.
func Path(accountID string) string { return "/accounts/" + accountID + "/challenges/widgets" }

// one widget on the account, by the sitekey that names it in every endpoint.
func one(accountID, sitekey string) string {
	return Path(accountID) + "/" + url.PathEscape(sitekey)
}

// Making is whether the pair came from a widget this press made or from one already there.
type Making string

const (
	Created Making = "created"
	Adopted Making = "adopted"
)

// NoListKind is which way the account's own list was not read.
type NoListKind string

const (
	// ReadRefused is cloudflare turning this sign-in down for this account.
	ReadRefused NoListKind = "refused"
	// ReadUnreachable is nothing found out either way.
	ReadUnreachable NoListKind = "unreachable"
	// NoCredential is this console holding no sign-in, so the account was never asked.
	//
	// Its own member and never a refusal: a refusal is "member, not administrator" and sends an
	// operator to ask an administrator for access they already have, and what is true here is that
	// this machine is signed out.
	NoCredential NoListKind = "no-credential"
)

// NoList is which way the account's widgets were not read.
type NoList struct {
	Kind   NoListKind `json:"kind"`
	Detail string     `json:"detail"`
}

// NoSignIn is the press this console holds no sign-in to make, as the list it never read.
func NoSignIn(detail string) NoList { return NoList{Kind: NoCredential, Detail: detail} }

// FailureKind is one of the four ways a widget request did not answer with a widget.
//
// Shared by the create, the get and the update because the states are the answer's rather than the
// request's, and a screen has the same four things to say about each.
type FailureKind string

const (
	// CallRefused is cloudflare turning this sign-in down for this account.
	CallRefused FailureKind = "refused"
	// CallFailed is cloudflare answering and not doing it, in its own words.
	CallFailed FailureKind = "failed"
	// CallUnreachable is nothing found out either way.
	CallUnreachable FailureKind = "unreachable"
	// CallUnreadable is a success in a shape nothing here was written against, which carries no
	// detail because every success here is the widget whole.
	CallUnreadable FailureKind = "unreadable"
)

// Failure is how one widget request did not answer with a widget.
type Failure struct {
	Kind   FailureKind `json:"kind"`
	Detail string      `json:"detail"`
}

// SupplyKind is how far the press that provides the widget got.
type SupplyKind string

const (
	// Supplied is the widget and both halves of it, before either half has been stored anywhere.
	Supplied SupplyKind = "supplied"
	// NoHosts is no site listed, so there is no host to make a widget against.
	NoHosts SupplyKind = "nothing"
	// Unlisted is the account's widgets not read, so nothing was created.
	Unlisted SupplyKind = "unlisted"
	// Ambiguous is two or more widgets of this deployment's name, between which nothing will guess.
	Ambiguous SupplyKind = "many"
	// Unmade is cloudflare not making the widget, or not handing back the one that is there.
	Unmade SupplyKind = "unmade"
)

// Supply is the widget and both halves of it, before either half has been stored anywhere.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Supply struct {
	Kind SupplyKind `json:"kind"`
	Made Making     `json:"made"`
	// Sitekey is public, is rendered into every donor's page, and is what an operator matches
	// against cloudflare's own screen.
	Sitekey string `json:"sitekey"`
	// Secret is cloudflare's copy of the pair, on its way to one request body and nowhere else. It
	// crosses no wire: what reads this value is the chain that stores it.
	Secret string `json:"-"`
	// Domains is what the widget carries now, which is the update's answer where one was made.
	Domains []string `json:"domains"`
	// Levelled is what levelling an adopted widget's hosts did, and nil on one just created.
	Levelled *Levelling `json:"levelled"`
	// Read is which way the account's list was not read, on Unlisted alone.
	Read *NoList `json:"read"`
	// Sitekeys is the widgets carrying this name, on Ambiguous alone.
	Sitekeys []string `json:"sitekeys"`
	// Failure is what cloudflare answered the create or the get with, on Unmade alone.
	Failure *Failure `json:"failure"`
}

// LevelKind is what happened to cloudflare's copy of the site list.
//
// Already and Made are the two that end with the two lists the same; everything else says which way
// this console could not get them there. None of them is a claim about a donor passing a challenge.
type LevelKind string

const (
	// Already is the widget carrying exactly these hosts, so cloudflare was asked nothing.
	Already LevelKind = "level"
	// Made is the update landing, and Domains what the widget carries now.
	Made LevelKind = "levelled"
	// NoHostsLeft is a stored list with no host in it, and a widget covering none challenges nobody.
	NoHostsLeft LevelKind = "nothing"
	// Absent is the account holding no widget of this deployment's name.
	Absent LevelKind = "no-widget"
	// TooMany is two or more of that name, between which nothing here will guess.
	TooMany LevelKind = "many"
	// Unread is the account's list not read, and Read says which way.
	Unread LevelKind = "unread"
	// Refused, Failed, Unreachable and Unreadable are the four ways the widget's own two requests
	// did not answer with a widget.
	Refused     LevelKind = "refused"
	Failed      LevelKind = "failed"
	Unreachable LevelKind = "unreachable"
	Unreadable  LevelKind = "unreadable"
)

// Levelling is how one press to bring the widget's hostnames level went.
//
// Flat rather than a member per kind, because that is what the wire is.
type Levelling struct {
	Kind LevelKind `json:"kind"`
	// Domains is the hosts the widget carries now, on Already and Made.
	Domains []string `json:"domains"`
	// Sitekeys is the widgets carrying this name, on TooMany alone.
	Sitekeys []string `json:"sitekeys"`
	// Read is which way the account's list was not read, on Unread alone.
	Read *NoList `json:"read"`
	// Detail is cloudflare's own words about the call, and empty where it wrote none — which
	// includes every Unreadable, because the body it could not read is the widget whole.
	Detail string `json:"detail"`
}

// NotLevelled is the press this console holds no sign-in to make.
func NotLevelled(detail string) Levelling {
	read := NoSignIn(detail)
	return Levelling{Kind: Unread, Domains: []string{}, Sitekeys: []string{}, Read: &read}
}

// Hosts is the host names a list of stored origins covers, in the list's own order and without
// repeats.
//
// A widget's domains are bare hosts and the deployment's site list holds whole origins, because
// `corsHeaders` in packages/app/src/lib/server/api/cors.ts compares an `Origin` header literally.
// The hostname and not the host, so the port comes off with the scheme: an origin may carry one and
// nothing that takes a host name takes a port on the end of it. This is the same reading
// `hostsOf` in packages/operator/src/origins.ts states for the surfaces that draw the list.
//
// A row with no host in it is dropped rather than passed through: it is called on the boxes as they
// were typed, and a row an operator added and never filled in is a value with no host in it. The
// repeats come out because two origins may share a host, and a widget carrying that host twice is a
// list cloudflare and this repository would describe differently.
func Hosts(sites []string) []string {
	held := []string{}
	seen := map[string]bool{}
	for _, site := range sites {
		address, err := url.Parse(strings.TrimSpace(site))
		if err != nil || address.Hostname() == "" {
			continue
		}
		host := address.Hostname()
		if seen[host] {
			continue
		}
		seen[host] = true
		held = append(held, host)
	}
	return held
}

// Provide finds this deployment's widget or makes one, and hands back the pair it is holding.
//
// **an adopted widget is levelled here and a created one is not.** a widget made outside this
// console carries whatever hostnames it was made with; one this press created was made against
// these hosts, so there is nothing to level.
//
// It stores nothing and deploys nothing: where the pair goes is the chain's, which holds the secret
// for the one call that stores it.
func Provide(ctx context.Context, calls Calls, name string, hosts []string) Supply {
	if len(hosts) == 0 {
		return Supply{Kind: NoHosts, Domains: []string{}, Sitekeys: []string{}}
	}

	pick := chosen(list(ctx, calls, name))
	switch pick.kind {
	case unlisted:
		return Supply{Kind: Unlisted, Domains: []string{}, Sitekeys: []string{}, Read: pick.read}
	case ambiguous:
		return Supply{Kind: Ambiguous, Domains: []string{}, Sitekeys: pick.sitekeys}
	}

	made, minted := Created, minted{}
	if pick.kind == found {
		made, minted = Adopted, get(ctx, calls, pick.widget.sitekey)
	} else {
		minted = create(ctx, calls, name, hosts)
	}
	if minted.failure != nil {
		return Supply{
			Kind: Unmade, Made: made, Domains: []string{}, Sitekeys: []string{},
			Failure: minted.failure,
		}
	}

	supply := Supply{
		Kind: Supplied, Made: made, Sitekey: minted.sitekey, Secret: minted.secret,
		Domains: minted.domains, Sitekeys: []string{},
	}
	if made == Adopted && !sameHosts(minted.domains, hosts) {
		levelled := update(ctx, calls, minted.sitekey, hosts)
		supply.Levelled = &levelled
		if levelled.Kind == Made {
			supply.Domains = levelled.Domains
		}
	}
	return supply
}

// Bring brings the widget's hostnames level with `hosts`, or says why it did not.
//
// **the whole list is sent, never the one that changed.** the update replaces a widget's domains,
// so an add and a removal are one request and the widget cannot drift a host at a time.
//
// **a list that is already level asks cloudflare nothing.** the hosts are compared as sets, because
// the order on a widget carries no meaning and cloudflare hands them back in its own.
//
// **an empty list asks for nothing.** a widget covering no host challenges nobody, so an operator
// who has emptied the site list has a widget to delete rather than one to level, and deleting it is
// theirs to do on cloudflare's own screen.
func Bring(ctx context.Context, calls Calls, name string, hosts []string) Levelling {
	empty := Levelling{Domains: []string{}, Sitekeys: []string{}}
	if len(hosts) == 0 {
		empty.Kind = NoHostsLeft
		return empty
	}

	pick := chosen(list(ctx, calls, name))
	switch pick.kind {
	case unlisted:
		empty.Kind, empty.Read = Unread, pick.read
		return empty
	case ambiguous:
		empty.Kind, empty.Sitekeys = TooMany, pick.sitekeys
		return empty
	case absent:
		empty.Kind = Absent
		return empty
	}

	if sameHosts(pick.widget.domains, hosts) {
		return Levelling{Kind: Already, Domains: hosts, Sitekeys: []string{}}
	}
	return update(ctx, calls, pick.widget.sitekey, hosts)
}

// one widget on the account, as its list answers it.
type entry struct {
	sitekey string
	domains []string
}

// which of the account's widgets is this deployment's, or which way that was not settled.
type pick struct {
	kind     pickKind
	widget   entry
	sitekeys []string
	read     *NoList
}

type pickKind string

const (
	found     pickKind = "one"
	absent    pickKind = "none"
	ambiguous pickKind = "many"
	unlisted  pickKind = "unread"
)

// the widgets on this account carrying `name`, or which way the list was not read.
//
// The whole list is walked rather than the endpoint's own `filter=name:` asked for: that filter
// matches a case-insensitive substring, which is a different question from the one this asks. A
// read that stopped at the first page would report a widget that is really there as absent, beside
// a press that mints a second pair under the one name.
func list(ctx context.Context, calls Calls, name string) ([]entry, *NoList) {
	read := cf.PagedList(ctx, func(ctx context.Context, path string) cf.Answer {
		return calls.Send(ctx, http.MethodGet, path, nil)
	}, Path(calls.AccountID), pageSize)
	if read.Failure != "" {
		kind := ReadUnreachable
		if read.Failure == cf.ResultRefused {
			kind = ReadRefused
		}
		return nil, &NoList{Kind: kind, Detail: read.Detail}
	}

	matches := []entry{}
	for _, listed := range read.Rows {
		held, ok := listed.(map[string]any)
		if !ok {
			continue
		}
		// a row with no sitekey is not a row: the sitekey is what a widget is reached by in every
		// endpoint, so a row missing one says nothing about whether this deployment's widget is there.
		named, isText := held["name"].(string)
		sitekey, hasKey := held["sitekey"].(string)
		if !isText || !hasKey || sitekey == "" || named != name {
			continue
		}
		matches = append(matches, entry{sitekey: sitekey, domains: hostList(held["domains"])})
	}
	return matches, nil
}

func chosen(matches []entry, unread *NoList) pick {
	if unread != nil {
		return pick{kind: unlisted, sitekeys: []string{}, read: unread}
	}
	if len(matches) == 0 {
		return pick{kind: absent, sitekeys: []string{}}
	}
	if len(matches) > 1 {
		keys := []string{}
		for _, held := range matches {
			keys = append(keys, held.sitekey)
		}
		return pick{kind: ambiguous, sitekeys: keys}
	}
	return pick{kind: found, widget: matches[0], sitekeys: []string{}}
}

// a widget read whole, pair and all, or the failure that came back instead.
type minted struct {
	sitekey string
	secret  string
	domains []string
	failure *Failure
}

// the whole body of a create, stated here so that it is asserted rather than trusted.
//
// `name`, the hosts and the mode. The endpoint also takes settings an enterprise account can set,
// and none of them is this repository's to state.
//
// cloudflare takes at most ten hostnames on a widget
// (https://developers.cloudflare.com/api/resources/turnstile/subresources/widgets/methods/create/),
// and an eleventh is its refusal to report rather than a list to trim here: a console that quietly
// dropped a host would leave that site's donation form challenging nobody.
func createBody(name string, hosts []string) map[string]any {
	return map[string]any{"name": name, "domains": hosts, "mode": mode}
}

func create(ctx context.Context, calls Calls, name string, hosts []string) minted {
	return readMinted(calls.Send(ctx, http.MethodPost, Path(calls.AccountID), createBody(name, hosts)))
}

func get(ctx context.Context, calls Calls, sitekey string) minted {
	return readMinted(calls.Send(ctx, http.MethodGet, one(calls.AccountID, sitekey), nil))
}

// one widget answered whole, read.
//
// Both the create and the get answer with the secret in the body, and the list is the one that
// redacts it — which is why the list is the read a screen is drawn from and this is not.
func readMinted(answer cf.Answer) minted {
	read := cf.ReadShaped(answer, func(value any) (minted, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return minted{}, false
		}
		sitekey, hasKey := held["sitekey"].(string)
		secret, hasSecret := held["secret"].(string)
		if !hasKey || !hasSecret || sitekey == "" || secret == "" {
			return minted{}, false
		}
		return minted{sitekey: sitekey, secret: secret, domains: hostList(held["domains"])}, true
	})
	if read.Kind != cf.ResultValue {
		failure := refusal(answer, read.Kind)
		return minted{failure: &failure}
	}
	return read.Value
}

// the update, which is a read and then a write.
//
// **the PUT replaces the widget whole**, so what is written back is what the get answered with and
// the new hostnames over it: a body carrying only `domains` blanks the widget's name and its mode,
// and a widget nobody meant to touch comes back nameless and challenging every visitor the wrong
// way. That is why a body missing either is written back over at all — nothing is.
//
// **the read is taken fresh rather than from the list.** the list carries a widget's name and its
// hostnames and nothing else this has to write back, so the row a screen was drawn from is not a
// body to PUT.
func update(ctx context.Context, calls Calls, sitekey string, hosts []string) Levelling {
	path := one(calls.AccountID, sitekey)
	answer := calls.Send(ctx, http.MethodGet, path, nil)
	held := cf.ReadShaped(answer, settings)
	if held.Kind != cf.ResultValue {
		return stopped(refusal(answer, held.Kind))
	}

	body := map[string]any{}
	for field, value := range held.Value {
		body[field] = value
	}
	body["domains"] = hosts

	wrote := calls.Send(ctx, http.MethodPut, path, body)
	// the answer is the widget as it now stands, the secret included, so the domains are lifted out
	// and the rest is dropped: a detail built out of any of it is a screen drawing a credential.
	written := cf.ReadShaped(wrote, func(value any) ([]string, bool) {
		read, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		return hostList(read["domains"]), true
	})
	if written.Kind != cf.ResultValue {
		return stopped(refusal(wrote, written.Kind))
	}
	return Levelling{Kind: Made, Domains: written.Value, Sitekeys: []string{}}
}

// every field of a widget the update has to hand back, and deliberately not the secret.
//
// The get answers with the widget whole, the pair included, so this takes the settings off it and
// leaves the rest where it was read. The four flags an enterprise account can set are optional in
// cloudflare's own schema and are carried only where the answer named one, because a body naming a
// flag is a body setting it.
func settings(value any) (map[string]any, bool) {
	held, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	name, named := held["name"].(string)
	how, moded := held["mode"].(string)
	// a body missing either is one there is no writing back without blanking the field it left out.
	if !named || !moded {
		return nil, false
	}

	kept := map[string]any{"name": name, "mode": how}
	for _, flag := range []string{"bot_fight_mode", "ephemeral_id", "offlabel"} {
		if set, isFlag := held[flag].(bool); isFlag {
			kept[flag] = set
		}
	}
	if clearance, isText := held["clearance_level"].(string); isText {
		kept["clearance_level"] = clearance
	}
	return kept, true
}

// an answer cf classified as something other than a value, sorted again for this errand.
//
// `missing` joins Failed: a widget cloudflare would not make and one it says it does not hold both
// leave an operator the same thing to do, which is read what cloudflare said. What stays apart is a
// cloudflare that never answered, because its way out is the network rather than the account.
func refusal(answer cf.Answer, kind cf.ResultKind) Failure {
	switch kind {
	case cf.ResultUnreadable:
		return Failure{Kind: CallUnreadable}
	case cf.ResultRefused:
		return Failure{Kind: CallRefused, Detail: cf.Said(answer)}
	}
	if answer.Kind == cf.Unreachable {
		return Failure{Kind: CallUnreachable, Detail: answer.Detail}
	}
	return Failure{Kind: CallFailed, Detail: cf.Said(answer)}
}

// one widget request's failure, as the levelling it stopped.
func stopped(failure Failure) Levelling {
	kinds := map[FailureKind]LevelKind{
		CallRefused:     Refused,
		CallFailed:      Failed,
		CallUnreachable: Unreachable,
		CallUnreadable:  Unreadable,
	}
	return Levelling{
		Kind: kinds[failure.Kind], Domains: []string{}, Sitekeys: []string{},
		Detail: failure.Detail,
	}
}

func hostList(value any) []string {
	listed, ok := value.([]any)
	if !ok {
		return []string{}
	}
	hosts := []string{}
	for _, entry := range listed {
		if host, isText := entry.(string); isText && host != "" {
			hosts = append(hosts, host)
		}
	}
	return hosts
}

// whether two lists of hostnames cover the same set.
func sameHosts(held, wanted []string) bool {
	if len(held) != len(wanted) {
		return false
	}
	covered := map[string]bool{}
	for _, host := range held {
		covered[host] = true
	}
	for _, host := range wanted {
		if !covered[host] {
			return false
		}
	}
	return len(covered) == len(wanted)
}
