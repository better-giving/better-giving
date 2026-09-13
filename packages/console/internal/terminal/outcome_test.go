package terminal

import (
	"strings"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deploy"
	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/effects"
	"github.com/better-giving/console/internal/first"
	"github.com/better-giving/console/internal/widget"
)

// every way the chain can end but the one that landed.
//
// declared here rather than read off ../first, which publishes no list of its kinds: a kind added
// there and not to ./outcome.go reaches `unaccounted`, and the case below is what says so — the
// same arrangement ./lines.go's DeployStages is held under.
var stops = []first.Kind{
	first.NoDatabase,
	first.NotDeployed,
	first.NoSignIn,
	first.NoWidget,
	first.Unkept,
	first.NoSession,
	first.ConsoleStopped,
}

func TestEveryWayTheChainCanStopSaysWhatItLeftBehind(t *testing.T) {
	for _, kind := range stops {
		said := Outcome(first.Outcome{Kind: kind})
		if said == "" {
			t.Errorf("a chain that ended %q says nothing at all", kind)
		}
		if said == unaccounted {
			t.Errorf("a chain that ended %q has no sentence of its own", kind)
		}
	}
}

func TestNoTwoWaysTheChainCanStopShareOneSentence(t *testing.T) {
	// a sentence standing for two of them is an operator sent to repair the wrong half: a widget
	// that was not registered and a password that was not stored are different states of one
	// deployment that is up.
	seen := map[string]first.Kind{}
	for _, kind := range stops {
		said := Outcome(first.Outcome{Kind: kind})
		if already, twice := seen[said]; twice {
			t.Errorf("%q and %q are told apart by nothing", already, kind)
		}
		seen[said] = kind
	}
}

func TestADeployThatLandedHasNothingToSay(t *testing.T) {
	if said := Outcome(first.Outcome{Kind: first.Deployed}); said != "" {
		t.Errorf("a deploy that landed says %q", said)
	}
}

// what a sentence drawn in a browser ends on, and what none of these may.
var browserActs = []string{"Reload this page", "Press Continue", "this page"}

func TestNoOutcomeSentenceSendsAnOperatorToAScreen(t *testing.T) {
	// the repair in a terminal is the command again, and there is no screen to press anything on:
	// a sentence copied off packages/console-ui/src/routes/_index.tsx would send an operator to a
	// face nothing draws for them.
	said := map[first.Kind]string{}
	for _, kind := range stops {
		said[kind] = Outcome(first.Outcome{Kind: kind})
	}
	for _, ran := range everyWayTheChainStops() {
		said[ran.Kind] += " " + Outcome(ran)
	}
	for kind, sentence := range said {
		for _, act := range browserActs {
			if strings.Contains(sentence, act) {
				t.Errorf("a chain that ended %q says %q, which names a browser act", kind, act)
			}
		}
	}
}

func TestNoOutcomeSentenceQuotesWhatCloudflareSaid(t *testing.T) {
	// cloudflare's words are drawn under the sentence and never inside it (./Said): a sentence
	// carrying them changes shape with the answer, and the answer is the one thing here that no
	// case can predict. it is also what keeps every value a press was made with out of the
	// sentence — nothing an operator typed reaches an outcome at all, and cloudflare's own words
	// are the only text on one this file did not write.
	for _, ran := range everyWayTheChainStops() {
		if said := Outcome(ran); strings.Contains(said, quoted) {
			t.Errorf("a chain that ended %q quotes what cloudflare said", ran.Kind)
		}
		if said := Said(ran); !strings.Contains(said, quoted) {
			t.Errorf("a chain that ended %q draws none of what cloudflare said: %q", ran.Kind, said)
		}
	}
}

func TestTheTwoStagesInFrontOfTheOneWayDoorSayNothingWasChanged(t *testing.T) {
	// they are in front of it so that a press that cannot go on leaves the account as it found it
	// (CLAUDE.md), and an operator who is not told that reads a stopped deploy as a database half
	// migrated.
	for _, at := range []deploy.Stage{deploy.Fetching, deploy.Checking} {
		said := Outcome(first.Outcome{Kind: first.NotDeployed, Ran: &deploy.Run{At: at}})
		if !strings.Contains(said, "nothing was changed") {
			t.Errorf("a deploy stopped at %q says %q", at, said)
		}
	}
}

func TestEveryStageOfTheDeploySaysWhatItLeftStanding(t *testing.T) {
	// the seven are four different states of one account, and the migration is the line between
	// them: a deploy stopped anywhere in the upload left a database that was migrated, and one
	// stopped in front of it left nothing.
	seen := map[string]deploy.Stage{}
	for _, at := range DeployStages {
		said := Outcome(first.Outcome{Kind: first.NotDeployed, Ran: &deploy.Run{At: deploy.Stage(at)}})
		if said == "" {
			t.Errorf("a deploy stopped at %q says nothing at all", at)
		}
		// a stage the engine genuinely reaches and this file has no case for falls through to the
		// sentence for a deploy that stopped where nothing could say — which reads as this console
		// losing track of a press it watched the whole way.
		if said == nowhereNamed(Starting) {
			t.Errorf("a deploy stopped at %q says this console has no account of where", at)
		}
		if already, twice := seen[said]; twice && !oneState(already, deploy.Stage(at)) {
			t.Errorf("a deploy stopped at %q and one stopped at %q say the same thing", already, at)
		}
		seen[said] = deploy.Stage(at)
	}
}

// the stages that leave the same thing standing, each group being one state and so one sentence.
func oneState(one, other deploy.Stage) bool {
	for _, group := range []map[deploy.Stage]bool{
		// in front of the one-way door: nothing written anywhere.
		{deploy.Fetching: true, deploy.Checking: true},
		// past it and short of a deployment: the files, the code and where it answers alike.
		{deploy.Uploading: true, deploy.Pushing: true, deploy.Addressing: true},
	} {
		if group[one] && group[other] {
			return true
		}
	}
	return false
}

func TestADeploymentThatNobodyCanSignInToIsSaidInThoseWords(t *testing.T) {
	// the worst place the chain can stop: everything is up and the dashboard turns every sign-in
	// away, and a sentence that only said a write failed would not tell an operator that.
	said := Outcome(first.Outcome{Kind: first.NoSignIn, Written: &deployment.Written{}})
	if !strings.Contains(said, "deployed") || !strings.Contains(said, "sign in") {
		t.Errorf("no-sign-in says %q", said)
	}
}

func TestAWidgetThatWasNotRegisteredIsSaidOverADeploymentThatIsServing(t *testing.T) {
	// the widget is registered after the deploy, so every one of these is said over a deployment
	// that is already up: an operator told nothing was deployed goes looking for one that is not
	// there.
	said := Outcome(first.Outcome{Kind: first.NoWidget, Supply: &widget.Supply{}})
	if !strings.Contains(said, "up and serving") {
		t.Errorf("no-widget says %q", said)
	}
}

// the words cloudflare is standing in for, on every member of an outcome that carries its answer.
const quoted = "cloudflare's own words here"

// one outcome of every kind, each carrying what the step that stopped it answered.
func everyWayTheChainStops() []first.Outcome {
	return []first.Outcome{
		{Kind: first.NoDatabase, Made: &deployment.Standing{
			Kind: deployment.DatabaseFailed, Detail: quoted}},
		{Kind: first.NotDeployed, Ran: &deploy.Run{
			Kind: deploy.Stopped, At: deploy.Migrating, File: "0007_windy_pandemic.sql",
			Detail: quoted}},
		{Kind: first.NoSignIn, Written: &deployment.Written{
			Kind: deployment.WriteFailed, Detail: quoted}},
		{Kind: first.NoWidget, Supply: &widget.Supply{
			Kind: widget.Unmade, Failure: &widget.Failure{Kind: widget.CallFailed, Detail: quoted}}},
		{Kind: first.Unkept, Written: &deployment.Written{
			Kind: deployment.WriteRefused, Detail: quoted}},
		{Kind: first.NoSession, Connection: &deployment.Connection{
			Kind: deployment.ConnectFailed, Detail: quoted}},
	}
}

// every way the redeploy can end but the one that landed.
//
// spelled out here rather than swept off ../effects, which publishes the four as constants and no
// list of them: a kind added there and not to ./redeploy.go reaches `unaccountedUpdate`, and the
// case below is what says so — the same arrangement the chain's own `stops` is held under.
var redeployStops = []effects.CarriedKind{
	effects.NoDatabase,
	effects.NotDeployed,
	effects.ConsoleStopped,
}

// every way the database this press deploys over is not resolved (../effects' Absent).
var databaseAbsences = []string{"none", "many", "refused", "unreachable", "no-credential"}

func TestEveryWayTheRedeployCanStopSaysWhatItLeftBehind(t *testing.T) {
	for _, kind := range redeployStops {
		said := UpdateOutcome(effects.Carried{Kind: kind})
		if said == "" {
			t.Errorf("a redeploy that ended %q says nothing at all", kind)
		}
		if said == unaccountedUpdate {
			t.Errorf("a redeploy that ended %q has no sentence of its own", kind)
		}
	}
}

func TestNoTwoWaysTheRedeployCanStopShareOneSentence(t *testing.T) {
	seen := map[string]effects.CarriedKind{}
	for _, kind := range redeployStops {
		said := UpdateOutcome(effects.Carried{Kind: kind})
		if already, twice := seen[said]; twice {
			t.Errorf("%q and %q are told apart by nothing", already, kind)
		}
		seen[said] = kind
	}
}

func TestARedeployThatLandedHasNothingToSay(t *testing.T) {
	if said := UpdateOutcome(effects.Carried{Kind: effects.Deployed}); said != "" {
		t.Errorf("a redeploy that landed says %q", said)
	}
}

func TestEveryWayTheDatabaseIsNotFoundSaysNothingWasUploaded(t *testing.T) {
	// the chain would have made the database and this press only looks for it, so every one of
	// these is said over a deployment that is still standing and still serving: an operator told
	// nothing was deployed goes looking for one that is not there.
	seen := map[string]string{}
	for _, found := range databaseAbsences {
		said := NoDatabaseFound(found)
		if !strings.Contains(said, "nothing was uploaded") {
			t.Errorf("a database that was %q says %q", found, said)
		}
		if already, twice := seen[said]; twice {
			t.Errorf("a database that was %q and one that was %q say the same thing", already, found)
		}
		seen[said] = found
	}
}

func TestNoRedeploySentenceQuotesWhatCloudflareSaid(t *testing.T) {
	for _, ran := range everyWayTheRedeployStops() {
		if said := UpdateOutcome(ran); strings.Contains(said, quoted) {
			t.Errorf("a redeploy that ended %q quotes what cloudflare said", ran.Kind)
		}
		if said := UpdateSaid(ran); !strings.Contains(said, quoted) {
			t.Errorf("a redeploy that ended %q draws none of what cloudflare said: %q", ran.Kind, said)
		}
	}
}

func TestNoRedeploySentenceSendsAnOperatorToAScreen(t *testing.T) {
	for _, said := range everyRedeploySentence() {
		for _, act := range browserActs {
			if strings.Contains(said, act) {
				t.Errorf("a redeploy says %q, which names a browser act", said)
			}
		}
	}
}

func TestNoDeploySentenceSendsAnOperatorToTheConsoleInstaller(t *testing.T) {
	// both halves of the deploy engine run under `start` now — it stands a deployment up and it
	// carries this release onto one already standing — and `update` installs a console and deploys
	// nothing. a sentence about a deploy naming it sends an operator to a press that cannot repair
	// what they are looking at.
	for _, said := range append(everyRedeploySentence(), everyChainSentence()...) {
		if strings.Contains(said, "better-giving update") {
			t.Errorf("a deploy says %q, which names the command that deploys nothing", said)
		}
	}
}

// one outcome of every kind the redeploy answers with cloudflare's own words.
func everyWayTheRedeployStops() []effects.Carried {
	return []effects.Carried{
		{Kind: effects.NoDatabase, Found: "refused", Detail: quoted},
		{Kind: effects.NotDeployed, Ran: &deploy.Run{
			Kind: deploy.Stopped, At: deploy.Migrating, File: "0007_windy_pandemic.sql",
			Detail: quoted}},
	}
}

// every sentence the redeploy can say, whichever half of it says it.
func everyRedeploySentence() []string {
	said := []string{}
	for _, kind := range redeployStops {
		said = append(said, UpdateOutcome(effects.Carried{Kind: kind}))
	}
	for _, found := range databaseAbsences {
		said = append(said, NoDatabaseFound(found), Unnamed(effects.Migrations{Absent: found}))
	}
	for _, kind := range appliedUnread {
		said = append(said, Unnamed(effects.Migrations{Applied: kind}))
	}
	said = append(said, everyDeployStopSentence(UpdateOutcome)...)
	return said
}

// every sentence the chain can say, whichever half of it says it.
func everyChainSentence() []string {
	said := []string{}
	for _, kind := range stops {
		said = append(said, Outcome(first.Outcome{Kind: kind}))
	}
	for _, ran := range everyWayTheChainStops() {
		said = append(said, Outcome(ran))
	}
	for _, made := range []deployment.StandingKind{
		deployment.DatabaseMany, deployment.DatabaseLimit, deployment.DatabaseRefused,
		deployment.DatabaseNoCredential, deployment.DatabaseUnreachable,
	} {
		said = append(said, Outcome(first.Outcome{
			Kind: first.NoDatabase, Made: &deployment.Standing{Kind: made}}))
	}
	for _, supply := range []widget.SupplyKind{
		widget.Ambiguous, widget.NoHosts, widget.Unmade, widget.Unlisted,
	} {
		said = append(said, Outcome(first.Outcome{
			Kind: first.NoWidget, Supply: &widget.Supply{Kind: supply}}))
	}
	said = append(said, everyDeployStopSentence(func(ran effects.Carried) string {
		return Outcome(first.Outcome{Kind: first.NotDeployed, Ran: ran.Ran})
	})...)
	return said
}

// every way the deploy engine itself stops, drawn by whichever command was watching it.
func everyDeployStopSentence(say func(effects.Carried) string) []string {
	said := []string{}
	for _, at := range DeployStages {
		said = append(said, say(effects.Carried{
			Kind: effects.NotDeployed, Ran: &deploy.Run{At: deploy.Stage(at)}}))
	}
	for _, kind := range []deploy.Kind{deploy.NoBundle, deploy.Mismatched, deploy.Refused} {
		said = append(said, say(effects.Carried{
			Kind: effects.NotDeployed, Ran: &deploy.Run{Kind: kind}}))
	}
	said = append(said, say(effects.Carried{Kind: effects.NotDeployed}))
	return said
}

// every way the read of the applied list does not land (../cf's Result).
var appliedUnread = []cf.ResultKind{
	cf.ResultRefused, cf.ResultMissing, cf.ResultUnreadable, cf.ResultUnreachable,
}

func TestEveryWayThePendingReadDoesNotLandRefusesInItsOwnWords(t *testing.T) {
	// a console that could not read what a press would apply has not named the one-way door, and a
	// confirm in front of an unnamed door is a confirmation of nothing (CLAUDE.md).
	for _, found := range databaseAbsences {
		if said := Unnamed(effects.Migrations{Absent: found}); said == "" {
			t.Errorf("a database that was %q says nothing at all", found)
		}
	}
	for _, kind := range appliedUnread {
		if said := Unnamed(effects.Migrations{Applied: kind}); said == "" {
			t.Errorf("an applied list that was %q says nothing at all", kind)
		}
	}
}

func TestAPendingReadThatLandedRefusesNothing(t *testing.T) {
	read := effects.Migrations{Applied: cf.ResultValue, Names: []string{"0007_donors.sql"}}
	if said := Unnamed(read); said != "" {
		t.Errorf("a read that named the door says %q", said)
	}
}
