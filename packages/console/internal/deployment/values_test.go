package deployment

import (
	"context"
	"testing"

	"github.com/better-giving/console/internal/release"
)

var settings = "/accounts/" + account + "/workers/scripts/" + worker + "/settings"

func varsRead(t *testing.T, answer any) VarsRead {
	t.Helper()
	return DeployedVars(context.Background(), fake(t, map[string]any{settings: answer}), account, worker)
}

// the row `name` was read as, by name rather than by position: what the order is is one assertion
// of its own below, and every other case is about one value.
func row(t *testing.T, read VarsRead, name string) DeployedVar {
	t.Helper()
	for _, one := range read.Vars {
		if one.Name == name {
			return one
		}
	}
	t.Fatalf("no row for %s in %+v", name, read.Vars)
	return DeployedVar{}
}

// every name gets a row whatever the bindings held, so an operator's eye is not the thing that
// notices one is missing — and a name off the enumeration gets none.
func TestEveryVarGetsARowInTheOrderTheEnumerationStatesThem(t *testing.T) {
	read := varsRead(t, envelope(map[string]any{"bindings": []any{
		map[string]any{"name": "STRIPE_PUBLISHABLE_KEY", "type": "plain_text", "text": "pk_live_x"},
		map[string]any{"name": "CONSOLE_TOKEN", "type": "secret_text"},
	}}))
	if read.Kind != ValuesRead || len(read.Vars) != len(release.DeployVars) {
		t.Fatalf("read %+v", read)
	}
	for at, name := range release.DeployVars {
		if read.Vars[at].Name != name {
			t.Fatalf("row %d is %q, wanted %q", at, read.Vars[at].Name, name)
		}
	}
	if held := row(t, read, "STRIPE_PUBLISHABLE_KEY"); held.Kind != VarValue || held.Value != "pk_live_x" {
		t.Fatalf("the publishable key read %+v", held)
	}
	if held := row(t, read, "SMTP_HOST"); held.Kind != VarAbsent {
		t.Fatalf("a name no binding carried read %+v", held)
	}
	for _, one := range read.Vars {
		if one.Name == "CONSOLE_TOKEN" {
			t.Error("the console's own session credential reached a row")
		}
	}
}

// a var stored as a secret is filled and unreadable, which is its own state: drawn as unset it
// would tell an operator to set a value that is already there.
func TestAVarHeldAsASecretIsWithheldAndNotAbsent(t *testing.T) {
	read := varsRead(t, envelope(map[string]any{"bindings": []any{
		map[string]any{"name": "BETTER_AUTH_URL", "type": "secret_text"},
		map[string]any{"name": "TURNSTILE_SITE_KEY", "type": "plain_text", "text": "   "},
	}}))
	if held := row(t, read, "BETTER_AUTH_URL"); held.Kind != VarWithheld {
		t.Fatalf("a var held as a secret read %+v", held)
	}
	// what the deployment itself makes of a blank: its own reader drops one, so a cell with a value
	// in it would say the deployment holds something the deployment does not read.
	if held := row(t, read, "TURNSTILE_SITE_KEY"); held.Kind != VarAbsent {
		t.Fatalf("a var holding only spaces read %+v", held)
	}
}

func TestAWorkerThatIsNotThereIsNotAFailureToReport(t *testing.T) {
	if read := varsRead(t, failed(10007, "script not found")); read.Kind != ValuesNotDeployed {
		t.Fatalf("read %+v", read)
	}
}

// an answer in a shape nothing was written against is not the empty list: the two differ by whether
// the screen is about to tell an operator that every credential is missing.
func TestAnAnswerInAnotherShapeIsUnreadableAndNotEmpty(t *testing.T) {
	if read := varsRead(t, envelope(map[string]any{"bindings": "none"})); read.Kind != ValuesUnreadable {
		t.Fatalf("read %+v", read)
	}
}

// the one row anything outside this reading asks about by name, because it is the one a reader has
// to have before there is anything to ask the deployment about its Stripe account at all.
func TestHoldsStripeSecretIsFalseWhereTheReadDidNotLand(t *testing.T) {
	if HoldsStripeSecret(VarsRead{Kind: ValuesRefused}) {
		t.Error("a read that came back in none of its ways was read as a key")
	}
	set := varsRead(t, envelope(map[string]any{"bindings": []any{
		map[string]any{"name": "STRIPE_SECRET_KEY", "type": "plain_text", "text": "sk_live_x"},
	}}))
	if !HoldsStripeSecret(set) {
		t.Error("a deployment holding the key that charges was read as holding none")
	}
}

// a withheld key is a key the deployment charges with: it is stored, the worker reads it, and the
// one thing that cannot be done with it is showing it here. a deployment answering about its Stripe
// account on it would otherwise be told there was nothing to ask about.
func TestAWithheldStripeKeyIsStillAKeyTheDeploymentHolds(t *testing.T) {
	read := varsRead(t, envelope(map[string]any{"bindings": []any{
		map[string]any{"name": "STRIPE_SECRET_KEY", "type": "secret_text"},
	}}))
	if !HoldsStripeSecret(read) {
		t.Error("a key held as a credential was read as no key at all")
	}
}
