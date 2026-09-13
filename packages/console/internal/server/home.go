package server

import (
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
// loopback round trip what the bar states — the account, the two names, and the two notes about
// what this machine could not write down.
//
// **the second is every cloudflare round trip and the deployment's own answer, as one answer.** the
// face is a function of every read on the page: nothing about it can be drawn before the slowest of
// them lands, so one answer is one checking state rather than a page that resolves three times
// under the reader. what is inside it is internal/deployment's, decided there.
//
// **neither carries a credential and neither may.** the cloudflare sign-in stays in internal/oauth
// and the session stays in internal/session; what crosses to the browser is an account id, a name,
// an address, a folder on this machine and what the deployment said about itself.

// home is what the page reads to draw the bar.
type home struct {
	// WorkerName and DatabaseName are the release's.
	WorkerName   string          `json:"workerName"`
	DatabaseName string          `json:"databaseName"`
	Account      account.Account `json:"account"`
	// Remembered is whether this machine will still know the account after a restart.
	Remembered bool `json:"remembered"`
	// NotKept is the folder a sign-in this machine could not write down would have gone in, and null
	// where nothing failed to keep. the credential in hand is good either way; what is lost is the
	// next launch's, and a note that does not name the folder is one the operator cannot act on.
	NotKept *string `json:"notKept"`
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
		held := store.Chosen()
		if held == nil {
			noAccount(w)
			return
		}
		read := home{
			WorkerName:   release.Baked.Name,
			DatabaseName: release.Baked.DatabaseName,
			Account:      held.Account,
			Remembered:   held.Remembered,
		}
		if flow.Phase().Why == oauth.NotKept {
			dir := records.Dir()
			read.NotKept = &dir
		}
		answer(w, http.StatusOK, read)
	})

	routes.HandleFunc("GET /api/home/reading", func(w http.ResponseWriter, r *http.Request) {
		held := store.Chosen()
		if held == nil {
			noAccount(w)
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
			Deployment:   deployment.Reads(surface),
		}))
	})
}
