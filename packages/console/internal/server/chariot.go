package server

import (
	"context"
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/chariot"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
)

// the press that sets Chariot up, and the poll that watches it.
//
// ./paypal.go's arrangement, down to the answers: the press answers as soon as the chain is under
// way, the poll reads the run internal/chariot holds, a landed run is consumed by the poll that
// observed it, and a stopped one stays until the next press.
//
// **it is the only way Chariot's four values reach a deployment from a screen.** the Connect id is
// fetched with the key and the webhook secret is minted for the subscription the press makes, and
// all four are one write made after the subscription is settled — so POST /api/values/vars refuses
// the four names (./values.go's chariotSetUpOnly), and no page can store a key beside a Connect or a
// secret it did not produce.
//
// **the key is a value for the length of one press**, handed straight to internal/chariot and
// reaching no answer, no log line and no argument list; ./chariot_test.go asserts its absence from
// what the poll hands back. what is read at this door is shape alone: whether the key answers at the
// address is Chariot's to say, and the chain's first call asks it.

// the two boxes, as the page posts them. an empty address is live.
type chariotPress struct {
	APIKey  string `json:"apiKey"`
	Address string `json:"address"`
}

func chariotRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
	doors func() (cf.Get, cf.Post),
	bind func(address, apiKey string) chariot.Call,
	presses *Presses,
) {
	runs := &chariot.Runs{}
	presses.watch(func() (string, bool) {
		held := runs.Read()
		if held == nil || held.Kind != "running" {
			return "", false
		}
		return "the Chariot setup is still running (" + string(held.Stage) + ")", true
	})

	routes.HandleFunc("POST /api/chariot/setup", func(w http.ResponseWriter, r *http.Request) {
		var posted chariotPress
		if !decodedWithin(w, r, &posted, pressedBytes) {
			return
		}
		if !filled(posted.APIKey) {
			answer(w, http.StatusBadRequest, map[string]string{
				"error": "the api key slot holds nothing, or a value with space around it",
			})
			return
		}
		address, isAddress := cf.Base(posted.Address, chariot.API)
		if !isAddress {
			answer(w, http.StatusBadRequest, map[string]string{
				"error": "the address slot holds something other than an https address with no path, " +
					"and nothing at all is live",
			})
			return
		}

		door, held := writing(w, r, flow, reads, patches, settings, store)
		if !held {
			return
		}

		// the run outlives this request by design, so it is given a context of its own; each call
		// carries a deadline of its own (internal/cf), which is what bounds the run.
		started, going := runs.Start(context.Background(),
			chariot.Asked{APIKey: posted.APIKey, Address: address},
			chariot.Effects{
				Call: bind(address, posted.APIKey),
				// the session is read at the press rather than closed over once, for the reason
				// ./stripe.go states above its own Covering.
				Profile: func(ctx context.Context) deployment.ReportRead {
					get, _ := doors()
					if get == nil {
						return deployment.ReportRead{NoReport: deployment.NoReport{Kind: deployment.NoSession}}
					}
					return deployment.Report(ctx, get)
				},
				Address: func(ctx context.Context) deployment.Address {
					return deployment.PublicAddress(ctx, door.Get, door.AccountID, door.WorkerName)
				},
				Publish: func(ctx context.Context, values map[string]*string) deployment.Written {
					return deployment.SetVars(ctx, door, values)
				},
			})
		if !going {
			answer(w, http.StatusConflict, map[string]any{"run": started})
			return
		}
		answer(w, http.StatusOK, map[string]any{"run": started})
	})

	routes.HandleFunc("GET /api/chariot/run", func(w http.ResponseWriter, _ *http.Request) {
		run := runs.Read()
		if run != nil && run.Kind == "ended" && run.Outcome != nil && run.Outcome.Kind == chariot.Done {
			runs.Forget()
		}
		answer(w, http.StatusOK, map[string]any{"run": run})
	})
}
