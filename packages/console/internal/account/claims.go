package account

import "encoding/json"

// which resources in the chosen account the operator has said are this deployment's.
//
// **a claim records nothing in cloudflare and must never read as if it did.** it changes no
// command's behaviour — every path resolves the database by name — and its whole job is to stop
// the console adopting a stranger's resource silently, and to let a screen require that the
// question was asked. a screen says `in use` and never `configured` or `ready`.
//
// **it is keyed by the account, and a claim made in another one is ignored rather than migrated.**
// connecting a different account therefore carries no claim across, and forgetting the choice needs
// no responsibility for claims: what it removes is the pointer, and the file below stops answering
// the moment the account it names is not the chosen one. it is read rather than deleted, because
// the operator may connect that account again and throwing the claim away would put them back in
// front of a question they have already answered.
//
// **the file holds one claim.** a claim made in a second account replaces it rather than joining
// it, so an operator moving between two accounts is asked again — which matters most for the
// turnstile widget, since the console looks for the one widget the release names wherever it is
// connected.
//
// **nothing writes one.** the presses that would claim a resource are not on the console's one
// page, so the file is read and never written: the read is here because the setup ledger is drawn
// from it, and a claim's absence is a state that ledger already has words for.

// what the claims are recorded under, beside the account itself.
const claimsFile = "claimed.json"

// DatabaseClaim is the d1 database the operator says is this deployment's.
type DatabaseClaim struct {
	Name string `json:"name"`
	UUID string `json:"uuid"`
}

// WidgetClaim is the turnstile widget the operator says is this deployment's.
type WidgetClaim struct {
	Name    string `json:"name"`
	Sitekey string `json:"sitekey"`
}

// Claims is what is claimed in one account. An absent half is simply not claimed.
type Claims struct {
	Database *DatabaseClaim `json:"database"`
	Widget   *WidgetClaim   `json:"widget"`
}

// the file as it is written: the account it was claimed in, and the two halves.
type claimRecord struct {
	AccountID string         `json:"accountId"`
	Database  *DatabaseClaim `json:"database"`
	Widget    *WidgetClaim   `json:"widget"`
}

// ClaimedIn is what the operator has claimed in `accountID`.
func (store *Store) ClaimedIn(accountID string) Claims {
	read, err := store.state.Read(claimsFile)
	if err != nil || len(read) == 0 {
		return Claims{}
	}
	var held claimRecord
	if json.Unmarshal(read, &held) != nil || held.AccountID != accountID {
		return Claims{}
	}
	claims := Claims{Database: held.Database, Widget: held.Widget}
	// a half missing either of its two values names nothing: the id is what a screen reports the
	// claim by, and the name is what says which resource it was made about.
	if claims.Database != nil && (claims.Database.Name == "" || claims.Database.UUID == "") {
		claims.Database = nil
	}
	if claims.Widget != nil && (claims.Widget.Name == "" || claims.Widget.Sitekey == "") {
		claims.Widget = nil
	}
	return claims
}
