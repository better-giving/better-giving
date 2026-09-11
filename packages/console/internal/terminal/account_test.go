package terminal

import (
	"errors"
	"io"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/signin"
)

// a sign-in carrying the accounts a case picks from.
func holding(accounts ...signin.Account) signin.SignIn {
	return signin.SignIn{Kind: signin.OAuth, Accounts: accounts}
}

var (
	acme  = signin.Account{ID: "a1", Name: "Acme Giving"}
	other = signin.Account{ID: "b2", Name: "Another Cause"}
)

// whether the cursor's ring carries a row answering with `value`, and every value on it, for a case
// reporting what it drew instead.
func carries(held []choice, value string) bool {
	for _, one := range held {
		if one.value == value {
			return true
		}
	}
	return false
}

func values(held []choice) []string {
	drawn := make([]string, 0, len(held))
	for _, one := range held {
		drawn = append(drawn, one.value)
	}
	return drawn
}

// the row the cursor is resting on.
func resting(drawn chooser) choice {
	held := drawn.ring()
	if drawn.at < 0 || drawn.at >= len(held) {
		return choice{}
	}
	return held[drawn.at]
}

func TestNoAccountIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	// the same refusal ./placement.go's is put behind, and for the same reason: a screen drawn at a
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
	// a picker with no account on it is a screen an operator cannot leave by choosing anything, so
	// the list is weighed in front of the drawing rather than drawn empty at them.
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
	}, nil)
	said := map[string]bool{}
	for _, one := range offered {
		if said[one.said] {
			t.Errorf("two accounts are both offered as %q", one.said)
		}
		said[one.said] = true
	}
	if said["Another"] != true {
		t.Errorf("an account whose name is its own is offered as something else: %v", said)
	}
}

// which row the picker opens on, which is what makes the common answer one keypress.
//
// `start` puts this question on every run, so the account this machine already operates has to be
// the row under the cursor: an operator who meant to keep it presses return, and one who did not is
// looking at the list they need.

func TestThePickerOpensOnTheAccountThisMachineRemembers(t *testing.T) {
	opened := resting(choosing(holding(acme, other), Picker{Remembered: other.ID}))

	if opened.value != other.ID {
		t.Errorf("the picker opens on %q, want the account this machine operates", opened.value)
	}
}

func TestAPickerRememberingNothingOpensOnTheFirstRow(t *testing.T) {
	opened := resting(choosing(holding(acme, other), Picker{}))

	if opened.value != acme.ID {
		t.Errorf("the picker opens on %q, want the first account on the list", opened.value)
	}
}

func TestAnAccountThisSignInNoLongerReachesOpensOnTheFirstRow(t *testing.T) {
	// the list is read off cloudflare every time and the remembered id is this machine's own, so an
	// account left since the last run is a value no row carries.
	opened := resting(choosing(holding(acme, other), Picker{Remembered: "gone"}))

	if opened.value != acme.ID {
		t.Errorf("the picker opens on %q, want a row that is on the list", opened.value)
	}
}

func TestNeitherActIsEverTheRowThePickerOpensOn(t *testing.T) {
	// both acts are on the cursor's ring, and neither is a thing an operator meets by pressing
	// return at a screen they opened: one gives up the sign-in and the other ends the run.
	for _, asked := range []Picker{{SignOut: true}, {SignOut: true, Remembered: "gone"}} {
		opened := resting(choosing(holding(acme, other), asked))
		if opened.value == signOutRow || opened.value == exitRow {
			t.Errorf("a picker opens on %q, want an account", opened.value)
		}
	}
}

// the act that signs this machine out, which `start` offers and `login` does not.

func TestTheSignOutActIsDrawnOnlyWhereItIsOffered(t *testing.T) {
	offered := choosing(holding(acme), Picker{SignOut: true}).ring()
	if !carries(offered, signOutRow) {
		t.Errorf("a picker offered the sign-out drew %v, want that act on it", values(offered))
	}

	plain := choosing(holding(acme), Picker{}).ring()
	if carries(plain, signOutRow) {
		t.Errorf("a picker offered no sign-out drew %v, want no press that could only fail",
			values(plain))
	}
}

func TestTheSignOutActCarriesAValueNoAccountCan(t *testing.T) {
	// the answer is read off one string, so the sign-out is weighed in front of the list rather
	// than looked for in it: an account whose id spelled that act would otherwise sign this machine
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

// the act that ends the run, which is on every drawing of this picker.

func TestTheWayOutIsAlwaysOfferedAndEndsTheRunTheWayAClosedPickerDoes(t *testing.T) {
	offered := choosing(holding(acme), Picker{}).ring()

	if len(offered) != 2 {
		t.Fatalf("the picker drew %d rows, want the account and the way out", len(offered))
	}
	_, answered, err := picked(offered[1].value, []signin.Account{acme})
	if answered != PickerClosed || err != nil {
		t.Errorf("the last row answered %q, %v, want the run ended as a closed picker ends it",
			answered, err)
	}
}

func TestTheRingRunsFromTheSignOutThroughTheAccountsToTheWayOut(t *testing.T) {
	offered := choosing(holding(acme, other), Picker{SignOut: true}).ring()

	same(t, "the ring", strings.Join(values(offered), " "),
		strings.Join([]string{signOutRow, acme.ID, other.ID, exitRow}, " "))
}

// the account this deployment was found in, marked on its row.
//
// what the mark rests on is one read per account, made by the caller before the picker draws
// (../effects' EachAddress) — so a row carries it where that read found the deployment, and carries
// nothing where the read said it is not there or never landed at all. an unmarked row is this
// console saying nothing either way, which is what makes the mark safe to draw.

func TestTheAccountHoldingThisDeploymentIsMarkedOnItsRow(t *testing.T) {
	offered := labelled([]signin.Account{acme, other}, []string{other.ID})

	if strings.Contains(offered[0].said, release.Baked.Name) {
		t.Errorf("an account no read found the deployment in is offered as %q", offered[0].said)
	}
	if !strings.Contains(offered[1].said, release.Baked.Name) {
		t.Errorf("the account holding the deployment is offered as %q, want it named there",
			offered[1].said)
	}
}

func TestTheMarkIsTheWorkerNameAndACheckAndClaimsNothingAboutAnyOtherRow(t *testing.T) {
	// the mark is the deployment's own name with a check beside it: a row saying a deployment is
	// there, and no row anywhere saying one is not.
	offered := labelled([]signin.Account{acme, other}, []string{other.ID})

	same(t, "the marked row", toneless.ReplaceAllString(offered[1].said, ""),
		other.Name+"  ("+release.Baked.Name+" ✓)")
	same(t, "the unmarked row", toneless.ReplaceAllString(offered[0].said, ""), acme.Name)
}

func TestAReadThatDidNotLandMarksNothing(t *testing.T) {
	// the caller hands over the accounts its reads found this deployment in and no others, so an
	// account missing from that list is one nothing was found out about — a read that was refused,
	// that never came back, or that ran past the ceiling. a row saying no deployment is there would
	// be a claim this console cannot make.
	offered := labelled([]signin.Account{acme}, nil)

	if offered[0].said != acme.Name {
		t.Errorf("an account no read landed for is offered as %q, want its name alone", offered[0].said)
	}
}

func TestAMarkedAccountSharingItsNameStillCarriesItsID(t *testing.T) {
	offered := labelled([]signin.Account{
		{ID: "a1", Name: "Cause"},
		{ID: "b2", Name: "Cause"},
	}, []string{"a1"})

	if !strings.Contains(offered[0].said, "a1") {
		t.Errorf("a marked row of two named alike is offered as %q, want its id on it", offered[0].said)
	}
	if !strings.Contains(offered[0].said, release.Baked.Name) {
		t.Errorf("a marked row of two named alike is offered as %q, want its mark on it too",
			offered[0].said)
	}
}

func TestTheWaitInFrontOfThePickerSaysWhatItIsWaitingOn(t *testing.T) {
	// the reads behind the marks are silent seconds, and a terminal showing nothing but a cursor
	// reads as a console that has hung.
	said := LookingForDeployments()

	if !strings.Contains(said, "Cloudflare") {
		t.Errorf("said %q, want where this console is looking", said)
	}
	if !strings.Contains(said, release.Baked.Name) {
		t.Errorf("said %q, want what it is looking for", said)
	}
}

func TestTheWaitInFrontOfTheNextScreenSaysWhatItIsReading(t *testing.T) {
	// the account is picked and the reads under it are silent seconds of their own — the address,
	// the release the deployment is on, the migrations waiting — and the screen after them erases
	// the terminal before it draws (./confirm.go).
	said := ReadingTheDeployment()

	if !strings.Contains(said, "reading") {
		t.Errorf("said %q, want what this console is doing", said)
	}
	if !strings.Contains(said, "this account") {
		t.Errorf("said %q, want the account the reads are about", said)
	}
}

// what the screen draws, one line at a time, with any tone taken off.
func screen(drawn chooser) string {
	said := strings.Split(strings.TrimRight(drawn.View(), "\n"), "\n")
	for at, one := range said {
		said[at] = strings.TrimRight(toneless.ReplaceAllString(one, ""), " ")
	}
	return strings.Join(said, "\n")
}

func TestTheSignOutIsDrawnAboveTheAccountsAndTheWayOutBelowThem(t *testing.T) {
	// the two acts are not accounts and are not drawn as rows of the list: the sign-out stands
	// above the question and the way out under the block, each with a line of its own around it.
	same(t, "the screen", screen(choosing(holding(acme, other), Picker{SignOut: true})),
		strings.Join([]string{
			"  [ log out ]",
			"",
			"┃ choose an account:",
			"┃ > Acme Giving",
			"┃   Another Cause",
			"",
			"  [ exit ]",
			"",
			"↑ up • ↓ down • / filter • enter submit",
		}, "\n"))
}

func TestAPickerOfferingNoSignOutDrawsNothingAboveTheAccounts(t *testing.T) {
	same(t, "the screen", screen(choosing(holding(acme), Picker{})),
		strings.Join([]string{
			"┃ choose an account:",
			"┃ > Acme Giving",
			"",
			"  [ exit ]",
			"",
			"↑ up • ↓ down • / filter • enter submit",
		}, "\n"))
}

func TestTheRowTheCursorIsOnIsTheOnlyOneCarryingTheCursor(t *testing.T) {
	drawn := choosing(holding(acme, other), Picker{Remembered: other.ID})

	said := strings.Split(screen(drawn), "\n")
	if said[1] != "┃   Acme Giving" || said[2] != "┃ > Another Cause" {
		t.Errorf("the accounts are drawn as %q and %q", said[1], said[2])
	}
}

func TestACursorRestingOnAnActIsOnNoAccountAtAll(t *testing.T) {
	// one cursor for the whole screen: an operator who has arrowed up to the sign-out is not also
	// standing on the account they arrowed off, and a list still drawing its own cursor would say
	// that a return there takes the account.
	drawn := choosing(holding(acme, other), Picker{SignOut: true})
	drawn.at = 0

	said := screen(drawn)
	if strings.Contains(said, "> ") {
		t.Errorf("the cursor rests on an act and an account row still carries it: %q", said)
	}
}

func TestAFilterBeingTypedStandsWhereTheTitleDoesAndNarrowsTheAccountsAlone(t *testing.T) {
	drawn := choosing(holding(acme, other), Picker{SignOut: true})
	drawn.filtering = true
	drawn.filter.SetValue("acme")

	said := screen(drawn)
	if !strings.Contains(said, "┃ /acme") || strings.Contains(said, "choose an account:") {
		t.Errorf("a filter being typed is drawn as %q", said)
	}
	if strings.Contains(said, other.Name) {
		t.Errorf("an account the filter left out is still drawn: %q", said)
	}
	if !strings.Contains(said, "[ log out ]") || !strings.Contains(said, "[ exit ]") {
		t.Errorf("a filter took an act off the screen: %q", said)
	}
}

func TestAFilterThatLeavesNoAccountSaysSoAndLeavesBothActsStanding(t *testing.T) {
	drawn := choosing(holding(acme, other), Picker{SignOut: true})
	drawn.filtering = true
	drawn.filter.SetValue("nothing of the sort")

	said := screen(drawn)
	if !strings.Contains(said, noneMatching) {
		t.Errorf("a filter matching no account draws %q", said)
	}
	if !carries(drawn.ring(), signOutRow) || !carries(drawn.ring(), exitRow) {
		t.Errorf("a filter matching no account left %v", values(drawn.ring()))
	}
}

// the keys, which are the whole of how this screen is answered.

var (
	pressUp    = tea.KeyMsg{Type: tea.KeyUp}
	pressDown  = tea.KeyMsg{Type: tea.KeyDown}
	pressEnter = tea.KeyMsg{Type: tea.KeyEnter}
	pressEsc   = tea.KeyMsg{Type: tea.KeyEsc}
	pressStop  = tea.KeyMsg{Type: tea.KeyCtrlC}
)

func runes(said string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(said)}
}

func pressing(drawn chooser, keys ...tea.KeyMsg) chooser {
	for _, key := range keys {
		next, _ := drawn.Update(key)
		drawn = next.(chooser)
	}
	return drawn
}

func TestTheArrowsRunFromTheSignOutThroughTheAccountsToTheWayOutAndRoundAgain(t *testing.T) {
	// one cursor for the three parts of the screen: the acts are reached by the same arrows the
	// accounts are, so nothing on it is a keystroke an operator has to guess at.
	drawn := choosing(holding(acme, other), Picker{SignOut: true})

	said := []string{resting(drawn).value}
	for range 4 {
		drawn = pressing(drawn, pressDown)
		said = append(said, resting(drawn).value)
	}
	same(t, "the ring the arrows run", strings.Join(said, " "),
		strings.Join([]string{acme.ID, other.ID, exitRow, signOutRow, acme.ID}, " "))

	if up := resting(pressing(choosing(holding(acme, other), Picker{SignOut: true}), pressUp)); up.value != signOutRow {
		t.Errorf("the arrow up off the first account reaches %q, want the sign-out", up.value)
	}
}

func TestTheLettersTheArrowsShareMoveTheCursorUntilAFilterIsBeingTyped(t *testing.T) {
	// the same two letters huh's own select moved by, because an operator who has answered the
	// other prompts of this run has been moving by them all along — and they are letters, so a
	// filter being typed takes them instead.
	drawn := choosing(holding(acme, other), Picker{SignOut: true})

	same(t, "what the letters reach",
		resting(pressing(drawn, runes("j"))).value+" "+resting(pressing(drawn, runes("k"))).value,
		other.ID+" "+signOutRow)

	if typing := pressing(drawn, runes("/"), runes("j"), runes("k")); typing.filter.Value() != "jk" {
		t.Errorf("a filter being typed reads %q, want the letters typed into it", typing.filter.Value())
	}
}

func TestAReturnAnswersWithTheRowTheCursorIsOn(t *testing.T) {
	drawn := choosing(holding(acme, other), Picker{SignOut: true})

	for _, held := range []struct {
		said  string
		keys  []tea.KeyMsg
		wants string
	}{
		{"an account", []tea.KeyMsg{pressEnter}, acme.ID},
		{"the account under it", []tea.KeyMsg{pressDown, pressEnter}, other.ID},
		{"the sign-out", []tea.KeyMsg{pressUp, pressEnter}, signOutRow},
		{"the way out", []tea.KeyMsg{pressDown, pressDown, pressEnter}, exitRow},
	} {
		answered := pressing(drawn, held.keys...)
		if answered.answer != held.wants || answered.left {
			t.Errorf("a return on %s answered %q, want %q", held.said, answered.answer, held.wants)
		}
	}
}

func TestAScreenTheOperatorLeftCarriesNoAnswerAtAll(t *testing.T) {
	// a picker given up is a press not made, which is the ending ./picked never sees: the answer is
	// empty and the caller ends the run quietly.
	for _, key := range []tea.KeyMsg{pressEsc, pressStop} {
		left := pressing(choosing(holding(acme), Picker{SignOut: true}), key)
		if !left.left || left.answer != "" {
			t.Errorf("a screen given up by %v carries %q", key, left.answer)
		}
	}
}

func TestASlashStartsAFilterAndWhatIsTypedNarrowsTheAccountsAlone(t *testing.T) {
	drawn := pressing(choosing(holding(acme, other), Picker{SignOut: true}),
		runes("/"), runes("a"), runes("c"), runes("m"), runes("e"))

	if !drawn.filtering || drawn.filter.Value() != "acme" {
		t.Fatalf("the filter reads %q, filtering %v", drawn.filter.Value(), drawn.filtering)
	}
	same(t, "what a filter leaves standing", strings.Join(values(drawn.ring()), " "),
		strings.Join([]string{signOutRow, acme.ID, exitRow}, " "))
}

func TestTheArrowsStillRunWhileAFilterIsBeingTyped(t *testing.T) {
	// the acts are never filtered away, so an operator who typed three letters that matched nothing
	// still reaches both of them by the same arrows.
	drawn := pressing(choosing(holding(acme, other), Picker{SignOut: true}),
		runes("/"), runes("z"), runes("z"))

	if len(drawn.matching()) != 0 {
		t.Fatalf("the filter left %v standing", values(drawn.matching()))
	}
	same(t, "what the arrows reach",
		strings.Join([]string{
			resting(drawn).value,
			resting(pressing(drawn, pressUp)).value,
			resting(pressing(drawn, pressUp, pressUp)).value,
		}, " "),
		strings.Join([]string{exitRow, signOutRow, exitRow}, " "))
}

func TestAFilterThatTakesTheAccountTheCursorWasOnMovesItToOneStillStanding(t *testing.T) {
	// the cursor is a row and not a number: a filter that took the row out from under it would
	// otherwise leave it standing on whatever moved into that place.
	drawn := pressing(choosing(holding(acme, other), Picker{Remembered: other.ID}),
		runes("/"), runes("a"), runes("c"))

	if resting(drawn).value != acme.ID {
		t.Errorf("the cursor rests on %q, want the account the filter left standing",
			resting(drawn).value)
	}
	if resting(pressing(drawn, runes("z"))).value != exitRow {
		t.Errorf("a filter leaving no account rests the cursor on %q, want the way out",
			resting(pressing(drawn, runes("z"))).value)
	}
}

func TestEscapeWithAFilterOnDropsTheFilterRatherThanTheScreen(t *testing.T) {
	drawn := pressing(choosing(holding(acme, other), Picker{}), runes("/"), runes("a"), pressEsc)

	if drawn.left {
		t.Error("the escape that dropped a filter gave the screen up as well")
	}
	if drawn.filtering || drawn.filter.Value() != "" {
		t.Errorf("the filter reads %q, filtering %v", drawn.filter.Value(), drawn.filtering)
	}
	if len(drawn.ring()) != 3 {
		t.Errorf("the accounts the dropped filter left are %v", values(drawn.ring()))
	}
}

func TestTheWaitInFrontOfAFirstRunSaysWhatItIsReading(t *testing.T) {
	// the picker's row said this account holds no deployment, so a wait claiming to read one is
	// about something the operator has just been told is not there: what is read is where a
	// deployment on it would answer (../../cmd/better-giving/start.go's aboutToMake).
	said := ReadingTheAccount()

	if !strings.Contains(said, "reading") {
		t.Errorf("said %q, want what this console is doing", said)
	}
	if !strings.Contains(said, "this account") {
		t.Errorf("said %q, want the account the read is about", said)
	}
	if strings.Contains(said, "the deployment") {
		t.Errorf("said %q about a deployment the picker has just said is not there", said)
	}
}
