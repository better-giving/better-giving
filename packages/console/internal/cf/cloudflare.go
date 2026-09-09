// Package cf is the console's door to cloudflare's REST API: the credential it is opened with, and
// the reading of what comes back through it.
//
// **the credential is held by this binary and reaches no page.** authority stays in this process,
// the browser sends intent only, and the token is never written into a sentence a screen draws. it
// travels in a header and never on a url, which ./client.go states and is what makes a failure's
// own words safe to draw.
//
// **cloudflare's failures are read as codes and the codes are named below.** a status alone does
// not tell a refused credential from an account that holds no such thing, and a code alone does not
// say what was not found — so ReadResult answers ResultMissing and leaves each read to say what is
// missing for it.
//
// **one binding sends a body of a dialect that is not plain json**, and MergePatchHeaders is where
// that is stated: a group of the deployment's secrets is written as a merge patch, and the bound
// header is what says so. every other call here is ordinary json.
//
// **every answer is read through a shape rather than reached into.** ReadShaped is the three steps
// every reader of this API takes — classify the answer, ask the value for the shape it was written
// against, report an answer in any other shape as ResultUnreadable in cloudflare's own words. a
// reader doing them by hand is a reader that can be written to do them differently.
//
// **a list is followed to its last page, here and not in the reads.** PagedList is the one walk,
// because a read that stopped at the first page would answer short without saying so — and a short
// list is drawn as a fact about the account rather than as a read that did not finish.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.
package cf

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// API is cloudflare's own base, and the one host every binding here is bound to.
const API = "https://api.cloudflare.com/client/v4"

// CredentialKind is which of cloudflare's three sign-ins a call is made with, or that there is none.
type CredentialKind string

const (
	// BearerToken is an api token, sent as an Authorization header.
	BearerToken CredentialKind = "bearer"
	// KeyCredential is the global key and the email that has to travel with it.
	KeyCredential CredentialKind = "key"
	// NoCredential is nothing to make a call with, and Detail is why.
	NoCredential CredentialKind = "none"
)

// Credential is what a cloudflare read is made with, or the reason there is nothing to make one
// with.
type Credential struct {
	Kind   CredentialKind
	Token  string
	Key    string
	Email  string
	Detail string
}

// BearerCredential is the api token this console is signed in with.
func BearerCredential(token string) Credential {
	return Credential{Kind: BearerToken, Token: token}
}

// CredentialReader is where a read gets its credential, handed in the way a Get is.
//
// It answers with a Credential of kind NoCredential rather than an error, for the reason nothing
// else here returns one: a machine holding no sign-in is a screen state and not a failure.
type CredentialReader interface {
	Credential(ctx context.Context) Credential
}

// StaticCredential is one credential this process already holds, handed to a read as the reader it
// wants.
type StaticCredential struct{ Held Credential }

// Credential answers with the one this was made around.
func (one StaticCredential) Credential(context.Context) Credential { return one.Held }

// Held is the credential asked for once, however many reads of one screen want it.
//
// Every cloudflare read a screen makes needs one, and each asking for it separately is the same
// unchanging answer read several times over. Lazy, so a screen whose reads never reach a credential
// asks for nothing.
//
// Handlers run concurrently and several may share one of these, so the reading is guarded rather
// than merely memoised.
func Held(read CredentialReader) CredentialReader {
	return &held{read: read}
}

type held struct {
	read CredentialReader
	once sync.Once
	got  Credential
}

func (one *held) Credential(ctx context.Context) Credential {
	one.once.Do(func() { one.got = one.read.Credential(ctx) })
	return one.got
}

// the headers one call to this API carries, which are the credential and nothing else.
//
// the three shapes are cloudflare's own. a credential of no usable kind carries no headers at all:
// a caller is expected to have found out it holds none before it gets here, and one that did not
// meets cloudflare's own refusal.
func apiHeaders(credential Credential) map[string]string {
	switch credential.Kind {
	case KeyCredential:
		return map[string]string{"X-Auth-Key": credential.Key, "X-Auth-Email": credential.Email}
	case BearerToken:
		return map[string]string{"Authorization": "Bearer " + credential.Token}
	default:
		return map[string]string{}
	}
}

// MergePatchHeaders is the headers a merge patch carries, stated as a value so that they are
// asserted rather than trusted.
//
// `secrets-bulk` is the one endpoint this console sends a body of another json dialect to: it takes
// a JSON Merge Patch (RFC 7396) keyed by secret name, where a name the body omits is left alone and
// a name it sends `null` for is deleted
// (https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/).
// The content type is how the endpoint is told which dialect it is reading.
func MergePatchHeaders(credential Credential) map[string]string {
	headers := apiHeaders(credential)
	headers["Content-Type"] = "application/merge-patch+json"
	return headers
}

// APISend is a call to cloudflare's API, bound to the credential once.
//
// The mapping onto headers is the whole of what this adds to JSONSend, which is where the rest of
// it is stated.
func APISend(credential Credential) Send { return JSONSend(API, apiHeaders(credential)) }

// APISchemaSend is the same call bound to the time applying a schema takes rather than to the time
// a screen's read is held to.
//
// The one call this console makes that a read's bound cuts part way through, and the one whose
// cutting leaves something behind: ./client.go's schemaTimeout says what that is.
func APISchemaSend(credential Credential) Send {
	return JSONSendWithin(API, apiHeaders(credential), schemaTimeout)
}

// APIMergePatch is the same call bound to the content type a merge patch is sent as.
func APIMergePatch(credential Credential) Send {
	return JSONSend(API, MergePatchHeaders(credential))
}

// APIMultipart is a multipart call to cloudflare's api, bound to the credential once.
//
// The two writes this console makes that carry no json: the script upload, and the settings patch a
// var goes up in — which cloudflare refuses a json body for outright.
func APIMultipart(credential Credential) MultipartUpload {
	return MultipartSend(API, apiHeaders(credential))
}

// APIGet is the same call bound to the one method a read is made with.
func APIGet(credential Credential) Get { return JSONGet(API, apiHeaders(credential)) }

// ResultKind is which of the states a screen draws differently one answer sorted into.
//
// A zero Result carries none of them, so nothing reads an unset one as a value that was there.
type ResultKind string

const (
	// ResultValue is the `result` cloudflare carried, and the only kind whose Value is set.
	ResultValue ResultKind = "value"
	// ResultMissing names no particular absent thing: notFoundCode says why it cannot, and each read
	// says for itself what was not found.
	ResultMissing ResultKind = "missing"
	// ResultRefused is cloudflare turning this credential down for this account.
	ResultRefused ResultKind = "refused"
	// ResultUnreachable is a cloudflare nothing was found out from, whose way out is trying again
	// rather than signing in again.
	ResultUnreachable ResultKind = "unreachable"
	// ResultUnreadable is an answer in a shape nothing here was written against.
	ResultUnreadable ResultKind = "unreadable"
)

// Result is the `result` a cloudflare answer carried, or which way it carried none.
type Result[T any] struct {
	Kind   ResultKind
	Value  T
	Detail string
}

// cloudflare turning this credential down for this account, which no status of its own carries.
const refusedCode = 10000

// cloudflare's `not found`, which is a different finding on each read that can get it.
//
// on `workers/scripts/{worker}/subdomain` it is a worker that has never been deployed, which is the
// ordinary state of every run before a first deploy; on `workers/subdomain` it is an account that
// has never registered one. ReadResult keeps them one code and one neutral state, because a reader
// that decided between them here would be deciding it for every read added after.
const notFoundCode = 10007

// ReadResult sorts one cloudflare answer into the states a screen draws differently.
//
// What every reader of this API shares is not parsing but classification: which status and which
// error code mean a refused credential, which mean a thing that is not on the account, and which
// mean an answer nothing was found out from. A second reader of its own would be a second answer to
// whether a fork's first run is a failure.
func ReadResult(answer Answer) Result[any] {
	if answer.Kind == Unreachable {
		return Result[any]{Kind: ResultUnreachable, Detail: answer.Detail}
	}
	detail := Said(answer)
	codes := ErrorCodes(answer.Body)
	// cloudflare's own refusal, told from a cloudflare that answered something else.
	if answer.Status == http.StatusUnauthorized || answer.Status == http.StatusForbidden ||
		slices.Contains(codes, refusedCode) {
		return Result[any]{Kind: ResultRefused, Detail: detail}
	}
	if slices.Contains(codes, notFoundCode) {
		return Result[any]{Kind: ResultMissing}
	}
	// anything else that failed is a cloudflare this console did not find the answer out from.
	if answer.Status < 200 || answer.Status > 299 {
		return Result[any]{Kind: ResultUnreachable, Detail: detail}
	}
	body, ok := answer.Body.(map[string]any)
	if !ok {
		return Result[any]{Kind: ResultUnreadable, Detail: detail}
	}
	value, named := body["result"]
	if !named {
		return Result[any]{Kind: ResultUnreadable, Detail: detail}
	}
	return Result[any]{Kind: ResultValue, Value: value}
}

// Shape is what a reader was written against, answering false where the answer was not that.
type Shape[T any] func(value any) (T, bool)

// ReadShaped classifies one cloudflare answer and then reads it for the shape the caller needs.
//
// An answer in a shape nothing here was written against is ResultUnreadable in cloudflare's own
// words, which is what turns a response cloudflare changed into a state a screen draws rather than
// a wrong value nobody sees. ResultMissing is passed through rather than decided: what is not found
// is the caller's sentence to say and never this one's.
func ReadShaped[T any](answer Answer, shape Shape[T]) Result[T] {
	read := ReadResult(answer)
	if read.Kind != ResultValue {
		return Result[T]{Kind: read.Kind, Detail: read.Detail}
	}
	value, ok := shape(read.Value)
	if !ok {
		return Result[T]{Kind: ResultUnreadable, Detail: Said(answer)}
	}
	return Result[T]{Kind: ResultValue, Value: value}
}

// Paged is a whole cloudflare list, or the failure that ended the walk and the codes it named.
type Paged struct {
	// Rows is every row across every page, and is what a finished walk carries.
	Rows []any
	// Failure is ResultRefused or ResultUnreachable where the walk did not finish, and empty where
	// it did.
	Failure ResultKind
	Detail  string
	// Codes is what cloudflare's own body named, for the read that has to tell two refusals apart.
	Codes []int
}

// PagedList follows one of cloudflare's paged lists to its last page.
//
// **A reader of the first page alone answers short and says nothing about it.** `result_info`
// carries the counts that say whether there is a page after this one: without the walk, an operator
// with more than a page of accounts loses the rest of them, and a database that is really there is
// reported as absent — beside a control offering to make a second one of the name.
//
// A page that came back empty ends the walk whatever those counts say. The counts are the account's
// to state and a wrong one would otherwise be a loop with no end to it inside one read.
//
// `size` is the page size where a caller has a reason to state one, and cloudflare's own default
// stands at zero: each list has its own floor and ceiling on the number and one over the ceiling is
// refused outright, so it belongs to the read that knows which list it is walking.
//
// A path may state a filter of its own, which is asked alongside the paging rather than in place
// of it.
//
// A failure is two states rather than the five ReadResult sorts into, because what a caller does
// about a list that came back missing or in a shape nothing was written against is what it does
// about a cloudflare it could not reach: look again.
//
// **The walk is bounded twice, and neither bound is cloudflare's to state.** A host answering the
// same non-empty page for every `page=N`, or reporting `per_page: 0` beside a large `total_count`,
// satisfies both of the stop conditions above forever while `rows` grows without end — inside a
// handler a browser is waiting on. So the walk also stops once it holds as many rows as the count
// claims, and at maxPages whatever anything says. Hitting the ceiling is reported as a failure and
// never as a list: a short answer drawn as a fact about the account is the thing this walk exists
// to prevent.
func PagedList(ctx context.Context, get Get, path string, size int) Paged {
	rows := []any{}
	per := ""
	if size != 0 {
		per = "per_page=" + strconv.Itoa(size) + "&"
	}
	joined := "?"
	if strings.Contains(path, "?") {
		joined = "&"
	}
	for page := 1; page <= maxPages; page++ {
		answer := get(ctx, fmt.Sprintf("%s%s%spage=%d", path, joined, per, page))
		read := ReadShaped(answer, func(value any) ([]any, bool) {
			held, ok := value.([]any)
			return held, ok
		})
		if read.Kind != ResultValue {
			failure := ResultUnreachable
			if read.Kind == ResultRefused {
				failure = ResultRefused
			}
			return Paged{Failure: failure, Detail: Said(answer), Codes: ErrorCodes(answer.Body)}
		}
		rows = append(rows, read.Value...)
		total, counted := totalCount(answer)
		if len(read.Value) == 0 || (counted && len(rows) >= total) || !hasMorePages(answer) {
			return Paged{Rows: rows}
		}
	}
	return Paged{
		Failure: ResultUnreachable,
		Detail:  fmt.Sprintf("Cloudflare's list had not ended after %d pages", maxPages),
	}
}

// how many pages one walk may ask for before it is the list that is wrong.
//
// cloudflare's own per-page ceilings are in the hundreds, so this is far past any list an account
// can really hold and close enough to bound a handler a browser is waiting on.
const maxPages = 100

// how many rows cloudflare says the whole list holds, where it says.
func totalCount(answer Answer) (int, bool) {
	body, ok := answer.Body.(map[string]any)
	if !ok {
		return 0, false
	}
	info, ok := body["result_info"].(map[string]any)
	if !ok {
		return 0, false
	}
	total, counted := info["total_count"].(float64)
	return int(total), counted
}

// whether cloudflare said there is a page after the one it just answered with.
func hasMorePages(answer Answer) bool {
	body, ok := answer.Body.(map[string]any)
	if !ok {
		return false
	}
	info, ok := body["result_info"].(map[string]any)
	if !ok {
		return false
	}
	page, onPage := info["page"].(float64)
	size, perPage := info["per_page"].(float64)
	total, counted := info["total_count"].(float64)
	return onPage && perPage && counted && page*size < total
}

// ErrorCodes is every error code a cloudflare body names, which is where its own meaning of a
// failure lives.
//
// Exported for the read that has to tell two refusals apart rather than take both.
func ErrorCodes(body any) []int {
	held, ok := body.(map[string]any)
	if !ok {
		return nil
	}
	errors, ok := held["errors"].([]any)
	if !ok {
		return nil
	}
	codes := []int{}
	for _, one := range errors {
		named, ok := one.(map[string]any)
		if !ok {
			continue
		}
		if code, isNumber := named["code"].(float64); isNumber {
			codes = append(codes, int(code))
		}
	}
	return codes
}

// Said is what cloudflare said about a failure, in its own words where it wrote any.
func Said(answer Answer) string {
	if answer.Kind == Unreachable {
		return answer.Detail
	}
	messages := []string{}
	if body, ok := answer.Body.(map[string]any); ok {
		if errors, listed := body["errors"].([]any); listed {
			for _, one := range errors {
				named, isObject := one.(map[string]any)
				if !isObject {
					continue
				}
				if message, isText := named["message"].(string); isText {
					messages = append(messages, message)
				}
			}
		}
	}
	if len(messages) == 0 {
		return "Cloudflare answered " + strconv.Itoa(answer.Status)
	}
	return strings.Join(messages, "; ")
}

// AssetsUpload is a multipart call bound to the token an assets upload session hands back.
//
// Not the account's own credential: the session mints a token of its own for the buckets, and it is
// single-use — so one is held for the length of one deploy and never beyond it.
func AssetsUpload(token string) MultipartUpload {
	return MultipartSend(API, map[string]string{"Authorization": "Bearer " + token})
}
