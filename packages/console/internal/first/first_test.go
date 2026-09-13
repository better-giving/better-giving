package first

import (
	"context"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/widget"
)

// the chain that stands a deployment up, from the effects it is made of.

// every effect landing, and what each of them was handed.
type working struct {
	// stages is every stage the chain reported, in order.
	stages []Stage
	// counts is the step and total each of those stages was reported with, in the same order.
	counts [][2]int
	// details is what each of those stages said it was on, in the same order.
	details []string
	// published is each payload the var door was handed, in the order they were written.
	published []map[string]string
	// hosts is what the widget was made against.
	hosts []string
	// databaseID is what the deploy was handed to bind the worker to.
	databaseID string
	// placement is where the database step was told to keep the records, and made says that step
	// was reached at all.
	placement string
	made      bool

	standing deployment.Standing
	ran      deploy.Run
	// own is where the deployment answers, which is the address the widget's host is taken off.
	own deployment.Address
	// answering is what the second read answered where the address was turned on, and answered says
	// the switch was reached at all. Zero is the same address again, which is a switch that changed
	// nothing.
	answering deployment.Address
	answered  bool
	// written is how the sign-in pair's write went, and kept how the widget pair's did.
	written deployment.Written
	kept    deployment.Written
	// prepared is how the two stages in front of the database went, zero where they landed.
	prepared   deploy.Run
	supply     widget.Supply
	connection deployment.Connection
}

func landing() *working {
	return &working{
		standing: deployment.Standing{Kind: deployment.DatabaseMade, UUID: "the-id"},
		prepared: deploy.Run{},
		ran:      deploy.Run{Kind: deploy.Deployed, At: deploy.Verifying},
		own: deployment.Address{
			Kind:       deployment.Deployed,
			WorkersDev: "https://a-deployment.hound.workers.dev",
		},
		written:    deployment.Written{Kind: deployment.WriteSet},
		kept:       deployment.Written{Kind: deployment.WriteSet},
		supply:     widget.Supply{Kind: widget.Supplied, Made: widget.Created, Sitekey: "0x4", Secret: "0x0secret"},
		connection: deployment.Connection{Kind: deployment.Connected, Origin: "https://x.workers.dev"},
	}
}

func (one *working) bound() Effects {
	return Effects{
		Database: func(_ context.Context, placement string) deployment.Standing {
			one.made, one.placement = true, placement
			return one.standing
		},
		Prepare: func(_ context.Context, report func(deploy.Progress)) deploy.Run {
			for _, stage := range []deploy.Stage{deploy.Fetching, deploy.Checking} {
				report(deploy.Progress{Stage: stage})
			}
			return one.prepared
		},
		Deploy: func(_ context.Context, databaseID string, report func(deploy.Progress)) deploy.Run {
			one.databaseID = databaseID
			for _, stage := range []deploy.Stage{
				deploy.Migrating, deploy.Uploading, deploy.Pushing, deploy.Addressing, deploy.Verifying,
			} {
				report(deploy.Progress{Stage: stage})
			}
			return one.ran
		},
		Own: func(context.Context) deployment.Address { return one.own },
		Answer: func(context.Context) deployment.Address {
			one.answered = true
			if one.answering.Kind == "" {
				return one.own
			}
			return one.answering
		},
		Widget: func(_ context.Context, hosts []string) widget.Supply {
			one.hosts = hosts
			return one.supply
		},
		Publish: func(_ context.Context, values map[string]string) deployment.Written {
			one.published = append(one.published, values)
			if len(one.published) == 1 {
				return one.written
			}
			return one.kept
		},
		Connect: func(context.Context) deployment.Connection { return one.connection },
		At: func(stage Stage, detail string, step, steps int) {
			one.stages = append(one.stages, stage)
			one.details = append(one.details, detail)
			one.counts = append(one.counts, [2]int{step, steps})
		},
	}
}

func asked() Asked {
	return Asked{
		Password:      "a password",
		SessionSecret: "a-session-secret",
	}
}

func ran(t *testing.T, one *working) Outcome {
	t.Helper()
	return Chain(context.Background(), asked(), one.bound())
}

func TestAFirstDeployMakesTheDatabaseDeploysStoresRegistersAndConnects(t *testing.T) {
	one := landing()
	if outcome := ran(t, one); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
	want := "fetching checking database migrating uploading pushing addressing verifying signing-in widget connecting"
	if said(one.stages) != want {
		t.Errorf("stages = %v, want %q", one.stages, want)
	}
}

func TestTheDeployBindsTheWorkerToTheDatabaseThePressResolved(t *testing.T) {
	// the id is what the worker's binding names, so a deploy made without one binds to nothing.
	one := landing()
	ran(t, one)
	if one.databaseID != "the-id" {
		t.Errorf("databaseID = %q", one.databaseID)
	}
}

func TestTheSignInPairIsWrittenBeforeTheWidgetIsRegistered(t *testing.T) {
	// the worst place the chain can stop is a deployment that is up and nobody can get into, so the
	// pair lands in the first write past the deploy.
	one := landing()
	ran(t, one)
	if len(one.published) != 2 {
		t.Fatalf("%d writes were made", len(one.published))
	}
	if _, named := one.published[0]["ADMIN_PASSWORD"]; !named {
		t.Errorf("first write = %v, want the pair an operator signs in with", names(one.published[0]))
	}
	if _, named := one.published[1]["TURNSTILE_SECRET_KEY"]; !named {
		t.Errorf("second write = %v, want the widget's own half", names(one.published[1]))
	}
}

func TestTheKeyThatSignsASessionIsGeneratedAndNeverAskedFor(t *testing.T) {
	one := landing()
	ran(t, one)
	if held := one.published[0]["BETTER_AUTH_SECRET"]; held != "a-session-secret" {
		t.Errorf("write = %v, want the key the press was made with", names(one.published[0]))
	}
	if password := one.published[0]["ADMIN_PASSWORD"]; password != "a password" {
		t.Error("the password is not the one that was typed; nothing here trims it")
	}
}

func TestTheWidgetIsWrittenAsVarsAndNotCarriedByADeploy(t *testing.T) {
	// a var is a read of the worker's bindings and one patch back — seconds, and no second trip past
	// the one-way door — which is what lets the widget be registered after the deploy.
	one := landing()
	ran(t, one)
	if one.published[1]["TURNSTILE_SITE_KEY"] != "0x4" {
		t.Errorf("published = %v", one.published)
	}
}

func TestTheWidgetCoversTheDeploymentsOwnHostAndNothingElse(t *testing.T) {
	// a bare host and not the origin the deployment answers on: a widget's domains are hosts. it is
	// the only one this press has — the donor-facing page is served by the deployment itself
	// (CLAUDE.md → Product surface) — and a site typed on the console's sites fold levels the widget
	// behind the write that stores it.
	one := landing()
	ran(t, one)
	if strings.Join(one.hosts, ",") != "a-deployment.hound.workers.dev" {
		t.Errorf("hosts = %v, want this deployment's own alone", one.hosts)
	}
}

func TestADeploymentAnsweringNowhereIsNoWidgetAndCloudflareIsAskedNothing(t *testing.T) {
	// the widget is registered against the host a donor is challenged on, so a deployment this
	// console cannot read an address for is a widget registered against nothing — and the sentence
	// names which of the five ways the read ended rather than reporting one absence.
	// a worker that is up and answering on nothing is three of those states and not one, and each
	// is somewhere different for an operator to go (../deployment/address.go's NoWorkersDev).
	for _, one := range []struct {
		address deployment.Address
		names   string
	}{
		{deployment.Address{Kind: deployment.NotDeployed}, "no worker of this deployment's name"},
		{deployment.Address{Kind: deployment.Deployed}, "no address a donor could be sent to"},
		{deployment.Address{Kind: deployment.Deployed, Why: deployment.TurnedOff},
			"workers.dev address is turned off"},
		{deployment.Address{Kind: deployment.Deployed, Why: deployment.Unregistered},
			"this account has never registered a workers.dev subdomain"},
		{deployment.Address{Kind: deployment.Deployed, Why: deployment.Unknown},
			"a workers.dev address this account would not name"},
		{deployment.Address{Kind: deployment.AddressRefused, Detail: "Authentication error"},
			"Authentication error"},
		{deployment.Address{Kind: deployment.AddressUnreachable}, "could not read where"},
	} {
		held := landing()
		held.own = one.address
		outcome := ran(t, held)
		if outcome.Kind != NoWidget {
			t.Fatalf("outcome = %+v, want the widget named as the thing that did not happen", outcome)
		}
		if !strings.Contains(outcome.Detail, one.names) {
			t.Errorf("detail = %q, which says nothing about %q", outcome.Detail, one.names)
		}
		// the arm carries a supply on every no-widget, because that is what the screen reads off one.
		if outcome.Supply == nil || outcome.Supply.Kind != widget.NoHosts {
			t.Errorf("supply = %+v, want the one a press with no host to cover answers", outcome.Supply)
		}
		if held.hosts != nil {
			t.Errorf("cloudflare was asked for a widget against %v", held.hosts)
		}
	}
}

func TestADatabaseThatWasNotMadeStopsTheChainBeforeAnythingIsDeployed(t *testing.T) {
	one := landing()
	one.standing = deployment.Standing{Kind: deployment.DatabaseMany}
	outcome := ran(t, one)
	if outcome.Kind != NoDatabase || outcome.Made.Kind != deployment.DatabaseMany {
		t.Fatalf("outcome = %+v", outcome)
	}
	if said(one.stages) != "fetching checking database" {
		t.Errorf("stages = %v, want nothing past the database", one.stages)
	}
}

func TestADeployThatDidNotLandIsCarriedWholeAndNothingIsStored(t *testing.T) {
	one := landing()
	one.ran = deploy.Run{Kind: deploy.Stopped, At: deploy.Uploading, Detail: "Authentication error"}
	outcome := ran(t, one)
	if outcome.Kind != NotDeployed || outcome.Ran.Kind != deploy.Stopped {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(one.published) != 0 {
		t.Errorf("%d writes were made against a deployment that is not there", len(one.published))
	}
}

func TestAReleaseThatCouldNotBeHeldStopsInFrontOfTheDatabase(t *testing.T) {
	// the whole of why the fetch stands ahead of the database: a bundle that is not there, or one
	// packed from another revision, leaves the cloudflare account exactly as this press found it.
	one := landing()
	one.prepared = deploy.Run{Kind: deploy.NoBundle, At: deploy.Fetching, Detail: "404"}
	outcome := ran(t, one)
	if outcome.Kind != NotDeployed || outcome.Ran.Kind != deploy.NoBundle {
		t.Fatalf("outcome = %+v", outcome)
	}
	if one.made {
		t.Errorf("a database was made after a release this press could not hold")
	}
	if said(one.stages) != "fetching checking" {
		t.Errorf("stages = %v, want nothing past the account read", one.stages)
	}
}

func TestASignInPairThatWasNotStoredIsItsOwnOutcomeAndNoWidgetIsMade(t *testing.T) {
	// the deployment is up and nobody can sign in to it, which is the worst place to stop.
	one := landing()
	one.written = deployment.Written{Kind: deployment.WriteRefused, Detail: "Authentication error"}
	outcome := ran(t, one)
	if outcome.Kind != NoSignIn || outcome.Written.Kind != deployment.WriteRefused {
		t.Fatalf("outcome = %+v", outcome)
	}
	if one.hosts != nil {
		t.Error("a widget was registered past a deployment nobody can sign in to")
	}
}

func TestTheWidgetIsRegisteredPastTheSignInWrite(t *testing.T) {
	// past the write because nothing that can fail may stand between the upload and the pair
	// anybody signs in with.
	one := landing()
	ran(t, one)
	if want := "signing-in widget"; !strings.Contains(said(one.stages), want) {
		t.Errorf("stages = %v, want %q among them", one.stages, want)
	}
}

func TestAWidgetThatWasNotMadeIsItsOwnOutcomeAndCarriesNoSecret(t *testing.T) {
	one := landing()
	one.supply = widget.Supply{Kind: widget.Unmade, Made: widget.Created,
		Failure: &widget.Failure{Kind: widget.CallRefused, Detail: "Authentication error"}}
	outcome := ran(t, one)
	if outcome.Kind != NoWidget || outcome.Supply.Failure.Kind != widget.CallRefused {
		t.Fatalf("outcome = %+v", outcome)
	}
	if outcome.Supply.Secret != "" {
		t.Error("an outcome carries the widget's secret")
	}
}

func TestAWidgetWhoseHalvesWereNotWrittenIsItsOwnOutcome(t *testing.T) {
	// a widget on the account and a deployment holding neither half of it: the way out is the same
	// press again, because the widget is found by name and its secret read back off a get.
	one := landing()
	one.kept = deployment.Written{Kind: deployment.WriteUnreachable, Detail: "no route"}
	outcome := ran(t, one)
	if outcome.Kind != Unkept || outcome.Supply.Sitekey != "0x4" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if outcome.Written == nil || outcome.Written.Kind != deployment.WriteUnreachable {
		t.Fatalf("outcome = %+v", outcome)
	}
	if outcome.Supply.Secret != "" {
		t.Error("an outcome carries the widget's secret")
	}
}

// both halves of the widget go up in one write, so the deployment gains one worker version and
// never a state holding the secret and not the sitekey.
func TestBothHalvesOfTheWidgetGoUpInOneWrite(t *testing.T) {
	one := landing()
	ran(t, one)
	if len(one.published) != 2 {
		t.Fatalf("the chain made %d var writes", len(one.published))
	}
	pair := one.published[1]
	if len(pair) != 2 || pair["TURNSTILE_SECRET_KEY"] != "0x0secret" || pair["TURNSTILE_SITE_KEY"] != "0x4" {
		t.Fatalf("the widget went up as %v", pair)
	}
}

// the sign-in pair is written as vars like everything else an operator configures.
func TestTheSignInPairGoesUpAsVars(t *testing.T) {
	one := landing()
	ran(t, one)
	pair := one.published[0]
	if len(pair) != 2 || pair["ADMIN_PASSWORD"] != "a password" || pair["BETTER_AUTH_SECRET"] != "a-session-secret" {
		t.Fatalf("the sign-in pair went up as %v", pair)
	}
}

func TestAWidgetAlreadyAtThoseValuesIsNotAFailure(t *testing.T) {
	// a second press over a deployment holding what it asked for writes nothing and is not a stop.
	one := landing()
	one.kept = deployment.Written{Kind: deployment.WriteUnchanged}
	if outcome := ran(t, one); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestASessionThisConsoleDidNotGetIsItsOwnOutcome(t *testing.T) {
	// the deployment is up and signable in to, and this console can read nothing it says about
	// itself: the way out is the same press again.
	one := landing()
	one.connection = deployment.Connection{Kind: deployment.ConnectRefused, Detail: "Authentication error"}
	outcome := ran(t, one)
	if outcome.Kind != NoSession || outcome.Connection.Kind != deployment.ConnectRefused {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestADatabaseAlreadyThereIsNotMadeASecondTime(t *testing.T) {
	one := landing()
	one.standing = deployment.Standing{Kind: deployment.DatabaseThere, UUID: "the-id"}
	if outcome := ran(t, one); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestEveryStageTheDeployReportsIsOneTheChainNames(t *testing.T) {
	// the screen's own mapping is written against Stages, so a stage the engine gained and this
	// list did not is a line lit for nothing.
	named := map[Stage]bool{}
	for _, stage := range Stages {
		named[stage] = true
	}
	for _, stage := range []deploy.Stage{
		deploy.Fetching, deploy.Checking, deploy.Migrating, deploy.Uploading, deploy.Pushing,
		deploy.Addressing, deploy.Verifying,
	} {
		if !named[Stage(stage)] {
			t.Errorf("the deploy reports %q and the chain names no such stage", stage)
		}
	}
}

func TestAGeneratedSessionKeyIsLongEnoughToSignWith(t *testing.T) {
	one, err := SessionSecret()
	if err != nil {
		t.Fatalf("SessionSecret: %v", err)
	}
	other, _ := SessionSecret()
	if len(one) < 40 || one == other {
		t.Errorf("secret = %d characters, and a second one %s it", len(one), sameness(one, other))
	}
}

func sameness(one, other string) string {
	if one == other {
		return "matched"
	}
	return "differed from"
}

func said(stages []Stage) string {
	held := []string{}
	for _, stage := range stages {
		held = append(held, string(stage))
	}
	return strings.Join(held, " ")
}

func names(payload map[string]string) []string {
	held := []string{}
	for name := range payload {
		held = append(held, name)
	}
	return held
}

func TestThePlacementReachesTheStepThatMakesTheDatabaseAndNothingAfterIt(t *testing.T) {
	// neither of cloudflare's placement fields can be changed after creation, so the one step able
	// to state it is the create — and a chain that carried it further would be carrying a value
	// nothing left can act on.
	one := landing()
	asked := asked()
	asked.Placement = "eu"
	if outcome := Chain(context.Background(), asked, one.bound()); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
	if one.placement != "eu" {
		t.Errorf("the database step was handed %q", one.placement)
	}
}

func TestTheWidgetsHostIsTakenOffACustomDomainWhereWorkersDevIsOff(t *testing.T) {
	// the address is whatever ./address.go's Origin answers, so a deployment served on a domain of
	// its own is challenged on that host rather than on nothing.
	one := landing()
	one.own = deployment.Address{
		Kind:        deployment.Deployed,
		Why:         deployment.TurnedOff,
		Domains:     []string{"https://give.example.org"},
		ReadDomains: true,
	}
	if outcome := ran(t, one); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
	if strings.Join(one.hosts, ",") != "give.example.org" {
		t.Errorf("hosts = %v", one.hosts)
	}
}

func TestTheEnginesOwnCountsAreCarriedThroughAndTheChainsStagesCountNothing(t *testing.T) {
	// what a screen draws on the row that is running is a bar, and the parts it is drawn from are
	// the engine's — cloudflare's buckets, the pending files. a chain that reported the stage alone
	// would leave that row with a name and no width, on the stages that take the minutes.
	one := landing()
	effects := one.bound()
	deploying := effects.Deploy
	effects.Deploy = func(ctx context.Context, databaseID string, report func(deploy.Progress)) deploy.Run {
		report(deploy.Progress{Stage: deploy.Uploading, Detail: "bucket 2 of 5", Step: 2, Steps: 5})
		return deploying(ctx, databaseID, report)
	}

	if outcome := Chain(context.Background(), asked(), effects); outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
	counted := [][2]int{}
	for at, stage := range one.stages {
		if one.counts[at] == [2]int{0, 0} {
			continue
		}
		counted = append(counted, one.counts[at])
		if stage != Stage(deploy.Uploading) {
			t.Errorf("%q was reported as %v, want a stage that counts nothing", stage, one.counts[at])
		}
	}
	if len(counted) != 1 || counted[0] != [2]int{2, 5} {
		t.Errorf("the counted stages were %v, want the engine's own", counted)
	}

	// the words beside the count are the engine's too: without them a row says a share of something
	// it never names.
	named := []string{}
	for at, detail := range one.details {
		if detail != "" {
			named = append(named, string(one.stages[at])+" "+detail)
		}
	}
	if len(named) != 1 || named[0] != "uploading bucket 2 of 5" {
		t.Errorf("the stages named %v, want the engine's own words carried through", named)
	}
}

func TestADeploymentWhoseOwnAddressIsOffIsTurnedOnAndReadAgain(t *testing.T) {
	// the upload leaves the worker's own workers.dev off where the account had no name to switch it
	// on under (../deploy/upload.go), so a deployment this press put up minutes ago stands there
	// reachable by nobody — and the widget is registered against the host donors are challenged on.
	one := landing()
	one.own = deployment.Address{Kind: deployment.Deployed, Why: deployment.TurnedOff}
	one.answering = deployment.Address{
		Kind:       deployment.Deployed,
		WorkersDev: "https://a-deployment.hound.workers.dev",
	}

	outcome := ran(t, one)

	if outcome.Kind != Deployed {
		t.Fatalf("outcome = %+v", outcome)
	}
	if strings.Join(one.hosts, ",") != "a-deployment.hound.workers.dev" {
		t.Errorf("hosts = %v, want the address the second read answered", one.hosts)
	}
}

func TestAnAddressThatIsNotOffIsLeftExactlyAsItIs(t *testing.T) {
	// the switch is turned on where a deployment answers nowhere and never where it answers: an
	// account with no workers.dev name of its own and a read that found nothing out are somewhere
	// else for the operator to go, and a worker already answering is one this press touches nothing
	// of.
	for _, address := range []deployment.Address{
		{Kind: deployment.Deployed, WorkersDev: "https://a-deployment.hound.workers.dev"},
		{Kind: deployment.Deployed, Why: deployment.Unregistered},
		{Kind: deployment.Deployed, Why: deployment.Unknown},
		{Kind: deployment.NotDeployed},
		{Kind: deployment.AddressRefused, Detail: "Authentication error"},
	} {
		one := landing()
		one.own = address
		ran(t, one)
		if one.answered {
			t.Errorf("%+v had its workers.dev switched on", address)
		}
	}
}

// the widget stage on its own, which is the press a `start` over a deployment already standing
// makes to finish what a first run never landed
// (../../cmd/better-giving/start.go's finishing).

func TestTheWidgetStageRegistersAndWritesBothHalvesOnItsOwn(t *testing.T) {
	one := landing()

	stopped := Registering(context.Background(), one.bound())

	if stopped.Kind != "" {
		t.Fatalf("Registering = %+v, want every step of it landing", stopped)
	}
	if said(one.stages) != "widget" {
		t.Errorf("stages = %v, want the one stage this press is", one.stages)
	}
	if len(one.published) != 1 || one.published[0]["TURNSTILE_SITE_KEY"] != "0x4" {
		t.Errorf("published %v, want both halves of the widget written", one.published)
	}
	if one.made || one.databaseID != "" {
		t.Error("a press that only registers the widget made a database")
	}
}

func TestTheWidgetStageAloneCarriesTheSameOutcomeTheChainWould(t *testing.T) {
	// the arms are the chain's own, so a finish that stopped is answered in the words the deploy
	// that stopped in the same place is (../terminal/outcome.go).
	one := landing()
	one.supply = widget.Supply{Kind: widget.Ambiguous, Sitekeys: []string{"0x1", "0x2"}}

	stopped := Registering(context.Background(), one.bound())

	if stopped.Kind != NoWidget || stopped.Supply == nil || stopped.Supply.Kind != widget.Ambiguous {
		t.Fatalf("Registering = %+v, want the widget's own answer whole", stopped)
	}
}

func TestTheWidgetStageDrawsNothingWhereNobodyIsReporting(t *testing.T) {
	// a finish draws no ledger: there is one stage and it stands under a wait of its own
	// (../../cmd/better-giving/start.go's finishAt).
	one := landing()
	effects := one.bound()
	effects.At = nil

	if stopped := Registering(context.Background(), effects); stopped.Kind != "" {
		t.Fatalf("Registering = %+v, want a press nobody is reporting to landing", stopped)
	}
}
