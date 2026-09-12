// Package deployment is what this console finds out about the deployment it operates, decided once,
// here.
//
// **the page is one page, and how far set-up has got is what decides which of it is drawn.** a
// screen that depends on something unconfigured is not drawn at all: there is no address before
// there is a worker, no session before there is an address, and nothing the deployment says about
// itself before there is a session. so the operator is never handed two findings to order — the
// earliest unmet one is the whole answer, and everything after it is unread rather than wrong. the
// face in front of this one is the cloudflare account itself, which the page decides off
// internal/server's sign-in answer; this takes over the moment there is one.
//
// **the deployment is not a fold and must not become one.** reaching the ready face is what proves
// it — every face before it is drawn instead until the worker is in the account, answers on an
// address and answers this console — so a fold reporting it would report the one fact the operator
// had to satisfy to be looking at the page.
//
// **the six folds are not decided here.** what each of them says is a reading of the values and the
// rows below, and it is made where the words are: packages/console-ui draws the labels, the status
// words and the sentence a fold that is not done carries. a second statement of those words here
// would be the two surfaces coming to disagree about what a job is called.
//
// **a read that did not land takes the whole page and never a fold.** the seventeen values come off
// the account in one read that is scoped to no fold, so a console that could not take them cannot
// say anything about any of the six. reported per fold it would be six findings from one failure,
// five of them over jobs that may already be done.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.
package deployment

import (
	"context"
	"sync"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/session"
)

// FaceKind is the one face on screen once an account is settled.
type FaceKind string

const (
	// FaceBlocked is nothing after the bar being readable.
	FaceBlocked FaceKind = "blocked"
	// FaceDeploy is no worker of this deployment's name being in the account, which
	// `better-giving start` ends: nothing on this page stands a deployment up.
	FaceDeploy FaceKind = "deploy"
	// FaceUnreachable is a deployment this console cannot read: the session was replaced, or it is
	// not answering.
	FaceUnreachable FaceKind = "unreachable"
	// FaceReady is it being up, answering, and the six folds being what is left.
	FaceReady FaceKind = "ready"
)

// BlockedKind is why nothing below the bar can be drawn, in the read's own terms.
//
// Each of them is repaired somewhere different — cloudflare's dashboard, this machine's connection,
// a sign-in, this console's own press — so they are members and never one sentence about a console
// that could not find out.
type BlockedKind string

const (
	// NoCredential is this console holding no cloudflare sign-in, so the account was never asked.
	NoCredential BlockedKind = "no-credential"
	// AccountRefused is cloudflare turning this sign-in down for this account.
	AccountRefused BlockedKind = "refused"
	// AccountUnreachable is a cloudflare nothing was found out from.
	AccountUnreachable BlockedKind = "unreachable"
	// TwoDatabases is a deploy that would bind to one of two databases of one name without saying
	// which.
	TwoDatabases BlockedKind = "two-databases"
	// NoAddress is the worker being in the account and answering on nothing outside cloudflare.
	NoAddress BlockedKind = "no-address"
	// NoValues is the deployment answering and the account not saying what it was configured with.
	//
	// Last of them because it is the only one that needs everything before it to have worked.
	NoValues BlockedKind = "no-values"
)

// Blocked is why nothing below the bar can be drawn.
//
// Flat rather than a member per kind, because that is what the wire is: every field is written on
// every answer and each is empty on the kinds that say nothing about it.
type Blocked struct {
	Kind   BlockedKind `json:"kind"`
	Detail string      `json:"detail"`
	// Count is how many databases of the one name the account holds.
	Count int `json:"count"`
	// Why is which of the three reasons there is no workers.dev address.
	Why NoWorkersDev `json:"why"`
}

// Face is the one face on screen and everything it needs to draw itself.
type Face struct {
	Kind FaceKind `json:"kind"`
	Why  *Blocked `json:"why"`
	// Database is `absent` or `present` on the deploy face, and empty on every other.
	Database string `json:"database"`
	// Address is where this deployment answers, carried on the two faces that are about one.
	Address string `json:"address"`
	// Read is which way the deployment's own report was not read, on the unreachable face.
	Read *NoReport `json:"read"`
}

// Reading is the whole slow half of the home screen, as one answer.
//
// One answer rather than three, because the face is a function of every read on the page: nothing
// about it can be drawn before the slowest of them lands, and one answer is one checking state
// rather than a page that resolves three times under the reader.
type Reading struct {
	Face   Face   `json:"face"`
	Values Values `json:"values"`
	// Sites is the deployment's own site list, which the sites fold seeds its boxes from.
	Sites []string `json:"sites"`
	// DonatePage is where this deployment's own donation page answers, which is this deployment's
	// own address: the donor-facing page is a route on this worker and no second one is deployed
	// (CLAUDE.md → Product surface). Empty where the deployment answers nowhere this console could
	// read.
	//
	// It is on no site row and on no form's allowed origins, so it is stated beside that list rather
	// than in it — the deployment accepts its own origin off the request instead, and nothing an
	// operator can untick takes it down.
	//
	// Empty on every face but the ready one, which is the only one that draws the fold.
	DonatePage string `json:"donatePage"`
	// Org is the organisation's profile as the deployment holds it, carried through unread.
	Org any `json:"org"`
	// HoldsStripeKey is whether there is anything to ask the deployment on the two addresses that
	// are Stripe's alone: what its account holds for gifts that repeat, and the press that registers
	// the hostnames wallet buttons are drawn on. both reach Stripe with the stored secret and answer
	// in a shape that says there was none, which a console draws as an answer it could not read — so
	// a deployment nobody has finished setting up would report a failure rather than the empty boxes
	// that are the truth of it.
	//
	// **the payments reading is not one of them and may not be put back under it.** that reading
	// answers for every processor and carries an arm for one this deployment holds no credentials
	// for (./payments.go), so a key that charges on one processor gating it is a deployment set up
	// on the other reporting nothing at all about the processor it does charge on.
	//
	// false on every face but the ready one, and false where the values read did not land.
	HoldsStripeKey bool `json:"holdsStripeKey"`
}

// Inputs is everything one reading is made from.
type Inputs struct {
	AccountID    string
	WorkerName   string
	DatabaseName string
	// Credential is what the account reads are made on, weighed before any of them is made.
	Credential cf.Credential
	// Account is those reads, bound to that credential.
	Account cf.Get
	// Session is the session this console holds on the deployment, or nil where it holds none.
	Session *session.Session
	// Deployment is how a read of the deployment's own surface is bound, so a case can answer for
	// one without a deployment.
	Deployment func(origin, token string) cf.Get
}

// Read is the whole reading, from the account and from the deployment.
//
// **the halves overlap rather than queue.** the account's own reads, the seventeen values and the
// deployment's report are not each other's inputs, and a page that waited on each in turn would hold
// the operator for the sum of them. what is sequenced is the pair inside the first: a refused
// account read decides the face on its own, and asking about an address there would be a call made
// for a line the screen is not going to draw.
func Read(ctx context.Context, inputs Inputs) Reading {
	if inputs.Credential.Kind == cf.NoCredential {
		// nothing is asked of the account at all, so what the reading says about why the seventeen
		// were not read is that they were not asked for.
		detail := inputs.Credential.Detail
		return Reading{
			Face:   Face{Kind: FaceBlocked, Why: &Blocked{Kind: NoCredential, Detail: detail}},
			Values: Values{Vars: VarsRead{Kind: ValuesNoCredential, Detail: detail}},
			Sites:  []string{},
		}
	}

	var (
		databases DatabaseList
		address   Address
		values    Values
		report    ReportRead
		waiting   sync.WaitGroup
	)

	waiting.Add(3)
	go func() {
		defer waiting.Done()
		databases = Databases(ctx, inputs.Account, inputs.AccountID, inputs.DatabaseName)
		if databases.Kind != Listed {
			return
		}
		address = PublicAddress(ctx, inputs.Account, inputs.AccountID, inputs.WorkerName)
	}()
	go func() {
		defer waiting.Done()
		values = readValues(ctx, inputs)
	}()
	go func() {
		defer waiting.Done()
		report = readSurface(ctx, inputs)
	}()
	waiting.Wait()

	return assemble(databases, address, values, report)
}

// the seventeen, which is one read of the worker's own bindings.
func readValues(ctx context.Context, inputs Inputs) Values {
	return Values{Vars: DeployedVars(ctx, inputs.Account, inputs.AccountID, inputs.WorkerName)}
}

// what the deployment says about itself, or that this console holds no session to ask over.
//
// A console holding none is its own answer rather than a request made with no credential: a bearer
// this console did not fill in would be refused by the deployment with a sentence about the
// deployment, and the state an operator is actually in is that this console has not connected.
func readSurface(ctx context.Context, inputs Inputs) ReportRead {
	if inputs.Session == nil || inputs.Deployment == nil {
		return ReportRead{NoReport: NoReport{Kind: NoSession}}
	}
	return Report(ctx, inputs.Deployment(inputs.Session.Origin, inputs.Session.Token))
}

// the face, from what the three reads answered.
func assemble(databases DatabaseList, address Address, values Values, report ReportRead) Reading {
	// the seventeen and the rows are carried on every face and never only on the one that draws
	// them: what the read answered is the same answer whichever face the reading landed on, and a
	// face carrying none would be a value read as unset rather than as unasked.
	read := Reading{Values: values, Sites: []string{}}
	blocked := func(why Blocked) Reading {
		read.Face = Face{Kind: FaceBlocked, Why: &why}
		return read
	}

	switch databases.Kind {
	case Refused:
		return blocked(Blocked{Kind: AccountRefused, Detail: databases.Detail})
	case Unreachable:
		return blocked(Blocked{Kind: AccountUnreachable, Detail: databases.Detail})
	}
	// two of a name is refused before anything else about the deployment is weighed: it is the one
	// thing about the database a press cannot repair.
	if databases.Count > 1 {
		return blocked(Blocked{Kind: TwoDatabases, Count: databases.Count})
	}

	switch address.Kind {
	case NotDeployed:
		held := "present"
		if databases.Count == 0 {
			held = "absent"
		}
		read.Face = Face{Kind: FaceDeploy, Database: held}
		return read
	case AddressRefused:
		return blocked(Blocked{Kind: AccountRefused, Detail: address.Detail})
	case AddressUnreachable, AddressUnreadable:
		return blocked(Blocked{Kind: AccountUnreachable, Detail: address.Detail})
	}

	origin := address.Origin()
	if origin == "" {
		return blocked(Blocked{Kind: NoAddress, Why: address.Why})
	}

	if report.Kind != Reported {
		answered := report.NoReport
		read.Face = Face{Kind: FaceUnreachable, Address: origin, Read: &answered}
		return read
	}

	// last, and after everything the folds do not depend on: every one of the six is read against
	// these, so a read that did not answer is the page rather than a row.
	if values.Vars.Kind != ValuesRead {
		return blocked(Blocked{Kind: NoValues, Detail: values.Vars.Detail})
	}

	read.Face = Face{Kind: FaceReady, Address: origin}
	read.HoldsStripeKey = HoldsStripeSecret(values.Vars)
	read.Sites = report.Sites
	read.DonatePage = origin
	read.Org = report.Org
	return read
}
