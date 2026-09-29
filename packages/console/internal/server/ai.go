package server

import (
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
)

// the deployment's model choice, read.
//
// **the write is the vars press and there is no second door for it.** `AI_MODEL` is one of the
// configuration values, so a choice goes up through `POST /api/values/vars` like any other, held
// there to internal/release's AIModels (./values.go); a page that chose re-reads here to learn what
// the account's credits say about it. what the read carries and why is internal/deployment's
// aimodel.go.
func aiRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	store *account.Store,
) {
	routes.HandleFunc("GET /api/ai-model", func(w http.ResponseWriter, r *http.Request) {
		accountID, credential, held := operating(w, r, flow, store)
		if !held {
			return
		}
		if credential.Kind == cf.NoCredential {
			answer(w, http.StatusOK, deployment.ModelChoice{
				Kind:    deployment.ValuesNoCredential,
				Credits: deployment.Credits{Kind: deployment.CreditsNotAsked},
				Detail:  credential.Detail,
			})
			return
		}
		answer(w, http.StatusOK, deployment.ReadModelChoice(
			r.Context(), reads(credential), accountID, release.Baked.Name, flow.TokenSet()))
	})
}
