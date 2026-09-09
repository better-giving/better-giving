package migrate

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

// a database that answers the way d1's query endpoint does, recording every statement sent to it.
type database struct {
	mutex   sync.Mutex
	sent    []string
	applied []string
	// refuses is the file whose sql this database turns down, and is empty where it turns none down.
	refuses string
	// halts is the file whose sql this database takes with a 2xx and a statement inside it that did
	// not run, which is the other way d1 reports a file it would not apply.
	halts  string
	status int
	body   string
}

func (held *database) sql() []string {
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return append([]string{}, held.sent...)
}

func (held *database) serve(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := "/accounts/an-account/d1/database/a-database/query"; r.URL.Path != want {
			t.Errorf("posted to %q, want %q", r.URL.Path, want)
		}
		var body struct {
			SQL string `json:"sql"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("Decode: %v", err)
		}

		held.mutex.Lock()
		held.sent = append(held.sent, body.SQL)
		refused := held.refuses != "" && strings.Contains(body.SQL, held.refuses)
		applied := append([]string{}, held.applied...)
		held.mutex.Unlock()

		if held.status != 0 {
			w.WriteHeader(held.status)
			w.Write([]byte(held.body))
			return
		}
		if refused {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"success":false,"errors":[{"code":7500,"message":"near \"opps\": syntax error"}]}`))
			return
		}
		if held.halts != "" && strings.Contains(body.SQL, held.halts) {
			json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"result": []any{
					map[string]any{"success": true, "results": []any{}},
					map[string]any{"success": false, "error": `near "opps": syntax error`},
				},
			})
			return
		}
		rows := []any{}
		if strings.Contains(body.SQL, "SELECT name FROM") {
			for _, name := range applied {
				rows = append(rows, map[string]any{"name": name})
			}
		}
		json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"result":  []any{map[string]any{"success": true, "results": rows}},
		})
	}))
}

func carried(names ...string) []File {
	files := []File{}
	for _, name := range names {
		files = append(files, File{Name: name, SQL: "create table " + strings.TrimSuffix(name, ".sql") + " (a text);"})
	}
	return files
}

func applied(t *testing.T, held *database, files []File) (Result, []string) {
	t.Helper()
	server := held.serve(t)
	defer server.Close()

	landed := []string{}
	result := Apply(context.Background(), cf.JSONSend(server.URL, nil), "an-account", "a-database", files,
		func(name string, at, of int) { landed = append(landed, name+" "+strconv.Itoa(at)+"/"+strconv.Itoa(of)) })
	return result, landed
}

func TestATableThatIsNotThereIsMadeBeforeItIsRead(t *testing.T) {
	// wrangler's own statement, verbatim: a table of another shape under the same name is a
	// deployment whose applied list `wrangler d1 migrations list` cannot read.
	held := &database{}
	result, _ := applied(t, held, carried("0000_a.sql"))

	if result.Kind != Landed {
		t.Fatalf("kind = %q (%s)", result.Kind, result.Detail)
	}
	sent := held.sql()
	if len(sent) == 0 || sent[0] != BootstrapSQL {
		t.Fatalf("the first statement was %q, want the bookkeeping table", sent[0])
	}
	if !strings.Contains(sent[1], "SELECT name FROM") {
		t.Errorf("the second statement was %q, want the applied list", sent[1])
	}
}

func TestEveryPendingFileGoesUpWithItsOwnRowBehindIt(t *testing.T) {
	// one string per file carrying the file and the row that records it, which is wrangler's own
	// concatenation: the endpoint takes a whole multi-statement file, so nothing is split here and
	// the row cannot land without the file it records.
	held := &database{}
	result, landed := applied(t, held, carried("0000_a.sql", "0001_b.sql"))

	if result.Kind != Landed || strings.Join(result.Applied, ",") != "0000_a.sql,0001_b.sql" {
		t.Fatalf("applied = %v (%s)", result.Applied, result.Detail)
	}
	// the total in front of the first file: a screen drawing the one-way door cannot count towards
	// a number nobody has told it, and the list is not known until the database's own has been read.
	if strings.Join(landed, ",") != " 0/2,0000_a.sql 1/2,0001_b.sql 2/2" {
		t.Errorf("the screen was told %v, want the total and then each file as it landed", landed)
	}
	sent := held.sql()[2:]
	for at, name := range []string{"0000_a.sql", "0001_b.sql"} {
		if !strings.HasPrefix(sent[at], "create table "+strings.TrimSuffix(name, ".sql")) {
			t.Errorf("statement %d opens %q, want the file's own sql", at, sent[at])
		}
		if !strings.Contains(sent[at], `INSERT INTO "d1_migrations" (name)`+"\nvalues ('"+name+"');") {
			t.Errorf("statement %d records nothing, and a run that dies after it repeats the file", at)
		}
	}
}

func TestARunThatDiedHalfWayResumesAtTheFileThatHadNotLanded(t *testing.T) {
	// the table is read before every run, so what a second press applies is what the first one did
	// not — and nothing it did.
	held := &database{applied: []string{"0000_a.sql", "0001_b.sql"}}
	result, landed := applied(t, held, carried("0000_a.sql", "0001_b.sql", "0002_c.sql"))

	if strings.Join(result.Applied, ",") != "0002_c.sql" {
		t.Errorf("applied = %v, want the one file that had not landed", result.Applied)
	}
	if strings.Join(landed, ",") != " 0/1,0002_c.sql 1/1" {
		t.Errorf("the screen was told %v, want the one file this run would apply", landed)
	}
	for _, sql := range held.sql() {
		if strings.HasPrefix(sql, "create table 0000_a") || strings.HasPrefix(sql, "create table 0001_b") {
			t.Error("a file the database had already applied was sent again")
		}
	}
}

func TestADatabaseHoldingEveryFileIsAppliedNothing(t *testing.T) {
	held := &database{applied: []string{"0000_a.sql"}}
	result, landed := applied(t, held, carried("0000_a.sql"))

	if result.Kind != Landed || len(result.Applied) != 0 || len(landed) != 0 {
		t.Errorf("kind = %q, applied = %v, told = %v", result.Kind, result.Applied, landed)
	}
}

func TestAFileThatFailedIsNamedAndTheRunStopsThere(t *testing.T) {
	// nothing rolls back and nothing is retried: what the operator is owed is which file the
	// database stopped on, because the ones in front of it are applied and stay applied.
	held := &database{refuses: "create table 0001_b"}
	result, landed := applied(t, held, carried("0000_a.sql", "0001_b.sql", "0002_c.sql"))

	if result.Kind != Failed {
		t.Fatalf("kind = %q, want %q", result.Kind, Failed)
	}
	if result.At != "0001_b.sql" {
		t.Errorf("stopped at %q, want the file the database turned down", result.At)
	}
	if strings.Join(result.Applied, ",") != "0000_a.sql" {
		t.Errorf("applied = %v, want the file that landed before it", result.Applied)
	}
	if strings.Join(landed, ",") != " 0/3,0000_a.sql 1/3" {
		t.Errorf("the screen was told %v, want the total and the one file that landed", landed)
	}
	if !strings.Contains(result.Detail, "syntax error") {
		t.Errorf("detail = %q, want the database's own words", result.Detail)
	}
	for _, sql := range held.sql() {
		if strings.HasPrefix(sql, "create table 0002_c") {
			t.Error("the file behind the one that failed was sent anyway")
		}
	}
}

func TestASignInCloudflareTurnsDownIsRefusedRatherThanFailed(t *testing.T) {
	// two different sentences: one is another account's database and one is a file to fix.
	held := &database{status: http.StatusForbidden, body: `{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`}
	result, _ := applied(t, held, carried("0000_a.sql"))

	if result.Kind != Refused {
		t.Errorf("kind = %q, want %q", result.Kind, Refused)
	}
}

func TestARunTheOperatorStoppedWaitingOnAppliesNoFurtherFile(t *testing.T) {
	held := &database{}
	server := held.serve(t)
	defer server.Close()

	ctx, stop := context.WithCancel(context.Background())
	result := Apply(ctx, cf.JSONSend(server.URL, nil), "an-account", "a-database",
		carried("0000_a.sql", "0001_b.sql"), func(_ string, at, _ int) {
			if at > 0 {
				stop()
			}
		})

	if result.Kind != Cancelled {
		t.Fatalf("kind = %q, want %q", result.Kind, Cancelled)
	}
	if strings.Join(result.Applied, ",") != "0000_a.sql" {
		t.Errorf("applied = %v, want what had landed when it stopped", result.Applied)
	}
	for _, sql := range held.sql() {
		if strings.HasPrefix(sql, "create table 0001_b") {
			t.Error("a file went up after the run was stopped")
		}
	}
}

func TestARunStoppedBeforeItReachedTheDatabaseIsCancelledRatherThanUnreachable(t *testing.T) {
	// a cut request reaches nothing in exactly the way a cloudflare with no route to it does, and
	// the two are not the same sentence: one is a press to make again, the other is a connection.
	held := &database{}
	server := held.serve(t)
	defer server.Close()

	ctx, stop := context.WithCancel(context.Background())
	stop()
	result := Apply(ctx, cf.JSONSend(server.URL, nil), "an-account", "a-database", carried("0000_a.sql"), nil)

	if result.Kind != Cancelled {
		t.Errorf("kind = %q, want %q", result.Kind, Cancelled)
	}
}

func TestTheDatabaseIsAskedWhatItHasAppliedWithoutApplyingAnything(t *testing.T) {
	// the list a screen draws before the press is made, which is the read half of the same step.
	held := &database{applied: []string{"0000_a.sql"}}
	server := held.serve(t)
	defer server.Close()

	read := Applied(context.Background(), cf.JSONSend(server.URL, nil), "an-account", "a-database")

	if read.Kind != cf.ResultValue || strings.Join(read.Value, ",") != "0000_a.sql" {
		t.Fatalf("read = %q %v (%s)", read.Kind, read.Value, read.Detail)
	}
	pending := Pending([]string{"0000_a.sql"}, carried("0000_a.sql", "0001_b.sql"))
	if len(pending) != 1 || pending[0].Name != "0001_b.sql" {
		t.Errorf("pending = %v, want the file the database has not", pending)
	}
	for _, sql := range held.sql() {
		if strings.HasPrefix(sql, "create table") {
			t.Error("a read applied a migration")
		}
	}
}

func TestAStatementThatDidNotRunInsideAnAnswerThatSucceededStopsTheRun(t *testing.T) {
	// the endpoint answers 2xx with one result per statement, and a file it would not apply is a
	// `success` of false on the entry rather than a status. a run that reads the status alone records
	// the file as landed and hands the upload a schema that was never created.
	held := &database{halts: "create table 0001_b"}
	result, landed := applied(t, held, carried("0000_a.sql", "0001_b.sql", "0002_c.sql"))

	if result.Kind != Failed {
		t.Fatalf("kind = %q, want %q", result.Kind, Failed)
	}
	if result.At != "0001_b.sql" {
		t.Errorf("stopped at %q, want the file the statement is in", result.At)
	}
	if !strings.Contains(result.Detail, "0001_b.sql, statement 2") {
		t.Errorf("detail = %q, names neither the file nor the statement of it that stopped", result.Detail)
	}
	if !strings.Contains(result.Detail, "syntax error") {
		t.Errorf("detail = %q, want the database's own words", result.Detail)
	}
	if strings.Join(result.Applied, ",") != "0000_a.sql" || strings.Join(landed, ",") != " 0/3,0000_a.sql 1/3" {
		t.Errorf("applied = %v and the screen was told %v, want the file that landed before it", result.Applied, landed)
	}
	for _, sql := range held.sql() {
		if strings.HasPrefix(sql, "create table 0002_c") {
			t.Error("the file behind the one that did not run was sent anyway")
		}
	}
}

func TestADatabaseWithNoTableYetHasAppliedNothingRatherThanBeingUnreachable(t *testing.T) {
	// the read a screen makes before the press is made, on the database every first run meets: d1
	// answers the select with an error rather than with no rows, and drawing that as a cloudflare
	// nothing was found out from reports a first run as a broken one.
	held := &database{status: http.StatusBadRequest,
		body: `{"success":false,"errors":[{"code":7500,"message":"D1_ERROR: no such table: d1_migrations: SQLITE_ERROR"}]}`}
	server := held.serve(t)
	defer server.Close()

	read := Applied(context.Background(), cf.JSONSend(server.URL, nil), "an-account", "a-database")

	if read.Kind != cf.ResultValue {
		t.Fatalf("kind = %q (%s), want %q", read.Kind, read.Detail, cf.ResultValue)
	}
	if len(read.Value) != 0 {
		t.Errorf("applied = %v, want none", read.Value)
	}
}

func TestTheNamesADeployWouldApplyAreTheCarriedOnesTheDatabaseHasNot(t *testing.T) {
	// what a screen naming the one-way door reads: the comparison over filenames alone, with no
	// bundle fetched and nothing applied.
	pending := PendingNames(
		[]string{"0000_a.sql"},
		[]string{"0000_a.sql", "0001_b.sql", "0002_c.sql"},
	)
	if strings.Join(pending, ",") != "0001_b.sql,0002_c.sql" {
		t.Errorf("pending = %v, want the files the database has not", pending)
	}
}

func TestANameTheDatabaseHoldsAndTheReleaseDoesNotIsLeftAlone(t *testing.T) {
	// a deployment ahead of this binary: nothing here can apply or unapply that file, and naming it
	// as pending would offer a press that would not touch it.
	if pending := PendingNames([]string{"0000_a.sql", "0009_z.sql"}, []string{"0000_a.sql"}); len(pending) != 0 {
		t.Errorf("pending = %v, want nothing", pending)
	}
}

func TestTheNamesTheDatabaseHoldsAndThisBinaryDoesNotAreTheOnesItIsAheadBy(t *testing.T) {
	// the other half of the same comparison, and the one that says which of the two is behind: a
	// database recording a file this release does not carry was deployed from a newer console.
	ahead := AheadNames(
		[]string{"0000_a.sql", "0001_b.sql", "0002_c.sql"},
		[]string{"0000_a.sql"},
	)
	if strings.Join(ahead, ",") != "0001_b.sql,0002_c.sql" {
		t.Errorf("ahead = %v, want the files the database holds and this binary does not", ahead)
	}
}

func TestADatabaseHoldingNothingThisBinaryDoesNotCarryIsAheadByNothing(t *testing.T) {
	// a database behind this console reads as ahead by nothing, so the two answers can be weighed
	// against each other without either standing in for the other.
	ahead := AheadNames([]string{"0000_a.sql"}, []string{"0000_a.sql", "0001_b.sql"})
	if len(ahead) != 0 {
		t.Errorf("ahead = %v, want nothing", ahead)
	}
}

func TestAheadIsAListAndNeverNilSoAnAnswerCarryingItIsNeverJSONNull(t *testing.T) {
	// the answer this feeds is read in a browser, where a null is a `.length` on nothing.
	if ahead := AheadNames(nil, nil); ahead == nil {
		t.Error("ahead = nil, want an empty list")
	}
}
