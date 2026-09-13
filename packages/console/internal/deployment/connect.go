package deployment

import (
	"context"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/session"
)

// connecting this console to the deployment: minting a session, writing it there, and handing it to
// whatever keeps it.
//
// **connecting is an act an operator carries out, never something a page load does.** writing this
// secret replaces whatever session was on the deployment, so a second console connecting revokes
// the first. a console that connected because a tab opened would revoke a colleague's session with
// nobody having asked for anything.
//
// **it reads the deployment's address before it writes, and what that read answers is half of the
// session.** the origin it hands back is recorded beside the token and is the host every errand
// calls — so a deployment answering on no address is a session there would be nothing to read over,
// and the press stops there. that read is also the sentence: it tells a worker that has never been
// deployed from an account that refused this sign-in from a cloudflare nothing could reach, and
// each of those has a different way out.
//
// **the address is read here and never posted.** what a browser sends is intent, and a host that
// travelled through a page is a credential written wherever that page said.
//
// **it answers once the deployment takes the session, and the write alone is not that.** a secret
// stored a moment ago is not yet what every copy of the worker reads, so a console served straight
// off the write is refused by the deployment it just connected to — and its gate's one press writes
// a fresh value that is refused the same way. the wait is bounded and ends connected either way:
// the write landed and is recorded, and what the deployment says after the bound is the reading's.
//
// **the token reaches no answer.** what crosses back is when the session ends and where it was
// written; the credential goes into one request body and into the record on this machine.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.

// ConnectionKind is how one connect press ended.
type ConnectionKind string

const (
	// Connected is the deployment holding this console's session, which is the only kind that left
	// anything anywhere.
	Connected ConnectionKind = "connected"
	// ConnectNowhere is there being nowhere to write to: a worker that is not in the account, one
	// answering on no address, or this console holding no sign-in to ask with.
	ConnectNowhere ConnectionKind = "nowhere"
	// ConnectRefused is cloudflare turning this sign-in down for this account.
	ConnectRefused ConnectionKind = "refused"
	// ConnectUnreachable is nothing found out either way.
	ConnectUnreachable ConnectionKind = "unreachable"
	// ConnectFailed is cloudflare answering and not storing it, in its own words.
	ConnectFailed ConnectionKind = "failed"
	// ConnectUnkept is the deployment holding a session this machine could not write down.
	//
	// Its own kind and not a failure of the write: the value is live on the deployment and this
	// console cannot use it, so the way out is the folder rather than the press.
	ConnectUnkept ConnectionKind = "unkept"
)

// Connection is how one press went.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Connection struct {
	Kind ConnectionKind `json:"kind"`
	// ExpiresAt is when the session ends, and empty on every kind but Connected. A screen may know
	// it so that it can warn before it runs out.
	ExpiresAt string `json:"expiresAt"`
	// Origin is where the session was written, which is the deployment the operator is looking at.
	Origin string `json:"origin"`
	// Detail is cloudflare's own words about the call, this machine's about a record it could not
	// write, or empty where neither wrote any.
	Detail string `json:"detail"`
}

// ConnectInputs is everything one press is made from.
type ConnectInputs struct {
	// Door is the account read the address comes off and the write the session goes up through.
	Door Door
	// Credential is what those calls are made on, weighed before either is made.
	Credential cf.Credential
	// Record is what keeps the session on this machine. It is handed in so that the whole press can
	// be looked at without a state directory.
	Record func(session.Session) error
	// Surface is how the deployment's own surface is read over the session just written, which is
	// what a connect waits on. Within bounds that wait and Every is how often it asks inside it.
	Surface func(origin, token string) cf.Get
	Within  time.Duration
	Every   time.Duration
	Now     time.Time
}

// SessionBound is how long a connect waits for the deployment to take the session it wrote, and
// SessionAsked how often it asks inside that.
//
// the bound sits inside the console server's own write timeout (../server/server.go's Listen),
// which the page's connect press is answered under.
const (
	SessionBound = 30 * time.Second
	SessionAsked = time.Second
)

// Connect mints a session, writes it to the deployment, and records it — or says why it did not.
func Connect(ctx context.Context, inputs ConnectInputs) Connection {
	if inputs.Credential.Kind == cf.NoCredential {
		// nothing is asked of cloudflare at all: what an operator does about it is sign in, which is
		// a state the panel already draws.
		return Connection{Kind: ConnectNowhere, Detail: inputs.Credential.Detail}
	}

	address := PublicAddress(ctx, inputs.Door.Get, inputs.Door.AccountID, inputs.Door.WorkerName)
	origin := address.Origin()
	if origin == "" {
		return Connection{Kind: ConnectNowhere, Detail: address.Detail}
	}

	token, expiresAt, err := session.Mint(inputs.Now)
	if err != nil {
		return Connection{Kind: ConnectFailed, Detail: err.Error()}
	}

	written := WriteConsoleToken(ctx, inputs.Door, token)
	if written.Kind != WriteSet {
		return unconnected(written)
	}

	// recorded only once the deployment holds it. a write that did not land leaves whatever session
	// was there still live, and a console that had dropped its own would have no way back to it.
	if err := inputs.Record(session.Session{
		WorkerName: inputs.Door.WorkerName,
		Token:      token,
		Origin:     origin,
		ExpiresAt:  expiresAt,
	}); err != nil {
		return Connection{Kind: ConnectUnkept, Origin: origin, Detail: err.Error()}
	}
	takes(ctx, inputs, inputs.Surface(origin, token))

	return Connection{
		Kind:      Connected,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
		Origin:    origin,
	}
}

// a write that did not land, as the press it stopped.
//
// One vocabulary rather than two: the session goes to the same endpoint on the same credential as
// the ten a deployment is configured with, so a second set of names here would be a screen with two
// accounts of one failure.
func unconnected(written Written) Connection {
	switch written.Kind {
	case WriteNowhere:
		detail := written.Detail
		if written.Address != nil && detail == "" {
			detail = written.Address.Detail
		}
		return Connection{Kind: ConnectNowhere, Detail: detail}
	case WriteRefused:
		return Connection{Kind: ConnectRefused, Detail: written.Detail}
	case WriteUnreachable:
		return Connection{Kind: ConnectUnreachable, Detail: written.Detail}
	}
	return Connection{Kind: ConnectFailed, Detail: written.Detail}
}

// waits until the deployment takes the session it was just written, or the bound elapses.
//
// only a refusal is not yet: any other answer — the report, a deployment older than the surface, one
// nothing reached — is a state the reading draws, and waiting longer would change none of them.
func takes(ctx context.Context, inputs ConnectInputs, get cf.Get) {
	bound, stop := context.WithTimeout(ctx, inputs.Within)
	defer stop()

	for {
		if Report(bound, get).Kind != NoReportRefused {
			return
		}
		select {
		case <-bound.Done():
			return
		case <-time.After(inputs.Every):
		}
	}
}
