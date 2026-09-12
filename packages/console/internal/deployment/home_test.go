package deployment

import (
	"context"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/session"
)

// which face of the console is on screen once an account is settled.
//
// **a screen depending on something unconfigured is not drawn at all**: there is no address before
// there is a worker, no session before there is an address, and nothing the deployment says about
// itself before there is a session. so the earliest unmet thing is the whole answer, and everything
// after it is unread rather than wrong — which is what these cases assert, one refusal at a time.

// an account holding a deployment that answers, with everything set, as the ready face needs it.
func whole() map[string]any {
	return map[string]any{
		DatabasesPath(account): envelope([]any{
			map[string]any{"name": "better-giving", "uuid": "one"},
		}),
		enablement: envelope(map[string]any{"enabled": true}),
		subdomain:  envelope(map[string]any{"subdomain": "hound-haven"}),
		domains:    envelope([]any{}),
		settings:   envelope(map[string]any{"bindings": []any{}}),
	}
}

func reading(t *testing.T, answers map[string]any, connected bool) Reading {
	t.Helper()
	inputs := Inputs{
		AccountID:    account,
		WorkerName:   worker,
		DatabaseName: "better-giving",
		Credential:   cf.BearerCredential("a-token"),
		Account:      fake(t, answers),
		Deployment: func(string, string) cf.Get {
			return deployment(t, 200, envelopeBody(nil))
		},
	}
	if connected {
		inputs.Session = &session.Session{
			WorkerName: worker,
			Token:      "a-session",
			Origin:     "https://better-giving.hound-haven.workers.dev",
		}
	}
	return Read(context.Background(), inputs)
}

func TestNothingIsAskedOfAnAccountThisConsoleCannotReach(t *testing.T) {
	read := Read(context.Background(), Inputs{
		Credential: cf.Credential{Kind: cf.NoCredential, Detail: "no sign-in on this machine"},
	})
	if read.Face.Kind != FaceBlocked || read.Face.Why.Kind != NoCredential {
		t.Fatalf("read %+v", read.Face)
	}
	if read.Face.Why.Detail != "no sign-in on this machine" {
		t.Fatalf("detail %q", read.Face.Why.Detail)
	}
}

// the one thing about the database no press can repair: every remote path resolves it by name, so a
// deploy would bind to one of two without saying which.
func TestTwoDatabasesOfOneNameStopThePage(t *testing.T) {
	answers := whole()
	answers[DatabasesPath(account)] = envelope([]any{
		map[string]any{"name": "better-giving", "uuid": "one"},
		map[string]any{"name": "better-giving", "uuid": "two"},
	})
	read := reading(t, answers, true)
	if read.Face.Kind != FaceBlocked || read.Face.Why.Kind != TwoDatabases || read.Face.Why.Count != 2 {
		t.Fatalf("read %+v", read.Face)
	}
}

// one of none is not a blocker at all: the press makes it, which is what the deploy face names.
func TestAWorkerThatIsNotThereIsOnePressAndSaysWhetherTheDatabaseIs(t *testing.T) {
	answers := whole()
	answers[enablement] = failed(10007, "script not found")
	answers[DatabasesPath(account)] = envelope([]any{})
	read := reading(t, answers, false)
	if read.Face.Kind != FaceDeploy || read.Face.Database != "absent" {
		t.Fatalf("read %+v", read.Face)
	}

	answers[DatabasesPath(account)] = envelope([]any{
		map[string]any{"name": "better-giving", "uuid": "one"},
	})
	if read := reading(t, answers, false); read.Face.Database != "present" {
		t.Fatalf("read %+v", read.Face)
	}
}

func TestAWorkerThatAnswersOnNoAddressStopsThePage(t *testing.T) {
	answers := whole()
	answers[enablement] = envelope(map[string]any{"enabled": false})
	read := reading(t, answers, true)
	if read.Face.Kind != FaceBlocked || read.Face.Why.Kind != NoAddress || read.Face.Why.Why != TurnedOff {
		t.Fatalf("read %+v", read.Face)
	}
}

// a console holding no session has not found the deployment wanting: it has not asked.
func TestAConsoleHoldingNoSessionIsTheGateAndNotAFinding(t *testing.T) {
	read := reading(t, whole(), false)
	if read.Face.Kind != FaceUnreachable || read.Face.Read.Kind != NoSession {
		t.Fatalf("read %+v", read.Face)
	}
	if read.Face.Address != "https://better-giving.hound-haven.workers.dev" {
		t.Fatalf("address %q", read.Face.Address)
	}
}

// every fold is read against the seventeen, so a read that did not answer is the page and not a
// row.
func TestValuesThatCouldNotBeReadTakeThePageAndNeverAFold(t *testing.T) {
	answers := whole()
	answers[settings] = failed(10000, "Authentication error")
	read := reading(t, answers, true)
	if read.Face.Kind != FaceBlocked || read.Face.Why.Kind != NoValues {
		t.Fatalf("read %+v", read.Face)
	}
	if read.Face.Why.Detail == "" {
		t.Error("the read that would not answer said nothing")
	}
}

func TestTheReadyFaceCarriesTheAddressAndWhatTheDeploymentSaid(t *testing.T) {
	read := reading(t, whole(), true)
	if read.Face.Kind != FaceReady {
		t.Fatalf("read %+v", read.Face)
	}
	if read.Face.Address != "https://better-giving.hound-haven.workers.dev" {
		t.Fatalf("address %q", read.Face.Address)
	}
	if len(read.Sites) != 1 || read.Org == nil {
		t.Fatalf("read %+v", read)
	}
	if read.Values.Vars.Kind != ValuesRead {
		t.Fatalf("values %+v", read.Values)
	}
	// nothing is asked of a deployment holding no key that charges: the read would answer in a
	// shape that says there was none, which draws as a failure rather than as the empty boxes.
	if read.HoldsStripeKey {
		t.Error("a deployment holding no stripe key was reported as holding one")
	}
}

// the donor-facing page is a route on this deployment's own worker and no second one is deployed
// (CLAUDE.md → Product surface), so where it answers is where the deployment answers.
func TestTheReadyFaceCarriesTheDeploymentsOwnDonationPage(t *testing.T) {
	read := reading(t, whole(), true)
	if read.DonatePage != read.Face.Address {
		t.Fatalf("donation page %q, and the deployment answers at %q", read.DonatePage, read.Face.Address)
	}
	if read.DonatePage != "https://better-giving.hound-haven.workers.dev" {
		t.Fatalf("donation page %q", read.DonatePage)
	}
}

// a deployment answering nowhere this console could read carries no page address either: a console
// stating one it did not read would send an operator at a host that answers nothing.
func TestADeploymentAnsweringNowhereCarriesNoDonationPageAddress(t *testing.T) {
	answers := whole()
	answers[enablement] = envelope(map[string]any{"enabled": false})
	read := reading(t, answers, true)
	if read.DonatePage != "" {
		t.Fatalf("donation page %q", read.DonatePage)
	}
}
