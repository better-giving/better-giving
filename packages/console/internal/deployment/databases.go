package deployment

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/cf"
)

// what this deployment already has in the chosen cloudflare account, read by name.
//
// **only the rows carrying the name are the home screen's business, and only how many of them there
// are.** the account may hold other people's databases; what decides the face is whether there is
// none of this deployment's name, one, or two — one press makes the first, and two of a name is the
// one thing about the database no press can repair, because every remote path resolves it by name
// (CLAUDE.md).
//
// **the list is read and never created from.** the screen this answers is the one that shows what
// is there before anything is made.

// ListKind is which of the three ways a list read ended.
type ListKind string

const (
	// Listed is a list that was walked to its last page, Count being the rows of the name.
	Listed ListKind = "listed"
	// Refused is cloudflare turning this sign-in down for this account.
	Refused ListKind = "refused"
	// Unreachable is nothing found out either way, which is not an account holding nothing.
	Unreachable ListKind = "unreachable"
)

// DatabaseList is how many databases of one name an account holds, or which way that was not read.
type DatabaseList struct {
	Kind  ListKind
	Count int
	// UUID is the id of the one row of that name, and empty where the account holds none or two.
	// It is what a deploy binds the worker to, and it reaches no page: the id is a deployment
	// artifact this repository does not commit (CLAUDE.md), and a screen drawing one would be
	// naming something a fork cannot reach.
	UUID   string
	Detail string
}

// how many rows the list is asked for at once.
//
// cloudflare states a floor of 10 and a ceiling of 10000 for this list and refuses a number over
// the ceiling outright
// (https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/). a
// hundred is inside both and is one round trip for any account this console is pointed at, and the
// walk in internal/cf is what makes a bigger one right rather than this number.
const pageSize = 100

// DatabasesPath is every d1 database on an account.
func DatabasesPath(accountID string) string { return "/accounts/" + accountID + "/d1/database" }

// Databases is how many of `accountID`'s d1 databases are called `name`.
//
// The whole list is walked rather than `?name=` asked for: the endpoint takes a search and a read
// that stopped at the first page would report a database that is really there as absent, beside a
// control offering to make a second one of the name.
func Databases(ctx context.Context, get cf.Get, accountID, name string) DatabaseList {
	read := cf.PagedList(ctx, get, DatabasesPath(accountID), pageSize)
	if read.Failure != "" {
		kind := Unreachable
		if read.Failure == cf.ResultRefused {
			kind = Refused
		}
		return DatabaseList{Kind: kind, Detail: read.Detail}
	}

	count, uuid := 0, ""
	for _, row := range read.Rows {
		// a row with no id is not a row: the id is what a database is resolved by everywhere else,
		// so a row missing one says nothing about whether this deployment's database is there.
		held, ok := row.(map[string]any)
		if !ok {
			continue
		}
		named, isText := held["name"].(string)
		id, hasID := held["uuid"].(string)
		if !isText || !hasID || id == "" || named != name {
			continue
		}
		count++
		uuid = id
	}
	if count != 1 {
		// two of the name name nothing: which one a deploy would bind to is exactly the question.
		uuid = ""
	}
	return DatabaseList{Kind: Listed, Count: count, UUID: uuid}
}

// the d1 database this deployment runs on, made rather than printed as a command to paste. It is
// the whole of what this console creates in the account beside the turnstile widget.
//
// **creating is not migrating.** this ends at the database existing; the migrations are applied by
// the deploy that follows, in front of the one-way door and never on a page load (CLAUDE.md).
//
// **the id is resolved by walking the list and never lifted off the create's answer.** every remote
// path resolves the database by name, and the two paths that end with one there — a database
// somebody made earlier and one this press just made — would otherwise read it two different ways.
// It is what the worker's binding names, so a deploy made without one binds to nothing.

// cloudflare's code for a database of that name already being on the account.
const existsCode = 7502

// cloudflare's code for the account holding as many databases as its plan allows.
const limitCode = 7406

// StandingKind is how the database this deployment runs on came to be there, or which way it is not.
type StandingKind string

const (
	// DatabaseThere is one of that name already on the account, which every press after the first
	// meets.
	DatabaseThere StandingKind = "there"
	// DatabaseMade is one this press created, or one that arrived between the read and the create —
	// which is the same outcome, because what a deploy binds to is the name.
	DatabaseMade StandingKind = "made"
	// DatabaseMany is two or more of that name, which is the one thing about the database no press
	// can repair: a deploy would bind to one of them without saying which.
	DatabaseMany StandingKind = "many"
	// DatabaseLimit is the account holding as many databases as its plan allows.
	DatabaseLimit StandingKind = "limit"
	// DatabaseRefused is cloudflare turning this sign-in down for this account.
	DatabaseRefused StandingKind = "refused"
	// DatabaseFailed is cloudflare answering and not making one, in its own words.
	DatabaseFailed StandingKind = "failed"
	// DatabaseUnreachable is nothing found out either way, which includes a database that was made
	// and whose id no walk of the list would answer.
	DatabaseUnreachable StandingKind = "unreachable"
	// DatabaseNoCredential is this console holding no sign-in, so the account was never asked.
	//
	// Its own member and never a refusal: a refusal is "member, not administrator" and sends an
	// operator to ask an administrator for access they already have, and what is true here is that
	// this machine is signed out. Nothing here answers it — it is the press's own reading of the
	// sign-in it holds, taken in front of the first call.
	DatabaseNoCredential StandingKind = "no-credential"
)

// Standing is where the database stands after one press, and the id a deploy binds to.
type Standing struct {
	Kind StandingKind `json:"kind"`
	// UUID is what the worker's binding names, and it reaches no page for DatabaseList.UUID's
	// reason.
	UUID   string `json:"-"`
	Detail string `json:"detail"`
}

// where a database keeps its records, which cloudflare takes at creation and never again.
//
// **the two are one choice and never two boxes.** cloudflare reads a jurisdiction over a hint where
// a create names both
// (https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), so a
// pair of controls would let an operator state a region and be given another. one value crosses the
// wire and this is what it may be.
//
// **neither can be changed once the database exists**, and the way out of a wrong one is an export,
// a delete, a create and an import — with the deployment down in between. it is the whole reason
// the choice is asked for in front of the press that stands a deployment up rather than settled
// afterwards on a fold.

// LocationHints are the six regions cloudflare will place a primary near, as a preference rather
// than a guarantee. There is no value for south america, africa or the middle east.
var LocationHints = []string{"wnam", "enam", "weur", "eeur", "apac", "oc"}

// Jurisdictions are the two hard restrictions on where records are stored and run.
var Jurisdictions = []string{"eu", "fedramp"}

// PlacementKnown is whether a posted placement is one of the eight, the empty string being
// cloudflare's own placement and the answer a press that was asked nothing carries.
func PlacementKnown(placement string) bool {
	return placement == "" ||
		enumerated(LocationHints, placement) || enumerated(Jurisdictions, placement)
}

// the create's body, from the name and the one placement value.
func creating(name, placement string) map[string]any {
	body := map[string]any{"name": name}
	switch {
	case enumerated(Jurisdictions, placement):
		body["jurisdiction"] = placement
	case enumerated(LocationHints, placement):
		body["primary_location_hint"] = placement
	}
	return body
}

// ProvideDatabase finds the database this deployment runs on or makes it, and resolves its id.
//
// **the placement reaches the create alone, and a database already there is left where it stands.**
// neither field can be changed after creation, so a press over an account that already holds one of
// the name has nowhere to put a placement and says nothing about it: what the operator chose is
// what the database that exists was made with.
//
// **nothing is read off a success.** the id comes off the walk that follows, so an answer cloudflare
// has since changed the shape of is still a database that was made.
func ProvideDatabase(ctx context.Context, send cf.Send, accountID, name, placement string) Standing {
	get := func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}

	held := Databases(ctx, get, accountID, name)
	switch {
	case held.Kind == Refused:
		return Standing{Kind: DatabaseRefused, Detail: held.Detail}
	case held.Kind != Listed:
		return Standing{Kind: DatabaseUnreachable, Detail: held.Detail}
	case held.Count > 1:
		return Standing{Kind: DatabaseMany}
	case held.Count == 1:
		return Standing{Kind: DatabaseThere, UUID: held.UUID}
	}

	if made := created(ctx, send, accountID, name, placement); made.Kind != DatabaseMade {
		return made
	}
	// the id is resolved by name, which is also what a 7502 leaves nothing else to resolve it by.
	resolved := Databases(ctx, get, accountID, name)
	if resolved.Kind != Listed || resolved.Count != 1 {
		return Standing{
			Kind:   DatabaseUnreachable,
			Detail: "this console made that database and could not read back which id it has",
		}
	}
	return Standing{Kind: DatabaseMade, UUID: resolved.UUID}
}

// one create answer, read.
//
// **the two d1 codes are read in front of cf.ReadResult rather than after it.** cloudflare sends
// both on a non-2xx, and ReadResult sorts a non-2xx carrying neither 10000 nor 10007 into
// unreachable — so a limit read afterwards would be drawn as a connection that dropped and offer no
// way out of itself.
func created(ctx context.Context, send cf.Send, accountID, name, placement string) Standing {
	answer := send(ctx, http.MethodPost, DatabasesPath(accountID), creating(name, placement))

	codes := cf.ErrorCodes(answer.Body)
	for _, code := range codes {
		switch code {
		case existsCode:
			return Standing{Kind: DatabaseMade}
		case limitCode:
			return Standing{Kind: DatabaseLimit, Detail: cf.Said(answer)}
		}
	}

	read := cf.ReadResult(answer)
	switch read.Kind {
	// a 2xx in a shape nothing was written against is a database that was made: nothing is read off
	// a success, so reporting it as a failure would stop the chain over a database that is there.
	case cf.ResultValue, cf.ResultUnreadable:
		return Standing{Kind: DatabaseMade}
	case cf.ResultRefused:
		return Standing{Kind: DatabaseRefused, Detail: read.Detail}
	}
	if answer.Kind == cf.Unreachable {
		return Standing{Kind: DatabaseUnreachable, Detail: answer.Detail}
	}
	// `missing` joins failed: a 10007 out of a create is cloudflare naming something it could not
	// find on the way, and what an operator does about it is read what cloudflare said.
	return Standing{Kind: DatabaseFailed, Detail: cf.Said(answer)}
}
