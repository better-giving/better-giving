package account

import (
	"context"
	"net/url"

	"github.com/better-giving/console/internal/cf"
)

// Verify is whether this sign-in can do anything inside the account.
//
// **what it exists to catch is "member, not administrator".** a cloudflare sign-in can see an
// account in its own list and be refused everything inside it, and nothing in that list says which.
// without this the refusal arrives at the first thing the deploy press creates, where nothing on
// the screen can repair it; with it, the refusal is a sentence beside the list with another account
// one press away.
//
// the account's d1 list is the read because it is the cheapest one scoped to an account: it creates
// nothing, changes nothing, and answers the empty list for an account with no databases in it —
// which is what every first run answers. **the read has to ask for something inside the account**:
// the list the picker was drawn from is what named this account in the first place, so no reading
// of it can answer the question — what a member is refused is the contents.
//
// **anything other than a result is a no.** the read was scoped to one account, so a cloudflare
// that refused it, could not be reached, or answered in a shape nothing was written against all
// leave the same thing untrue, and the choice is not recorded on a fact nobody established.
func Verify(ctx context.Context, get cf.Get, id string) bool {
	// one page, because nothing here reads the rows.
	path := "/accounts/" + url.PathEscape(id) + "/d1/database?per_page=10&page=1"
	return cf.ReadResult(get(ctx, path)).Kind == cf.ResultValue
}
