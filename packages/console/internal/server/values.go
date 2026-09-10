package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
)

// the two presses over the thirteen values this deployment is configured with: one sets them and
// takes them off, and one frees a name the deployment is holding as a credential.
//
// **what a browser posts is names and values, and a name mapped to `null` is a removal.** setting
// and removing are one door because they are one patch of the worker's bindings — internal/deployment
// is where that is argued.
//
// **a body is refused in two cases.** internal/release holds the thirteen, and a name off that list
// is refused here rather than written under whatever the page said — the console's own session
// credential is on no enumeration and is not reachable through this door. the other is a name
// carrying a blank, which is neither a value the deployment reads nor the removal `null` is.
//
// **every one of them answers 200 carrying how the write went.** each way a write did not happen is
// a state the fold draws at the control that was pressed, with a sentence and a way out of its own,
// so a status carrying it would make the page's own reading a failure to recover from. the codes
// here are for the presses that never reached a write at all: a machine with no account chosen, and
// a body this console will not act on.
//
// **no value reaches this file's own answers.** what crosses back is a kind, cloudflare's words
// about the call, and the names of any vars held as credentials — internal/deployment is where the
// values go, and they go into a request body and nowhere else.

// how much of a press's body is read before it is a request nobody made.
//
// The whole enumeration is the largest thing posted here — thirteen names and their values — and
// anything past that is not this page.
const writtenBytes = 32 << 10

func valuesRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
) {
	// sets the vars a fold's boxes carry, which is a read of the worker's bindings and one patch
	// back.
	routes.HandleFunc("POST /api/values/vars", func(w http.ResponseWriter, r *http.Request) {
		var posted struct {
			Values map[string]*string `json:"values"`
		}
		if !decoded(w, r, &posted) {
			return
		}
		for name, value := range posted.Values {
			if !enumerated(release.DeployVars, name) {
				refuseName(w, name)
				return
			}
			if value == nil {
				continue
			}
			// the deployment reads a blank as nothing at all, so storing one would leave this console
			// drawing a value the deployment does not read. taking the name off is what an emptied box
			// asks for, and that is the `null` above.
			if strings.TrimSpace(*value) == "" {
				answer(w, http.StatusBadRequest, map[string]string{
					"error": "this console does not store " + name + " with nothing in it",
				})
				return
			}
		}

		door, held := writing(w, r, flow, reads, patches, settings, store)
		if !held {
			return
		}
		answer(w, http.StatusOK, deployment.SetVars(r.Context(), door, posted.Values))
	})

	// takes every var this deployment is holding as a credential off it.
	//
	// It carries no body at all: which names are freed is read off cloudflare inside the binary, and
	// a name a page chose would be a credential deleted wherever that page said.
	routes.HandleFunc("POST /api/values/vars/free", func(w http.ResponseWriter, r *http.Request) {
		door, held := writing(w, r, flow, reads, patches, settings, store)
		if !held {
			return
		}
		answer(w, http.StatusOK, deployment.FreeWithheldVars(r.Context(), door))
	})
}

// one press's body, or the refusal a body this console will not act on earned.
//
// The bound and the refusal of an unknown member are the door every posted body here passes: what
// arrives is names and values, and anything else is not this page.
func decoded(w http.ResponseWriter, r *http.Request, into any) bool {
	return decodedWithin(w, r, into, writtenBytes)
}

// that same door, bounded by what the press it belongs to may carry.
func decodedWithin(w http.ResponseWriter, r *http.Request, into any, bytes int64) bool {
	reader := json.NewDecoder(http.MaxBytesReader(w, r.Body, bytes))
	reader.DisallowUnknownFields()
	if err := reader.Decode(into); err != nil {
		answer(w, http.StatusBadRequest, map[string]string{
			"error": "this console reads a press naming the values to set and nothing else",
		})
		return false
	}
	return true
}

// the account this machine is operating and the sign-in it holds, or the answer a press that has
// neither got instead.
//
// The account is this machine's own record and the worker is the baked release's: neither travels
// through a browser, because a name that did would be a value written onto a worker the operator is
// not looking at.
//
// A credential this console does not hold is handed back rather than answered here, because what
// each door says about one differs: a write reports it as a write that never happened, and the
// press that stands a deployment up reports it as the first step of a chain that made nothing.
func operating(
	w http.ResponseWriter,
	r *http.Request,
	flow *oauth.Flow,
	store *account.Store,
) (string, cf.Credential, bool) {
	chosen := store.Chosen()
	if chosen == nil {
		// every press here is scoped to an account, so there is nowhere to write rather than a write
		// that failed. the page draws the panel that chooses one.
		answer(w, http.StatusConflict, map[string]string{
			"error": "this console has not been told which Cloudflare account this deployment is in",
		})
		return "", cf.Credential{}, false
	}
	return chosen.Account.ID, flow.Credential(r.Context()), true
}

// the door a press writes through, or the answer it got instead.
func writing(
	w http.ResponseWriter,
	r *http.Request,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
) (deployment.Door, bool) {
	accountID, credential, held := operating(w, r, flow, store)
	if !held {
		return deployment.Door{}, false
	}
	if credential.Kind == cf.NoCredential {
		// nothing is asked of cloudflare on a credential this console does not hold: what an operator
		// does about it is sign in, which is a state the fold already draws.
		answer(w, http.StatusOK, deployment.NoCredentialWrite(credential.Detail))
		return deployment.Door{}, false
	}

	return deployment.Door{
		AccountID:  accountID,
		WorkerName: release.Baked.Name,
		Get:        reads(credential),
		Patch:      patches(credential),
		Settings:   settings(credential),
	}, true
}

// whether `name` is on the enumeration.
func enumerated(enumeration []string, name string) bool {
	for _, one := range enumeration {
		if one == name {
			return true
		}
	}
	return false
}

func refuseName(w http.ResponseWriter, name string) {
	answer(w, http.StatusBadRequest, map[string]string{
		"error": "this console sets the thirteen values a deployment is configured with, and " +
			name + " is not one of them",
	})
}
