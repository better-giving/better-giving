package signin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// how the console tells one sign-in from another, off the bodies cloudflare's API really answers
// with.
//
// the account list is the part worth the file. it is an intersection of two paged lists, and every
// way one of them can come back short is a different thing to draw: a wider list than the truth
// offers an account that fails at the first command scoped to it, and a failure drawn as an empty
// one tells an operator their account is gone.

const (
	hound = "c8b0cf21be22bec40c6fd4dec7a6bbf7"
	salas = "457b5d4a3344c1fd84107230619b9acf"
)

// a cloudflare success body, in the envelope the API really answers in.
func ok(result any, info map[string]any) map[string]any {
	body := map[string]any{"result": result, "success": true, "errors": []any{}, "messages": []any{}}
	if info != nil {
		body["result_info"] = info
	}
	return body
}

// a cloudflare failure body, with the code it really carries.
func refused(code int, message string) map[string]any {
	return map[string]any{
		"result":   nil,
		"success":  false,
		"errors":   []any{map[string]any{"code": code, "message": message}},
		"messages": []any{},
	}
}

// an accounts row, in the shape `/accounts` really lists them.
func accountRow(id, name string) map[string]any {
	return map[string]any{
		"id":       id,
		"name":     name,
		"type":     "standard",
		"settings": map[string]any{"enforce_twofactor": false},
	}
}

// a memberships row this sign-in holds, which names its account inside itself.
func membershipRow(id, name string) map[string]any {
	return map[string]any{
		"id":      "m-" + id,
		"code":    "a7c1",
		"status":  "accepted",
		"account": map[string]any{"id": id, "name": name},
		"roles":   []any{"Super Administrator - All Privileges"},
	}
}

// a memberships row nobody accepted, which is what cloudflare lists an invitation as until
// somebody does and after somebody turns it down.
func invitationRow(id, name, status string) map[string]any {
	row := membershipRow(id, name)
	row["status"] = status
	return row
}

// one answer, and the status it is sent under.
type answer struct {
	status int
	body   map[string]any
}

// the three reads, answered from literals.
//
// `accounts` and `memberships` are one answer per page, so a case states as many as the list it is
// about was paginated into; a page past the last stated one comes back empty, which is how
// cloudflare ends a list.
type answers struct {
	accounts    []answer
	memberships []answer
	user        *answer
}

func page(list []answer, at int) answer {
	if at >= 1 && at <= len(list) {
		return list[at-1]
	}
	return answer{body: ok([]any{}, nil)}
}

// every path one fake was asked for and the query it carried, guarded because the reads it answers
// are made at once.
type asked struct {
	mutex sync.Mutex
	paths []string
}

func (one *asked) called(path string) {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	one.paths = append(one.paths, path)
}

func (one *asked) saw(path string) bool {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	for _, seen := range one.paths {
		if strings.HasPrefix(seen, path) {
			return true
		}
	}
	return false
}

func (one *asked) count() int {
	one.mutex.Lock()
	defer one.mutex.Unlock()
	return len(one.paths)
}

// a cloudflare answering the three reads a sign-in is made of, and recording every path asked for.
func serve(t *testing.T, held answers) (cf.Get, *asked) {
	t.Helper()
	seen := &asked{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.called(r.URL.RequestURI())
		at, _ := strconv.Atoi(r.URL.Query().Get("page"))
		var sent answer
		switch r.URL.Path {
		case "/accounts":
			if held.accounts == nil {
				held.accounts = []answer{{body: ok([]any{accountRow(hound, "hound-haven")}, nil)}}
			}
			sent = page(held.accounts, at)
		case "/memberships":
			if held.memberships == nil {
				held.memberships = []answer{{body: ok([]any{membershipRow(hound, "hound-haven")}, nil)}}
			}
			sent = page(held.memberships, at)
		case "/user":
			sent = answer{body: ok(map[string]any{"email": "operator@example.org"}, nil)}
			if held.user != nil {
				sent = *held.user
			}
		default:
			t.Errorf("nothing here reads %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if sent.status != 0 {
			w.WriteHeader(sent.status)
		}
		_ = json.NewEncoder(w).Encode(sent.body)
	}))
	t.Cleanup(server.Close)
	return cf.JSONGet(server.URL, nil), seen
}

func read(t *testing.T, held answers, credential cf.Credential, tokenSet bool) SignIn {
	t.Helper()
	get, _ := serve(t, held)
	return Read(context.Background(), credential, tokenSet, get)
}

var bearer = cf.BearerCredential("v1.0-not-a-real-token")

func TestASignInCarriesTheEmailAndTheAccountsThrough(t *testing.T) {
	got := read(t, answers{}, bearer, false)

	if got.Kind != OAuth {
		t.Errorf("kind = %q, want %q", got.Kind, OAuth)
	}
	if got.Email == nil || *got.Email != "operator@example.org" {
		t.Errorf("email = %v, want the address cloudflare named", got.Email)
	}
	if len(got.Accounts) != 1 || got.Accounts[0] != (Account{ID: hound, Name: "hound-haven"}) {
		t.Errorf("accounts = %v, want the one account both lists name", got.Accounts)
	}
}

func TestOnlyAnAccountAMembershipNamesIsOffered(t *testing.T) {
	// an account this credential can see is not an account it is a member of, and the id every
	// command after the connect screen runs under has to be both.
	got := read(t, answers{
		accounts: []answer{{body: ok([]any{
			accountRow(hound, "hound-haven"),
			accountRow(salas, "justin-salas"),
		}, nil)}},
		memberships: []answer{{body: ok([]any{membershipRow(salas, "justin-salas")}, nil)}},
	}, bearer, false)

	if len(got.Accounts) != 1 || got.Accounts[0].ID != salas {
		t.Errorf("accounts = %v, want the one account both lists name", got.Accounts)
	}
}

func TestAnInvitationNobodyAcceptedIsNotAnAccountThisSignInHolds(t *testing.T) {
	// a pending invitation names an account the credential is not a member of yet, and the id every
	// command after the connect screen runs under has to be one it is.
	get, seen := serve(t, answers{
		accounts: []answer{{body: ok([]any{
			accountRow(hound, "hound-haven"),
			accountRow(salas, "justin-salas"),
		}, nil)}},
		memberships: []answer{{body: ok([]any{
			invitationRow(hound, "hound-haven", "pending"),
			membershipRow(salas, "justin-salas"),
		}, nil)}},
	})
	got := Read(context.Background(), bearer, false, get)

	// asked for narrowed, because a list cloudflare can filter is one it should not be sending.
	if !seen.saw("/memberships?status=accepted&page=1") {
		t.Errorf("asked %v, want the memberships narrowed to the accepted ones", seen.paths)
	}
	if len(got.Accounts) != 1 || got.Accounts[0].ID != salas {
		t.Errorf("accounts = %v, want the one membership this sign-in holds", got.Accounts)
	}
}

func TestTwoListsSharingNothingAreAnEmptyListRatherThanAFailure(t *testing.T) {
	// a sign-in that carries no usable account is a true thing to say about this machine, and the
	// picker draws the chooser with no rows in it as a state of its own.
	got := read(t, answers{
		accounts:    []answer{{body: ok([]any{accountRow(hound, "hound-haven")}, nil)}},
		memberships: []answer{{body: ok([]any{membershipRow(salas, "justin-salas")}, nil)}},
	}, bearer, false)

	if got.Kind != OAuth || len(got.Accounts) != 0 {
		t.Errorf("read = %+v, want a sign-in carrying no account", got)
	}
}

func TestBothListsAreFollowedPastTheirFirstPage(t *testing.T) {
	// a read of the first page alone answers short and says nothing about it, which is drawn as a
	// fact about the account rather than as a read that did not finish.
	counts := map[string]any{"page": float64(1), "per_page": float64(1), "total_count": float64(2)}
	last := map[string]any{"page": float64(2), "per_page": float64(1), "total_count": float64(2)}
	got := read(t, answers{
		accounts: []answer{
			{body: ok([]any{accountRow(hound, "hound-haven")}, counts)},
			{body: ok([]any{accountRow(salas, "justin-salas")}, last)},
		},
		memberships: []answer{
			{body: ok([]any{membershipRow(hound, "hound-haven")}, counts)},
			{body: ok([]any{membershipRow(salas, "justin-salas")}, last)},
		},
	}, bearer, false)

	if len(got.Accounts) != 2 {
		t.Errorf("accounts = %v, want both pages of them", got.Accounts)
	}
}

func TestAnAccountRowWithNoIdIsDropped(t *testing.T) {
	// a row nothing can be scoped to is not a row: the id is what every command after the connect
	// screen runs under.
	got := read(t, answers{
		accounts: []answer{{body: ok([]any{
			map[string]any{"name": "nameless"},
			accountRow(hound, "hound-haven"),
		}, nil)}},
	}, bearer, false)

	if len(got.Accounts) != 1 || got.Accounts[0].ID != hound {
		t.Errorf("accounts = %v, want the row that can be scoped to and no other", got.Accounts)
	}
}

func TestAnAccountWithNoNameIsReadableByItsId(t *testing.T) {
	got := read(t, answers{
		accounts: []answer{{body: ok([]any{map[string]any{"id": hound}}, nil)}},
	}, bearer, false)

	if len(got.Accounts) != 1 || got.Accounts[0].Name != hound {
		t.Errorf("accounts = %v, want the id standing in for the name", got.Accounts)
	}
}

func TestTheAccountsStandWhenTheMembershipsAreRefusedOverPermission(t *testing.T) {
	// the intersection only ever narrows, so what is drawn is the wider list and the
	// account-scoped read behind a later command is what refuses — which is a refusal that names
	// the account, where this one could not.
	for _, code := range []int{9106, 10000} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			got := read(t, answers{
				memberships: []answer{{status: http.StatusForbidden, body: refused(code, "not allowed")}},
			}, bearer, false)

			if got.Kind != OAuth || len(got.Accounts) != 1 {
				t.Errorf("read = %+v, want the accounts cloudflare did name", got)
			}
		})
	}
}

func TestThePermissionIsNamedWhenNoAccountCameBackToFallBackOn(t *testing.T) {
	got := read(t, answers{
		accounts:    []answer{{body: ok([]any{}, nil)}},
		memberships: []answer{{status: http.StatusForbidden, body: refused(9106, "not allowed")}},
	}, bearer, false)

	if got.Kind != Refused || got.Detail == "" {
		t.Errorf("read = %+v, want a refusal naming what is missing", got)
	}
}

func TestAMembershipsFailureThatIsNotAboutPermissionIsNotFallenBackOn(t *testing.T) {
	got := read(t, answers{
		memberships: []answer{{status: http.StatusInternalServerError, body: refused(1000, "boom")}},
	}, bearer, false)

	if got.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", got.Kind, Unreachable)
	}
}

func TestARefusedAccountsListIsReportedRatherThanFallenBackOn(t *testing.T) {
	// there is nothing left to intersect and nothing to fall back on.
	got := read(t, answers{
		accounts: []answer{{status: http.StatusForbidden, body: refused(10000, "Authentication error")}},
	}, bearer, false)

	if got.Kind != Refused {
		t.Errorf("kind = %q, want %q", got.Kind, Refused)
	}
}

func TestAMachineWithNoNetworkIsUnreachableRatherThanRefused(t *testing.T) {
	// telling an operator to sign in again over a dropped connection sends them to a flow that
	// cannot finish either, and the second failure looks exactly like the first.
	get := cf.JSONGet("http://127.0.0.1:1", nil)
	got := Read(context.Background(), bearer, false, get)

	if got.Kind != Unreachable {
		t.Errorf("kind = %q, want %q", got.Kind, Unreachable)
	}
}

func TestTheAddressIsAbsentAndTheSignInStandsWhenTheUserMayNotBeRead(t *testing.T) {
	// 9109 is cloudflare refusing this credential the thing it asked for, which on `/user` is an
	// address that cannot be shown rather than a sign-in that failed.
	got := read(t, answers{
		user: &answer{status: http.StatusForbidden, body: refused(9109, "Unable to read user")},
	}, bearer, false)

	if got.Kind != OAuth || got.Email != nil {
		t.Errorf("read = %+v, want a sign-in with no address on it", got)
	}
}

func TestAUserWithNoEmailOnItIsAnAbsentAddressRatherThanAnUnreadableAnswer(t *testing.T) {
	got := read(t, answers{
		user: &answer{body: ok(map[string]any{"id": "u1"}, nil)},
	}, bearer, false)

	if got.Kind != OAuth || got.Email != nil {
		t.Errorf("read = %+v, want a sign-in with no address on it", got)
	}
}

func TestAnyOtherRefusalOnTheUserFailsTheWholeRead(t *testing.T) {
	got := read(t, answers{
		user: &answer{status: http.StatusUnauthorized, body: refused(10000, "Authentication error")},
	}, bearer, false)

	if got.Kind != Refused {
		t.Errorf("kind = %q, want %q", got.Kind, Refused)
	}
}

func TestAGlobalKeysAddressIsTheOneItAlreadyCarries(t *testing.T) {
	// a global api key travels with the email it has to be sent alongside, so there is nothing to
	// ask for.
	get, seen := serve(t, answers{})
	got := Read(context.Background(), cf.Credential{
		Kind:  cf.KeyCredential,
		Key:   "not-a-real-key",
		Email: "keyholder@example.org",
	}, true, get)

	if got.Email == nil || *got.Email != "keyholder@example.org" {
		t.Errorf("email = %v, want the address the key travels with", got.Email)
	}
	if seen.saw("/user") {
		t.Error("the user was asked for behind a credential that already names one")
	}
}

func TestWhichKindOfSignInItIsDecidesWhetherASignInControlIsDrawn(t *testing.T) {
	for _, one := range []struct {
		name       string
		credential cf.Credential
		tokenSet   bool
		want       Kind
	}{
		{"a credential this binary holds itself", bearer, false, OAuth},
		{"a credential inherited from the environment", bearer, true, Token},
		// a global api key travels with an email and can only have been set in the environment.
		{"a global api key", cf.Credential{Kind: cf.KeyCredential, Key: "k", Email: "a@b.test"}, false, Token},
	} {
		t.Run(one.name, func(t *testing.T) {
			got := read(t, answers{}, one.credential, one.tokenSet)
			if got.Kind != one.want {
				t.Errorf("kind = %q, want %q", got.Kind, one.want)
			}
		})
	}
}

func TestAMachineHoldingNothingToReadWithIsSignedOut(t *testing.T) {
	get, seen := serve(t, answers{})
	got := Read(context.Background(), cf.Credential{Kind: cf.NoCredential}, false, get)

	if got.Kind != SignedOut {
		t.Errorf("kind = %q, want %q", got.Kind, SignedOut)
	}
	if seen.count() != 0 {
		t.Errorf("cloudflare was asked %v behind no credential at all", seen.paths)
	}
}
