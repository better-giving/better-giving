package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/state"
)

// a token far enough past the minimum random length to be one.
const random = "0123456789012345678901234567890123456789012"

func recorded(t *testing.T, body string) state.Store {
	t.Helper()
	dir := t.TempDir()
	if body != "" {
		if err := os.WriteFile(filepath.Join(dir, File), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return state.At(dir)
}

func TestParseReadsTheExpiryOutOfTheToken(t *testing.T) {
	at := time.Unix(1_800_000_000, 0)
	held, ok := Parse("bg1.1800000000." + random)
	if !ok {
		t.Fatal("a token in the grammar the deployment reads was refused")
	}
	if !held.Equal(at) {
		t.Fatalf("expiry %v, wanted %v", held, at)
	}
}

func TestParseRefusesAnythingElse(t *testing.T) {
	for _, value := range []string{
		"",
		"bg1.1800000000",
		"bg2.1800000000." + random,
		"bg1.later." + random,
		"bg1.1800000000.short",
	} {
		if _, ok := Parse(value); ok {
			t.Fatalf("%q was read as a token", value)
		}
	}
}

// the furthest expiry a deployment accepts is still one here, so the ceiling is no stricter.
func TestHeldIsTheRecordAtTheFurthestExpiryADeploymentAccepts(t *testing.T) {
	store := recorded(t, `{"workerName":"better-giving","origin":"https://x.workers.dev","token":"bg1.1800000000.`+random+`"}`)
	if Held(store, "better-giving", time.Unix(1_800_000_000-sessionSeconds-clockSkewSeconds, 0)) == nil {
		t.Error("a session ending at the furthest expiry a deployment accepts was read as none")
	}
}

// the deployment refuses only an expiry before its now, so a session ending at now is still one.
func TestHeldIsTheRecordAtTheInstantItEnds(t *testing.T) {
	store := recorded(t, `{"workerName":"better-giving","origin":"https://x.workers.dev","token":"bg1.1800000000.`+random+`"}`)
	if Held(store, "better-giving", time.Unix(1_800_000_000, 0)) == nil {
		t.Error("a session ending at now was read as none, where the deployment still accepts it")
	}
}

func TestHeldIsTheRecordWhereItIsThisDeploymentsAndStillOne(t *testing.T) {
	store := recorded(t, `{"workerName":"better-giving","origin":"https://x.workers.dev","token":"bg1.1800000000.`+random+`"}`)
	held := Held(store, "better-giving", time.Unix(1_800_000_000-60*60, 0))
	if held == nil {
		t.Fatal("a live session on this deployment was read as none")
	}
	if held.Origin != "https://x.workers.dev" || held.Token == "" {
		t.Fatalf("read %+v", held)
	}
}

func TestHeldIsNothingWhereTheRecordIsAnotherDeploymentsOrGone(t *testing.T) {
	now := time.Unix(1_800_000_000-60*60, 0)
	live := `{"workerName":"better-giving","origin":"https://x.workers.dev","token":"bg1.1800000000.` + random + `"}`

	if Held(recorded(t, ""), "better-giving", now) != nil {
		t.Error("a machine holding no record answered with a session")
	}
	if Held(recorded(t, "not json"), "better-giving", now) != nil {
		t.Error("a record that is not json answered with a session")
	}
	if Held(recorded(t, live), "another-worker", now) != nil {
		t.Error("a session minted for one deployment answered under another's name")
	}
	if Held(recorded(t, live), "better-giving", time.Unix(1_800_000_001, 0)) != nil {
		t.Error("a session past its expiry answered as one")
	}
	if Held(recorded(t, live), "better-giving", time.Unix(1_800_000_000, int64(time.Millisecond))) != nil {
		t.Error("a session a millisecond past its expiry answered as one, where the deployment refuses it")
	}
	if Held(recorded(t, live), "better-giving", time.Unix(1_800_000_000-sessionSeconds-clockSkewSeconds-1, 0)) != nil {
		t.Error("a session ending further out than a deployment accepts answered as one")
	}
	if Held(recorded(t, `{"workerName":"better-giving","origin":"","token":"bg1.1800000000.`+random+`"}`), "better-giving", now) != nil {
		t.Error("a record naming no origin answered with a session")
	}
}

// the vectors packages/operator's console token spec states, which is the statement both ends of
// the wire are written against. a value one end mints and the other refuses is the failure they
// exist to catch, so they are asserted here rather than restated.
func TestParseRefusesEveryValueTheDeploymentRefuses(t *testing.T) {
	for what, value := range map[string]string{
		"empty":                            "",
		"carrying no version prefix":       "1755600000." + random,
		"carrying another version":         "bg2.1755600000." + random,
		"one dot short":                    "bg1." + random,
		"one dot long":                     "bg1.1755600000." + random + ".extra",
		"a word":                           "test",
		"an empty random part":             "bg1.1755600000.",
		"a random part one short":          "bg1.1755600000." + random[:len(random)-1],
		"an empty expiry":                  "bg1.." + random,
		"an expiry that is not a number":   "bg1.soon." + random,
		"a signed expiry":                  "bg1.-1755600000." + random,
		"an expiry signed positive":        "bg1.+1755600000." + random,
		"an expiry of negative zero":       "bg1.-0." + random,
		"a hexadecimal expiry":             "bg1.0x68a4c180." + random,
		"an expiry padded with a space":    "bg1. 1755600000." + random,
		"an expiry past what a date holds": "bg1.999999999999999999." + random,
	} {
		if _, ok := Parse(value); ok {
			t.Errorf("a token %s was read as one", what)
		}
	}
}

// `/^\d+$/` takes leading zeros, so a deployment reads them as the same second.
func TestParseReadsAnExpiryWithLeadingZeros(t *testing.T) {
	held, ok := Parse("bg1.01800000000." + random)
	if !ok || !held.Equal(time.Unix(1_800_000_000, 0)) {
		t.Fatalf("an expiry with a leading zero read as %v, %v", held, ok)
	}
}

// the last whole second a javascript `Date` holds is the edge on both ends: a deployment reads the
// expiry into one, and a second past it is an Invalid Date it reads as no token at all.
func TestParseHoldsTheExpiryToTheLastSecondADateHolds(t *testing.T) {
	if _, ok := Parse("bg1.8640000000000." + random); !ok {
		t.Error("an expiry at the last second a date holds was refused")
	}
	if _, ok := Parse("bg1.8640000000001." + random); ok {
		t.Error("an expiry a second past what a date holds was read as one")
	}
}

// the session this binary mints, against the ceiling the deployment refuses past.
//
// a deployment refuses an expiry further out than CONSOLE_SESSION_SECONDS from its own clock, past
// a few minutes for skew, as `console_clock_ahead` — so a sessionSeconds longer than that constant
// spends the skew allowance on every connect, and past it is refused on every one.
func TestTheSessionIsNoLongerThanTheDeploymentAccepts(t *testing.T) {
	ceiling := statedProduct(t, filepath.Join("packages", "operator", "src", "console", "token.ts"),
		`export const CONSOLE_SESSION_SECONDS`)
	if sessionSeconds > ceiling {
		t.Errorf("this binary mints %d-second sessions and a deployment accepts %d", sessionSeconds, ceiling)
	}
}

// Held's ceiling is the deployment's to the second: looser holds a session the deployment refuses
// as `console_clock_ahead`, stricter drops one it still accepts.
func TestTheSkewIsTheOneTheDeploymentAllows(t *testing.T) {
	skew := statedProduct(t, filepath.Join("packages", "app", "src", "lib", "server", "console", "access.ts"),
		`const CONSOLE_CLOCK_SKEW_SECONDS`)
	if clockSkewSeconds != skew {
		t.Errorf("this binary allows %d seconds of skew and a deployment allows %d", clockSkewSeconds, skew)
	}
}

// statedProduct is the value `declaration = a * b * …;` states in a file under the repo root.
func statedProduct(t *testing.T, path, declaration string) int {
	t.Helper()
	root, err := release.RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, path))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(regexp.QuoteMeta(declaration) + `\s*=\s*([\d_ *]+);`).FindSubmatch(source)
	if match == nil {
		t.Fatalf("%s states no %s as a product of numbers", path, declaration)
	}
	product := 1
	for _, factor := range strings.Split(string(match[1]), "*") {
		value, err := strconv.Atoi(strings.ReplaceAll(strings.TrimSpace(factor), "_", ""))
		if err != nil {
			t.Fatalf("%s states %s as %q, which is not a product of numbers", path, declaration, match[1])
		}
		product *= value
	}
	return product
}

func TestMintEndsTheSessionTwelveHoursOut(t *testing.T) {
	now := time.Unix(1_755_600_000, 0)
	token, expiresAt, err := Mint(now)
	if err != nil {
		t.Fatal(err)
	}
	if want := now.Add(12 * time.Hour); !expiresAt.Equal(want) {
		t.Fatalf("session ends %v, wanted %v", expiresAt, want)
	}
	read, ok := Parse(token)
	if !ok {
		t.Fatal("a minted token was not read back as one")
	}
	// the expiry the deployment reads is the one this console holds: a mint keeping any part of a
	// second would hand the two halves values that differ and are still not equal.
	if !read.Equal(expiresAt) {
		t.Fatalf("the token carries %v and the mint answered %v", read, expiresAt)
	}
}

func TestMintSpellsTheSecretHalfInBase64URL(t *testing.T) {
	token, _, err := Mint(time.Unix(1_755_600_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	held := strings.Split(token, ".")[2]
	if len(held) < minRandom {
		t.Fatalf("the secret half is %d characters, under the %d a deployment reads", len(held), minRandom)
	}
	// the grammar splits on dots and the value rides a header: `+`, `/` and `=` are not it.
	for _, letter := range held {
		if !strings.ContainsRune(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", letter) {
			t.Fatalf("the secret half carries %q", letter)
		}
	}
}

func TestMintIsADifferentSecretEveryTime(t *testing.T) {
	now := time.Unix(1_755_600_000, 0)
	first, _, err := Mint(now)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := Mint(now)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("two mints against one clock made one credential")
	}
}

func TestRecordIsReadBackAsTheSessionThatWasWritten(t *testing.T) {
	store := recorded(t, "")
	token, expiresAt, err := Mint(time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := Record(store, Session{
		WorkerName: "better-giving",
		Token:      token,
		Origin:     "https://x.workers.dev",
		ExpiresAt:  expiresAt,
	}); err != nil {
		t.Fatal(err)
	}

	held := Held(store, "better-giving", time.Unix(1_700_000_001, 0))
	if held == nil {
		t.Fatal("what was just recorded was read back as no session")
	}
	if held.Token != token || held.Origin != "https://x.workers.dev" {
		t.Fatalf("read %+v", held)
	}
}

// the expiry is not written down: it is inside the token, and a second copy is a value that can
// disagree with the one the deployment reads.
func TestRecordWritesTheTokenAndWhereItWentAndNothingElse(t *testing.T) {
	store := recorded(t, "")
	token, expiresAt, err := Mint(time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := Record(store, Session{
		WorkerName: "better-giving",
		Token:      token,
		Origin:     "https://x.workers.dev",
		ExpiresAt:  expiresAt,
	}); err != nil {
		t.Fatal(err)
	}

	written, err := store.Read(File)
	if err != nil {
		t.Fatal(err)
	}
	var held map[string]any
	if err := json.Unmarshal(written, &held); err != nil {
		t.Fatal(err)
	}
	if len(held) != 3 {
		t.Fatalf("the record carries %v", held)
	}
	for _, name := range []string{"workerName", "origin", "token"} {
		if _, named := held[name]; !named {
			t.Errorf("the record names no %s", name)
		}
	}
}
