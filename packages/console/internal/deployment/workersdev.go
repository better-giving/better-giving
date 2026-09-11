package deployment

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// the two workers.dev settings a deployment answers under: the name the account holds, and the
// switch on the worker itself. ./address.go composes the two into where a deployment answers; each
// of them is read and set here.
//
// **a workers.dev name is one pool for the whole of cloudflare.** one account anywhere holds any
// given name, so a name derived from the account's own is a name that may already be somebody
// else's — which is why what happens to a refusal is a question put to the operator rather than a
// second name invented here.
//
// **an account holding a name is left exactly as it is.** cloudflare takes one name per account and
// every worker on it answers under that one, so a run that registered over it would move every
// other deployment in the account.
//
// **the shape is cloudflare's and is stated here so that a name this console sends is one it can
// take.** it is a dns label — lowercase letters, digits and hyphens, starting and ending on a
// letter or a digit, 63 characters at the most — and a name outside it is refused by cloudflare
// rather than by anything a screen could say afterwards.

// NameCeiling is the longest a workers.dev name may be, which is the length of a dns label. The
// shape below spells the same bound, and is what holds a name to it.
const NameCeiling = 63

// everything a workers.dev name may not carry, in runs, so that a run of them collapses to the one
// hyphen that stands for it.
var unusable = regexp.MustCompile(`[^a-z0-9]+`)

// what cloudflare takes: a dns label of lowercase letters, digits and hyphens that begins and ends
// on a letter or a digit.
var usable = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// DerivedName is the workers.dev name made out of a cloudflare account's own name, and empty where
// that name carries nothing a workers.dev name may be made of.
//
// It is what is tried before the operator is asked for one: an account named for the organisation
// operating it derives the address donors are sent to, and a question nobody had to answer is a
// question that cannot be answered wrongly.
func DerivedName(accountName string) string {
	name := strings.Trim(unusable.ReplaceAllString(strings.ToLower(accountName), "-"), "-")
	if len(name) > NameCeiling {
		name = name[:NameCeiling]
	}
	// the cut may land on the hyphen that stood for a space, and a name ending on one is a name
	// cloudflare refuses.
	return strings.TrimRight(name, "-")
}

// NameUsable is whether cloudflare would take `name` as an account's workers.dev name.
func NameUsable(name string) bool {
	return usable.MatchString(name)
}

// NameKind is how a run's reading of the account's workers.dev name ended, or its registering of
// one.
type NameKind string

const (
	// NameHeld is the account already holding a name, which Name carries. Nothing is registered
	// over one: cloudflare takes one name per account and every worker on it answers under that
	// one.
	NameHeld NameKind = "held"
	// NameNone is an account that has never registered one, which is a first run and not a failure.
	NameNone NameKind = "none"
	// NameRegistered is a name this run registered, which Name carries.
	NameRegistered NameKind = "registered"
	// NameTaken is cloudflare refusing that name for this account, which one account anywhere
	// already holding it is. Detail is what cloudflare said about it.
	NameTaken NameKind = "taken"
	// NameRefused is cloudflare turning this sign-in down for this account.
	NameRefused NameKind = "refused"
	// NameUnreachable is nothing found out either way, which is never an account with no name.
	NameUnreachable NameKind = "unreachable"
	// NameUnreadable is an answer in a shape nothing here was written against, which is never an
	// account with no name either.
	NameUnreadable NameKind = "unreadable"
	// NameFailed is cloudflare answering and registering nothing, in its own words.
	NameFailed NameKind = "failed"
)

// Named is what an account's workers.dev name stands at after one reading or one registration.
type Named struct {
	Kind NameKind
	// Name is the name the account holds, on NameHeld and NameRegistered alone.
	Name   string
	Detail string
}

// NamePath is the account's own workers.dev name.
func NamePath(accountID string) string { return "/accounts/" + accountID + "/workers/subdomain" }

// AccountName is the workers.dev name `accountID` holds, or which way it holds none.
func AccountName(ctx context.Context, get cf.Get, accountID string) Named {
	read := cf.ReadShaped(get(ctx, NamePath(accountID)), func(value any) (string, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return "", false
		}
		named, isText := held["subdomain"].(string)
		return named, isText && named != ""
	})
	switch read.Kind {
	case cf.ResultValue:
		return Named{Kind: NameHeld, Name: read.Value}
	case cf.ResultMissing:
		return Named{Kind: NameNone}
	case cf.ResultRefused:
		return Named{Kind: NameRefused, Detail: read.Detail}
	case cf.ResultUnreadable:
		return Named{Kind: NameUnreadable, Detail: read.Detail}
	default:
		return Named{Kind: NameUnreachable, Detail: read.Detail}
	}
}

// cloudflare's code for a workers.dev name that is not this account's to take.
const takenCode = 10031

// RegisterName gives `accountID` the workers.dev name `name`, which every worker on it then answers
// under.
//
// **nothing is read off a success.** the name that was sent is the name the account now holds, so
// an answer cloudflare has since changed the shape of is still a name that was registered.
func RegisterName(ctx context.Context, send cf.Send, accountID, name string) Named {
	answer := send(ctx, http.MethodPut, NamePath(accountID), map[string]any{"subdomain": name})

	// the taken code is read in front of cf.ReadResult rather than after it: cloudflare sends it on
	// a non-2xx, which ReadResult sorts into unreachable — and a name somebody else holds drawn as
	// a connection that dropped offers no way out of itself.
	for _, code := range cf.ErrorCodes(answer.Body) {
		if code == takenCode {
			return Named{Kind: NameTaken, Detail: cf.Said(answer)}
		}
	}

	read := cf.ReadResult(answer)
	switch read.Kind {
	case cf.ResultValue, cf.ResultUnreadable:
		return Named{Kind: NameRegistered, Name: name}
	case cf.ResultRefused:
		return Named{Kind: NameRefused, Detail: read.Detail}
	}
	if answer.Kind == cf.Unreachable {
		return Named{Kind: NameUnreachable, Detail: answer.Detail}
	}
	return Named{Kind: NameFailed, Detail: cf.Said(answer)}
}

// Answering turns `workerName`'s own workers.dev address on and reads where it answers then.
//
// **the caution ../deploy/upload.go's address states does not hold here.** it will not switch on an
// address for a worker whose custom domains it could not read, because a worker somebody pointed a
// domain at is one whose operator chose where it answers. this is called on a worker the same run
// uploaded minutes earlier, against an account this run has just been through: what it overrules is
// a deployment standing in the account reachable by nobody.
//
// previews stay off, for that function's reason.
//
// A switch cloudflare would not take is answered as the address read it stands in for, because that
// is what the caller has: a press that needed an address and did not get one.
func Answering(ctx context.Context, send cf.Send, accountID, workerName string) Address {
	answer := send(ctx, http.MethodPost,
		"/accounts/"+accountID+"/workers/scripts/"+url.PathEscape(workerName)+"/subdomain",
		map[string]any{"enabled": true, "previews_enabled": false})

	read := cf.ReadResult(answer)
	switch read.Kind {
	case cf.ResultValue, cf.ResultUnreadable:
	case cf.ResultMissing:
		return Address{Kind: NotDeployed}
	case cf.ResultRefused:
		return Address{Kind: AddressRefused, Detail: read.Detail}
	default:
		return Address{Kind: AddressUnreachable, Detail: cf.Said(answer)}
	}

	return PublicAddress(ctx, func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}, accountID, workerName)
}
