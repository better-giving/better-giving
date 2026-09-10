package terminal

import (
	"errors"
	"io"

	"github.com/charmbracelet/huh"

	"github.com/better-giving/console/internal/signin"
)

// which cloudflare account this deployment is in, taken off an operator at a terminal.
//
// **it is put to them even where there is one account to put.** every command past this runs under
// the account it names — the worker, the database, the widget and this console's own session are
// all in it — and a console that chose the only one on the list would have made that choice on
// their behalf. ../account states what the choice is and what it is not.
//
// **`start` puts it on every run, and this file is what makes that cost one keypress.** the account
// is remembered between runs and drawn on no other screen, so an operator holding a personal
// account and an organisation's had nothing telling them which of the two a deploy was about to
// write into — a question they never see cannot be answered wrong. the picker opens on the account
// this machine already operates (./opening), so keeping it is a return and changing it is the list
// they needed anyway.
//
// **it states the sign-in the rows were read off.** the list is cloudflare's answer to one
// credential, and a machine holding a browser sign-in and a token in its environment reaches two
// different lists — so which of them these rows came from is on the screen the choice is made on,
// and nowhere else in a run of `start` (./readFrom).
//
// **the row that signs this machine out is the caller's to offer.** a credential set in this
// console's environment is one ../oauth's Out refuses, so a picker drawn over one offers a row that
// could only fail; `login` offers none either, because it is the press that takes a sign-in rather
// than one standing between an operator and a deploy.
//
// **the id is checked and recorded by the caller, not here.** the order is the browser handler's
// (../server/account.go): the list is read off cloudflare, the account is picked from it,
// `account.Verify` finds out whether this sign-in may act inside it, and only then is it written
// down. this file is the middle step alone, so nothing here reaches cloudflare and nothing here
// remembers anything.

// Answered is how the account question ended.
//
// Three because the two that are not a choice are different acts: a picker the operator closed
// leaves this machine as it was found, and the sign-out row is a press they made.
type Answered string

const (
	// AccountChosen is a row picked off the list.
	AccountChosen Answered = "chosen"
	// PickerClosed is the picker closed, which is a choice not made rather than a failure to
	// report, and is also what a list nothing could be picked from answers with.
	PickerClosed Answered = "closed"
	// SigningOut is the row that gives up the cloudflare sign-in this machine holds.
	SigningOut Answered = "signing-out"
)

// Picker is what the account question is put with beside the sign-in it draws.
type Picker struct {
	// Remembered is the account this machine already operates, by id, and empty where it remembers
	// none. The picker opens on it.
	Remembered string
	// SignOut is whether the row that gives up this machine's sign-in is one of the endings.
	SignOut bool
}

// the value the sign-out row carries.
//
// no account can carry it: ../signin drops a row whose id is not a string it can be scoped to, and
// every id cloudflare answers with is hex. it is weighed in front of the list all the same
// (./picked), so the reading does not rest on that.
const signOutRow = "sign-out"

// ErrNoAccounts is a sign-in carrying no account to choose between, which is a prompt with nothing
// to put.
var ErrNoAccounts = errors.New("this Cloudflare sign-in is a member of no account")

// AskAccount takes which of the accounts `held` carries this deployment is in.
//
// PickerClosed with no error is the operator closing the prompt, as ./AskPassword's false is.
func AskAccount(
	in io.Reader,
	to io.Writer,
	held signin.SignIn,
	asked Picker,
) (signin.Account, Answered, error) {
	// weighed in front of the terminal check and not behind it: an empty list is not a question
	// that could not be put, it is no question at all.
	if len(held.Accounts) == 0 {
		return signin.Account{}, PickerClosed, ErrNoAccounts
	}
	if !attended(in, to) {
		return signin.Account{}, PickerClosed,
			noTerminal{"which Cloudflare account this deployment is in"}
	}
	clear(to)
	offered, opening := rows(held, asked)
	// the value the form is bound to is what it opens on, which is huh's own arrangement: the row
	// carrying it is the one under the cursor when the list is drawn.
	chosen := opening
	asking := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("which Cloudflare account this deployment is in").
			Description("everything this console makes is made inside it\n" + readFrom(held)).
			Options(offered...).
			Value(&chosen),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return signin.Account{}, PickerClosed, nil
	case err != nil:
		return signin.Account{}, PickerClosed, err
	}
	return picked(chosen, held.Accounts)
}

// the rows this picker draws, and the one it opens on.
func rows(held signin.SignIn, asked Picker) ([]huh.Option[string], string) {
	offered := labelled(held.Accounts)
	if asked.SignOut {
		offered = append(offered,
			huh.NewOption("sign this machine out of Cloudflare", signOutRow))
	}
	return offered, opening(held.Accounts, asked.Remembered)
}

// the row the cursor starts on: the account this machine remembers, where this sign-in still
// reaches it.
//
// the list is read off cloudflare on every run and the remembered id is this machine's own, so an
// account this sign-in has left since is a value no row carries — and a cursor bound to one would
// open the list on whatever huh falls back to rather than on a row the operator can read.
func opening(accounts []signin.Account, remembered string) string {
	for _, one := range accounts {
		if one.ID == remembered {
			return remembered
		}
	}
	if len(accounts) == 0 {
		return ""
	}
	return accounts[0].ID
}

// what the value the picker came back with is worth.
//
// the sign-out is weighed in front of the list rather than looked for in it: a row an account could
// spell would otherwise sign this machine out on the press that chose that account.
func picked(chosen string, accounts []signin.Account) (signin.Account, Answered, error) {
	if chosen == signOutRow {
		return signin.Account{}, SigningOut, nil
	}
	for _, one := range accounts {
		if one.ID == chosen {
			return one, AccountChosen, nil
		}
	}
	return signin.Account{}, PickerClosed, ErrNoAccounts
}

// which cloudflare sign-in these rows were read off, as a line under the question.
//
// a credential set in this console's environment is the sign-in every command here uses and no
// browser sign-in takes its place (../oauth's Credential), so the two are told apart rather than
// both called signed in. an email address cloudflare would not say is left off rather than left
// dangling, which is ./confirm.go's reading of the same absence.
func readFrom(held signin.SignIn) string {
	where := "read from the Cloudflare sign-in this machine holds"
	if held.Kind == signin.Token {
		where = "read from the Cloudflare credential set in this console's environment"
	}
	if held.Email != nil {
		return where + ", " + *held.Email
	}
	return where
}

// the accounts as rows to choose between, each labelled by the name it carries on cloudflare.
//
// **a name two of them share carries its id, and one that is its own does not.** cloudflare does
// not hold account names apart, and the id is the string an operator matches against the dashboard
// url they are already looking at — so it is drawn where it is the only thing telling two rows
// apart, and left off where it would be noise on the row that needs none. ../signin already reads
// an account with no name at all by its id, so those rows arrive here named.
func labelled(accounts []signin.Account) []huh.Option[string] {
	shared := map[string]int{}
	for _, one := range accounts {
		shared[one.Name]++
	}
	offered := make([]huh.Option[string], 0, len(accounts))
	for _, one := range accounts {
		label := one.Name
		if shared[one.Name] > 1 && label != one.ID {
			label += " (" + one.ID + ")"
		}
		offered = append(offered, huh.NewOption(label, one.ID))
	}
	return offered
}
