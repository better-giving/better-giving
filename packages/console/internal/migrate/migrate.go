// Package migrate is this repository's migrations applied to a live d1 database over its query
// endpoint, with no wrangler on the machine that presses the button.
//
// **the whole of a file goes up as one `sql` string, and the row that records it goes with it.**
// d1's query endpoint takes a multi-statement string and answers with one result per statement, so
// nothing here splits a file, parses a `--> statement-breakpoint` or reads a statement's shape —
// wrangler's own concatenation, file then `INSERT INTO d1_migrations`, travels verbatim. a row
// cannot land without the file it records, which is what a resumed run rests on.
//
// **every run re-reads the table first, and a file is recorded the moment it lands.** the pair is
// what makes a run that died between files resume rather than repeat: what a second press applies
// is what the first one did not, and nothing it did. the table itself is created if it is not
// there, with the statement wrangler uses — a table of another shape under that name is a
// deployment whose applied list `wrangler d1 migrations list` cannot read.
//
// **a file that failed part way through is the one state a rerun does not settle.** the statements
// in front of the one that failed are committed and the row that would record the file is not, so
// the next press sends the whole file again and dies on the first `CREATE TABLE` it repeats —
// nothing here makes one conditional. what a failure carries is the file and which statement of it
// stopped, because fixing that database is a hand at the console rather than another press.
//
// **nothing rolls back and nothing is retried.** the query endpoint has no transaction to reach for
// and a file is one request, so what it committed stays committed — and the migration is behind
// CLAUDE.md's one-way door either way. so a failure names the file the database stopped on and the
// run ends there, rather than carrying on into files written against a schema that was not
// reached.
//
// every failure is a value, the way ../cf's are: nothing here returns an error, and an error handed
// up to a handler would be a 500 in place of the state that explains it.
package migrate

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// BootstrapSQL is the bookkeeping table, in the statement wrangler creates it with.
//
// Verbatim from `getCreateMigrationsTableQuery` in the wrangler version packages/app pins, its
// identifier quoting and its column order included: a table of another shape under this name is one
// wrangler's own `d1 migrations list` reads differently from this binary, and CLAUDE.md refuses a
// rename of an applied migration on the same ground — the filename in it is the record.
const BootstrapSQL = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`

// the bookkeeping table's own name, which is wrangler's DEFAULT_MIGRATION_TABLE.
const migrationsTable = "d1_migrations"

// the applied list, read in the order the rows were written.
const appliedSQL = `SELECT name FROM "d1_migrations" ORDER BY id;`

// File is one migration the bundle carries.
type File struct {
	// Name is the filename, which is what the database records and what a rerun compares against.
	Name string
	SQL  string
}

// Kind is how one run of the migrations ended.
type Kind string

const (
	// Landed is every pending file applied and recorded, which includes a database that had them
	// all already.
	Landed Kind = "landed"
	// Failed is the database turning one file down, and At names it.
	Failed Kind = "failed"
	// Refused is cloudflare turning this credential down for this account.
	Refused Kind = "refused"
	// Missing is no database of that id, which is every run before one has been made.
	Missing Kind = "missing"
	// Unreachable is nothing found out either way: no route to cloudflare, or it took too long.
	Unreachable Kind = "unreachable"
	// Unreadable is an answer in a shape nothing here was written against.
	Unreadable Kind = "unreadable"
	// Cancelled is the operator no longer waiting, and Applied is what had landed by then.
	Cancelled Kind = "cancelled"
)

// Result is how one run went, and what it left on the database whichever way it went.
type Result struct {
	Kind Kind
	// Applied is every file this run landed, in order, and is what has been recorded whatever the
	// kind — the one-way door is behind each of them.
	Applied []string
	// At is the file the run stopped on, and is empty where it did not stop on one.
	At     string
	Detail string
}

// Apply is every pending file applied to one database, each recorded as it lands.
//
// `saw` is called with each filename the moment its row is written, so that a screen can say where
// a run has got to; it is called on the goroutine the run is on, and a call that blocks holds the
// run up.
//
// **the total is stated before the first file lands, and that is what `at` and `of` are for.** the
// list is not known until the database's own has been read, and a screen drawing a bar over the
// one-way door cannot count towards a number nobody has told it — so a run with anything pending
// says `0` of the total with no name, then one call per file as each lands. A run with nothing
// pending says nothing at all: there is no door to draw.
func Apply(ctx context.Context, send cf.Send, account, database string, carried []File, saw func(name string, at, of int)) Result {
	path := "/accounts/" + account + "/d1/database/" + database + "/query"

	// before the read rather than after it: the table has to exist for the list to be readable, and
	// the statement makes nothing where it is already there.
	if failure, stopped := query(ctx, send, path, "", BootstrapSQL); stopped {
		return Result{Kind: failure.Kind, Detail: failure.Detail}
	}
	read := Applied(ctx, send, account, database)
	if read.Kind != cf.ResultValue {
		return Result{Kind: from(read.Kind), Detail: read.Detail}
	}

	result := Result{Kind: Landed, Applied: []string{}}
	pending := Pending(read.Value, carried)
	if saw != nil && len(pending) > 0 {
		saw("", 0, len(pending))
	}
	for at, file := range pending {
		// between files rather than inside one: a run stopped part way through a file is a file
		// half applied with no row to say so, and the request is what the context would cut.
		if ctx.Err() != nil {
			result.Kind = Cancelled
			result.Detail = ctx.Err().Error()
			return result
		}
		if failure, stopped := query(ctx, send, path, file.Name, recorded(file)); stopped {
			result.Kind = failure.Kind
			result.At = file.Name
			result.Detail = failure.Detail
			return result
		}
		result.Applied = append(result.Applied, file.Name)
		if saw != nil {
			saw(file.Name, at+1, len(pending))
		}
	}
	return result
}

// Applied is every migration the database's own table records, in the order they were applied.
//
// A database with no such table has applied nothing, which is what every run before the first one
// reads. d1 answers that select with an error rather than with no rows, so the two are told apart
// here: a read that reported it as a cloudflare nothing was found out from would draw an ordinary
// first run as a broken one, beside a press offering to apply nothing.
func Applied(ctx context.Context, send cf.Send, account, database string) cf.Result[[]string] {
	answer := send(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+database+"/query",
		map[string]string{"sql": appliedSQL})
	if answer.Kind == cf.Answered && missingTable(cf.Said(answer)) {
		return cf.Result[[]string]{Kind: cf.ResultValue, Value: []string{}}
	}
	return cf.ReadShaped(answer, func(value any) ([]string, bool) {
		statements, ok := value.([]any)
		if !ok || len(statements) == 0 {
			return nil, false
		}
		first, ok := statements[0].(map[string]any)
		if !ok {
			return nil, false
		}
		rows, ok := first["results"].([]any)
		if !ok {
			return nil, false
		}
		names := []string{}
		for _, row := range rows {
			named, ok := row.(map[string]any)
			if !ok {
				return nil, false
			}
			name, ok := named["name"].(string)
			if !ok {
				return nil, false
			}
			names = append(names, name)
		}
		return names, true
	})
}

// Pending is every carried file the database has not applied, in the order they are applied in.
//
// A name the database holds and the bundle does not carry is left alone: it is a deployment ahead of
// this binary, and nothing here can apply or unapply it.
func Pending(applied []string, carried []File) []File {
	held := holding(applied)
	pending := []File{}
	for _, file := range carried {
		if !held[file.Name] {
			pending = append(pending, file)
		}
	}
	return pending
}

// PendingNames is that same comparison over filenames alone.
//
// What a screen naming the one-way door before a press reads: the list a deploy would apply is a
// question about names, so answering it fetches no bundle and applies nothing.
func PendingNames(applied, carried []string) []string {
	held := holding(applied)
	names := []string{}
	for _, name := range carried {
		if !held[name] {
			names = append(names, name)
		}
	}
	return names
}

// AheadNames is that comparison the other way round: every name the database records that this
// binary does not carry, in the order the database applied them.
//
// **it is what says which of the two is behind, and ./PendingNames cannot say it.** a file this
// release does not carry was applied by a newer console, so a deployment holding one is running
// code this binary is older than — and a console offering to deploy over it would carry the app
// backwards while leaving that file's schema in place. the two answers are read together: pending
// alone is a deployment behind this console, and either list may be non-empty on its own.
func AheadNames(applied, carried []string) []string {
	held := holding(carried)
	names := []string{}
	for _, name := range applied {
		if !held[name] {
			names = append(names, name)
		}
	}
	return names
}

// the names a database already has, as a set.
func holding(applied []string) map[string]bool {
	held := map[string]bool{}
	for _, name := range applied {
		held[name] = true
	}
	return held
}

// one file and the row that records it, as one statement string.
func recorded(file File) string {
	name := strings.ReplaceAll(file.Name, "'", "''")
	return file.SQL + "\nINSERT INTO \"d1_migrations\" (name)\nvalues ('" + name + "');"
}

// one statement string sent to the database, and whether it is a reason to stop.
//
// `file` is the migration the string is of, which a failure names beside the statement of it that
// stopped: the file has to be repaired by hand from there, because the statements in front of the
// one that failed are committed and no row records the file.
func query(ctx context.Context, send cf.Send, path, file, sql string) (Result, bool) {
	answer := send(ctx, http.MethodPost, path, map[string]string{"sql": sql})
	if answer.Kind == cf.Unreachable {
		// a request cut by the operator's own cancellation reaches nothing in exactly the way a
		// cloudflare with no route to it does, and the two are not the same sentence.
		if ctx.Err() != nil {
			return Result{Kind: Cancelled, Detail: ctx.Err().Error()}, true
		}
		return Result{Kind: Unreachable, Detail: answer.Detail}, true
	}
	read := cf.ReadResult(answer)
	switch read.Kind {
	case cf.ResultValue:
		if at, said := refusedStatement(read.Value); at != 0 {
			return Result{Kind: Failed, Detail: inFile(file) + "statement " + strconv.Itoa(at) + ": " + said}, true
		}
		return Result{}, false
	case cf.ResultRefused:
		return Result{Kind: Refused, Detail: read.Detail}, true
	case cf.ResultMissing:
		return Result{Kind: Missing, Detail: cf.Said(answer)}, true
	}
	// cloudflare answered and turned the statement down, which is the sql failing rather than the
	// account being unreachable — ../cf sorts both into one kind because every other read of that
	// api has nothing else to say about a status it did not expect.
	if answer.Status < 200 || answer.Status > 299 {
		return Result{Kind: Failed, Detail: inFile(file) + cf.Said(answer)}, true
	}
	return Result{Kind: Unreadable, Detail: cf.Said(answer)}, true
}

// the first statement of a file the database did not run, counted from one, and what it said about
// it — or zero where every statement ran.
//
// **the endpoint answers one result per statement and a statement that failed is a `success` of
// false on its own entry, inside a 2xx.** a run reading the status alone records the file as landed
// and hands the upload a schema that was never created, which is the worker replaced over a
// database that cannot serve it. wrangler reads this same field.
func refusedStatement(value any) (int, string) {
	statements, ok := value.([]any)
	if !ok {
		return 0, ""
	}
	for at, one := range statements {
		entry, ok := one.(map[string]any)
		if !ok {
			continue
		}
		if ran, says := entry["success"].(bool); says && !ran {
			said, _ := entry["error"].(string)
			if said == "" {
				said = "the database would not run it"
			}
			return at + 1, said
		}
	}
	return 0, ""
}

// the file a failure is in, where the string sent was one file's own.
func inFile(file string) string {
	if file == "" {
		return ""
	}
	return file + ", "
}

// whether what the database said is the bookkeeping table not being there yet.
func missingTable(said string) bool {
	return strings.Contains(said, "no such table") && strings.Contains(said, migrationsTable)
}

// the kind a read of the applied list ended in, in this package's own words.
func from(kind cf.ResultKind) Kind {
	switch kind {
	case cf.ResultRefused:
		return Refused
	case cf.ResultMissing:
		return Missing
	case cf.ResultUnreadable:
		return Unreadable
	default:
		return Unreachable
	}
}
