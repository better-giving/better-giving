package server

import "net/http"

// the one press that ends the run this server is inside.
//
// **the console is a binary on the operator's own machine, so closing the tab leaves it running.**
// nothing else on the machine says a process is holding the loopback port, and the terminal it was
// typed in is often not the window the operator is looking at — so the page it draws is where the
// run is ended from, and this is the door.
//
// **the answer is written and the handler returns, and neither the listener nor the process is
// touched here.** what ends the run is the hook, and `http.Server.Shutdown` waits for the request
// that called it — so the page reads its answer because the stop is somebody else's to make
// (../../cmd/better-giving/main.go). a handler that shut the listener down under itself, or slept
// to let the bytes out, would be racing the thing that already waits.

func closeRoutes(routes *http.ServeMux, asked func()) {
	routes.HandleFunc("POST /api/console/close", func(w http.ResponseWriter, _ *http.Request) {
		answer(w, http.StatusOK, map[string]bool{"closing": true})
		if asked != nil {
			asked()
		}
	})
}
