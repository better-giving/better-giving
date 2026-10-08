// Package session is the session this console holds open to the deployment, as this machine
// records it.
//
// **minting is here beside reading, and writing the value onto the deployment is not.** what the
// grammar is, how long a session lasts and how the record is kept are one statement, and a mint
// living elsewhere would be a second one that can disagree with the reading beside it. what stays
// out is the request: a new value on the deployment replaces whatever session was on it, so that
// is an act behind a control, made through internal/deployment's own door.
//
// **the token is held here and reaches no page.** it is closed over by the reader
// internal/deployment binds, the way a cloudflare credential is closed over in internal/cf, so
// nothing that decides what a screen says holds one.
//
// **the session is held under the worker it was minted for.** a session minted for one deployment,
// answered with under another's name, would report one deployment's readiness as the other's — so
// the name is a parameter and a record naming some other worker is no session at all.
//
// **a session past its expiry is no session here.** the expiry is enforced on the deployment and
// nowhere else, so a console still offering an expired token reaches a screen about the deployment
// refusing it — which is a screen about the deployment standing in for a fact about this console.
// it is read back out of the token rather than recorded beside it, so the two halves cannot come to
// disagree.
package session

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/better-giving/console/internal/state"
)

// File is what the session is recorded under, beside the other things this machine remembers.
const File = "session.json"

// the grammar the deployment reads its bearer in: a version, the second the session ends at, and
// the part that is secret. packages/operator/src/console/token.ts is the statement of it that both
// ends are written against.
const (
	version   = "bg1"
	minRandom = 43
	parts     = 3
	// how long a session lasts. it exists for the one case nothing else closes: a console that
	// died without disconnecting leaves a live bearer on a public hostname held by nobody, and a
	// laptop lid is that case. it may not exceed CONSOLE_SESSION_SECONDS in
	// packages/operator/src/console/token.ts: a deployment refuses an expiry further out than that
	// from its own clock, past the skew packages/app/src/lib/server/console/access.ts allows
	// (CONSOLE_CLOCK_SKEW_SECONDS), as `console_clock_ahead`.
	// TestTheSessionIsNoLongerThanTheDeploymentAccepts reads it.
	sessionSeconds = 12 * 60 * 60
	// how far past now + sessionSeconds a deployment still reads an expiry as a session:
	// CONSOLE_CLOCK_SKEW_SECONDS in packages/app/src/lib/server/console/access.ts, and
	// TestTheSkewIsTheOneTheDeploymentAllows reads it.
	clockSkewSeconds = 5 * 60
	// the largest expiry a deployment will read, which is the last whole second a javascript `Date`
	// can hold (8.64e15 ms). a value past it is refused here rather than sent, because a deployment
	// that cannot read the expiry reads the whole value as no token.
	maxSeconds = 8_640_000_000_000
	// the secret half is 32 bytes, which is the 43 characters minRandom is the floor for.
	randomBytes = 32
)

// Session is one console's session on one deployment, credential and all.
type Session struct {
	WorkerName string
	// Token is the bearer the deployment compares. It leaves this package only inside a reader.
	Token     string
	Origin    string
	ExpiresAt time.Time
}

// the record as it is written: the token, and where it was written.
//
// The expiry is not among them: it is inside the token, and a second copy is a value that can
// disagree with the one the deployment reads.
type record struct {
	WorkerName string `json:"workerName"`
	Origin     string `json:"origin"`
	Token      string `json:"token"`
}

// Parse is when the session a token names ends, or that the value is no token.
//
// A value in any other shape is refused rather than sent: a bearer this console could not read is
// one the deployment is bound to turn down, and the screen it lands on is about the deployment.
func Parse(token string) (time.Time, bool) {
	held := strings.Split(token, ".")
	if len(held) != parts || held[0] != version || len(held[2]) < minRandom {
		return time.Time{}, false
	}
	if !digitsOnly(held[1]) {
		return time.Time{}, false
	}
	seconds, err := strconv.ParseInt(held[1], 10, 64)
	if err != nil || seconds > maxSeconds {
		return time.Time{}, false
	}
	return time.Unix(seconds, 0), true
}

// digitsOnly is the deployment's `/^\d+$/` on the expiry, which ParseInt is looser than: it takes
// a leading `+` or `-`, and `-0` reads as zero.
func digitsOnly(expiry string) bool {
	if expiry == "" {
		return false
	}
	for i := 0; i < len(expiry); i++ {
		if expiry[i] < '0' || expiry[i] > '9' {
			return false
		}
	}
	return true
}

// Held is the session recorded on this machine where it is this deployment's and still one, and nil
// otherwise.
//
// An expiry further out than a deployment accepts from now is no session either: the deployment
// would refuse it as `console_clock_ahead`, so it is read as none. A session ending at `now` is
// still one, as it is to the deployment (`consoleAccess` in
// packages/app/src/lib/server/console/access.ts refuses only an expiry before its now).
//
// `now` is this machine's clock and the deployment reads its own, so with the two apart the
// answers here and there can differ: a session read here can still be refused there.
//
// Every way the record could be wrong lands on the same nil, which is the state the screen already
// draws: no session, and a control that mints one.
func Held(store state.Store, workerName string, now time.Time) *Session {
	read, err := store.Read(File)
	if err != nil || len(read) == 0 {
		return nil
	}
	var held record
	if json.Unmarshal(read, &held) != nil {
		return nil
	}
	if held.WorkerName != workerName || held.Origin == "" || held.Token == "" {
		return nil
	}
	expiresAt, ok := Parse(held.Token)
	latest := now.Add((sessionSeconds + clockSkewSeconds) * time.Second)
	if !ok || expiresAt.Before(now) || expiresAt.After(latest) {
		return nil
	}
	return &Session{
		WorkerName: held.WorkerName,
		Token:      held.Token,
		Origin:     held.Origin,
		ExpiresAt:  expiresAt,
	}
}

// Mint is a token for a console connecting at `now`, and when the session it names ends.
//
// The expiry is whole seconds, because that is what the grammar stores: a mint holding any part of
// a second would hand this console and the deployment two expiries that differ and are still not
// equal.
//
// base64url with nothing padding it — the grammar splits on dots, and `+`, `/` and `=` are the
// three characters a header, a shell and a url are each liable to treat as their own.
func Mint(now time.Time) (string, time.Time, error) {
	secret := make([]byte, randomBytes)
	if _, err := rand.Read(secret); err != nil {
		return "", time.Time{}, err
	}
	expiresAt := time.Unix(now.Unix()+sessionSeconds, 0)
	token := version + "." +
		strconv.FormatInt(expiresAt.Unix(), 10) + "." +
		base64.RawURLEncoding.EncodeToString(secret)
	return token, expiresAt, nil
}

// Record writes `held` onto this machine, replacing whatever session was recorded.
//
// It is written only once the deployment holds the value: a write that did not land leaves whatever
// session was there still live, and a console that had already dropped its own would have no way
// back to it.
func Record(store state.Store, held Session) error {
	written, err := json.Marshal(record{
		WorkerName: held.WorkerName,
		Origin:     held.Origin,
		Token:      held.Token,
	})
	if err != nil {
		return err
	}
	return store.Write(File, written)
}
