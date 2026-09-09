package account

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/better-giving/console/internal/state"
)

// which cloudflare account this deployment is in, as this machine remembers it.
//
// **an account id is not a credential.** it authorises nothing on its own and is the identifier
// already in every cloudflare dashboard url — so what is asserted below is the whole of the file
// rather than the two keys in it, and anything that does authorise something arriving beside them
// fails here.

func TestAMachineWithNothingChosenHasNothingToAnswerWith(t *testing.T) {
	store := New(state.At(t.TempDir()))
	if chosen := store.Chosen(); chosen != nil {
		t.Fatalf("a first run answered %+v", chosen)
	}
}

func TestAChoiceIsReadBackByTheNextRunOfTheConsole(t *testing.T) {
	dir := t.TempDir()
	if remembered := New(state.At(dir)).Choose(Account{ID: "an-account", Name: "hound-haven"}); !remembered {
		t.Fatal("a writable directory said the choice was not remembered")
	}

	chosen := New(state.At(dir)).Chosen()
	if chosen == nil {
		t.Fatal("the next run found nothing recorded")
	}
	if chosen.Account.ID != "an-account" || chosen.Account.Name != "hound-haven" || !chosen.Remembered {
		t.Fatalf("read back %+v", chosen)
	}
}

func TestTheRecordIsTheAccountAndNothingElse(t *testing.T) {
	dir := t.TempDir()
	New(state.At(dir)).Choose(Account{ID: "an-account", Name: "hound-haven"})

	written, err := os.ReadFile(filepath.Join(dir, "account.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != "{\n\t\"id\": \"an-account\",\n\t\"name\": \"hound-haven\"\n}\n" {
		t.Fatalf("the record holds %s", written)
	}
}

func TestAMachineThatCannotBeWrittenOnKeepsTheChoiceForThisRun(t *testing.T) {
	// a directory that cannot be made: the path names a file, so creating anything under it fails
	// the way a read-only home or a directory somebody else owns does.
	blocked := filepath.Join(t.TempDir(), "in-the-way")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := New(state.At(filepath.Join(blocked, "better-giving")))

	if store.Choose(Account{ID: "an-account", Name: "hound-haven"}) {
		t.Fatal("a directory that cannot be written said the choice was remembered")
	}
	chosen := store.Chosen()
	if chosen == nil || chosen.Account.ID != "an-account" {
		t.Fatalf("the operator was sent back to the picker: %+v", chosen)
	}
	if chosen.Remembered {
		t.Fatal("a choice nothing recorded was answered as remembered")
	}
}

func TestAClaimMadeInOneAccountIsNotAnsweredForAnother(t *testing.T) {
	dir := t.TempDir()
	claimed(t, dir, `{"accountId":"an-account","database":{"name":"donations","uuid":"a-uuid"},
		"widget":{"name":"a-widget","sitekey":"a-sitekey"}}`)
	store := New(state.At(dir))

	held := store.ClaimedIn("an-account")
	if held.Database == nil || held.Database.UUID != "a-uuid" {
		t.Fatalf("the claim in this account was not answered: %+v", held)
	}
	if held.Widget == nil || held.Widget.Sitekey != "a-sitekey" {
		t.Fatalf("the widget claim was not answered: %+v", held)
	}

	// connecting a different account carries no claim across: what was claimed was claimed in there.
	if other := store.ClaimedIn("another-account"); other.Database != nil || other.Widget != nil {
		t.Fatalf("a claim crossed accounts: %+v", other)
	}
}

func TestAClaimInAShapeNothingWasWrittenAgainstIsNotOne(t *testing.T) {
	dir := t.TempDir()
	claimed(t, dir, `{"accountId":"an-account","database":{"name":"donations"},"widget":7}`)

	held := New(state.At(dir)).ClaimedIn("an-account")
	if held.Database != nil || held.Widget != nil {
		t.Fatalf("a half-written claim was read as one: %+v", held)
	}
}

func TestAMachineWithNoClaimsFileHasClaimedNothing(t *testing.T) {
	held := New(state.At(t.TempDir())).ClaimedIn("an-account")
	if held.Database != nil || held.Widget != nil {
		t.Fatalf("a first run had claimed something: %+v", held)
	}
}

func claimed(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "claimed.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}
