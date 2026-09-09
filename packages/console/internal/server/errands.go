package server

import (
	"context"
	"net/http"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the seven errands this console proxies to the deployment: the organisation's legal identity and
// where it reaches the operator, the test send, the payments reading, the repeating-gifts standing
// and the press that provisions it, the site list, and the press that registers the hostnames a
// donor is drawn wallet buttons on.
//
// **the deployment is the authority for every one of them.** what a value may be, what a send did,
// what the processor account holds and whether a site may be dropped are decided inside the worker,
// and each answer arrives with the sentence a reader acts on. this posts what was typed and carries
// what comes back, at the box its key names — a rule written here would be a second opinion, and the
// half that drifts is the one nothing reports.
//
// **every one of them answers 200 carrying how it went.** each way an errand did not land is a
// state the fold draws at the control that was pressed, so a status carrying it would make the
// page's own reading a failure to recover from. the codes here are for the presses that never
// reached the deployment at all: a body this console will not act on, and a name it does not draw
// a box for.
//
// **the session is read here and reaches no answer.** it is closed over by the reader and the
// writer internal/deployment is handed, which is internal/cf's arrangement for every credential
// this binary holds — a console holding none is its own answer rather than a request made with a
// bearer nobody filled in.

// the org fold posts a profile whole: every box, every time, because the endpoint stores a field
// left out of the body as cleared.
type orgPress struct {
	Values map[string]string `json:"values"`
}

type sitesPress struct {
	Sites []string `json:"sites"`
}

type testEmailPress struct {
	To string `json:"to"`
}

// surfaceDoors is the session this console holds, bound to a reader and a writer of the
// deployment's own console surface, or neither where it holds none.
//
// The session is read at the press rather than at start-up, because it is minted and re-minted
// while the console is open, and it reaches no answer: it is closed over by the two calls
// internal/deployment is handed, which is internal/cf's arrangement for every credential this
// binary holds.
func surfaceDoors(records state.Store, surface func(origin, token string) cf.Send) func() (cf.Get, cf.Post) {
	return func() (cf.Get, cf.Post) {
		mine := session.Held(records, release.Baked.Name, time.Now())
		if mine == nil {
			return nil, nil
		}
		send := surface(mine.Origin, mine.Token)
		return func(ctx context.Context, path string) cf.Answer {
				return send(ctx, http.MethodGet, path, nil)
			}, func(ctx context.Context, path string, body any) cf.Answer {
				return send(ctx, http.MethodPost, path, body)
			}
	}
}

func errandRoutes(routes *http.ServeMux, held func() (cf.Get, cf.Post)) {

	// stores the organisation's profile, whole, from whichever of the two folds pressed.
	routes.HandleFunc("POST /api/deployment/org", func(w http.ResponseWriter, r *http.Request) {
		var posted orgPress
		if !decoded(w, r, &posted) {
			return
		}
		for field := range posted.Values {
			if !enumerated(release.OrgProfileFields, field) {
				answer(w, http.StatusBadRequest, map[string]string{
					"error": "this console draws no box for " + field,
				})
				return
			}
		}
		_, post := held()
		answer(w, http.StatusOK, deployment.SaveOrg(r.Context(), post, posted.Values))
	})

	// asks the deployment to send a test message to the address typed beside the button.
	//
	// The destination is the one thing posted with it, and it is the operator's: a mail host is only
	// checked by an inbox somebody is watching. What an address may be is the deployment's rule and
	// is not read here.
	routes.HandleFunc("POST /api/deployment/test-email", func(w http.ResponseWriter, r *http.Request) {
		var posted testEmailPress
		if !decoded(w, r, &posted) {
			return
		}
		_, post := held()
		answer(w, http.StatusOK, deployment.SendTest(r.Context(), post, posted.To))
	})

	// what the deployment says about the processor account it charges on.
	routes.HandleFunc("GET /api/deployment/payments", func(w http.ResponseWriter, r *http.Request) {
		get, _ := held()
		answer(w, http.StatusOK, deployment.ReadPayments(r.Context(), get))
	})

	// where the deployment stands on gifts that repeat. The read changes nothing: a screen drawn
	// from the press below would provision an operator's processor account as a side effect of them
	// opening a page.
	routes.HandleFunc("GET /api/deployment/recurring", func(w http.ResponseWriter, r *http.Request) {
		get, _ := held()
		answer(w, http.StatusOK, deployment.ReadRecurring(r.Context(), get))
	})

	// asks the deployment to put what a repeating gift is charged against on that account.
	//
	// It carries no body: what the account holds is found by an id the deployment derives.
	routes.HandleFunc("POST /api/deployment/recurring", func(w http.ResponseWriter, r *http.Request) {
		_, post := held()
		answer(w, http.StatusOK, deployment.SetUpRecurring(r.Context(), post))
	})

	// asks the deployment to register the hostnames a donor is drawn wallet buttons on.
	//
	// It carries no body, and no hostname may ever be added to one: the account is the operator's
	// and a registration is a public claim on a domain, so the list is the deployment's own address
	// and its own site rows, settled inside the worker (internal/deployment/wallets.go).
	routes.HandleFunc("POST /api/deployment/wallet-domains", func(w http.ResponseWriter, r *http.Request) {
		_, post := held()
		answer(w, http.StatusOK, deployment.LevelWallets(r.Context(), post))
	})

	// stores the site list, whole.
	//
	// The rule the list is read against is applied in the browser before this is pressed, and the
	// deployment applies it again over what it stores — so nothing here parses one.
	routes.HandleFunc("POST /api/deployment/sites", func(w http.ResponseWriter, r *http.Request) {
		var posted sitesPress
		if !decoded(w, r, &posted) {
			return
		}
		if posted.Sites == nil {
			posted.Sites = []string{}
		}
		_, post := held()
		answer(w, http.StatusOK, deployment.SaveSites(r.Context(), post, posted.Sites))
	})
}
