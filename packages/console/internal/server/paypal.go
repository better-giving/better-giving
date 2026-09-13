package server

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/paypal"
)

// the press that sets PayPal up, and the poll that watches it.
//
// ./stripe.go's arrangement, down to the answers: the press answers as soon as the chain is under
// way, the poll reads the run internal/paypal holds, a landed run is consumed by the poll that
// observed it, and a stopped one stays until the next press.
//
// **it is the only way the PayPal pair reaches a deployment from a screen.** the pair and the
// listener's id are one write made at the end of the chain, so a deployment is never holding a pair
// with no listener behind it — a deployment whose approved orders are never captured. POST
// /api/values/vars refuses the three names (./values.go's paypalSetUpOnly), so no fold can skip the
// listener.
//
// **both halves are values for the length of one press**, handed straight to internal/paypal and
// reaching no answer, no log line and no argument list; ./paypal_test.go asserts their absence from
// what the poll hands back. no shape is read at this door: whether a pair authenticates is PayPal's to
// answer, and the chain's first call asks it.

// the pair, as the fold posts it. both halves are required: a stored secret is readable by nothing,
// so a press that left one box empty holds nothing a token can be minted with.
type paypalPress struct {
	ClientID string `json:"clientId"`
	Secret   string `json:"secret"`
}

func paypalRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
	bind func(clientID, secret string) paypal.Binding,
	presses *Presses,
) {
	runs := &paypal.Runs{}
	presses.watch(func() (string, bool) {
		held := runs.Read()
		if held == nil || held.Kind != "running" {
			return "", false
		}
		return "the PayPal setup is still running (" + string(held.Stage) + ")", true
	})

	routes.HandleFunc("POST /api/paypal/setup", func(w http.ResponseWriter, r *http.Request) {
		var posted paypalPress
		if !decodedWithin(w, r, &posted, pressedBytes) {
			return
		}
		if !filled(posted.ClientID) {
			answer(w, http.StatusBadRequest, map[string]string{
				"error": "the client id slot holds nothing, or a value with space around it",
			})
			return
		}
		if !filled(posted.Secret) {
			answer(w, http.StatusBadRequest, map[string]string{
				"error": "the secret slot holds nothing, or a value with space around it",
			})
			return
		}

		door, held := writing(w, r, flow, reads, patches, settings, store)
		if !held {
			return
		}

		binding := bind(posted.ClientID, posted.Secret)
		// the run outlives this request by design, so it is given a context of its own; each call
		// carries a deadline of its own (internal/cf), which is what bounds the run.
		started, going := runs.Start(context.Background(),
			paypal.Asked{ClientID: posted.ClientID, Secret: posted.Secret},
			paypal.Effects{
				Authorize: binding.Authorize,
				Bearer:    binding.Bearer,
				Address: func(ctx context.Context) deployment.Address {
					return deployment.PublicAddress(ctx, door.Get, door.AccountID, door.WorkerName)
				},
				Publish: func(ctx context.Context, values map[string]string) deployment.Written {
					return deployment.SetVars(ctx, door, deployment.Stored(values))
				},
			})
		if !going {
			answer(w, http.StatusConflict, map[string]any{"run": started})
			return
		}
		answer(w, http.StatusOK, map[string]any{"run": started})
	})

	routes.HandleFunc("GET /api/paypal/run", func(w http.ResponseWriter, _ *http.Request) {
		run := runs.Read()
		if run != nil && run.Kind == "ended" && run.Outcome != nil && run.Outcome.Kind == paypal.Done {
			runs.Forget()
		}
		answer(w, http.StatusOK, map[string]any{"run": run})
	})
}
