package server

import (
	"context"
	"net/http"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the two the home screen is drawn from, and they are two because they answer at two speeds.
//
// **the first is this machine's own memory and the baked names**, so the page knows within a
// loopback round trip whether there is a shell to draw at all — the bar states the account, and
// there is nothing true to put on one until there is an account to state.
//
// **the second is every cloudflare round trip and the deployment's own answer, as one answer.** the
// face is a function of every read on the page: nothing about it can be drawn before the slowest of
// them lands, so one answer is one checking state rather than a page that resolves three times
// under the reader. what is inside it is internal/deployment's, decided there.
//
// **neither carries a credential and neither may.** the cloudflare sign-in stays in internal/oauth
// and the session stays in internal/session; what crosses to the browser is an account id, a name,
// an address and what the deployment said about itself.

// shape is what the page reads to find out whether a shell is drawn.
type shape struct {
	// Shape is `connect` while nothing has been chosen, and `shell` once something has.
	Shape string `json:"shape"`
	// WorkerName and DatabaseName are the release's, stated on both shapes: the panel in front of
	// the shell names the deployment it is about before there is an account to scope anything to.
	WorkerName   string `json:"workerName"`
	DatabaseName string `json:"databaseName"`
	// Account is null while nothing has been chosen.
	Account *account.Account `json:"account"`
	// Remembered is whether this machine will still know the account after a restart.
	Remembered bool `json:"remembered"`
}

func homeRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	store *account.Store,
	records state.Store,
	surface func(origin, token string) cf.Send,
) {
	routes.HandleFunc("GET /api/home", func(w http.ResponseWriter, _ *http.Request) {
		read := shape{
			Shape:        "connect",
			WorkerName:   release.Baked.Name,
			DatabaseName: release.Baked.DatabaseName,
		}
		if held := store.Chosen(); held != nil {
			read.Shape = "shell"
			read.Account = &held.Account
			read.Remembered = held.Remembered
		}
		answer(w, http.StatusOK, read)
	})

	routes.HandleFunc("GET /api/home/reading", func(w http.ResponseWriter, r *http.Request) {
		held := store.Chosen()
		if held == nil {
			// every read below is scoped to an account, so there is nothing to read rather than a
			// reading that came back empty. the page draws the panel that chooses one.
			answer(w, http.StatusConflict, map[string]string{
				"error": "this console has not been told which cloudflare account this deployment is in",
			})
			return
		}

		credential := flow.Credential(r.Context())
		answer(w, http.StatusOK, deployment.Read(r.Context(), deployment.Inputs{
			AccountID:    held.Account.ID,
			WorkerName:   release.Baked.Name,
			DatabaseName: release.Baked.DatabaseName,
			Credential:   credential,
			Account:      reads(credential),
			Session:      session.Held(records, release.Baked.Name, time.Now()),
			Deployment:   surfaceReads(surface),
		}))
	})
}

// how a call to a deployment's own console surface is bound.
//
// The session travels in a header and never on the url, which is internal/cf's arrangement for
// every credential this binary holds: the reader that decides what a screen says is handed a
// function and never a token. One binding for reads and writes alike, because the seven errands write
// through the same door this reads through.
func deploymentCalls(origin, token string) cf.Send {
	return cf.JSONSend(origin, map[string]string{"Authorization": "Bearer " + token})
}

// the read half of that binding, which is the whole of what a reading of the deployment needs.
func surfaceReads(surface func(origin, token string) cf.Send) func(string, string) cf.Get {
	return func(origin, token string) cf.Get {
		send := surface(origin, token)
		return func(ctx context.Context, path string) cf.Answer {
			return send(ctx, http.MethodGet, path, nil)
		}
	}
}
