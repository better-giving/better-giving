package deploy

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/bundle"
	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/deployment"
)

func TestADeployFetchesMigratesUploadsPushesAndVerifies(t *testing.T) {
	held := &account{}
	run, stages := deployed(t, held, packed(t, baked()))

	if run.Kind != Deployed {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if strings.Join(stagesAsText(stages), " ") != "fetching checking migrating uploading pushing scheduling addressing verifying" {
		t.Errorf("stages = %v, want each one as the run reached it", stages)
	}
	if strings.Join(run.Applied, ",") != "0000_a.sql" {
		t.Errorf("applied = %v, want the migration the bundle carries", run.Applied)
	}
	if !held.saw("PUT /accounts/an-account/workers/scripts/better-giving") {
		t.Errorf("nothing was uploaded; the run called %v", held.paths)
	}
}

func TestTheOrderIsMigrateThenUpload(t *testing.T) {
	// the same one-way door packages/app's own deploy script keeps (CLAUDE.md): everything able to
	// fail runs in front of the migration, and the migration runs before the upload.
	held := &account{}
	deployed(t, held, packed(t, baked()))

	migrated, uploaded := -1, -1
	for at, path := range held.paths {
		if strings.HasSuffix(path, "/query") && migrated == -1 {
			migrated = at
		}
		if strings.HasPrefix(path, "PUT ") {
			uploaded = at
		}
	}
	if migrated == -1 || uploaded == -1 || migrated > uploaded {
		t.Errorf("migrated at %d and uploaded at %d, in %v", migrated, uploaded, held.paths)
	}
}

func TestTheScriptGoesUpWithTheBindingsThisAppHas(t *testing.T) {
	held := &account{}
	deployed(t, held, packed(t, baked()))

	if len(held.metadata) != 1 {
		t.Fatalf("%d scripts were uploaded", len(held.metadata))
	}
	metadata := held.metadata[0]
	if metadata["main_module"] != "index.js" {
		t.Errorf("main_module = %v", metadata["main_module"])
	}
	if metadata["compatibility_date"] != "2026-07-22" {
		t.Errorf("compatibility_date = %v", metadata["compatibility_date"])
	}

	bindings, _ := metadata["bindings"].([]any)
	if len(bindings) != 3 {
		t.Fatalf("bindings = %v, want the database, the limiter and the record of this release",
			bindings)
	}
	database, _ := bindings[0].(map[string]any)
	if database["type"] != "d1" || database["name"] != "DB" || database["id"] != "a-database" {
		// the field is `id` on the way up, whatever a later read of the settings calls it.
		t.Errorf("the database binding is %v", database)
	}
	limiter, _ := bindings[1].(map[string]any)
	if limiter["type"] != "ratelimit" || limiter["namespace_id"] != "7412" {
		t.Errorf("the rate limiter binding is %v", limiter)
	}
	if simple, _ := limiter["simple"].(map[string]any); simple["limit"] != float64(600) {
		t.Errorf("the limiter's bucket is %v", limiter["simple"])
	}
}

// what release a deployment is on, recorded by the act that puts it there.
//
// it rides the upload's own metadata rather than a write after it, so there is no state where the
// code landed and the record did not: a deploy that stopped before the upload recorded nothing, and
// one that landed recorded what landed. what reads it back is the cloudflare sign-in
// (../deployment's RecordedRelease), which is what a machine holding no session for this deployment
// still has.

func TestTheReleaseGoingUpIsRecordedOnTheWorkerByTheUploadItself(t *testing.T) {
	held := &account{}
	deployed(t, held, packed(t, baked()))

	recorded := map[string]any{}
	bindings, _ := held.metadata[0]["bindings"].([]any)
	for _, one := range bindings {
		if binding, ok := one.(map[string]any); ok && binding["name"] == deployment.RecordedReleaseName {
			recorded = binding
		}
	}
	if recorded["type"] != "plain_text" || recorded["text"] != carriedRelease {
		t.Errorf("the release went up as %v, want the one this deploy carried", recorded)
	}
}

func TestADeployNamingNoReleaseWritesNoRecordRatherThanABlankOne(t *testing.T) {
	// an empty record would replace a true one with a blank; a binding left off is a record
	// `keep_bindings` leaves exactly as the last deploy wrote it.
	held := &account{}
	deployedNamingNoRelease(t, held, packed(t, baked()))

	bindings, _ := held.metadata[0]["bindings"].([]any)
	for _, one := range bindings {
		if binding, ok := one.(map[string]any); ok && binding["name"] == deployment.RecordedReleaseName {
			t.Errorf("a deploy naming no release wrote %v", binding)
		}
	}
}

func TestTheUploadKeepsTheSecretsAndTheVarsTheDeploymentIsHolding(t *testing.T) {
	// without this field a plain-text var is deleted by the upload, which leaves the donation form
	// with no publishable key and no sitekey. `keep_vars: true` in packages/app/wrangler.jsonc is
	// the same decision, argued there at length; the values are binding types rather than names.
	held := &account{}
	deployed(t, held, packed(t, baked()))

	kept, _ := json.Marshal(held.metadata[0]["keep_bindings"])
	if string(kept) != `["plain_text","json","secret_text","secret_key"]` {
		t.Errorf("keep_bindings = %s", kept)
	}
}

func TestTheAssetsGoUpBeforeTheScriptThatServesThem(t *testing.T) {
	held := &account{}
	deployed(t, held, packed(t, baked()))

	if held.sessions != 1 {
		t.Fatalf("%d upload sessions were opened", held.sessions)
	}
	if strings.Join(held.uploaded, ",") != "session-token-a" {
		// the bucket is authorised with the token the session handed back, not the account's own.
		t.Errorf("a bucket went up on %v", held.uploaded)
	}
	assets, _ := held.metadata[0]["assets"].(map[string]any)
	if assets["jwt"] != "completion-token-a" {
		t.Errorf("the script names %v as its assets, want the token the last bucket answered with", assets["jwt"])
	}
	config, _ := assets["config"].(map[string]any)
	if config["_headers"] != "/embed.js\n  cache-control: public\n" {
		t.Errorf("_headers = %v, want the file's own text on the metadata", config["_headers"])
	}
}

func TestEveryDeployOpensAnUploadSessionOfItsOwn(t *testing.T) {
	// the completion token is single-use: a second upload reusing one is refused, so a session is
	// per deploy rather than per binary.
	held := &account{}
	bundle := packed(t, baked())
	deployed(t, held, bundle)
	deployed(t, held, bundle)

	if held.sessions != 2 {
		t.Fatalf("%d sessions were opened over two deploys", held.sessions)
	}
	if strings.Join(held.uploaded, ",") != "session-token-a,session-token-b" {
		t.Errorf("the buckets went up on %v, want each deploy's own session", held.uploaded)
	}
	first, _ := held.metadata[0]["assets"].(map[string]any)
	second, _ := held.metadata[1]["assets"].(map[string]any)
	if first["jwt"] == second["jwt"] {
		t.Errorf("both deploys named %v, and the second would be refused", first["jwt"])
	}
}

func TestASessionWantingNothingStillFinishesTheUpload(t *testing.T) {
	// a redeploy that changed no static file gets no buckets back, and the session's own token is
	// what the script is uploaded with.
	held := &account{wantsNothing: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}
	if len(held.uploaded) != 0 {
		t.Errorf("a bucket went up for a session that wanted none: %v", held.uploaded)
	}
	assets, _ := held.metadata[0]["assets"].(map[string]any)
	if assets["jwt"] != "session-token-a" {
		t.Errorf("the script names %v as its assets", assets["jwt"])
	}
}

func TestABundleFromAnotherShapeOfTheAppIsRefusedBeforeAnythingIsApplied(t *testing.T) {
	theirs := baked()
	theirs.Migrations = append(theirs.Migrations, "0001_later.sql")
	held := &account{}

	run, stages := deployed(t, held, packed(t, theirs))

	if run.Kind != Mismatched || run.At != Fetching {
		t.Fatalf("kind = %q at %q", run.Kind, run.At)
	}
	if strings.Join(run.Fields, ",") != "migrations" {
		t.Errorf("fields = %v, want what the two disagree on", run.Fields)
	}
	if len(held.paths) != 0 {
		t.Errorf("the account was called at all: %v", held.paths)
	}
	if strings.Join(stagesAsText(stages), " ") != "fetching" {
		t.Errorf("stages = %v, want the one it did not get past", stages)
	}
}

func TestAReleaseCarryingNoBundleIsItsOwnAnswer(t *testing.T) {
	held := &account{}
	run, _ := deployed(t, held, nil)

	if run.Kind != NoBundle || run.At != Fetching {
		t.Errorf("kind = %q at %q", run.Kind, run.At)
	}
	if len(held.paths) != 0 {
		t.Errorf("the account was called with no bundle to deploy: %v", held.paths)
	}
}

func TestAMigrationThatFailedStopsTheRunInFrontOfTheUpload(t *testing.T) {
	// the door is one way and the run is behind it, so what the screen is owed is which file the
	// database stopped on — and the worker is not replaced over a schema that was not reached.
	held := &account{refusesSQL: "create table a"}
	run, stages := deployed(t, held, packed(t, baked()))

	if run.Kind != Stopped || run.At != Migrating {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if run.File != "0000_a.sql" {
		t.Errorf("stopped at %q, want the file the database turned down", run.File)
	}
	if held.saw("PUT /accounts/an-account/workers/scripts/better-giving") {
		t.Error("the worker was uploaded over migrations that did not land")
	}
	if strings.Join(stagesAsText(stages), " ") != "fetching checking migrating" {
		t.Errorf("stages = %v", stages)
	}
}

func TestADeploymentThatCameBackWithoutABindingIsNotDeployed(t *testing.T) {
	// the upload's own answer carries no bindings at all, so the reading is a settings call after
	// it — and a worker running without its database is one every request fails on.
	held := &account{bound: []string{"DB"}}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Stopped || run.At != Verifying {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if !strings.Contains(run.Detail, "API_RATE_LIMITER") {
		t.Errorf("detail = %q, want the binding that did not come back", run.Detail)
	}
}

func TestARunTheOperatorStoppedWaitingOnSaysSoAndNotThatItFailed(t *testing.T) {
	// a stopped run is not a broken one: the migrations it applied are applied, and what the screen
	// says about it is different from what it says about a cloudflare that turned something down.
	for _, at := range []Stage{Fetching, Checking, Migrating, Uploading, Pushing, Addressing} {
		held := &account{}
		run, _ := deployedStopping(t, held, packed(t, baked()), at)

		if run.Kind != Cancelled {
			t.Errorf("stopping at %q ended %q (%s)", at, run.Kind, run.Detail)
		}
		if run.At != at {
			t.Errorf("stopping at %q was reported at %q", at, run.At)
		}
	}
}

func stagesAsText(stages []Stage) []string {
	text := []string{}
	for _, stage := range stages {
		text = append(text, string(stage))
	}
	return text
}

func TestEveryStatementOfAMigrationGoesUpOnTheBoundAWholeFileFitsIn(t *testing.T) {
	// the bound a screen's read is made with cuts a migration file's request off, and a call cut
	// there stops the run on a file d1 may still land whole — so the schema calls are the one part
	// of a deploy the read's own deadline is not put on.
	held := &account{}
	deployed(t, held, packed(t, baked()))

	queries := 0
	for _, path := range held.paths {
		if strings.HasSuffix(path, "/query") {
			queries++
		}
	}
	if queries == 0 || held.throughMigrate != queries {
		t.Errorf("%d of %d schema calls went up on the migration's own bound", held.throughMigrate, queries)
	}
}

func TestASignInTheAccountsWorkersAreClosedToIsFoundOutInFrontOfTheDoor(t *testing.T) {
	// the migration is one way and the upload is what it is applied for, so a credential that cannot
	// replace the script is found out while nothing has been applied.
	held := &account{refusesWorkers: true}
	run, stages := deployed(t, held, packed(t, baked()))

	if run.Kind != Refused || run.At != Checking {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	for _, path := range held.paths {
		if strings.HasSuffix(path, "/query") {
			t.Errorf("a migration was applied for an upload that was never going to be taken: %v", held.paths)
		}
	}
	if strings.Join(stagesAsText(stages), " ") != "fetching checking" {
		t.Errorf("stages = %v", stages)
	}
}

func TestAnAccountWithNoWorkerOfThisNameYetIsAFirstDeployAndNotARefusal(t *testing.T) {
	// the check is a read of the script this deploy replaces, and before the first deploy there is
	// none — cloudflare's `not found` is the ordinary state of every fork's first press.
	held := &account{neverDeployed: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Deployed {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
}

func TestADeploymentAnsweringNowhereIsGivenAnAddress(t *testing.T) {
	// wrangler turns workers.dev on for a worker that declares no routes and the raw api does not,
	// so a deployment the console put up stood in the account reachable by nobody.
	held := &account{neverDeployed: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Deployed {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	made := held.subdomains["better-giving"]
	if len(made) != 1 {
		t.Fatalf("workers.dev was set %d times", len(made))
	}
	if made[0]["enabled"] != true {
		t.Errorf("workers.dev = %v, want it turned on", made[0])
	}
	if made[0]["previews_enabled"] != false {
		t.Errorf("previews = %v, want one address and no per-version ones", made[0])
	}
}

func TestADeployLeavesAWorkerThatAlreadyAnswersAlone(t *testing.T) {
	held := &account{workersDev: true}
	deployed(t, held, packed(t, baked()))

	if made := held.subdomains["better-giving"]; len(made) != 0 {
		t.Errorf("workers.dev was set %d times on a worker that answers: %v", len(made), made)
	}
}

func TestADeployLeavesAWorkerOnADomainOfItsOwnAlone(t *testing.T) {
	// an operator who attached a domain and turned workers.dev off has said where their deployment
	// answers, and a deploy switching it back on would overrule that every time they shipped.
	held := &account{customDomains: []string{"give.riverside-shelter.org"}}
	deployed(t, held, packed(t, baked()))

	if made := held.subdomains["better-giving"]; len(made) != 0 {
		t.Errorf("workers.dev was set %d times on a worker with a domain: %v", len(made), made)
	}
}

func TestADeploymentThatCouldNotBeGivenAnAddressSaysSo(t *testing.T) {
	// the migrations are through the one-way door by this point and the worker is up, and it still
	// answers nowhere — which is a deploy reporting success onto a screen with no address on it.
	held := &account{neverDeployed: true, refusesSubdomain: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Refused || run.At != Addressing {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
}

func TestEveryCheckADeployMakesIsAStageOfItsOwnAndNamesNothingBesideIt(t *testing.T) {
	// each check is a row an operator watches light and tick (../terminal/lines.go), so the stage is
	// the whole of what it says: a note beside it would be a second wording of the row's own words.
	held := &account{neverDeployed: true}
	run, reported := deployedReporting(t, held, packed(t, baked()))
	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}

	passed := []Stage{}
	for _, progress := range reported {
		if len(passed) == 0 || passed[len(passed)-1] != progress.Stage {
			passed = append(passed, progress.Stage)
		}
	}
	want := "fetching checking migrating uploading pushing scheduling addressing verifying"
	if got := strings.Join(stagesAsText(passed), " "); got != want {
		t.Errorf("stages = %q, want %q", got, want)
	}
	for _, check := range []Stage{Checking, Scheduling, Addressing, Verifying} {
		if said := detailed(reportedAt(reported, check)); strings.Join(said, "|") != "" {
			t.Errorf("%q said %q, want the stage opening and nothing else", check, said)
		}
	}
}

func TestTheScheduleGoesUpAfterTheScriptAsTheCronsTheBundleCarries(t *testing.T) {
	held := &account{}
	run, _ := deployed(t, held, packed(t, baked()))
	if run.Kind != Deployed {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}

	const schedules = "PUT /accounts/an-account/workers/scripts/better-giving/schedules"
	script, scheduled := -1, -1
	for at, path := range held.paths {
		switch path {
		case "PUT /accounts/an-account/workers/scripts/better-giving":
			script = at
		case schedules:
			scheduled = at
		}
	}
	if script == -1 || scheduled < script {
		t.Fatalf("script at %d and schedule at %d, in %v", script, scheduled, held.paths)
	}
	var sent []map[string]string
	if len(held.schedules) != 1 || json.Unmarshal([]byte(held.schedules[0]), &sent) != nil {
		t.Fatalf("schedules sent = %q, want one json body", held.schedules)
	}
	if len(sent) != 1 || len(sent[0]) != 1 || sent[0]["cron"] != "*/30 * * * *" {
		t.Errorf("schedule = %v, want the one cron the bundle carries", sent)
	}
}

func TestABundleDeclaringNoCronsTakesTheScheduleOffRatherThanLeavingIt(t *testing.T) {
	config := baked()
	config.Crons = []string{}
	held := &account{}
	run := runningWith(t, held, packed(t, config), config)
	if run.Kind != Deployed {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}

	if len(held.schedules) != 1 || strings.TrimSpace(held.schedules[0]) != "[]" {
		t.Errorf("schedules sent = %q, want one empty list", held.schedules)
	}
}

func TestAScheduleCloudflareTurnedDownStopsTheRunAndSaysSo(t *testing.T) {
	held := &account{refusesSchedules: true}
	run, stages := deployed(t, held, packed(t, baked()))

	if run.Kind != Stopped || run.At != Scheduling {
		t.Fatalf("kind = %q at %q (%s), want stopped at scheduling", run.Kind, run.At, run.Detail)
	}
	if !strings.Contains(run.Detail, "schedule") || !strings.Contains(run.Detail, "invalid cron expression") {
		t.Errorf("detail = %q, want the schedule named and cloudflare's own words", run.Detail)
	}
	if last := stages[len(stages)-1]; last != Scheduling {
		t.Errorf("stages = %v, want the run to end at the schedule", stages)
	}
}

func TestAWorkerMissingItsScheduleIsUnscheduledAndNothingIsReported(t *testing.T) {
	held := &account{}
	reported := []Progress{}
	options := againstAccount(t, held, baked(), &reported)

	unscheduled, run := Unscheduled(t.Context(), options)
	if run.Kind != "" || !unscheduled {
		t.Errorf("unscheduled = %v with %q (%s), want the missing cron found", unscheduled, run.Kind, run.Detail)
	}
	if len(reported) != 0 || len(held.schedules) != 0 {
		t.Errorf("a read reported %v and put %q, want neither", reported, held.schedules)
	}
}

func TestAWorkerHoldingTheCarriedScheduleInAnyOrderIsLevel(t *testing.T) {
	config := baked()
	config.Crons = []string{"0 3 * * *", "*/30 * * * *"}
	held := &account{scheduled: []string{"*/30 * * * *", "0 3 * * *"}}
	reported := []Progress{}

	unscheduled, run := Unscheduled(t.Context(), againstAccount(t, held, config, &reported))
	if run.Kind != "" || unscheduled {
		t.Errorf("unscheduled = %v with %q (%s), want level", unscheduled, run.Kind, run.Detail)
	}
}

func TestAWorkerHoldingACronTheReleaseDroppedIsUnscheduled(t *testing.T) {
	config := baked()
	config.Crons = []string{}
	held := &account{scheduled: []string{"*/30 * * * *"}}
	reported := []Progress{}

	if unscheduled, _ := Unscheduled(t.Context(), againstAccount(t, held, config, &reported)); !unscheduled {
		t.Error("a cron the release no longer declares read as level")
	}
}

func TestAScheduleReadThatDidNotLandStopsAtSchedulingInCloudflaresWords(t *testing.T) {
	held := &account{refusesScheduleRead: true}
	reported := []Progress{}

	unscheduled, run := Unscheduled(t.Context(), againstAccount(t, held, baked(), &reported))
	if unscheduled || run.Kind != Stopped || run.At != Scheduling {
		t.Fatalf("unscheduled = %v with %q at %q, want stopped at scheduling", unscheduled, run.Kind, run.At)
	}
	if !strings.Contains(run.Detail, "schedule") || !strings.Contains(run.Detail, "an internal error occurred") {
		t.Errorf("detail = %q, want the schedule named and cloudflare's own words", run.Detail)
	}
	if len(held.schedules) != 0 {
		t.Errorf("a read that did not land put %q", held.schedules)
	}
}

func TestARescheduleIsTheSchedulingStagePuttingTheCarriedCronsUp(t *testing.T) {
	held := &account{}
	reported := []Progress{}

	run := Reschedule(t.Context(), againstAccount(t, held, baked(), &reported))
	if run.Kind != Deployed || run.At != Scheduling {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if len(reported) != 1 || reported[0].Stage != Scheduling {
		t.Errorf("reported %v, want the scheduling stage alone", reported)
	}
	if strings.Join(held.scheduled, ",") != "*/30 * * * *" {
		t.Errorf("the worker holds %q, want the carried cron", held.scheduled)
	}
}

func TestARescheduleCloudflareTurnedDownStopsAtScheduling(t *testing.T) {
	held := &account{refusesSchedules: true}
	reported := []Progress{}

	run := Reschedule(t.Context(), againstAccount(t, held, baked(), &reported))
	if run.Kind != Stopped || run.At != Scheduling ||
		!strings.HasPrefix(run.Detail, "Cloudflare did not take the worker's schedule: ") {
		t.Errorf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
}

func TestASessionAskingForAFileTheBundleDoesNotCarryNamesTheHash(t *testing.T) {
	held := &account{wantsUnknown: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Stopped || run.At != Uploading {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if !strings.Contains(run.Detail, "0123456789abcdef0123456789abcdef") {
		t.Errorf("detail = %q, names no hash, and the hash is the whole of what can be looked up", run.Detail)
	}
}

func TestASessionThatHandedBackNoCompletionTokenIsNotUploadedOver(t *testing.T) {
	// the token the last bucket answers with is what the script names its assets by. sending the
	// session's own in its place is an upload cloudflare takes or refuses for a reason that says
	// nothing about the files, so it is refused here instead.
	held := &account{noCompletion: true}
	run, _ := deployed(t, held, packed(t, baked()))

	if run.Kind != Stopped || run.At != Uploading {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if !strings.Contains(run.Detail, "completion token") {
		t.Errorf("detail = %q, want what was not handed back", run.Detail)
	}
	if held.saw("PUT /accounts/an-account/workers/scripts/better-giving") {
		t.Error("the worker was uploaded naming assets nothing completed")
	}
}

func TestTheUploadCountsTheBucketsCloudflareAsksFor(t *testing.T) {
	// what a screen draws on the row that is running is a bar, and the parts it is drawn from are
	// cloudflare's own buckets: how many there are is the session's answer and nothing this binary
	// decides, so the count is reported as it goes rather than worked out in front of it.
	held := &account{oneFilePerBucket: true}
	run, reported := deployedReporting(t, held, packed(t, baked(), "one.js", "two.js"))
	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}

	counted := []string{}
	for _, progress := range reportedAt(reported, Uploading) {
		// the stage opens on a report that is on nothing yet, in front of the buckets it counts.
		if progress.Steps == 0 {
			continue
		}
		counted = append(counted, strconv.Itoa(progress.Step)+" of "+strconv.Itoa(progress.Steps))
	}
	if len(counted) < 2 {
		t.Fatalf("the buckets were reported as %v, want one report per bucket", counted)
	}
	for at, said := range counted {
		if want := strconv.Itoa(at+1) + " of " + strconv.Itoa(len(counted)); said != want {
			t.Errorf("bucket %d reported %q, want %q", at, said, want)
		}
	}
}

func TestTheMigrationCountsTheFilesItWillApplyBeforeTheFirstOneLands(t *testing.T) {
	// the one-way door is the stage an operator waits longest on and the one they may not press
	// past, so the total is stated before anything has been applied rather than climbing towards a
	// number nobody has been told.
	held := &account{}
	run, reported := deployedReporting(t, held, packed(t, baked()))
	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}

	counted := []string{}
	for _, progress := range reportedAt(reported, Migrating) {
		if progress.Steps == 0 {
			continue
		}
		counted = append(counted, strconv.Itoa(progress.Step)+"/"+strconv.Itoa(progress.Steps)+" "+progress.Detail)
	}
	files := len(baked().Migrations)
	want := []string{"0/" + strconv.Itoa(files) + " "}
	for at, name := range baked().Migrations {
		want = append(want, strconv.Itoa(at+1)+"/"+strconv.Itoa(files)+" "+name)
	}
	if strings.Join(counted, ",") != strings.Join(want, ",") {
		t.Errorf("the migration reported %v, want %v", counted, want)
	}
}

func TestTheDownloadCountsTheBytesTheReleaseSaidItWasSending(t *testing.T) {
	held := &account{}
	bundle := packed(t, baked())
	run, reported := deployedReporting(t, held, bundle)
	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}

	counted := reportedAt(reported, Fetching)
	if len(counted) < 2 {
		t.Fatalf("the download reported %v, want the stage and then what arrived", counted)
	}
	last := counted[len(counted)-1]
	if last.Steps != len(bundle) || last.Step != last.Steps {
		t.Errorf("the download ended at %d of %d, want the whole of the %d bytes the release sent",
			last.Step, last.Steps, len(bundle))
	}
	// one report per step of the count rather than one per read: a bundle is tens of megabytes and
	// the reader hands back a few tens of kilobytes at a time.
	if len(counted) > 21 {
		t.Errorf("the download reported %d times, want no more than one per step of the count", len(counted))
	}
}

func TestAByteCountIsSaidInTheUnitAnOperatorReadsIt(t *testing.T) {
	// what stands beside the download's bar is the figure the operator would check the release's
	// own size against, so the units are the decimal ones a release is quoted in.
	for _, one := range []struct {
		count int64
		want  string
	}{
		{0, "0 B"},
		{812, "812 B"},
		{999, "999 B"},
		{1_000, "1.0 KB"},
		{12_400, "12.4 KB"},
		// a figure a decimal place would round up into the unit above is said in that unit.
		{999_999, "1.0 MB"},
		{1_000_000, "1.0 MB"},
		{31_000_000, "31.0 MB"},
		// past what a 32-bit int holds, which a bundle's own byte count is not far from.
		{4_300_000_000, "4.3 GB"},
	} {
		if said := sized(one.count); said != one.want {
			t.Errorf("%d bytes = %q, want %q", one.count, said, one.want)
		}
	}
}

func TestTheDownloadSaysHowManyBytesHaveArrivedOfHowMany(t *testing.T) {
	// the share beside a row says how far the download has got and nothing about what it is
	// counting; the operator reads the size off this.
	said := []string{}
	arriving(func(progress Progress) { said = append(said, progress.Detail) })(12_400_000, 31_000_000)
	if len(said) != 1 || said[0] != "12.4 MB of 31.0 MB" {
		t.Errorf("the download said %q", said)
	}
}

func TestTheScriptUploadReportsOncePerStepOfItsCountAndOnceAtTheEnd(t *testing.T) {
	// **this is the longest silent stretch a deploy has**: one PUT carrying the worker's metadata
	// and every module under it. what is counted is the body handed to the connection (../cf's
	// Sending), thinned the way the download is — a watcher held level with every write is thousands
	// of frames for a bar with twenty places to be.
	reported := []Progress{}
	watching := going(func(progress Progress) { reported = append(reported, progress) })

	total := int64(400_000)
	for sent := int64(1_000); sent <= total; sent += 1_000 {
		watching(sent, total)
	}

	if len(reported) != 21 {
		t.Fatalf("the script reported %d times over 400 writes, want one per step and one at the end", len(reported))
	}
	for _, progress := range reported {
		if progress.Stage != Pushing || progress.Detail == "" {
			t.Fatalf("the script reported %+v, want the code's own stage and how much has gone", progress)
		}
	}
	last := reported[len(reported)-1]
	if int64(last.Step) != total || int64(last.Steps) != total {
		t.Errorf("the script ended at %d of %d, want the whole body", last.Step, last.Steps)
	}
}

func TestAScriptUploadOfNoStatedLengthReportsNothing(t *testing.T) {
	reported := 0
	going(func(Progress) { reported++ })(0, 0)
	if reported != 0 {
		t.Errorf("the script reported %d times against no total", reported)
	}
}

func TestTheFilesAndTheCodeAreTwoStagesEachCountingItsOwnParts(t *testing.T) {
	// the buckets finish at every one of them taken and the code's own bytes then start again at
	// none of them sent, so a screen that drew the two under one name would take a bar to full and
	// then back to nothing. what tells them apart is the stage and not the words beside it, which
	// is why neither detail names what is going up (../terminal/lines.go draws that).
	held := &account{}
	run, reported := deployedReporting(t, held, packed(t, baked()))
	if run.Kind != Deployed {
		t.Fatalf("kind = %q (%s)", run.Kind, run.Detail)
	}

	if said := detailed(reportedAt(reported, Uploading)); strings.Join(said, "|") != "|bucket 1 of 1" {
		t.Errorf("the files said %q, want the stage opening and then the buckets", said)
	}
	// the code's own line carries its byte count, which is why it is matched by what a run of this
	// size cannot vary: what a packed bundle weighs is not this case's claim (./arrivedOf).
	said := detailed(reportedAt(reported, Pushing))
	if len(said) != 2 || said[0] != "" || !strings.Contains(said[1], " of ") {
		t.Errorf("the code said %q, want the stage opening and then its bytes", said)
	}
}

// what a run of reports said it was on, with a detail repeated by the report after it said once.
func detailed(reported []Progress) []string {
	said := []string{}
	for _, progress := range reported {
		if len(said) == 0 || said[len(said)-1] != progress.Detail {
			said = append(said, progress.Detail)
		}
	}
	return said
}

func TestTheScriptUploadSaysHowManyBytesHaveGoneAndOfHowMany(t *testing.T) {
	// the longest single call a deploy makes, and until it says this the only figure beside it was a
	// share: an operator watching `37%` of an upload has no idea whether it is 40 megabytes or four,
	// and the download beside it in the same ledger has said both all along (./arrivedOf).
	reported := []Progress{}
	watching := going(func(progress Progress) { reported = append(reported, progress) })

	total := int64(12_100_000)
	watching(3_400_000, total)
	watching(total, total)

	if len(reported) != 2 {
		t.Fatalf("the script reported %d times, want one per step", len(reported))
	}
	// the bytes alone: the line this is drawn beside already says the app's code is what is going
	// up, and a detail naming it again would say twice what that line says once.
	if reported[0].Detail != "3.4 MB of 12.1 MB" {
		t.Errorf("the script said %q, want the bytes alone, in the figures the download quotes",
			reported[0].Detail)
	}
	if !strings.Contains(reported[1].Detail, "12.1 MB of 12.1 MB") {
		t.Errorf("the script ended saying %q, want the whole body gone", reported[1].Detail)
	}
}

// what a call raising from inside the upload may be spelling, which is the whole reason a recovered
// value is dropped where it is.
const uploadCredential = "hunter2"

func TestAnUploadThatRaisedIsARunThatFailedAndNotAProcessThatEnded(t *testing.T) {
	// **the ledger is drawn over this call**, so a raise on the goroutine carrying it that nobody
	// catches ends the process while the terminal is the renderer's — an operator left at a shell
	// with no cursor, typing `reset` blind. the run stops through the door it already stops through.
	options := Options{
		Account: "an-account",
		Config:  baked(),
		Shape:   shape(),
		Upload: func(context.Context, string, string, []cf.Part, cf.Sending) cf.Answer {
			panic("cloudflare turned down " + uploadCredential)
		},
	}

	failed := uploadScript(context.Background(), options,
		bundle.Bundle{MainModule: "index.js"}, "a-token", func(Progress) {})

	if failed.Kind != Stopped {
		t.Fatalf("an upload that raised is %q, want a run that stopped", failed.Kind)
	}
	if strings.Contains(failed.Detail, uploadCredential) {
		t.Errorf("the operator is shown %q, want nothing the raise carried", failed.Detail)
	}
}

func TestABundleThatIsNotTheOneThisReleasePackedIsRefusedBeforeAnythingIsApplied(t *testing.T) {
	// the manifest is no answer to this one: an archive somebody else wrote carries whatever
	// manifest they wrote with it, and what a deploy hands the account is javascript and sql.
	bundle.Digest = strings.Repeat("0", 64)
	t.Cleanup(func() { bundle.Digest = "" })
	held := &account{}

	run, stages := deployed(t, held, packed(t, baked()))

	if run.Kind != Substituted || run.At != Fetching {
		t.Fatalf("kind = %q at %q (%s)", run.Kind, run.At, run.Detail)
	}
	if len(held.paths) != 0 {
		t.Errorf("the account was called at all: %v", held.paths)
	}
	if strings.Join(stagesAsText(stages), " ") != "fetching" {
		t.Errorf("stages = %v, want the one it did not get past", stages)
	}
}
