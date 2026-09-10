// Package server is the local http server the console draws its ui through.
//
// **it answers on the loopback address alone and offers no cors, and both of those are the door
// rather than a default.** this process holds a cloudflare credential and answers presses that
// spend it, so any page open in the operator's browser can reach it by name —
// `http://127.0.0.1:5320` resolves from any origin. what stops one acting on their account is
// Guard, and no header here ever invites a browser to try.
//
// **the ui is served for every path the router does not know, and `/api` is the exception.** a
// client route is a path only the browser resolves, so a deep link has to reach the document — but
// an `/api` path that fell through is a call to something that is not there, and a page answering
// it would be read as a success by whatever called it.
package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/better-giving/console/internal/account"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/oauth"
	"github.com/better-giving/console/internal/state"
	"github.com/better-giving/console/internal/stripe"
)

// Options is what one console server is built around.
type Options struct {
	// UI serves the embedded page, and everything the router does not know reaches it.
	UI http.Handler
	// Version and Commit are what this binary was built at, which /api/version answers with.
	Version string
	Commit  string
	// Flow is the cloudflare sign-in this machine holds, and the browser flow that changes it.
	Flow *oauth.Flow
	// Reads is how a cloudflare read is made on a credential. Nil is cloudflare's own API.
	Reads func(cf.Credential) cf.Get
	// Patches is how a group of credentials is written on a credential, which is a merge patch and
	// the one call this console makes in a json dialect of its own. Nil is cloudflare's own API.
	Patches func(cf.Credential) cf.Send
	// Settings is how a var is written on a credential, which is the multipart patch cloudflare
	// takes no json body for, and how the worker's script goes up. Nil is cloudflare's own API.
	Settings func(cf.Credential) cf.MultipartUpload
	// Sends is how a plain json call to cloudflare is made on a credential, which is the widget the
	// site list is levelled against. Nil is cloudflare's own API.
	Sends func(cf.Credential) cf.Send
	// Surface is how a call to a deployment's own console surface is bound, so a case can answer
	// for one without a deployment. Nil is a json call carrying the session as a bearer.
	Surface func(origin, token string) cf.Send
	// Processor is how a call to the payment processor is bound to the secret key one press
	// carries, so a case can run the whole setup chain without a processor account. Nil is the
	// processor's own API.
	Processor func(secretKey string) stripe.Call
	// Accounts is which cloudflare account this deployment is in, as this machine remembers it.
	Accounts *account.Store
	// Records is what this machine remembers between runs, which the session is read out of and
	// which a sign-in that could not be written down is named by.
	Records state.Store
	// Presses is where the long presses register the reading a stop makes of them. Nil is a server
	// nothing is waiting on, which is every case that starts one without a terminal to stop it.
	Presses *Presses
	// Close asks the run around this server to end, which the close press calls and may call more
	// than once — guarding a second press is the run's own (../../cmd/better-giving/main.go). Nil
	// is a server with no run to stop, which is every case that starts one; the press still
	// answers, having stopped nothing.
	Close func()
}

// New is the console's routes, behind the guard every request passes through.
func New(options Options) http.Handler {
	reads := options.Reads
	if reads == nil {
		reads = cf.APIGet
	}
	patches := options.Patches
	if patches == nil {
		patches = cf.APIMergePatch
	}
	settings := options.Settings
	if settings == nil {
		settings = cf.APIMultipart
	}
	surface := options.Surface
	if surface == nil {
		surface = deploymentCalls
	}
	processor := options.Processor
	if processor == nil {
		processor = stripe.Bind
	}
	sends := options.Sends
	if sends == nil {
		sends = cf.APISend
	}
	presses := options.Presses
	if presses == nil {
		presses = &Presses{}
	}
	doors := surfaceDoors(options.Records, surface)

	routes := http.NewServeMux()
	signIn(routes, options.Flow, reads, options.Records)
	accountRoutes(routes, options.Flow, reads, options.Accounts)
	homeRoutes(routes, options.Flow, reads, options.Accounts, options.Records, surface)
	valuesRoutes(routes, options.Flow, reads, patches, settings, options.Accounts)
	sessionRoutes(routes, options.Flow, reads, patches, options.Accounts, options.Records)
	errandRoutes(routes, doors)
	widgetRoutes(routes, options.Flow, reads, sends, options.Accounts)
	stripeRoutes(routes, options.Flow, reads, patches, settings, options.Accounts, doors, processor,
		presses)
	closeRoutes(routes, options.Close)
	routes.HandleFunc("GET /api/version", func(w http.ResponseWriter, _ *http.Request) {
		// a placeholder while the folds are still the react app's own: what it says is true, and
		// what it proves is that the proxy and the embed are wired to the same process.
		answer(w, http.StatusOK, map[string]string{
			"version": options.Version,
			"commit":  options.Commit,
		})
	})
	routes.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		answer(w, http.StatusNotFound, map[string]string{"error": "no such endpoint"})
	})
	routes.Handle("/", options.UI)
	return headers(Guard(routes))
}

// how much of a request's headers this server reads before it is a request nobody made.
//
// The body cap is stated per handler and covers no part of this: headers are read before any
// handler runs, and an http.Server that states none takes a megabyte of them.
const headerBytes = 64 << 10

// headers is what every answer carries, refusals included, which is why it is outside the guard.
//
// **two, and the two that are true of a server bound to the loopback address.** nothing may guess
// the type of a body this answers with, and no address of this console travels to a page the
// operator follows a link to.
//
// **no content security policy and no strict transport security.** this is plain http on 127.0.0.1
// by design (the package comment above), so hsts is a promise about a scheme this server does not
// speak, and the page it serves is built by vite — whose dev server injects the inline scripts a
// policy would have to name.
func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		said := w.Header()
		said.Set("X-Content-Type-Options", "nosniff")
		said.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// Listen is the server New's handler is served by, stated at the loopback address alone.
//
// **it binds nothing, and Addr is the one spelling of that address.** the caller takes the listener
// itself and hands it to Serve (../../cmd/better-giving/main.go's bind), so that nothing claims the
// console is there until this process holds the port — and an address spelled again at that end
// would be the live one, with the loopback-only guarantee ./Guard rests on declared here where
// nothing would read it.
//
// The timeouts and the header bound are stated because an http.Server sets none of its own: a
// request that never finishes arriving would otherwise hold a connection for as long as the process
// lives, and one that never stops naming headers is read to a megabyte before a handler sees it.
func Listen(handler http.Handler, port int) *http.Server {
	return &http.Server{
		Addr:              net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		Handler:           handler,
		MaxHeaderBytes:    headerBytes,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		// no answer here is held open: every one is a read or a write to cloudflare or to the
		// deployment, each carrying a deadline of its own (internal/cf), and this bounds them all.
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
}

// Guard refuses any request that another page could have caused.
//
// **The name the request arrived under is read first, and it is the reading the other two rest on.**
// A page served from `http://evil.test:5320/`, whose dns answers 127.0.0.1 on a second lookup, is
// same-origin with this server as far as the browser is concerned: it sends `Sec-Fetch-Site:
// same-origin`, a GET of its own carries no `Origin` at all, and a fetch that does carry one sends
// `Origin` and `Host` that agree with each other. Comparing those two to each other therefore
// establishes nothing. What that page cannot do is make the browser send a loopback `Host`, so
// refusing every host but the three loopback spellings is what closes it.
//
// Then two more readings, because neither covers the other. `Origin` is sent by every fetch a page
// makes cross-origin and by every form post, and comparing it against the host the request arrived
// at is what tells this server's own page from any other. `Sec-Fetch-Site` is the browser's own
// account of where a request came from and is sent where `Origin` is not — `same-site` is refused
// beside `cross-site` because a sibling name is not this origin either.
//
// A request carrying neither is served: that is a page this server drew making a same-origin GET,
// and an address the operator typed.
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(r.Host) {
			refuse(w, "this console answers on the loopback name only")
			return
		}
		switch r.Header.Get("Sec-Fetch-Site") {
		case "cross-site", "same-site":
			refuse(w, "this console answers its own page only")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !isSameOrigin(origin, r.Host) {
			refuse(w, "this console answers its own page only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// whether the request arrived under a name that only this machine answers.
//
// The three spellings are the whole list: anything else is a name that resolved here rather than
// one that means here. `localhost` is on it because the dev proxy forwards it verbatim and because
// it is what an operator types.
func isLoopbackHost(host string) bool {
	name, _, err := net.SplitHostPort(host)
	if err != nil {
		// a host carrying no port, which is what a request to port 80 arrives with.
		name = host
	}
	switch strings.Trim(name, "[]") {
	case "127.0.0.1", "localhost", "::1":
		return true
	default:
		return false
	}
}

// whether `origin` names the host this request arrived at.
//
// The host is the request's own rather than the bound address, because under `pnpm run console` a
// request reaches this process through vite's proxy: the browser's page is `localhost:5322` and
// both headers say so, while this process is listening on another port entirely. Comparing against
// the bound address would refuse every dev call. What makes the pair agree across that hop is
// `changeOrigin: false` in packages/console-ui/vite.config.ts, whose own comment states why the proxy
// entry is written as an object.
func isSameOrigin(origin, host string) bool {
	stated, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return stated.Host != "" && stated.Host == host
}

func refuse(w http.ResponseWriter, why string) {
	answer(w, http.StatusForbidden, map[string]string{"error": why})
}

func answer(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
