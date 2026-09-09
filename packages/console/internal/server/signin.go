package server

import (
	"net/http"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/signin"
	"github.com/better-giving/console/internal/state"
)

// the four the page asks about the sign-in: what it is, how to start one, how to leave a wait, and
// how to give one up.
//
// **the page is handed a state and never a credential.** the token stays in ../oauth, travels into
// a header in ../cf, and reaches nothing a browser reads — so a status carries a phase, an address
// the operator is being sent to, an email and a list of accounts, and the whole file is written so
// that adding a fifth thing to it is a deliberate act.
//
// **signing out is not an endpoint at all while the environment holds the token.** what is in use
// then came from the terminal the console was started in and there is nothing on this machine to
// forget, so the answer is a 404 rather than a refusal — the same absence the page draws by not
// offering the control.

// signedIn is the fourth thing a status can say, and it is not a phase of the flow: it is a
// credential being held, whichever way it arrived.
const signedIn = "signed-in"

// status is what the page reads to draw the connect panel.
type status struct {
	// Phase is `idle`, `waiting`, `unfinished` or `signed-in`.
	Phase string `json:"phase"`
	// Address is the allow page a waiting flow opened, so a machine whose browser did not open has
	// somewhere to be pointed. Empty unless waiting.
	Address string `json:"address"`
	// Why is how an unfinished flow ended, and is empty unless it is one.
	Why oauth.Why `json:"why"`
	// Detail is the folder a sign-in that could not be written down would have gone in, and is
	// empty on every other state. The panel's sentence sends the operator to make that folder
	// writable, and one that does not say which folder is one they cannot act on: it is the
	// operating system's own config home and is not somewhere they have been.
	Detail string `json:"detail"`
	// TokenSet is whether the credential came from this console's environment, which decides
	// whether a sign-in control and a sign-out control are drawn at all.
	TokenSet bool          `json:"tokenSet"`
	SignIn   signin.SignIn `json:"signIn"`
}

// started is what a press that changed the flow answers with, which is the phase it left behind.
type started struct {
	Phase   oauth.PhaseName `json:"phase"`
	Address string          `json:"address"`
}

func signIn(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	records state.Store,
) {
	routes.HandleFunc("GET /api/sign-in", func(w http.ResponseWriter, r *http.Request) {
		credential := flow.Credential(r.Context())
		tokenSet := flow.TokenSet()
		read := signin.Read(r.Context(), credential, tokenSet, reads(credential))

		phase := flow.Phase()
		name := string(phase.Name)
		// a credential being held is what the screen is really asking about, and it outranks a flow
		// that ended unfinished: an operator who signed in some other way afterwards would
		// otherwise be shown the failure of a flow that no longer decides anything.
		if read.Kind == signin.OAuth || read.Kind == signin.Token {
			name = signedIn
		}
		detail := ""
		if phase.Why == oauth.NotKept {
			detail = records.Dir()
		}
		answer(w, http.StatusOK, status{
			Phase:    name,
			Address:  phase.Address,
			Why:      phase.Why,
			Detail:   detail,
			TokenSet: tokenSet,
			SignIn:   read,
		})
	})

	routes.HandleFunc("POST /api/sign-in", func(w http.ResponseWriter, _ *http.Request) {
		phase, opened, err := flow.Start()
		if err != nil {
			// what could not be opened is a listener on this machine, so its own words are drawn:
			// they name a port and never a credential, and a sentence about the port alone hides a
			// bind that failed for some other reason entirely.
			answer(w, http.StatusConflict, map[string]string{
				"error": "this machine could not answer a sign-in on " + oauth.CallbackURL +
					": " + err.Error(),
			})
			return
		}
		if !opened {
			answer(w, http.StatusConflict, map[string]string{
				"error": "a sign-in is already open in this operator's browser",
			})
			return
		}
		answer(w, http.StatusOK, started{Phase: phase.Name, Address: phase.Address})
	})

	routes.HandleFunc("POST /api/sign-in/stop", func(w http.ResponseWriter, _ *http.Request) {
		flow.Stop()
		answer(w, http.StatusOK, started{Phase: oauth.Idle})
	})

	routes.HandleFunc("POST /api/sign-out", func(w http.ResponseWriter, r *http.Request) {
		if flow.TokenSet() {
			answer(w, http.StatusNotFound, map[string]string{
				"error": "the sign-in in use came from " + oauth.TokenVar +
					" in this console's environment, so there is nothing here to sign out of",
			})
			return
		}
		if err := flow.Out(r.Context()); err != nil {
			answer(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		answer(w, http.StatusOK, started{Phase: oauth.Idle})
	})
}
