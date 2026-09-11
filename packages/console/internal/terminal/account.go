package terminal

import (
	"errors"
	"io"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
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
// **the two acts are drawn off the list, and one cursor still runs through all three.** an operator
// meets this screen on every run of `start`, and the two things they may want that are not an
// account — giving up the sign-in, and leaving without choosing one — are presses rather than
// keystrokes to guess at. neither is a row of the accounts: a list an operator reads as the
// accounts they hold is one a row saying "sign this machine out" makes a liar of, and the sign-out
// is not a kind of account. so the accounts are drawn as their own block, the sign-out stands above
// it and the way out below it, and the arrows run through the three in the order an operator
// reaches for them (./chooser).
//
// **it is this package's own drawing and not a form.** a form draws its own title first and puts no
// row above it, and the act that gives up the sign-in belongs above the question rather than under
// the accounts — so this screen is a bubbletea model, as ./ledger.go and ./waiting.go are, dressed
// from the styles every other prompt of the same run is drawn in (./dressing).
//
// **an account already holding this deployment is marked on its row, and no row ever says one is
// not there.** the reads that mark it are the caller's and this file makes none — nothing here
// reaches cloudflare — so what arrives is ./Picker's Deployed, and an account missing from it is one
// nothing was found out about rather than one with no deployment on it (./labelled).
//
// **the act that signs this machine out is the caller's to offer.** a credential set in this
// console's environment is one ../oauth's Out refuses, so a picker drawn over one offers a press
// that could only fail; `login` offers none either, because it is the press that takes a sign-in
// rather than one standing between an operator and a deploy.
//
// **the id is checked and recorded by the caller, not here.** the order is the browser handler's
// (../server/account.go): the list is read off cloudflare, the account is picked from it,
// `account.Verify` finds out whether this sign-in may act inside it, and only then is it written
// down. this file is the middle step alone, so nothing here reaches cloudflare and nothing here
// remembers anything.

// Answered is how the account question ended.
//
// Three because the two that are not a choice are different acts: a picker the operator closed
// leaves this machine as it was found, and the sign-out is a press they made.
type Answered string

const (
	// AccountChosen is a row picked off the list.
	AccountChosen Answered = "chosen"
	// PickerClosed is the picker closed, which is a choice not made rather than a failure to
	// report. It is also what a list nothing could be picked from answers with, and what the act
	// that leaves without choosing an account answers with: an operator who chose to end the run
	// and one who closed the screen have both made the same press, which is none.
	PickerClosed Answered = "closed"
	// SigningOut is the act that gives up the cloudflare sign-in this machine holds.
	SigningOut Answered = "signing-out"
)

// Picker is what the account question is put with beside the sign-in it draws.
type Picker struct {
	// Remembered is the account this machine already operates, by id, and empty where it remembers
	// none. The picker opens on it.
	Remembered string
	// SignOut is whether the act that gives up this machine's sign-in is one of the endings.
	SignOut bool
	// Deployed is the accounts, by id, a read found this deployment in. An id this list does not
	// name is one nothing was found out about: a read that said the deployment is not there, one
	// cloudflare refused, and one that never landed are all absent from it alike, which is what
	// ./labelled's mark rests on. The reads are the caller's (../effects' EachAddress).
	Deployed []string
}

// the values the two acts carry.
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
// caller draws this once over all of them (../../cmd/better-giving/start.go's waitingOver).
//
// **it names no account.** the picker was the last screen and the account was the press that left
// it, so which one this is about is the one thing the operator already knows.
func ReadingTheDeployment() string {
	return "reading the deployment on this account"
}

// ReadingTheAccount is what stands over the read a run makes where the picker found no deployment
// on the account it was left on, drawn by the caller while it makes it (./waiting.go).
//
// **it is about the account and never about a deployment, which is the whole reason it is not
// ./ReadingTheDeployment.** the row the operator pressed said this account holds none, so a wait
// claiming to read one is about something they have just been told is not there. what is read is
// the workers.dev name the account answers under, which is where a deployment on it would answer
// (../../cmd/better-giving/start.go's aboutToMake).
func ReadingTheAccount() string {
	return "reading where a deployment on this account would answer"
}

// ErrNoAccounts is a sign-in carrying no account to choose between, which is a prompt with nothing
// to put.
var ErrNoAccounts = errors.New("this Cloudflare sign-in is a member of no account")

// AskAccount takes which of the accounts `held` carries this deployment is in.
//
// PickerClosed with no error is the operator closing the picker, as ./AskPassword's false is.
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
	// the sign-in is a line of its own above the screen rather than a clause under the question: it
	// is one fact about this machine, and what is below it is about the rows.
	above(to, readFrom(held))

	drawn, err := tea.NewProgram(
		choosing(held, asked), tea.WithInput(in), tea.WithOutput(to)).Run()
	switch {
	case errors.Is(err, tea.ErrInterrupted):
		return signin.Account{}, PickerClosed, nil
	case err != nil:
		return signin.Account{}, PickerClosed, err
	}
	answered, ours := drawn.(chooser)
	// a screen the operator left carries no answer at all, and that is the ending a closed picker
	// has always had: a press not made, which the caller ends the run on quietly.
	if !ours || answered.left {
		return signin.Account{}, PickerClosed, nil
	}
	return picked(answered.answer, held.Accounts)
}

// a row the cursor can rest on: an account, or one of the two acts.
type choice struct {
	// said is the row as it is drawn, mark and all.
	said string
	// value is what picking it answers with: an account's id, or one of the two act values.
	value string
	// named is the row's words with no mark on them, which is what the filter reads. the mark
	// carries the tone its check is drawn in, and a filter read against that would be matched
	// against escape codes rather than against a name (./matching).
	named string
}

// the model this screen is drawn from: the accounts, whether the sign-out is offered, where the
// cursor is resting, and what the operator left with.
type chooser struct {
	// accounts is every account as a row, in the order cloudflare answered with, whether or not the
	// filter is leaving it standing.
	accounts []choice
	signOut  bool
	// at is where the cursor is on ./ring, which is the accounts with the acts around them.
	at int
	// filter is what an operator has typed to narrow the accounts, and filtering is whether they
	// are typing it. the acts are never filtered away (./ring).
	filter    textinput.Model
	filtering bool
	// answer is the value the row they pressed return on carries, and empty until they do.
	answer string
	// left is the screen given up rather than answered, which is the ending a closed picker has.
	left bool
}

// the model the screen opens on: the accounts labelled, and the cursor on the one this machine
// already operates.
func choosing(held signin.SignIn, asked Picker) chooser {
	filter := textinput.New()
	filter.Prompt = "/"
	drawn := chooser{
		accounts: labelled(held.Accounts, asked.Deployed),
		signOut:  asked.SignOut,
		filter:   filter,
	}
	// the cursor opens on an account and never on an act: one of them gives up the sign-in and the
	// other ends the run, and neither is a thing an operator meets by pressing return at a screen
	// they have just opened.
	drawn.at = drawn.accountsFrom()
	opens := opening(held.Accounts, asked.Remembered)
	for at, one := range drawn.accounts {
		if one.value == opens {
			drawn.at = drawn.accountsFrom() + at
			break
		}
	}
	return drawn
}

// where the accounts start on ./ring, which is under the sign-out where that is offered.
func (drawn chooser) accountsFrom() int {
	if drawn.signOut {
		return 1
	}
	return 0
}

// the ring the cursor runs around: the sign-out where it is offered, the accounts the filter left
// standing, and the way out.
//
// **the acts are on it whatever the filter says.** they are not accounts and a filter is about
// accounts, so a screen that filtered them away would leave an operator who typed three letters
// with no way out but the interrupt.
func (drawn chooser) ring() []choice {
	held := make([]choice, 0, len(drawn.accounts)+2)
	if drawn.signOut {
		held = append(held, choice{said: signOutSaid, value: signOutRow, named: signOutSaid})
	}
	held = append(held, drawn.matching()...)
	return append(held, choice{said: exitSaid, value: exitRow, named: exitSaid})
}

// the accounts the filter leaves standing, which is all of them where nothing is typed.
func (drawn chooser) matching() []choice {
	typed := strings.ToLower(strings.TrimSpace(drawn.filter.Value()))
	if typed == "" {
		return drawn.accounts
	}
	held := make([]choice, 0, len(drawn.accounts))
	for _, one := range drawn.accounts {
		if strings.Contains(strings.ToLower(one.named), typed) {
			held = append(held, one)
		}
	}
	return held
}

func (drawn chooser) Init() tea.Cmd { return textinput.Blink }

// one keystroke.
//
// **the arrows and the return are read in front of the filter, and the letters fall through to
// it.** a screen where `j` moved the cursor while an account was being typed would be one an
// operator cannot type the name of an account into, and one where the arrows did not move while a
// filter is on would strand them in it.
//
// **an escape drops the filter where there is one and gives the screen up where there is not.**
// what an operator means by it is the last thing they did, and the filter is what they did last.
//
// **the interrupt is an ending this screen answers itself.** it holds the terminal in raw mode for
// the length of the question, so the keystroke arrives here rather than at the process — and what
// it ends is the question, which is the ending a picker they closed has always had (./AskAccount).
func (drawn chooser) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	key, pressed := message.(tea.KeyMsg)
	if !pressed {
		return drawn, nil
	}
	switch key.String() {
	case "ctrl+c":
		drawn.left = true
		return drawn, tea.Quit
	case "esc":
		if drawn.filtering {
			return drawn.unfiltered(), nil
		}
		drawn.left = true
		return drawn, tea.Quit
	case "enter":
		drawn.answer = drawn.ring()[drawn.at].value
		return drawn, tea.Quit
	case "up":
		return drawn.moved(-1), nil
	case "down":
		return drawn.moved(1), nil
	case "k":
		if !drawn.filtering {
			return drawn.moved(-1), nil
		}
	case "j":
		if !drawn.filtering {
			return drawn.moved(1), nil
		}
	case "/":
		if !drawn.filtering {
			drawn.filtering = true
			return drawn, drawn.filter.Focus()
		}
	}
	if !drawn.filtering {
		return drawn, nil
	}
	resting := drawn.ring()[drawn.at].value
	typed, next := drawn.filter.Update(message)
	drawn.filter = typed
	return drawn.anchored(resting), next
}

// the cursor moved one row, which runs off either end of the screen onto the other.
//
// the three parts are a ring and not a list with stops at its ends: the two acts sit at the far
// ends of it, so an operator on the last account reaches the way out by carrying on downwards and
// the sign-out by one press upwards from the first.
func (drawn chooser) moved(by int) chooser {
	held := len(drawn.ring())
	drawn.at = (drawn.at + by + held) % held
	return drawn
}

// where the cursor goes when the filter has changed under it.
//
// **the cursor is a row and not a number.** the row it was resting on keeps it wherever the filter
// left that row standing, so typing a letter does not move the cursor onto whatever moved up into
// its place.
//
// **an account the filter took goes to the first account it left**, and to the way out where it
// left none — which is the one press on the screen that costs nothing: a filter matching nothing is
// a screen an operator is leaving or retyping, and neither the sign-out nor an account is a thing
// to rest a return on there.
func (drawn chooser) anchored(resting string) chooser {
	held := drawn.ring()
	for at, one := range held {
		if one.value == resting {
			drawn.at = at
			return drawn
		}
	}
	drawn.at = len(held) - 1
	if len(drawn.matching()) > 0 {
		drawn.at = drawn.accountsFrom()
	}
	return drawn
}

// the filter given up, with every account back on the ring.
func (drawn chooser) unfiltered() chooser {
	resting := drawn.ring()[drawn.at].value
	drawn.filtering = false
	drawn.filter.SetValue("")
	drawn.filter.Blur()
	return drawn.anchored(resting)
}

// the screen: the sign-out where it is offered, the accounts in a block of their own, the way out
// under them, and the keys along the bottom.
//
// **each act is a line with nothing beside it and a blank line between it and the block.** what
// tells an operator that the two are not accounts is where they are drawn, so the space around them
// is the whole of that reading.
func (drawn chooser) View() string {
	held := drawn.ring()
	said := &strings.Builder{}
	if drawn.signOut {
		said.WriteString(act(held[0], drawn.at == 0) + "\n\n")
	}
	said.WriteString(dressing.Focused.Base.Render(drawn.block()) + "\n\n")
	last := len(held) - 1
	said.WriteString(act(held[last], drawn.at == last) + "\n\n")
	said.WriteString(helpSaid + "\n")
	return said.String()
}

// the block the cursor moves inside: the question, and a row for every account the filter left
// standing.
//
// a filter that left none says so where a row would be, because a block with nothing under its own
// question reads as a screen that lost the list rather than as one an operator typed too much into.
func (drawn chooser) block() string {
	said := &strings.Builder{}
	said.WriteString(drawn.asking())
	standing := drawn.matching()
	if len(standing) == 0 {
		said.WriteString("\n" + noCursor + dimmed.Render(noneMatching))
	}
	for at, one := range standing {
		if drawn.at == drawn.accountsFrom()+at {
			said.WriteString("\n" + dressing.Focused.SelectSelector.String() +
				dressing.Focused.SelectedOption.Render(one.said))
			continue
		}
		said.WriteString("\n" + noCursor + dressing.Focused.UnselectedOption.Render(one.said))
	}
	return said.String()
}

// what stands at the top of the block: the question, or the filter while one is being typed.
//
// the filter takes the question's own line rather than a line beside it, because the two say the
// same thing one after the other — which accounts the rows under them are.
func (drawn chooser) asking() string {
	if drawn.filtering {
		return drawn.filter.View()
	}
	return dressing.Focused.Title.Render(chooseAccount)
}

// one act as it is drawn: its own words, in the tone that says whether a return would land there.
//
// it starts in the column the block's words start in, so the three parts of the screen read as one
// screen rather than as a list with two strays beside it.
func act(one choice, resting bool) string {
	if resting {
		return noCursor + onAct.Render(one.said)
	}
	return noCursor + dimmed.Render(one.said)
}

// the styles this screen is drawn in, which are the ones every other prompt of the same run is
// drawn in.
//
// the picker stopped being a form so that an act could be drawn above its title (./AskAccount), and
// a screen that then dressed itself would be the one prompt of a `start` looking like a different
// program. so the block, the cursor, the rows and the help line are huh's own theme, which
// ./confirm.go, ./password.go and ./placement.go are all drawn in; the mark on a row is
// ./ledger.go's check, which is the green every closed row of this console carries.
var dressing = huh.ThemeCharm()

// what an act the cursor is resting on is drawn in: the tone the cursor carries on the rows, with
// the "> " that tone sets taken off, because an act is not a row of the list.
var onAct = dressing.Focused.SelectSelector.UnsetString()

// the keys this screen answers to, drawn along the bottom of it.
//
// the words are the ones huh's own select put there and the keys are the same keys, so an operator
// who has run `start` before reads the line they have always read.
var helpSaid = helping()

func helping() string {
	pressing := []struct{ key, does string }{
		{"↑", "up"}, {"↓", "down"}, {"/", "filter"}, {"enter", "submit"},
	}
	said := make([]string, 0, len(pressing))
	for _, one := range pressing {
		said = append(said, dressing.Help.ShortKey.Render(one.key)+" "+
			dressing.Help.ShortDesc.Render(one.does))
	}
	return strings.Join(said, dressing.Help.ShortSeparator.Render(" • "))
}

// what stands where the cursor does not, so every row's words start in the same column, and what
// the acts are drawn in from.
const noCursor = "  "

// the question the block puts, and the whole of what it says about itself.
//
// nothing stands under it: what is being chosen between is on the rows, and a line of prose saying
// what an account is for is one an operator reads once and reads past on every run of `start` after.
const chooseAccount = "choose an account:"

// what a filter leaving no account standing says, where a row would be.
const noneMatching = "no account matches that"

// what the two acts say, which is the press and never what the caller does after it.
//
// **the way out says leaving and not what leaving costs**, because both presses that draw this
// picker leave it differently: `start` says nothing was created and nothing was deployed and
// `login` records no account, and each of them says its own words on the way out
// (../../cmd/better-giving/start.go's closed).
//
// **the brackets are what says a press.** neither act is a row of the account list and neither
// carries the cursor the rows carry, so its own words are the whole of what makes it one.
const (
	signOutSaid = "[ log out ]"
	exitSaid    = "[ exit ]"
)

// the account the cursor starts on: the one this machine remembers, where this sign-in still
// reaches it.
//
// the list is read off cloudflare on every run and the remembered id is this machine's own, so an
// account this sign-in has left since is a value no row carries — and a cursor bound to one would
// open the screen on no row at all rather than on one the operator can read.
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

// what the value the screen came back with is worth.
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

// which cloudflare sign-in these rows were read off, as the line above the screen.
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
func labelled(accounts []signin.Account, deployed []string) []choice {
	shared := map[string]int{}
	for _, one := range accounts {
		shared[one.Name]++
	}
	found := map[string]bool{}
	for _, id := range deployed {
		found[id] = true
	}
	offered := make([]choice, 0, len(accounts))
	for _, one := range accounts {
		named := one.Name
		if shared[one.Name] > 1 && named != one.ID {
			named += " (" + one.ID + ")"
		}
		said := named
		if found[one.ID] {
			// the worker as this binary was baked to name it (../release), because that is the name
			// on the cloudflare dashboard the operator would go looking at, and the check ./ledger.go
			// closes a row with, because it is the same claim: this one is done.
			said += "  (" + release.Baked.Name + " " + check.String() + ")"
		}
		offered = append(offered, choice{said: said, value: one.ID, named: named})
	}
	return offered
}
