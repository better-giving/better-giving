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
// **the id is checked and recorded by the caller, not here.** the order is the browser handler's
// (../server/account.go): the list is read off cloudflare, the account is picked from it,
// `account.Verify` finds out whether this sign-in may act inside it, and only then is it written
// down. this file is the middle step alone, so nothing here reaches cloudflare and nothing here
// remembers anything.

// ErrNoAccounts is a sign-in carrying no account to choose between, which is a prompt with nothing
// to put.
var ErrNoAccounts = errors.New("this cloudflare sign-in is a member of no account")

// AskAccount takes which of `accounts` this deployment is in.
//
// False with no error is the operator closing the prompt, as ./AskPassword's is.
func AskAccount(in io.Reader, to io.Writer, accounts []signin.Account) (signin.Account, bool, error) {
	// weighed in front of the terminal check and not behind it: an empty list is not a question
	// that could not be put, it is no question at all.
	if len(accounts) == 0 {
		return signin.Account{}, false, ErrNoAccounts
	}
	if !attended(in) {
		return signin.Account{}, false, ErrNoTerminal
	}
	clear(to)
	var chosen string
	asking := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("which cloudflare account this deployment is in").
			Description("everything this console makes is made inside it").
			Options(labelled(accounts)...).
			Value(&chosen),
	)).WithInput(in).WithOutput(to)

	switch err := asking.Run(); {
	case errors.Is(err, huh.ErrUserAborted):
		return signin.Account{}, false, nil
	case err != nil:
		return signin.Account{}, false, err
	}
	for _, one := range accounts {
		if one.ID == chosen {
			return one, true, nil
		}
	}
	return signin.Account{}, false, ErrNoAccounts
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
