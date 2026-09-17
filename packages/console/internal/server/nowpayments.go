package server

import (
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/nowpayments"
	"github.com/better-giving/console/internal/oauth"
)

// the press that stores NOWPayments' three values: the api key, the IPN secret and the outcome
// currency.
//
// **a save and not a run.** there is no endpoint to register — each payment names its own callback
// address — so the press is two reads against NOWPayments and one var write, answered in the
// request that made it, and nothing is left going for a stop to wait on.
//
// **nothing is written until NOWPayments has said the key reads the account and the outcome currency
// is one of its coins** (internal/nowpayments). a key it turns down, or a currency it names no coin
// for, answers which of the two boxes is wrong and leaves the deployment holding exactly what it
// held. the IPN secret is minted in NOWPayments' dashboard and no call reads it back, so it is
// stored as it was typed.
//
// **it is the only way the three reach a deployment from a screen**, so POST /api/values/vars
// refuses them (./values.go's nowpaymentsSetUpOnly): a key stored there would be one nothing checked.
//
// **the key and the secret are values for the length of one press**, handed to internal/nowpayments
// and to the deployment's var door and reaching no answer, no log line and no argument list;
// ./nowpayments_test.go asserts their absence from what the press hands back.

// the three boxes, as the page posts them.
type nowpaymentsPress struct {
	APIKey          string `json:"apiKey"`
	IPNSecret       string `json:"ipnSecret"`
	OutcomeCurrency string `json:"outcomeCurrency"`
}

// nowpaymentsSaved is how one press went: `written` carries the write, and every other kind is the
// check that stopped it, with NOWPayments' own words about why.
type nowpaymentsSaved struct {
	Kind    string              `json:"kind"`
	Detail  string              `json:"detail"`
	Written *deployment.Written `json:"written"`
}

func nowpaymentsRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
	bind func(apiKey string) nowpayments.Call,
) {
	routes.HandleFunc("POST /api/nowpayments/values", func(w http.ResponseWriter, r *http.Request) {
		var posted nowpaymentsPress
		if !decodedWithin(w, r, &posted, pressedBytes) {
			return
		}
		for _, slot := range []struct{ name, typed string }{
			{"api key", posted.APIKey},
			{"IPN secret", posted.IPNSecret},
			{"outcome currency", posted.OutcomeCurrency},
		} {
			if !filled(slot.typed) {
				answer(w, http.StatusBadRequest, map[string]string{
					"error": "the " + slot.name + " slot holds nothing, or a value with space around it",
				})
				return
			}
		}

		accountID, credential, held := operating(w, r, flow, store)
		if !held {
			return
		}
		if credential.Kind == cf.NoCredential {
			nowhere := deployment.NoCredentialWrite(credential.Detail)
			answer(w, http.StatusOK, nowpaymentsSaved{Kind: "written", Written: &nowhere})
			return
		}

		checked := nowpayments.Check(r.Context(), bind(posted.APIKey), posted.OutcomeCurrency)
		if checked.Kind != nowpayments.Readable {
			answer(w, http.StatusOK, nowpaymentsSaved{Kind: string(checked.Kind), Detail: checked.Detail})
			return
		}
		door := openDoor(accountID, credential, reads, patches, settings)
		written := deployment.SetVars(r.Context(), door,
			nowpayments.Values(posted.APIKey, posted.IPNSecret, checked))
		answer(w, http.StatusOK, nowpaymentsSaved{Kind: "written", Written: &written})
	})
}
