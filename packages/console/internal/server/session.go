package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/session"
	"github.com/better-giving/console/internal/state"
)

// the one press that opens this console's session on the deployment.
//
// **it answers 200 carrying how the press went.** every way it did not happen is a state the panel
// draws at the control that was pressed, with a sentence and a way out of its own, so a status
// carrying it would make the page's own reading a failure to recover from. the code here is for the
// press that never reached a write at all: a machine with no account chosen.
//
// **one press at a time, and a second joins the first's outcome.** two writes in flight leave this
// console holding whichever token it recorded last while the deployment holds whichever was written
// last, which are not necessarily the same one — and the console would then be refused by a
// deployment it had just connected to.
//
// **the account and the worker are this machine's own and never a browser's.** the account is the
// recorded choice and the worker is the baked release's, which is what pairs the address read with
// the write; a name that travelled through a page would be a credential written onto a worker the
// operator is not looking at.

func sessionRoutes(
	routes *http.ServeMux,
	flow *oauth.Flow,
	reads func(cf.Credential) cf.Get,
	patches func(cf.Credential) cf.Send,
	store *account.Store,
	records state.Store,
) {
	presses := &connectPresses{}

	routes.HandleFunc("POST /api/session", func(w http.ResponseWriter, r *http.Request) {
		chosen := store.Chosen()
		if chosen == nil {
			// the write is scoped to an account, so there is nowhere to write rather than a write
			// that failed. the page draws the panel that chooses one.
			answer(w, http.StatusConflict, map[string]string{
				"error": "this console has not been told which Cloudflare account this deployment is in",
			})
			return
		}

		credential := flow.Credential(r.Context())
		answer(w, http.StatusOK, presses.joined(r.Context(), func(ctx context.Context) deployment.Connection {
			return deployment.Connect(ctx, deployment.ConnectInputs{
				Door: deployment.Door{
					AccountID:  chosen.Account.ID,
					WorkerName: release.Baked.Name,
					Get:        reads(credential),
					Patch:      patches(credential),
				},
				Credential: credential,
				Record: func(mine session.Session) error {
					return session.Record(records, mine)
				},
				Now: time.Now(),
			})
		}))
	})
}

// the connect press this process is making, if it is making one.
type connectPresses struct {
	guard   sync.Mutex
	running *connectPress
}

// one press, and the outcome every request that joined it is answered with.
type connectPress struct {
	done    chan struct{}
	outcome deployment.Connection
}

// joined runs `press` where none is running, and waits on the running one where there is.
//
// The press outlives the request that started it, because a tab closed mid-write would otherwise
// tear a call that is already storing a credential on the deployment — leaving a session live there
// that nothing recorded. The call has a deadline of its own, so nothing here waits without bound.
func (presses *connectPresses) joined(
	ctx context.Context,
	press func(context.Context) deployment.Connection,
) deployment.Connection {
	presses.guard.Lock()
	if held := presses.running; held != nil {
		presses.guard.Unlock()
		<-held.done
		return held.outcome
	}
	mine := &connectPress{done: make(chan struct{})}
	presses.running = mine
	presses.guard.Unlock()

	mine.outcome = press(context.WithoutCancel(ctx))

	presses.guard.Lock()
	presses.running = nil
	presses.guard.Unlock()
	close(mine.done)
	return mine.outcome
}
