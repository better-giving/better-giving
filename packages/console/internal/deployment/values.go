package deployment

import (
	"context"
	"net/url"
	"strings"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// the thirteen values this deployment was configured with, read off the account rather than off the
// deployment.
//
// **this is what a screen shows when the deployment is the thing that is wrong**: a configuration
// that 500s, a session that has lapsed, a worker that was never deployed. reading the thirteen out
// of the account is what lets it still show what a deployment refusing to talk is holding.
//
// **one door, and every row carries its value.** all thirteen are plain-text bindings on the
// worker's own settings, so one read of that endpoint answers for the whole of what a deployment is
// configured with — and a value cloudflare hands back is a value a screen can draw, which is what
// lets an operator check the credential they pasted rather than a mask over it.
//
// **the enumeration is the list and there is no second one.** internal/release states the thirteen,
// and the read below returns a row for every name on it whatever came back — the same rows in the
// same order in every state, which is what stops an operator's eye being the thing that notices one
// is missing. a name the deployment holds that is off the list is dropped: the console's own session
// credential is deliberately on no enumeration.

// ValuesKind is which of the six ways a read of the thirteen ended.
type ValuesKind string

const (
	// ValuesRead is the rows, which is the only kind carrying any.
	ValuesRead ValuesKind = "read"
	// ValuesNotDeployed is the worker not being in the account, every run before a first deploy.
	ValuesNotDeployed ValuesKind = "not-deployed"
	// ValuesRefused is cloudflare turning this sign-in down for this account.
	ValuesRefused ValuesKind = "refused"
	// ValuesNoCredential is this console holding no sign-in to read with.
	ValuesNoCredential ValuesKind = "no-credential"
	// ValuesUnreachable is nothing found out either way.
	ValuesUnreachable ValuesKind = "unreachable"
	// ValuesUnreadable is an answer in a shape nothing here was written against.
	ValuesUnreadable ValuesKind = "unreadable"
)

// VarKind is what one var's slot holds. Three states and not two: `withheld` is a binding under one
// of the thirteen names that is not `plain_text`, which is a deployment that stored the value as a
// secret. Collapsing it into `absent` would print the same cell over two deployments an
// operator has to do different things to — the value is there and the deployment reads it, and what
// gets one out of the state is the press that frees the names (./write.go's FreeWithheldVars).
type VarKind string

const (
	// VarValue is a plain-text binding, Value being what it holds.
	VarValue VarKind = "value"
	// VarWithheld is a filled slot this console cannot read a value out of, which is a name the
	// deployment is holding as a credential.
	VarWithheld VarKind = "withheld"
	// VarAbsent is nothing in the slot.
	VarAbsent VarKind = "absent"
)

// DeployedVar is one var, as the deployment holds it.
type DeployedVar struct {
	Name  string  `json:"name"`
	Kind  VarKind `json:"kind"`
	Value string  `json:"value"`
}

// VarsRead is what the thirteen read as, or which way they did not.
type VarsRead struct {
	Kind   ValuesKind    `json:"kind"`
	Vars   []DeployedVar `json:"vars"`
	Detail string        `json:"detail"`
}

// Values is the thirteen as the door answered for them, whether or not it landed.
//
// One member and still a struct, so that the wire it is carried on (./home.go's Reading) narrows
// rather than moves: what every reader of it names is still `values.vars`.
type Values struct {
	Vars VarsRead `json:"vars"`
}

// the name the Stripe credential that charges is held under.
//
// The one row anything outside this reading asks about by name, because it is the one a reader has
// to have before there is anything to ask the deployment about its Stripe account at all.
const stripeSecret = "STRIPE_SECRET_KEY"

// HoldsStripeSecret is whether this deployment holds the Stripe credential that charges.
//
// **a read that did not land is not a key.** a read that came back in none of its ways found
// nothing out, and a caller told the slot is filled on that would act on a claim nothing made.
//
// **withheld is held.** a name the deployment is carrying as a credential is a value the worker
// reads and charges with, and the only thing that cannot be done with it is drawing it on this
// console — so a deployment holding one can be asked about its Stripe account like any other.
func HoldsStripeSecret(read VarsRead) bool {
	if read.Kind != ValuesRead {
		return false
	}
	for _, row := range read.Vars {
		if row.Name == stripeSecret && (row.Kind == VarValue || row.Kind == VarWithheld) {
			return true
		}
	}
	return false
}

// the two names the spam widget's halves are held under.
const (
	turnstileSitekey = "TURNSTILE_SITE_KEY"
	turnstileSecret  = "TURNSTILE_SECRET_KEY"
)

// HoldsNoSpamPair is whether this deployment holds neither half of the spam widget's pair, which is
// a deployment no run ever registered one for.
//
// **a read that did not land claims nothing.** a read that came back in none of its ways found
// nothing out, and a caller told the slots are empty on that registers a second widget over a
// deployment already carrying one — so a reading carrying no row for either name says nothing
// either.
//
// **either half held is a pair this reading leaves alone.** the two go up in one write
// (../first), so one of them standing alone is a deployment somebody configured by hand rather than
// a stage that did not run. withheld is held, for ./HoldsStripeSecret's reason: the worker reads
// it, and the only thing that cannot be done with it is drawing it on this console.
func HoldsNoSpamPair(read VarsRead) bool {
	if read.Kind != ValuesRead {
		return false
	}
	empty := 0
	for _, row := range read.Vars {
		if row.Name != turnstileSitekey && row.Name != turnstileSecret {
			continue
		}
		if row.Kind != VarAbsent {
			return false
		}
		empty++
	}
	return empty == 2
}

// where a worker's own settings are read, values of deployed vars among them.
func settingsPath(accountID, workerName string) string {
	return "/accounts/" + accountID + "/workers/scripts/" + url.PathEscape(workerName) + "/settings"
}

// DeployedVars is the thirteen as `workerName` in `accountID` holds them.
func DeployedVars(ctx context.Context, get cf.Get, accountID, workerName string) VarsRead {
	read := cf.ReadShaped(get(ctx, settingsPath(accountID, workerName)), func(value any) ([]any, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		bindings, listed := held["bindings"].([]any)
		return bindings, listed
	})
	if read.Kind != cf.ResultValue {
		return VarsRead{Kind: failedValues(read.Kind), Detail: read.Detail}
	}

	held := map[string]map[string]any{}
	for _, binding := range read.Value {
		row, ok := binding.(map[string]any)
		if !ok {
			continue
		}
		if name, isText := row["name"].(string); isText {
			held[name] = row
		}
	}
	vars := make([]DeployedVar, 0, len(release.DeployVars))
	for _, name := range release.DeployVars {
		vars = append(vars, toVar(name, held[name]))
	}
	return VarsRead{Kind: ValuesRead, Vars: vars}
}

// one binding, as the row for the name it was found under.
//
// A value that trims to empty is absent, because that is what the deployment itself makes of it:
// its own config reader drops one, so a cell with a value in it would say the deployment holds
// something the deployment does not read.
func toVar(name string, binding map[string]any) DeployedVar {
	if binding == nil {
		return DeployedVar{Name: name, Kind: VarAbsent}
	}
	if binding["type"] == "plain_text" {
		text, _ := binding["text"].(string)
		if strings.TrimSpace(text) == "" {
			return DeployedVar{Name: name, Kind: VarAbsent}
		}
		return DeployedVar{Name: name, Kind: VarValue, Value: strings.TrimSpace(text)}
	}
	// anything else under one of the thirteen names is filled and unreadable: `secret_text` is a
	// value the deployment stored as a secret, and a binding of some other type is a name this
	// console cannot read a value out of either.
	return DeployedVar{Name: name, Kind: VarWithheld}
}

// how a read that carried no rows ended, in this reading's own words.
//
// 10007 is "this Worker does not exist on your account", which is the ordinary state of every run
// before a first deploy and not a failure to report.
func failedValues(kind cf.ResultKind) ValuesKind {
	switch kind {
	case cf.ResultMissing:
		return ValuesNotDeployed
	case cf.ResultRefused:
		return ValuesRefused
	case cf.ResultUnreadable:
		return ValuesUnreadable
	default:
		return ValuesUnreachable
	}
}
