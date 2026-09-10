package terminal

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/signin"
)

// a sign-in carrying two accounts, which is what every case below picks from.
func holding(accounts ...signin.Account) signin.SignIn {
	return signin.SignIn{Kind: signin.OAuth, Accounts: accounts}
}

var (
	acme  = signin.Account{ID: "a1", Name: "Acme Giving"}
	other = signin.Account{ID: "b2", Name: "Another Cause"}
)

func TestNoAccountIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	// the same refusal ./placement.go's is put behind, and for the same reason: a form drawn at a
	// pipe is one nothing is ever typed back into.
	picked, answered, err := AskAccount(
		strings.NewReader("\n"), io.Discard, holding(acme), Picker{})
	if answered == AccountChosen || picked.ID != "" {
		t.Errorf("AskAccount = %v, %v", picked, answered)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskAccount refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
}

func TestNoAccountIsAskedForWhereThisSignInIsAMemberOfNone(t *testing.T) {
	// a select with no rows in it is a form an operator cannot leave by choosing anything, so the
	// list is weighed in front of the prompt rather than drawn empty at them.
	_, answered, err := AskAccount(strings.NewReader("\n"), io.Discard, holding(), Picker{})
	if answered == AccountChosen {
		t.Error("AskAccount answered with an account off an empty list")
	}
	if !errors.Is(err, ErrNoAccounts) {
		t.Errorf("AskAccount met an empty list with %v, want %v", err, ErrNoAccounts)
	}
}

func TestTwoAccountsOfOneNameAreToldApartByTheirIDs(t *testing.T) {
	// the choice is irreversible in the sense that matters — every command after it runs under the
	// account it names — so two rows an operator cannot tell apart is the one thing this list may
	// not draw.
	offered := labelled([]signin.Account{
		{ID: "a1", Name: "Cause"},
		{ID: "b2", Name: "Cause"},
		{ID: "c3", Name: "Another"},
	})
	labels := map[string]bool{}
	for _, one := range offered {
		if labels[one.Key] {
			t.Errorf("two accounts are both offered as %q", one.Key)
		}
		labels[one.Key] = true
	}
	if labels["Another"] != true {
		t.Errorf("an account whose name is its own is offered as something else: %v", labels)
	}
}

// which row the picker opens on, which is what makes the common answer one keypress.
//
// `start` puts this question on every run, so the account this machine already operates has to be
// the row under the cursor: an operator who meant to keep it presses return, and one who did not is
// looking at the list they need.

func TestThePickerOpensOnTheAccountThisMachineRemembers(t *testing.T) {
	_, opening := rows(holding(acme, other), Picker{Remembered: other.ID})

	if opening != other.ID {
		t.Errorf("the picker opens on %q, want the account this machine operates", opening)
	}
}

func TestAPickerRememberingNothingOpensOnTheFirstRow(t *testing.T) {
	_, opening := rows(holding(acme, other), Picker{})

	if opening != acme.ID {
		t.Errorf("the picker opens on %q, want the first account on the list", opening)
	}
}

func TestAnAccountThisSignInNoLongerReachesOpensOnTheFirstRow(t *testing.T) {
	// the list is read off cloudflare every time and the remembered id is this machine's own, so an
	// account left since the last run is a value no row carries.
	_, opening := rows(holding(acme, other), Picker{Remembered: "gone"})

	if opening != acme.ID {
		t.Errorf("the picker opens on %q, want a row that is on the list", opening)
	}
}

// the row that signs this machine out, which `start` offers and `login` does not.

func TestTheSignOutRowIsDrawnOnlyWhereItIsOffered(t *testing.T) {
	offered, _ := rows(holding(acme), Picker{SignOut: true})
	if len(offered) != 2 {
		t.Fatalf("the picker drew %d rows, want the account and the sign-out", len(offered))
	}
	if _, answered, _ := picked(offered[1].Value, []signin.Account{acme}); answered != SigningOut {
		t.Errorf("the last row answered %q, want the sign-out", answered)
	}

	plain, _ := rows(holding(acme), Picker{})
	if len(plain) != 1 {
		t.Errorf("a picker offered no sign-out drew %d rows, want the account alone", len(plain))
	}
}

func TestTheSignOutRowCarriesAValueNoAccountCan(t *testing.T) {
	// the answer is read off one string, so the sign-out is weighed in front of the list rather
	// than looked for in it: an account whose id spelled that row would otherwise sign this machine
	// out of cloudflare on the press that chose it.
	_, answered, err := picked(signOutRow, []signin.Account{{ID: signOutRow, Name: "impossible"}})
	if answered != SigningOut || err != nil {
		t.Errorf("picked = %q, %v, want the sign-out weighed in front of the list", answered, err)
	}
}

func TestAnAccountPickedIsTheOneTheRowNamed(t *testing.T) {
	one, answered, err := picked(other.ID, []signin.Account{acme, other})

	if err != nil || answered != AccountChosen {
		t.Fatalf("picked = %q, %v, want the account chosen", answered, err)
	}
	if one != other {
		t.Errorf("picked %v, want %v", one, other)
	}
}

func TestARowNamingNoAccountAtAllIsNoChoice(t *testing.T) {
	_, answered, err := picked("gone", []signin.Account{acme})

	if answered == AccountChosen {
		t.Error("a value no row carries was read as an account")
	}
	if !errors.Is(err, ErrNoAccounts) {
		t.Errorf("picked answered %v, want %v", err, ErrNoAccounts)
	}
}

// which sign-in the list came from, stated on the screen the choice is made on.
//
// the picker is drawn on every run of `start` now, so it is the one screen that can say whose
// cloudflare access these rows were read with — and an operator holding a browser sign-in and a
// token in their environment cannot tell the two lists apart otherwise.

func TestThePickerStatesTheSignInItReadTheListFrom(t *testing.T) {
	address := "jane@acme.test"
	said := readFrom(signin.SignIn{Kind: signin.OAuth, Email: &address})

	if !strings.Contains(said, address) {
		t.Errorf("said %q, want the address the sign-in belongs to", said)
	}
}

func TestACredentialFromTheEnvironmentIsSaidAsOne(t *testing.T) {
	// a token set in this console's environment is the sign-in every command here uses, and it is
	// not the one a browser took: an operator reading "signed in" over rows read with it would be
	// looking at the wrong identity.
	said := readFrom(signin.SignIn{Kind: signin.Token})

	if !strings.Contains(said, "environment") {
		t.Errorf("said %q, want a credential from the environment said as one", said)
	}
}

func TestASignInCloudflareWouldNotNameIsStillSaidAsOne(t *testing.T) {
	said := readFrom(signin.SignIn{Kind: signin.OAuth})

	if said == "" {
		t.Error("a sign-in carrying no address says nothing at all about where the list came from")
	}
	if strings.HasSuffix(said, ", ") {
		t.Errorf("said %q, want no sentence ending on the space before a missing value", said)
	}
}
