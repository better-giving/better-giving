package terminal

import (
	"strings"
	"testing"
	"time"

	"github.com/better-giving/console/internal/oauth"
)

// the four ends a sign-in has when it hands this machine no credential, said in a terminal.
//
// the state's own word is the enum ../oauth stores it under and is not a sentence: an operator told
// `timed-out` has been handed this console's internals and no act.

func TestEverySignInThatDidNotFinishHasASentenceOfItsOwn(t *testing.T) {
	said := map[oauth.Why]string{}
	for _, why := range []oauth.Why{oauth.TimedOut, oauth.Refused, oauth.NothingBack, oauth.NotKept} {
		sentence := SignInUnfinished(why, "/home/o/.better-giving", "better-giving login")
		if sentence == "" {
			t.Fatalf("%q was answered with nothing", why)
		}
		if strings.Contains(sentence, string(why)) {
			t.Errorf("%q said %q, want a sentence rather than the state's own word", why, sentence)
		}
		if !strings.Contains(sentence, "better-giving login") {
			t.Errorf("%q said %q, want the command that asked for the sign-in named", why, sentence)
		}
		for held, before := range said {
			if before == sentence {
				t.Errorf("%q and %q are answered with the same sentence: %q", held, why, sentence)
			}
		}
		said[why] = sentence
	}
}

func TestAnEndingThisConsoleDoesNotKnowIsNotGivenAnotherStatesSentence(t *testing.T) {
	// ../oauth's Why is a bare string and nothing checks that this file names every value of it, so
	// a fifth ending added there would otherwise be answered with the words written for the one that
	// came back empty — an operator told the page may have been closed on a sign-in that ended some
	// other way, and a state nobody can tell from `nothing-back` in a report.
	unknown := SignInUnfinished("locked-out", "/home/o/.better-giving", "better-giving login")
	empty := SignInUnfinished(oauth.NothingBack, "/home/o/.better-giving", "better-giving login")

	if unknown == empty {
		t.Fatalf("an ending this console does not know said %q, which is nothing-back's own sentence",
			unknown)
	}
	if strings.Contains(unknown, "locked-out") {
		t.Errorf("said %q, want a sentence rather than the state's own word", unknown)
	}
	if !strings.Contains(unknown, "better-giving login") {
		t.Errorf("said %q, want something to do about it", unknown)
	}
}

func TestASignInNobodyAllowedInTimeIsAWaitThisConsoleKeptAndNeverAPageThatWasClosed(t *testing.T) {
	// an operator who was simply slow and is told the page was closed goes hunting a tab they never
	// shut. the wait's own length is ../oauth's and is not spelled here.
	sentence := SignInUnfinished(oauth.TimedOut, "/home/o/.better-giving", "better-giving start")
	if strings.Contains(sentence, "closed") {
		t.Errorf("said %q, want a wait this console keeps rather than a page that was closed", sentence)
	}
	if strings.Contains(sentence, "two minutes") {
		t.Errorf("said %q, want the wait's length left where it is owned", sentence)
	}
	if !strings.Contains(sentence, "better-giving start") {
		t.Errorf("said %q, want the command that asked for the sign-in named", sentence)
	}
}

func TestASignInThisMachineCouldNotWriteDownNamesTheDirectory(t *testing.T) {
	sentence := SignInUnfinished(oauth.NotKept, "/home/o/.better-giving", "better-giving login")
	if !strings.Contains(sentence, "/home/o/.better-giving") {
		t.Errorf("said %q, want the directory it could not be written to named", sentence)
	}
}

func TestASignInThisMachineCouldNotWriteDownReadsAsOneSentence(t *testing.T) {
	// the fragment the other three open a sentence with lands mid-clause here, so this branch words
	// itself: a capital inside a clause reads as two sentences spliced together, and "run … again
	// lands here" wants a gerund.
	sentence := SignInUnfinished(oauth.NotKept, "/home/o/.better-giving", "better-giving login")
	if strings.Contains(sentence, "Run better-giving login") {
		t.Errorf("said %q, want no capital inside a clause", sentence)
	}
	if !strings.Contains(sentence, "running better-giving login again") {
		t.Errorf("said %q, want the clause to read as one sentence", sentence)
	}
}

// what a terminal says while a sign-in is open in a browser, which is the state the address alone
// leaves silent.
//
// packages/console-ui/src/lib/connect-panel.tsx draws both halves for the browser — a page that
// opened, and an address to open by hand — and states the wait; the terminal printed the address
// and then polled for up to two minutes saying nothing.

func TestASignInBeingWaitedOnSaysSoAndSaysForHowLong(t *testing.T) {
	said := SignInWaiting(true, "https://dash.cloudflare.test/oauth2/auth?x=1", 2*time.Minute)

	if !strings.Contains(said, "https://dash.cloudflare.test/oauth2/auth?x=1") {
		t.Errorf("said %q, want the address the operator was sent to", said)
	}
	if !strings.Contains(said, "waits") {
		t.Errorf("said %q, want the wait stated rather than left as silence", said)
	}
	if !strings.Contains(said, "2 minutes") {
		t.Errorf("said %q, want how long the wait is", said)
	}
}

func TestTheWaitIsTakenFromTheOneTheFlowKeepsRatherThanWrittenIntoTheSentence(t *testing.T) {
	// ../oauth's Waits is overridable, so a number spelled in this file is one a flow built with a
	// wait of its own would make wrong.
	said := SignInWaiting(true, "https://dash.cloudflare.test/", 90*time.Second)

	if !strings.Contains(said, "90 seconds") {
		t.Errorf("said %q, want the wait this flow keeps", said)
	}
	if strings.Contains(said, "2 minutes") {
		t.Errorf("said %q, want no wait of this file's own", said)
	}
}

func TestAPageThatOpenedAndAnAddressToOpenByHandAreToldApart(t *testing.T) {
	opened := SignInWaiting(true, "https://dash.cloudflare.test/", 2*time.Minute)
	byHand := SignInWaiting(false, "https://dash.cloudflare.test/", 2*time.Minute)

	if opened == byHand {
		t.Fatalf("both said %q, want a page that opened told from one nothing opened", opened)
	}
	if !strings.Contains(opened, "opened") {
		t.Errorf("said %q, want the page that opened named as one", opened)
	}
	if !strings.Contains(byHand, "open this address") {
		t.Errorf("said %q, want the operator asked to open it themselves", byHand)
	}
}
