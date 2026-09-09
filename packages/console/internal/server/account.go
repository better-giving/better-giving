package server

import (
	"encoding/json"
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/signin"
)

// the two the page asks about the account: which one this deployment is in, and choosing one.
//
// **the choice is made once and is never taken back here.** the press beside the account name
// closes the console (./close.go), and nothing on this surface drops the pointer — what picks
// another account is `better-giving login` in a terminal, which records over it.
//
// **the posted id is never trusted.** the account list is read again on every press and an id that
// is not on it is refused, so a list that changed while the panel was open, a stale tab and an
// edited request all land on the same named refusal beside the list.
//
// **a refusal is a word rather than a sentence.** the four of them are states the panel already has
// words for, and the sentence it draws names the account and offers the way out — so what crosses
// here is which refusal it was, and the account it is about where there is one to name.
//
// **the page is handed an account and never a credential**, which is the same rule ./signin.go
// holds to: what reaches a browser is an id, a name and what has been claimed in there.

// chosen is what the page reads to draw the shell, or to find out there is not one to draw.
type chosen struct {
	// Account is null while nothing has been chosen, which is the picker.
	Account *account.Account `json:"account"`
	// Remembered is whether this machine will still know it after a restart. False on a machine the
	// state directory could not be written on, where the choice holds for this run alone.
	Remembered bool `json:"remembered"`
	// Claims is what the operator has said is this deployment's inside that account.
	Claims account.Claims `json:"claims"`
}

// refused is a press turned down, in the word the panel draws its sentence from.
type refused struct {
	Refusal string `json:"refusal"`
	// Account is what the sentence names, and is null where there is nothing to name.
	Account *string `json:"account"`
}

// how much of a press's body is read before it is a request nobody made.
//
// what arrives here is one account id, so anything past a short line is not this page.
const postedBytes = 4 << 10

func accountRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	store *account.Store,
) {
	routes.HandleFunc("GET /api/account", func(w http.ResponseWriter, _ *http.Request) {
		answer(w, http.StatusOK, read(store))
	})

	// records which account this deployment is in, which is the one irreversible choice here.
	routes.HandleFunc("POST /api/account", func(w http.ResponseWriter, r *http.Request) {
		var posted struct {
			Account string `json:"account"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, postedBytes))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&posted); err != nil {
			answer(w, http.StatusBadRequest, map[string]string{
				"error": "this console reads a press naming one account and nothing else",
			})
			return
		}
		if posted.Account == "" {
			turnDown(w, http.StatusBadRequest, "nothing", nil)
			return
		}

		credential := flow.Credential(r.Context())
		get := reads(credential)
		// the list the choice is checked against is read again here rather than taken from the page:
		// what a browser posts is intent, and the id it carries is checked against what cloudflare
		// says now.
		list := signin.Read(r.Context(), credential, flow.TokenSet(), get)
		if list.Kind != signin.OAuth && list.Kind != signin.Token {
			turnDown(w, http.StatusConflict, "signin", nil)
			return
		}
		found := named(list.Accounts, posted.Account)
		if found == nil {
			turnDown(w, http.StatusConflict, "stale", &posted.Account)
			return
		}
		// the refusal that would otherwise arrive at the first thing the deploy press creates —
		// ../account states which read it is and why it has to reach inside the account.
		if !account.Verify(r.Context(), get, found.ID) {
			turnDown(w, http.StatusForbidden, "refused", &found.Name)
			return
		}

		answer(w, http.StatusOK, map[string]bool{
			"remembered": store.Choose(account.Account{ID: found.ID, Name: found.Name}),
		})
	})
}

// what this machine says about the account, claims included.
//
// The claims are read for the chosen account alone, which is what keeps a claim made in one account
// invisible from another.
func read(store *account.Store) chosen {
	held := store.Chosen()
	if held == nil {
		return chosen{}
	}
	return chosen{
		Account:    &held.Account,
		Remembered: held.Remembered,
		Claims:     store.ClaimedIn(held.Account.ID),
	}
}

func turnDown(w http.ResponseWriter, status int, why string, about *string) {
	answer(w, status, refused{Refusal: why, Account: about})
}

// the account on this sign-in's list carrying `id`, or nil where none of them does.
func named(accounts []signin.Account, id string) *signin.Account {
	for _, one := range accounts {
		if one.ID == id {
			return &one
		}
	}
	return nil
}
