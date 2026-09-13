package terminal

import (
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
)

// what `start` says as it connects this console to a deployment already standing, which is the last
// act in front of the console being served (../../cmd/better-giving/start.go's connecting).
//
// **connecting is said before it is made, and running `start` is the agreement to it.** the session
// written replaces whatever session the deployment held (../deployment/connect.go), so a console
// another machine has open there is signed out by this press — and the terminal is the one place
// that can say so while it happens.
//
// **a connect that did not land is the end of the run and never a console served over it.** every
// screen the console draws is a reading taken over that session, so a page opened without one is a
// page of failures with nothing on it to act on; the sentence here is the act instead.

// ReplacingOtherConsoles is the line said in front of the connect.
var ReplacingOtherConsoles = "connecting this console to your deployment, which signs out any " +
	"other console connected to it"

// Unconnected is a connect that did not land, in one sentence ending in what to do about it.
//
// `dir` is the folder this machine keeps what it remembers in, named where the session reached the
// deployment and could not be written down here: making that folder writable is the act, and a
// sentence that did not say which folder is one the operator cannot act on.
func Unconnected(kind deployment.ConnectionKind, dir string) string {
	name := release.Baked.Name
	switch kind {
	case deployment.ConnectNowhere:
		return name + " answers on no address this console can read, so the console couldn't " +
			"connect to it and wasn't opened. " + again
	case deployment.ConnectRefused:
		return "Cloudflare won't let this sign-in store the console's session on " + name +
			", so the console wasn't opened. " + AnotherAccount
	case deployment.ConnectUnreachable:
		return "Cloudflare didn't answer, so the console couldn't connect to " + name +
			" and wasn't opened. Check this machine's connection, " + Starting.After
	case deployment.ConnectUnkept:
		return name + " holds this console's session and this machine couldn't write it down in " +
			Code(dir) + ", so the console wasn't opened. Make that folder writable, " +
			Starting.After
	default:
		return "Cloudflare didn't store the console's session on " + name +
			", so the console wasn't opened. " + again
	}
}
