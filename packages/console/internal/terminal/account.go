package terminal

import (
	"errors"
	"io"

	"github.com/charmbracelet/huh"

	"github.com/better-giving/console/internal/release"
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
// **the two acts sit under the accounts on the same list, and the arrow keys reach them.** an
// operator meets this screen on every run of `start`, and the two things they may want that are not
// an account — giving up the sign-in, and leaving without choosing one — are rows rather than a
// keystroke to guess at. huh's select draws no row that cannot be chosen, so what sets the acts off
// from the accounts is their own words: an account row is a name, and an act row says what it does
// (./rows).
//
// **an account already holding this deployment is marked on its row, and no row ever says one is
// not there.** the reads that mark it are the caller's and this file makes none — nothing here
// reaches cloudflare — so what arrives is ./Picker's Deployed, and an account missing from it is one
// nothing was found out about rather than one with no deployment on it (./labelled).
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
	// report. It is also what a list nothing could be picked from answers with, and what the row
	// that leaves without choosing an account answers with: an operator who chose to end the run
	// and one who closed the prompt have both made the same press, which is none.
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
	// Deployed is the accounts, by id, a read found this deployment in. An id this list does not
	// name is one nothing was found out about: a read that said the deployment is not there, one
	// cloudflare refused, and one that never landed are all absent from it alike, which is what
	// ./labelled's mark rests on. The reads are the caller's (../effects' EachAddress).
	Deployed []string
}

// the values the two act rows carry.
//
// no account can carry either: ../signin drops a row whose id is not a string it can be scoped to,
// and every id cloudflare answers with is hex. they are weighed in front of the list all the same
// (./picked), so the reading does not rest on that.
const (
	signOutRow = "sign-out"
	exitRow    = "exit"
)

// LookingForDeployments is what stands over the reads that mark ./Picker's Deployed rows, drawn by
// the caller while it makes them (./waiting.go).
//
// **it says what is being looked for and where.** the reads are one per account and take the
// seconds a round trip takes, and an operator watching a terminal say nothing through them is
// watching a console that has hung. the worker is named as this binary was baked to name it
// (../release), which is the name the mark on the row uses and the name on the cloudflare dashboard
// they would go looking at.
func LookingForDeployments() string {
	return "looking for " + release.Baked.Name + " on each of your Cloudflare accounts"
}

// ReadingTheDeployment is what stands over the reads a run makes once an account has been picked,
// drawn by the caller while it makes them (./waiting.go).
//
// **it is the same silence one screen later, and one wait rather than one per read.** the address
// the picker did not land, which release the deployment is on and what a deploy would apply are
// three round trips with nothing between them, and the screen that follows erases the terminal
// before it draws (./confirm.go) — so an operator who has just chosen an account watches a cursor
// blink until it does. three lines flickering past would be worse than one that holds, so the
// caller draws this once over all of them (../../cmd/better-giving/start.go's readingAhead).
//
// **it names no account.** the picker was the last screen and the account was the press that left
// it, so which one this is about is the one thing the operator already knows.
func ReadingTheDeployment() string {
	return "reading the deployment on this account"
}

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
	// the sign-in is a line of its own above the question rather than a clause under it: it is one
	// fact about this machine, and the question below it is about the rows.
	above(to, readFrom(held))
	offered, opening := rows(held, asked)
	// the value the form is bound to is what it opens on, which is huh's own arrangement: the row
	// carrying it is the one under the cursor when the list is drawn.
	chosen := opening
	asking := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("choose an account to go on with").
			Description("everything this console makes is made inside it").
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
//
// the acts go under the accounts in the order an operator reaches for them: the sign-out is about
// this machine's cloudflare access and the way out is about this question, and only the second of
// them is on every drawing.
//
// **the way out names the question and not what the caller does about it**, because both presses
// that draw this picker leave it differently: `start` says nothing was created and nothing was
// deployed and `login` records no account, and each of them says its own words on the way out
// (../../cmd/better-giving/start.go's closed).
func rows(held signin.SignIn, asked Picker) ([]huh.Option[string], string) {
	offered := labelled(held.Accounts, asked.Deployed)
	if asked.SignOut {
		offered = append(offered,
			huh.NewOption("sign this machine out of Cloudflare", signOutRow))
	}
	offered = append(offered, huh.NewOption("leave without choosing an account", exitRow))
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
// the two acts are weighed in front of the list rather than looked for in it: a row an account
// could spell would otherwise sign this machine out on the press that chose that account.
//
// the way out answers with the picker closed and no error, because that is the same ending: a press
// not made, which the caller ends the run on quietly (../../cmd/better-giving/start.go's closed).
func picked(chosen string, accounts []signin.Account) (signin.Account, Answered, error) {
	switch chosen {
	case signOutRow:
		return signin.Account{}, SigningOut, nil
	case exitRow:
		return signin.Account{}, PickerClosed, nil
	}
	for _, one := range accounts {
		if one.ID == chosen {
			return one, AccountChosen, nil
		}
	}
	return signin.Account{}, PickerClosed, ErrNoAccounts
}

// which cloudflare sign-in these rows were read off, as the line above the question.
//
// a credential set in this console's environment is the sign-in every command here uses and no
// browser sign-in takes its place (../oauth's Credential), so the two are told apart rather than
// both called signed in. an email address cloudflare would not say is left off rather than left
// dangling, which is ./confirm.go's reading of the same absence.
func readFrom(held signin.SignIn) string {
	where := "signed in to Cloudflare"
	if held.Kind == signin.Token {
		where = "using the Cloudflare credential set in this console's environment"
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
//
// **a row this deployment was found on says so, and a row it was not found on says nothing.** an
// operator whose machine has operated two accounts is answering off the name alone otherwise, and
// the account already holding the deployment is the one fact that settles it. `deployed` names only
// the accounts a read landed on and found it in (./Picker), so an unmarked row is this console
// making no claim rather than one saying there is no deployment there — which is the whole of what
// makes the mark safe to draw.
func labelled(accounts []signin.Account, deployed []string) []huh.Option[string] {
	shared := map[string]int{}
	for _, one := range accounts {
		shared[one.Name]++
	}
	found := map[string]bool{}
	for _, id := range deployed {
		found[id] = true
	}
	offered := make([]huh.Option[string], 0, len(accounts))
	for _, one := range accounts {
		label := one.Name
		if shared[one.Name] > 1 && label != one.ID {
			label += " (" + one.ID + ")"
		}
		if found[one.ID] {
			// the worker as this binary was baked to name it (../release), because that is the name
			// on the cloudflare dashboard the operator would go looking at.
			label += "  (" + release.Baked.Name + " is deployed here)"
		}
		offered = append(offered, huh.NewOption(label, one.ID))
	}
	return offered
}
