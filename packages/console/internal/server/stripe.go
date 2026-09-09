package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/stripe"
)

// the press that sets the payment processor up, and the poll that watches it.
//
// **the press answers as soon as the chain is under way and never with what the chain did.** the
// chain is several round trips against three hosts, so a request held open for it is a page that
// cannot say which part is running. how far it has got is read off the run this process is holding
// (internal/stripe), and a landed run is consumed by the reading that observed it while a stopped
// one stays until the next press clears it.
//
// **the two keys are values for the length of one press.** they arrive in one body over the
// loopback address, are handed straight to internal/stripe — one bound to the caller, one into a
// settings patch — and reach no answer, no log line and no argument list. every case in
// ./stripe_test.go asserts their absence from what the poll hands back.
//
// **no shape is read at this door, and none is read in the browser.** whether a value is a key
// Stripe takes is Stripe's to answer, and the chain's first call asks it (`naming` in
// internal/stripe). what the door refuses is a slot holding nothing or a value with space around
// it, which is the same reading the fold makes of an empty box (`stripeRefusals` in
// packages/console-ui/src/lib/stripe-keys.ts).
//
// **the account and the worker are read on this machine and never posted.** a name that travelled
// through a page is an endpoint registered, and a credential written, wherever that page said.

// how much of the press's body is read before it is a request nobody made. Two keys and nothing
// else, and anything past that is not this page.
const pressedBytes = 8 << 10

// the two keys, as the fold posts them. An empty secret is the press that leaves the stored one
// alone, which can make no call to the processor at all and is the var write by itself.
type stripePress struct {
	Secret      string `json:"secret"`
	Publishable string `json:"publishable"`
}

func stripeRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	settings func(cf.Credential) cf.MultipartUpload,
	store *account.Store,
	doors func() (cf.Get, cf.Post),
	processor func(secretKey string) stripe.Call,
	presses *Presses,
) {
	runs := &stripe.Runs{}
	presses.watch(func() (string, bool) { return stripeGoing(runs) })

	routes.HandleFunc("POST /api/stripe/setup", func(w http.ResponseWriter, r *http.Request) {
		var posted stripePress
		if !decodedWithin(w, r, &posted, pressedBytes) {
			return
		}
		asked, refusal := asking(posted)
		if refusal != "" {
			answer(w, http.StatusBadRequest, map[string]string{"error": refusal})
			return
		}

		door, held := writing(w, r, flow, reads, patches, settings, store)
		if !held {
			return
		}

		// the run outlives this request by design, so it is given a context of its own: one that
		// ended with the handler would cancel every call the chain has left to make. each of those
		// calls carries a deadline of its own (internal/cf), which is what bounds the run.
		started, going := runs.Start(context.Background(), asked, stripe.Effects{
			Call: processor(posted.Secret),
			Address: func(ctx context.Context) deployment.Address {
				return deployment.PublicAddress(ctx, door.Get, door.AccountID, door.WorkerName)
			},
			Repeating: func(ctx context.Context) deployment.RecurringSetup {
				_, post := doors()
				return deployment.SetUpRecurring(ctx, post)
			},
			// the session is read at the press rather than closed over once, which is
			// internal/deployment's arrangement for every credential: a run outliving the request it
			// was started by is one this console may re-mint a session under while it goes.
			Covering: func(ctx context.Context) deployment.WalletsLevel {
				_, post := doors()
				return deployment.LevelWallets(ctx, post)
			},
			Publish: func(ctx context.Context, values map[string]string) deployment.Written {
				return deployment.SetVars(ctx, door, deployment.Stored(values))
			},
		})
		if !going {
			// one at a time: two chains racing each other would leave the account holding whichever
			// endpoint was created last and the deployment holding whichever secret was stored last,
			// which are not necessarily the same one. the run already going comes back, because that
			// is what the fold draws either way.
			answer(w, http.StatusConflict, map[string]any{"run": started})
			return
		}
		answer(w, http.StatusOK, map[string]any{"run": started})
	})

	// how far the press has got, asked over and over while it runs.
	//
	// A run that landed is handed over and then dropped: the whole of what says a press worked is
	// the reading the fold is holding when it stops, so a reload afterwards is a clean face rather
	// than the last press reported again. A run that stopped is left where it is — a failure has to
	// survive a reload — and the next press is what clears it.
	routes.HandleFunc("GET /api/stripe/run", func(w http.ResponseWriter, _ *http.Request) {
		run := runs.Read()
		if run != nil && run.Kind == "ended" && run.Outcome != nil && run.Outcome.Kind == stripe.Done {
			runs.Forget()
		}
		answer(w, http.StatusOK, map[string]any{"run": run})
	})
}

// what the two keys asked for, or the refusal a body this console will not act on earned.
//
// **a value is never trimmed and a padded one is refused.** trimming would store a key that differs
// from what the operator is looking at, and sending one would fail against the processor with a
// sentence about a key rather than about a space.
func asking(posted stripePress) (stripe.Asked, string) {
	if !filled(posted.Publishable) {
		return stripe.Asked{}, "the published slot holds nothing, or a value with space around it"
	}
	if posted.Secret == "" {
		// nothing can read a stored credential back, so a press that left that box alone has no key
		// to make a single call with: what is left is the var.
		return stripe.Asked{Act: stripe.ActPublish, PublishableKey: posted.Publishable}, ""
	}
	if !filled(posted.Secret) {
		return stripe.Asked{}, "the charging slot holds a value with space around it"
	}
	return stripe.Asked{
		Act:            stripe.ActErrand,
		SecretKey:      posted.Secret,
		PublishableKey: posted.Publishable,
	}, ""
}

// whether a slot holds a value, and one that carries no space around it.
func filled(key string) bool {
	return key != "" && key == strings.TrimSpace(key)
}

// what a stop is told about a processor setup this process is holding.
//
// The stage is named because the chain's steps are not alike: one deletes an endpoint and the next
// creates its replacement, and a console that went away between the two leaves the deployment
// receiving nothing.
func stripeGoing(runs *stripe.Runs) (string, bool) {
	held := runs.Read()
	if held == nil || held.Kind != "running" {
		return "", false
	}
	return "the payments setup is still running (" + string(held.Stage) + ")", true
}
