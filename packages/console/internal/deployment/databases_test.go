package deployment

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

const account = "an-account"

func TestDatabasesCountsTheRowsCarryingTheName(t *testing.T) {
	get := fake(t, map[string]any{
		"/accounts/" + account + "/d1/database": envelope([]any{
			map[string]any{"name": "better-giving", "uuid": "one"},
			map[string]any{"name": "somebody-elses", "uuid": "two"},
			map[string]any{"name": "better-giving", "uuid": "three"},
		}),
	})
	read := Databases(context.Background(), get, account, "better-giving")
	if read.Kind != Listed || read.Count != 2 {
		t.Fatalf("read %+v", read)
	}
}

func TestDatabasesDropsARowThatNamesNoDatabase(t *testing.T) {
	get := fake(t, map[string]any{
		"/accounts/" + account + "/d1/database": envelope([]any{
			map[string]any{"name": "better-giving", "uuid": ""},
			map[string]any{"uuid": "one"},
			"not a row",
			map[string]any{"name": "better-giving", "uuid": "one"},
		}),
	})
	read := Databases(context.Background(), get, account, "better-giving")
	if read.Kind != Listed || read.Count != 1 {
		t.Fatalf("read %+v", read)
	}
}

// an answer this cannot read is not an empty account: the two differ by whether the console is
// about to offer to make a database.
func TestDatabasesTellsARefusalFromAnEmptyAccount(t *testing.T) {
	refused := fake(t, map[string]any{
		"/accounts/" + account + "/d1/database": failed(10000, "Authentication error"),
	})
	if read := Databases(context.Background(), refused, account, "x"); read.Kind != Refused {
		t.Fatalf("read %+v", read)
	}

	empty := fake(t, map[string]any{"/accounts/" + account + "/d1/database": envelope([]any{})})
	if read := Databases(context.Background(), empty, account, "x"); read.Kind != Listed || read.Count != 0 {
		t.Fatalf("read %+v", read)
	}
}

// the database this deployment runs on, made where the account holds none of the name.

// a cloudflare whose list answers `rows` and whose create answers `made`, recording every call.
//
// The list is asked twice on the path that creates one, so the rows a case states are what the
// account holds after the create rather than before it: the walk is what resolves the id.
func making(t *testing.T, made any, after ...any) (*[]string, cf.Send) {
	t.Helper()
	calls := []string{}
	rows := []any{}
	if after != nil {
		rows = after
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method)
		if r.Method == http.MethodPost {
			write(w, made)
			return
		}
		// what the account holds before anything was made is nothing, unless a case named two of
		// the name — which is the state a press meets before it makes anything at all.
		if len(calls) == 1 && len(rows) < 2 {
			write(w, envelope([]any{}))
			return
		}
		write(w, envelope(rows))
	}))
	t.Cleanup(api.Close)
	return &calls, cf.JSONSend(api.URL, map[string]string{})
}

func write(w http.ResponseWriter, answer any) {
	if said, ok := answer.(coded); ok {
		w.WriteHeader(said.status)
		_ = json.NewEncoder(w).Encode(said.body)
		return
	}
	if status, ok := answer.(int); ok {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(failed(10000, "Authentication error"))
		return
	}
	_ = json.NewEncoder(w).Encode(answer)
}

func TestADatabaseAlreadyOfThatNameIsResolvedRatherThanMadeAgain(t *testing.T) {
	// every remote path resolves the database by name (CLAUDE.md), so what a deploy binds to is the
	// name and not which press put it there.
	calls, send := standingThere(t)
	standing := ProvideDatabase(context.Background(), send, account, "better-giving", "")
	if standing.Kind != DatabaseThere || standing.UUID != "the-id" {
		t.Fatalf("standing = %+v", standing)
	}
	for _, method := range *calls {
		if method == http.MethodPost {
			t.Error("a database of that name was made a second time")
		}
	}
}

func TestAnAccountHoldingNoneIsMadeOneAndItsIDIsResolvedByName(t *testing.T) {
	calls, send := making(t, envelope(map[string]any{"uuid": "the-id"}),
		map[string]any{"name": "better-giving", "uuid": "the-id"})
	standing := ProvideDatabase(context.Background(), send, account, "better-giving", "")
	if standing.Kind != DatabaseMade || standing.UUID != "the-id" {
		t.Fatalf("standing = %+v", standing)
	}
	if len(*calls) != 3 {
		t.Errorf("calls = %v, want the list, the create and the walk that resolves the id", *calls)
	}
}

func TestSomethingOfThatNameArrivingBetweenTheReadAndThePressIsNotAFailure(t *testing.T) {
	// cloudflare's 7502 is not an error to draw: the same outcome as making one, because every
	// remote path resolves the database by name.
	calls, send := making(t, failedStatus(400, 7502, "database already exists"),
		map[string]any{"name": "better-giving", "uuid": "the-id"})
	standing := ProvideDatabase(context.Background(), send, account, "better-giving", "")
	if standing.Kind != DatabaseMade || standing.UUID != "the-id" {
		t.Fatalf("standing = %+v, calls = %v", standing, *calls)
	}
}

func TestAnAccountAtItsLimitIsItsOwnAnswer(t *testing.T) {
	// its way out is a database to delete or a paid plan, which is nothing like a refused sign-in.
	_, send := making(t, failedStatus(400, 7406, "workers.api.error.d1_database_limit_exceeded"))
	if standing := ProvideDatabase(context.Background(), send, account, "x", ""); standing.Kind != DatabaseLimit {
		t.Fatalf("standing = %+v", standing)
	}
}

func TestTwoDatabasesOfOneNameAreRefusedRatherThanChosenBetween(t *testing.T) {
	// a deploy would bind to one of them without saying which, and no press can repair it.
	calls, send := making(t, 500,
		map[string]any{"name": "better-giving", "uuid": "one"},
		map[string]any{"name": "better-giving", "uuid": "two"})
	standing := ProvideDatabase(context.Background(), send, account, "better-giving", "")
	if standing.Kind != DatabaseMany {
		t.Fatalf("standing = %+v", standing)
	}
	if len(*calls) != 1 {
		t.Errorf("calls = %v, want the list and nothing past it", *calls)
	}
}

func TestACreateCloudflareTurnedDownCarriesItsOwnWords(t *testing.T) {
	_, send := making(t, 403)
	standing := ProvideDatabase(context.Background(), send, account, "x", "")
	if standing.Kind != DatabaseRefused || standing.Detail == "" {
		t.Fatalf("standing = %+v", standing)
	}
}

func TestADatabaseThatWasMadeAndCouldNotBeResolvedIsNotADeploy(t *testing.T) {
	// the uuid is what the worker's binding names, so a deploy made without one binds to nothing.
	_, send := making(t, envelope(map[string]any{"uuid": "the-id"}))
	standing := ProvideDatabase(context.Background(), send, account, "better-giving", "")
	if standing.Kind != DatabaseUnreachable {
		t.Fatalf("standing = %+v", standing)
	}
}

// what cloudflare wraps a coded failure in, at the status it sends one at.
func failedStatus(status, code int, message string) any {
	return coded{status: status, body: failed(code, message)}
}

type coded struct {
	status int
	body   map[string]any
}

// an account already holding one of the name, whose list says so on the first read.
func standingThere(t *testing.T) (*[]string, cf.Send) {
	t.Helper()
	calls := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method)
		write(w, envelope([]any{map[string]any{"name": "better-giving", "uuid": "the-id"}}))
	}))
	t.Cleanup(api.Close)
	return &calls, cf.JSONSend(api.URL, map[string]string{})
}

// where the records are kept, chosen once and carried into the create.

// a cloudflare recording the body of every create, whose list answers one row of the name after it.
func placing(t *testing.T) (*[]map[string]any, cf.Send) {
	t.Helper()
	bodies := []map[string]any{}
	lists := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body := map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			bodies = append(bodies, body)
			write(w, envelope(map[string]any{"uuid": "the-id"}))
			return
		}
		lists++
		if lists == 1 {
			write(w, envelope([]any{}))
			return
		}
		write(w, envelope([]any{map[string]any{"name": "better-giving", "uuid": "the-id"}}))
	}))
	t.Cleanup(api.Close)
	return &bodies, cf.JSONSend(api.URL, map[string]string{})
}

func TestAnAutomaticPlacementCreatesTheDatabaseNamingNeitherField(t *testing.T) {
	// cloudflare's own placement, which is what every deployment with no residency rule takes.
	bodies, send := placing(t)
	if standing := ProvideDatabase(context.Background(), send, account, "better-giving", ""); standing.Kind != DatabaseMade {
		t.Fatalf("standing = %+v", standing)
	}
	if len(*bodies) != 1 {
		t.Fatalf("%d creates were made", len(*bodies))
	}
	made := (*bodies)[0]
	if _, named := made["primary_location_hint"]; named {
		t.Errorf("the create named a location hint: %+v", made)
	}
	if _, named := made["jurisdiction"]; named {
		t.Errorf("the create named a jurisdiction: %+v", made)
	}
}

func TestARegionIsCarriedAsThePrimaryLocationHint(t *testing.T) {
	bodies, send := placing(t)
	if standing := ProvideDatabase(context.Background(), send, account, "better-giving", "weur"); standing.Kind != DatabaseMade {
		t.Fatalf("standing = %+v", standing)
	}
	made := (*bodies)[0]
	if made["primary_location_hint"] != "weur" {
		t.Errorf("the create carried %+v", made)
	}
	if _, named := made["jurisdiction"]; named {
		t.Errorf("a region was carried as a jurisdiction: %+v", made)
	}
}

func TestAJurisdictionIsCarriedAsTheJurisdictionAndNeverAsAHint(t *testing.T) {
	// cloudflare reads a jurisdiction over a hint, so a value sent as both would be one control
	// answered two ways.
	bodies, send := placing(t)
	if standing := ProvideDatabase(context.Background(), send, account, "better-giving", "eu"); standing.Kind != DatabaseMade {
		t.Fatalf("standing = %+v", standing)
	}
	made := (*bodies)[0]
	if made["jurisdiction"] != "eu" {
		t.Errorf("the create carried %+v", made)
	}
	if _, named := made["primary_location_hint"]; named {
		t.Errorf("a jurisdiction was carried as a hint too: %+v", made)
	}
}

func TestOnlyTheEightPlacementsAndTheAutomaticOneAreKnown(t *testing.T) {
	for _, known := range append(append([]string{""}, LocationHints...), Jurisdictions...) {
		if !PlacementKnown(known) {
			t.Errorf("%q is offered and not known", known)
		}
	}
	for _, unknown := range []string{"EU", "us", "wnam ", "auto", "enam,eu"} {
		if PlacementKnown(unknown) {
			t.Errorf("%q is known", unknown)
		}
	}
}
