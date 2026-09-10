package effects

import (
	"context"
	"time"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/release"
	"github.com/better-giving/console/internal/signin"
)

// where this deployment answers on each account a sign-in carries, read before the operator is
// asked which of them to go on with.
//
// **it is the same read ./OwnAddress makes, made once per account instead of once.** what marks the
// account picker's rows is a deployment found on one (../terminal/account.go), and what the pass
// after the pick needs is where that account's deployment answers — so both come off one reading
// and the run that follows the pick asks cloudflare nothing this screen already answered
// (../../cmd/better-giving/start.go's standingOn).
//
// **a read that did not land is left off, and that is the whole reason the mark can be drawn.** a
// refusal, a network that went away and an answer in a shape nothing was written against are all
// absent from the answer exactly as an account with no deployment on it is present in it with
// NotDeployed — so a row this list does not name is one nothing was found out about, and no screen
// built on it ever says a deployment is not somewhere.
//
// **the reads are made at once and the picker waits on ./addressCeiling and no longer.** they are
// one round trip each and an operator is standing at a terminal in front of a question the marks
// only help with, so an account cloudflare is slow about holds up neither the others nor the
// screen.

// Addresses is what each account was found holding, by account id, for the reads that landed.
type Addresses map[string]deployment.Address

// addressCeiling is how long the picker waits on those reads.
//
// **past it the screen draws with what landed rather than making the operator wait.** the marks are
// a help on the way to a choice and never the choice itself, and a `start` that sat on a slow
// account would be holding the operator in front of a blank terminal for a question they could
// already have answered.
const addressCeiling = 5 * time.Second

// EachAddress is where this deployment answers on each of `accounts`, as far as `get` found out
// inside ./addressCeiling.
func EachAddress(ctx context.Context, get cf.Get, accounts []signin.Account) Addresses {
	return eachAddress(ctx, accounts, func(ctx context.Context, accountID string) deployment.Address {
		return OwnAddress(ctx, deployment.Door{
			AccountID:  accountID,
			WorkerName: release.Baked.Name,
			Get:        get,
		})
	}, addressCeiling)
}

// the same, with the read and the ceiling handed in, so that every state above can be looked at
// without a cloudflare account, without a network and without a wait a case sits through.
func eachAddress(
	ctx context.Context,
	accounts []signin.Account,
	read func(context.Context, string) deployment.Address,
	ceiling time.Duration,
) Addresses {
	inside, stop := context.WithTimeout(ctx, ceiling)
	defer stop()

	type landed struct {
		id      string
		address deployment.Address
	}
	// buffered by the whole list, so a read that comes back past the ceiling hands its answer over
	// and ends rather than holding a goroutine open on a channel nothing is reading any more.
	answers := make(chan landed, len(accounts))
	for _, one := range accounts {
		go func() {
			answers <- landed{one.ID, read(inside, one.ID)}
		}()
	}

	found := Addresses{}
	for range accounts {
		select {
		case answer := <-answers:
			switch answer.address.Kind {
			case deployment.Deployed, deployment.NotDeployed:
				found[answer.id] = answer.address
			}
		case <-inside.Done():
			return found
		}
	}
	return found
}
