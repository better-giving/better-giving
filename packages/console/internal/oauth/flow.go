package oauth

import (
	"context"
	"crypto/subtle"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/state"
)

// PhaseName is what the sign-in is doing right now, as a screen draws it.
type PhaseName string

const (
	// Idle is nothing open and nothing to report — before the first press, and after one landed.
	Idle PhaseName = "idle"
	// Waiting is a sign-in open in the operator's browser, not yet allowed.
	Waiting PhaseName = "waiting"
	// Unfinished is a flow that ended without a credential, and Why is which of the four.
	Unfinished PhaseName = "unfinished"
)

// Why is how a flow that ended without a credential ended.
type Why string

const (
	// TimedOut is a flow nobody allowed inside the wait.
	TimedOut Why = "timed-out"
	// Refused is the operator turning the request down at cloudflare's own page, which is their
	// "cancel". It is that one answer alone (./turnedDown) and never every way cloudflare says it
	// would not finish a flow: what a terminal says about this one names a decision the operator
	// made, and a failure at cloudflare's end reported that way is a press they never made handed
	// back to them as one they did — every other of them ends as NothingBack.
	Refused Why = "refused"
	// NothingBack is a flow that ended some other way: a browser closed, an exchange cloudflare
	// would not make, a failure cloudflare named on the way back.
	NothingBack Why = "nothing-back"
	// NotKept is a sign-in cloudflare allowed and this machine could not write down — the first
	// exchange, or a later refresh of the pair it left behind.
	NotKept Why = "not-kept"
)

// Phase is the sign-in as a screen draws it, and it carries no credential by construction.
//
// Address is the page the operator was sent to, so a machine whose browser did not open has
// somewhere to be pointed. It carries this flow's `state` and challenge, both of which are public
// halves of pkce and single-use; the verifier they prove never leaves this process.
type Phase struct {
	Name    PhaseName `json:"phase"`
	Address string    `json:"address"`
	Why     Why       `json:"why"`
}

// Flow is the sign-in this machine runs, and the credential it holds between runs.
//
// **it is state of the process and not of a page.** the callback listener belongs to the machine,
// so a refresh, a second tab and a closed-and-reopened tab all see the same waiting state, and
// pressing the control twice does not open a second browser.
//
// Handlers run concurrently, so both halves are guarded: `waiting` is the flow in flight and `held`
// covers the stored credential, which the refresh reads and writes.
type Flow struct {
	store  state.Store
	send   cf.FormPost
	open   func(address string)
	waits  time.Duration
	now    func() time.Time
	listen func() (net.Listener, error)

	mutex   sync.Mutex
	waiting *attempt
	why     Why

	held sync.Mutex
}

// one sign-in open in a browser: what it is waiting on, and what proves it was this press.
//
// `claimed` is a callback having been taken by this attempt, which is what makes the code arriving
// a second time land nowhere. It is read and written under the flow's own mutex.
type attempt struct {
	address  string
	state    string
	verifier string
	claimed  bool
	server   *http.Server
	timer    *time.Timer
}

// Phase is what the sign-in is doing right now.
func (flow *Flow) Phase() Phase {
	flow.mutex.Lock()
	defer flow.mutex.Unlock()

	if flow.waiting != nil {
		return Phase{Name: Waiting, Address: flow.waiting.address}
	}
	if flow.why != "" {
		return Phase{Name: Unfinished, Why: flow.why}
	}
	return Phase{Name: Idle}
}

// Start opens a sign-in in the operator's browser, or joins the one already open.
//
// The second answer is whether this press is what opened it: a second press while one is waiting
// gets the first press's address and no second browser, and the screen reports at the control that
// the flow it is about is already open. A second flow could not be started anyway — it would bind
// the same registered callback port and fail — so what the report prevents is not a duplicate but
// an error the operator did nothing to cause.
//
// The error is the listener: a port already taken is another copy of this console — or something
// else on the machine — holding the one address cloudflare will redirect to, and there is no second
// port to move to.
func (flow *Flow) Start() (Phase, bool, error) {
	flow.mutex.Lock()
	if flow.waiting != nil {
		open := flow.waiting.address
		flow.mutex.Unlock()
		return Phase{Name: Waiting, Address: open}, false, nil
	}

	verifier, err := secret()
	if err != nil {
		flow.mutex.Unlock()
		return Phase{}, false, err
	}
	tie, err := secret()
	if err != nil {
		flow.mutex.Unlock()
		return Phase{}, false, err
	}

	listener, err := flow.listen()
	if err != nil {
		flow.mutex.Unlock()
		return Phase{}, false, err
	}

	open := AuthorizeURL + "?" + url.Values{
		"response_type":         {"code"},
		"client_id":             {ClientID},
		"redirect_uri":          {CallbackURL},
		"scope":                 {strings.Join(Scopes, " ")},
		"state":                 {tie},
		"code_challenge":        {challenge(verifier)},
		"code_challenge_method": {"S256"},
	}.Encode()

	routes := http.NewServeMux()
	routes.HandleFunc(callbackPath, flow.callback)
	started := &attempt{
		address:  open,
		state:    tie,
		verifier: verifier,
		server: &http.Server{
			Handler:           routes,
			ReadHeaderTimeout: 5 * time.Second,
		},
	}
	// the wait is armed before the listener is served, so a flow nobody allows ends whatever else
	// happens — a browser that was never opened included.
	started.timer = time.AfterFunc(flow.waits, func() { flow.end(started, TimedOut) })
	flow.waiting = started
	flow.why = ""
	flow.mutex.Unlock()

	go func() { _ = started.server.Serve(listener) }()
	if flow.open != nil {
		flow.open(open)
	}
	return Phase{Name: Waiting, Address: open}, true, nil
}

// Stop ends a sign-in the operator no longer wants to finish, leaving nothing to report.
//
// Nothing rather than `unfinished`: what happened is that they pressed stop, which the screen they
// are looking at already says. It is also what `start` and `login` call on the way down, so a
// console that is closed mid-sign-in leaves no listener behind.
func (flow *Flow) Stop() {
	flow.mutex.Lock()
	ending := flow.waiting
	flow.waiting = nil
	flow.why = ""
	flow.mutex.Unlock()

	shut(ending)
}

// the one `error=` value that is an answer rather than a failure: oauth's word for the person at
// the page turning the request down.
const turnedDown = "access_denied"

// the callback cloudflare redirects the operator's browser to once they have allowed it.
//
// **the state is read before anything else is believed, and claimed as it is read.** any page in
// that browser can reach this listener by name, so a code arriving under a state this flow did not
// mint is dropped rather than exchanged — without that, another page could hand this console a
// sign-in of its own choosing. the claim is what makes the same code arriving twice — a reloaded
// redirect, a browser that sent it again — one exchange rather than one per arrival.
func (flow *Flow) callback(w http.ResponseWriter, r *http.Request) {
	asked := r.URL.Query()

	flow.mutex.Lock()
	open := flow.waiting
	if open == nil || open.claimed || !minted(asked.Get("state"), open.state) {
		flow.mutex.Unlock()
		w.WriteHeader(http.StatusBadRequest)
		page(w, "This sign-in wasn't the one the console opened.")
		return
	}
	// the attempt stays the flow in flight while it is claimed: dropping it here would draw the
	// console as idle for as long as the exchange takes, which is a sign-in reported as landed
	// before it has.
	open.claimed = true
	flow.mutex.Unlock()

	switch refusal := asked.Get("error"); {
	case refusal == turnedDown:
		page(w, "The console hasn't been given access. Go back to it to try again.")
		go flow.end(open, Refused)
		return
	case refusal != "":
		// the same page and the same end as a callback that carried nothing at all, because that
		// is what this is: cloudflare naming a failure of its own rather than the operator
		// answering (./Refused).
		page(w, "Cloudflare sent nothing back. Go back to the console to try again.")
		go flow.end(open, NothingBack)
		return
	}
	code := asked.Get("code")
	if code == "" {
		page(w, "Cloudflare sent nothing back. Go back to the console to try again.")
		go flow.end(open, NothingBack)
		return
	}

	// the browser is answered before the exchange, so the operator is not looking at a blank tab
	// while a round trip to cloudflare happens behind it.
	page(w, "Signed in. You can close this tab and go back to the console.")
	go flow.finish(open, code)
}

// whether the callback arrived under the state this flow minted.
//
// Compared in constant time: `==` on a string stops at the first byte that differs, and the time it
// takes to do that is a page in that browser reading the state back a byte at a time.
func minted(arrived, mine string) bool {
	if arrived == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(arrived), []byte(mine)) == 1
}

// exchanges the code and ends the flow, one way or the other.
func (flow *Flow) finish(open *attempt, code string) {
	ctx, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()

	flow.held.Lock()
	_, ok, err := flow.exchange(ctx, code, open.verifier)
	flow.held.Unlock()

	switch {
	case !ok:
		flow.end(open, NothingBack)
	case err != nil:
		// a credential nothing wrote down is one this machine cannot read either, so the operator
		// is told rather than left holding a sign-in that is gone with the process.
		flow.end(open, NotKept)
	default:
		// nothing to report: what says the sign-in landed is the account list the screen draws next.
		flow.end(open, "")
	}
}

// ends `open` where it is still the flow in flight, with what to say about it afterwards.
//
// The attempt is compared rather than assumed: a wait that fires while the operator's own stop is
// landing would otherwise report a timeout about a flow that is already gone, or about the fresh
// one they started in its place.
func (flow *Flow) end(open *attempt, why Why) {
	flow.mutex.Lock()
	if flow.waiting != open {
		flow.mutex.Unlock()
		return
	}
	flow.waiting = nil
	flow.why = why
	flow.mutex.Unlock()

	shut(open)
}

// what a refresh that landed leaves the sign-in saying about whether it was written down.
//
// **the credential in hand is good either way, and this is about the next run.** every read of the
// record goes through the file, so a refresh nothing wrote down is a machine signed in now and
// signed out at the next launch — and the operator can only act on that while something says which
// folder would not take it.
//
// A write that landed clears it, so the state lasts exactly as long as it is true.
func (flow *Flow) kept(err error) {
	flow.mutex.Lock()
	defer flow.mutex.Unlock()
	switch {
	case err != nil:
		flow.why = NotKept
	case flow.why == NotKept:
		flow.why = ""
	}
}

// takes down one attempt's listener, and the wait armed with it.
//
// Shutdown rather than Close: the callback answers the browser and ends the flow from a goroutine
// of its own, and a close that raced it would cut that response off mid-write.
func shut(open *attempt) {
	if open == nil {
		return
	}
	open.timer.Stop()
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	_ = open.server.Shutdown(ctx)
}

// what the operator's browser is left looking at, which carries no credential and never could.
func page(w http.ResponseWriter, said string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte("<!doctype html><meta charset=utf-8><title>Better Giving</title><p>" +
		said + "</p>"))
}
