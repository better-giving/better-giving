package terminal

import (
	"strconv"
	"time"

	"github.com/better-giving/console/internal/oauth"
)

// what a sign-in that handed this machine no credential left behind, said in a terminal.
//
// **the state is ../oauth's and the sentence is this console's.** `timed-out`, `refused`,
// `nothing-back` and `not-kept` are the words a phase is stored under and read back by, and an
// operator handed one of them has been shown an enum: what a terminal says is what happened and
// what to do about it. each of the four is named, and an ending this file does not know is said as
// one rather than given another state's words.
//
// **the act is the caller's own command**, the way ./outcome.go's Repair is: the sign-in is asked
// for by `login` and by `start`, and either sentence naming the other command sends an operator to
// a press that is not the one they made.
//
// **packages/console-ui/src/lib/connect-panel.tsx words the same four states for the browser, and
// none of its sentences is copied here.** every act on that page is a press on it, and an operator
// standing at a terminal has no such page in front of them.
//
// **one of the four is not a failure.** cloudflare turning the request down is the operator's own
// cancel (../oauth/flow.go), so what the caller does about that sentence is print it and end
// cleanly — which is what every closed prompt in this binary does (./prompt.go).
//
// **the sign-in that is still open has a sentence too, and it is the one place the wait is stated.**
// the caller prints an address and then polls in silence for as long as ../oauth waits, so without
// it the operator cannot tell a console that is waiting from one that has hung. how long that wait
// is arrives as the value ../oauth keeps — a flow may be built with a wait of its own, so a number
// written into a sentence here would be one this file could not keep true. and the two cases the
// browser panel splits are split here as well: a page that opened is a different act from an
// address to open by hand, and the caller is what knows which machine it is on.

// SignInUnfinished is the one sentence a sign-in that ended without a credential is answered with.
//
// `dir` is where this machine keeps what it is signed in as, named by the one state that could not
// be written there. `command` is the caller's own, as the press that puts the sign-in again, in
// plain words: it is set off as code here (./Code), so a caller that marked it would mark it
// twice.
func SignInUnfinished(why oauth.Why, dir, command string) string {
	again := "Run " + Code(command) + " again"
	switch why {
	case oauth.TimedOut:
		// a wait this console keeps and never a page that was closed: an operator who was simply
		// slow and is told the page was closed goes hunting a tab they never shut. how long that
		// wait is belongs to ../oauth and is not spelled a second time here.
		return "Cloudflare didn't hear back inside the time this console waits for a sign-in to be " +
			"allowed, so this machine isn't signed in. " + again + ": it opens a fresh page."
	case oauth.Refused:
		return "The sign-in was turned down at Cloudflare, so this machine isn't signed in. " +
			again + " when you want to allow it."
	case oauth.NotKept:
		// the credential is only ever read back from the record this console writes, so a write
		// that did not happen is a sign-in this machine does not hold rather than one it holds and
		// did not save.
		// the fragment the other three open a sentence with would land inside a clause here, so
		// this one words itself: a capital mid-clause reads as two sentences spliced together.
		return "Cloudflare allowed the sign-in and this console couldn't write it down in " +
			Code(dir) + ", so this machine isn't signed in. Until that folder can be written to, " +
			"running " + Code(command) + " again lands here."
	case oauth.NothingBack:
		return "Cloudflare sent nothing back, and the page may have been closed before the sign-in " +
			"was allowed. " + again + "."
	default:
		// ../oauth's Why is a bare string and nothing holds this switch to every value of it, so a
		// fifth ending would otherwise be handed the sentence written for the one that came back
		// empty — a page nobody closed, reported as one that was. what is said instead is that this
		// console did not recognise the ending, which is the shape
		// ../../cmd/better-giving/start.go's atTheDoor takes at its own unnamed answer.
		return "Cloudflare ended the sign-in in a way this console does not recognise, so this " +
			"machine isn't signed in. " + again + "."
	}
}

// SignInWaiting is what a terminal says while a sign-in is open in the operator's browser.
//
// `opened` is whether this machine had a browser this console knows how to open, which is what
// tells the two sentences apart; `address` is the page the operator allows the access on; `waits`
// is how long ../oauth waits for it, as that flow keeps it.
func SignInWaiting(opened bool, address string, waits time.Duration) string {
	waiting := "this console waits " + spell(waits) + " for it."
	if opened {
		return "a Cloudflare page has opened in your browser: " + Code(address) +
			"\nallow the access it asks for, then come back here. " + waiting +
			"\nnothing opened? open that address yourself."
	}
	return "open this address in your browser and allow the access it asks for: " + Code(address) +
		"\n" + waiting
}

// how long the wait is, in words rather than go's own duration spelling.
//
// `2m0s` is a value read off a clock and not a length an operator was told, and it is the one thing
// about this sentence that would otherwise reach them as a machine's.
func spell(waits time.Duration) string {
	seconds := int(waits.Round(time.Second).Seconds())
	switch {
	case seconds >= 120 && seconds%60 == 0:
		return strconv.Itoa(seconds/60) + " minutes"
	case seconds == 60:
		return "a minute"
	default:
		return strconv.Itoa(seconds) + " seconds"
	}
}
