package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

func TestHeldIsTheRecordWhereItIsThisDeploymentsAndStillOne(t *testing.T) {
	store := recorded(t, `{"workerName":"better-giving","origin":"https://x.workers.dev","token":"bg1.1800000000.`+random+`"}`)
	held := Held(store, "better-giving", time.Unix(1_700_000_000, 0))
	if held == nil {
		t.Fatal("a live session on this deployment was read as none")
	}
	if held.Origin != "https://x.workers.dev" || held.Token == "" {
		t.Fatalf("read %+v", held)
	}
}

func TestHeldIsNothingWhereTheRecordIsAnotherDeploymentsOrGone(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
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
		"a hexadecimal expiry":             "bg1.0x68a4c180." + random,
		"an expiry padded with a space":    "bg1. 1755600000." + random,
		"an expiry past what a date holds": "bg1.999999999999999999." + random,
	} {
		if _, ok := Parse(value); ok {
			t.Errorf("a token %s was read as one", what)
		}
	}
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
