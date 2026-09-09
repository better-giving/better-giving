package server

import (
	"net/http"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/widget"
)

// the half of a site-list save that reaches cloudflare.
//
// **it spends the operator's own cloudflare credential, which is why it is not one of
// ./errands.go's.** every errand there is handed `doors` and posted to the deployment's own console
// surface over the session this console holds, and the deployment decides it. the spam widget is a
// resource on the cloudflare account rather than anything the deployment owns, so this press reads
// and writes it directly and no deployment is asked anything.

// the list a levelling is brought behind, as the sites fold posts it.
type levelPress struct {
	Sites []string `json:"sites"`
}

func widgetRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	sends func(cf.Credential) cf.Send,
	store *account.Store,
) {
	// brings cloudflare's copy of the site list level behind what the deployment stored.
	//
	// **the deployment is written first and cloudflare is levelled behind it**, which is the order
	// whose failure costs least: a removal in this order leaves cloudflare covering a host nothing
	// is served on, where the reverse would leave a host still served and no longer challengeable,
	// and every gift from it would fail. The page calls this only where the list landed, and posts
	// the list the deployment stored rather than the boxes.
	//
	// **the widget's name is the baked release's and the account is this machine's record.** what
	// crosses is the list alone: a name that travelled through a page is a widget somebody else's
	// account is levelled against.
	//
	// **this deployment's own host goes up in front of every ticked site, so an operator cannot
	// untick their own donation page.** the donor-facing page is a route on this worker and is on no
	// site row (CLAUDE.md → Product surface), so a levelling taken off the boxes alone would leave
	// that page challenging nobody the first time somebody saves an empty list. the host is read off
	// the account the way the chain reads it, and a deployment this console cannot read an address
	// for adds nothing rather than a host it guessed.
	routes.HandleFunc("POST /api/widget/level", func(w http.ResponseWriter, r *http.Request) {
		var posted levelPress
		if !decoded(w, r, &posted) {
			return
		}
		accountID, credential, held := operating(w, r, flow, store)
		if !held {
			return
		}
		if credential.Kind == cf.NoCredential {
			answer(w, http.StatusOK, widget.NotLevelled(credential.Detail))
			return
		}
		door := deployment.Door{
			AccountID:  accountID,
			WorkerName: release.Baked.Name,
			Get:        reads(credential),
		}
		// widget.Hosts drops a row with no host in it and takes the repeats out, so a ticked site
		// that is this deployment's own address is covered once and stays first.
		covering := append([]string{effects.OwnAddress(r.Context(), door).Origin()}, posted.Sites...)
		answer(w, http.StatusOK, widget.Bring(r.Context(),
			widget.Calls{Send: sends(credential), AccountID: accountID},
			release.Baked.TurnstileWidgetName, widget.Hosts(covering)))
	})
}
