package release

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// the committed config against the files it was baked out of.
//
// **this is the gate the binary's whole baked arrangement rests on.** every one of these four is
// stated in a file in this repository and read by the binary out of the committed json alone, so a
// rename in packages/app that nobody rebakes ships a binary looking for a worker nobody has. it
// fails here instead, at `go test`, and the way out is `go run ./cmd/bake`.
//
// **the sources are read as text here and interpreted in ./bake.go.** the wrangler config is JSONC
// and the widget's name is a constant in a TypeScript module, and the bake is the one reader that
// parses either. what this asserts is equality against the text — the narrowest thing that catches
// a rename, and the one reading that cannot agree with the bake by repeating its mistake.
//
// `commit` is not compared: it is the HEAD the file was baked at and legitimately differs from the
// one being committed now.

// the top level of a wrangler config, which is everything before its `env` block.
//
// packages/app/wrangler.jsonc declares an `env.test` with a name, a database and a migrations
// directory of its own, and each of the three reads below would otherwise find whichever came
// first in the file. cutting at `env` is what makes reading the first occurrence honest.
//
// the cut is anchored to the start of a line, because the key is what ends the top level and a
// comment mentioning `"env"` above that block is not. unanchored, such a comment would truncate the
// region silently and every read below would fatal on a key that is really there.
func topLevel(t *testing.T, config string) string {
	t.Helper()
	at := regexp.MustCompile(`(?m)^\s*"env"\s*:`).FindStringIndex(config)
	if at == nil {
		return config
	}
	return config[:at[0]]
}

// the `d1_databases` entry this deployment is about, which is the one bound as DB.
//
// the same entry ./bake.go picks, and they have to agree: reading the first `database_name` in the
// file would turn a correctly baked config red the moment that block lists another database ahead
// of this one. the region ends at the next `binding`, so a key read inside it belongs to this entry
// and not to a neighbour.
func boundEntry(t *testing.T, config string) string {
	t.Helper()
	binding := regexp.MustCompile(`"binding"\s*:\s*"DB"`)
	at := binding.FindStringIndex(config)
	if at == nil {
		t.Fatal("no d1_databases entry is bound as DB")
	}
	entry := config[at[1]:]
	if after := regexp.MustCompile(`"binding"\s*:`).FindStringIndex(entry); after != nil {
		entry = entry[:after[0]]
	}
	return entry
}

func stated(t *testing.T, text, key string) string {
	t.Helper()
	match := regexp.MustCompile(`"` + key + `"\s*:\s*"([^"]*)"`).FindStringSubmatch(text)
	if match == nil {
		t.Fatalf("no %q is stated", key)
	}
	return match[1]
}

func TestTheWorkerIsTheOnePackagesAppDeploys(t *testing.T) {
	config := topLevel(t, read(t, "packages/app/wrangler.jsonc"))

	if want := stated(t, config, "name"); Baked.Name != want {
		t.Errorf("name = %q, want %q — rebake with `go run ./cmd/bake`", Baked.Name, want)
	}
}

func TestTheDatabaseIsTheOneEveryDeployResolvesByName(t *testing.T) {
	config := boundEntry(t, topLevel(t, read(t, "packages/app/wrangler.jsonc")))

	if want := stated(t, config, "database_name"); Baked.DatabaseName != want {
		t.Errorf("database_name = %q, want %q", Baked.DatabaseName, want)
	}
}

func TestTheMigrationsDirectoryIsTheOneThatConfigStates(t *testing.T) {
	config := boundEntry(t, topLevel(t, read(t, "packages/app/wrangler.jsonc")))

	if want := stated(t, config, "migrations_dir"); Baked.MigrationsDir != want {
		t.Errorf("migrations_dir = %q, want %q", Baked.MigrationsDir, want)
	}
}

func TestTheMigrationsAreTheOnesInTheTree(t *testing.T) {
	// wrangler records an applied migration by filename and CLAUDE.md refuses a rename of one, so
	// the filenames are the whole of what a deployment's own `d1_migrations` table is compared
	// against.
	entries, err := os.ReadDir(filepath.Join(repoRoot(t), "packages", "app", "migrations"))
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	want := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			want = append(want, entry.Name())
		}
	}

	if len(want) == 0 {
		t.Fatal("packages/app/migrations holds no .sql at all")
	}
	if strings.Join(Baked.Migrations, "\n") != strings.Join(want, "\n") {
		t.Errorf("migrations = %v, want %v", Baked.Migrations, want)
	}
}

func TestTheRuntimeIsTheOnePackagesAppDeploysUnder(t *testing.T) {
	// the upload states these itself — there is no wrangler in the operator's path to read them off
	// that file — so a date left behind here runs the deployed code under another runtime than the
	// build was made against.
	config := topLevel(t, read(t, "packages/app/wrangler.jsonc"))

	if want := stated(t, config, "compatibility_date"); Upload.CompatibilityDate != want {
		t.Errorf("compatibility_date = %q, want %q", Upload.CompatibilityDate, want)
	}
	want := listed(t, config, "compatibility_flags")
	if strings.Join(Upload.CompatibilityFlags, ",") != strings.Join(want, ",") {
		t.Errorf("compatibility_flags = %v, want %v", Upload.CompatibilityFlags, want)
	}
}

func TestTheDatabaseIsBoundUnderTheNameEveryQueryIsWrittenAgainst(t *testing.T) {
	config := topLevel(t, read(t, "packages/app/wrangler.jsonc"))

	// the binding names the entry boundEntry picks, so the two readings cannot come apart.
	if !regexp.MustCompile(`"binding"\s*:\s*"` + regexp.QuoteMeta(Upload.D1Binding) + `"`).MatchString(config) {
		t.Errorf("d1_binding = %q, which that config binds nothing under", Upload.D1Binding)
	}
}

func TestEveryRateLimiterIsBakedWithTheBucketItCountsUnder(t *testing.T) {
	// a namespace is account-wide and each bucket has one of its own, which packages/app/wrangler.jsonc
	// argues on the block itself. so the whole entry is compared: a namespace that moved is two
	// surfaces eating each other's count, and a limit that moved is a bucket of another size.
	block := rateLimitBlock(t, topLevel(t, read(t, "packages/app/wrangler.jsonc")))

	entries := regexp.MustCompile(`"name"\s*:\s*"([^"]*)"`).FindAllStringSubmatchIndex(block, -1)
	if len(entries) != len(Upload.RateLimits) {
		t.Fatalf("%d rate limiters are baked, and that config declares %d", len(Upload.RateLimits), len(entries))
	}
	for at, entry := range entries {
		region := block[entry[1]:]
		if at+1 < len(entries) {
			region = block[entry[1]:entries[at+1][0]]
		}
		baked := Upload.RateLimits[at]
		if want := block[entry[2]:entry[3]]; baked.Name != want {
			t.Errorf("rate limiter %d is %q, want %q", at, baked.Name, want)
		}
		if want := stated(t, region, "namespace_id"); baked.NamespaceID != want {
			t.Errorf("%s namespace_id = %q, want %q", baked.Name, baked.NamespaceID, want)
		}
		if want := numbered(t, region, "limit"); baked.Simple.Limit != want {
			t.Errorf("%s limit = %d, want %d", baked.Name, baked.Simple.Limit, want)
		}
		if want := numbered(t, region, "period"); baked.Simple.Period != want {
			t.Errorf("%s period = %d, want %d", baked.Name, baked.Simple.Period, want)
		}
	}
}

func TestObservabilityIsWhatThatConfigTurnsOn(t *testing.T) {
	// the upload carries this too, so a deployment made by the binary reports the way one made from
	// a checkout does.
	config := topLevel(t, read(t, "packages/app/wrangler.jsonc"))
	match := regexp.MustCompile(`"observability"\s*:\s*\{[^}]*"enabled"\s*:\s*(true|false)`).FindStringSubmatch(config)
	want := match != nil && match[1] == "true"

	if Upload.Observability != want {
		t.Errorf("observability = %v, want %v", Upload.Observability, want)
	}
}

// the `ratelimits` block off the top level, which is where every bucket this deployment has is
// declared.
//
// the region ends where the top level does, because `env` is what follows it and topLevel has
// already cut that away.
func rateLimitBlock(t *testing.T, config string) string {
	t.Helper()
	at := regexp.MustCompile(`"ratelimits"\s*:`).FindStringIndex(config)
	if at == nil {
		t.Fatal("that config declares no ratelimits")
	}
	return config[at[1]:]
}

func listed(t *testing.T, text, key string) []string {
	t.Helper()
	match := regexp.MustCompile(`"` + key + `"\s*:\s*\[([^\]]*)\]`).FindStringSubmatch(text)
	if match == nil {
		t.Fatalf("no %q is stated", key)
	}
	values := []string{}
	for _, one := range regexp.MustCompile(`"([^"]*)"`).FindAllStringSubmatch(match[1], -1) {
		values = append(values, one[1])
	}
	return values
}

func numbered(t *testing.T, text, key string) int {
	t.Helper()
	match := regexp.MustCompile(`"` + key + `"\s*:\s*(\d+)`).FindStringSubmatch(text)
	if match == nil {
		t.Fatalf("no %q is stated", key)
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatalf("%q is %q, which is not a number", key, match[1])
	}
	return value
}

func TestTheWidgetIsNamedByTheModuleThatStatesIt(t *testing.T) {
	// the constant's name, its single quotes and its literal value are the interface — that module's
	// own header says so, and nothing imports it.
	source := read(t, "packages/app/src/lib/config/turnstile-widget.ts")
	match := regexp.MustCompile(`TURNSTILE_WIDGET_NAME\s*=\s*'([^']+)'`).FindStringSubmatch(source)
	if match == nil {
		t.Fatal("the module states no TURNSTILE_WIDGET_NAME")
	}

	if Baked.TurnstileWidgetName != match[1] {
		t.Errorf("turnstileWidgetName = %q, want %q", Baked.TurnstileWidgetName, match[1])
	}
}

func TestTheCommitIsARevisionAndNotAPlaceholder(t *testing.T) {
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(Baked.Commit) {
		t.Errorf("commit = %q, want the forty characters `git rev-parse HEAD` writes", Baked.Commit)
	}
}

func TestAConfigThatIsNotJsonIsRefusedRatherThanRead(t *testing.T) {
	if _, err := Parse([]byte(`{"name":`)); err == nil {
		t.Error("a truncated config parsed, and a binary would ship with fields nobody set")
	}
}

func TestAManifestIsTheBakedConfigWrittenBackTheSameWay(t *testing.T) {
	// the bundle's manifest and this config are held equal before a deploy applies anything
	// (internal/bundle), so the two are one text and not two derivations of it.
	written, err := WriteManifest(Baked)
	if err != nil {
		t.Fatalf("WriteManifest: %v", err)
	}
	if string(written) != string(configJSON) {
		t.Errorf("a manifest written off the baked config is not ./config.json's own text")
	}

	read, err := ReadManifest(written)
	if err != nil {
		t.Fatalf("ReadManifest: %v", err)
	}
	if read.Commit != Baked.Commit || read.Name != Baked.Name {
		t.Errorf("a manifest read back states %q at %q", read.Name, read.Commit)
	}
}

// the repository this package sits in, walked up to from the test's own directory.
//
// a go test runs in the directory of the package under test, and every source above is named from
// the repository root — so the walk is what lets one path be written once. it is ./bake.go's, which
// climbs for the same reason from wherever `go run ./cmd/bake` was invoked.
func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func read(t *testing.T, fromRoot string) string {
	t.Helper()
	source, err := os.ReadFile(filepath.Join(repoRoot(t), filepath.FromSlash(fromRoot)))
	if err != nil {
		t.Fatalf("ReadFile %s: %v", fromRoot, err)
	}
	return string(source)
}

// the seventeen against the module both operator surfaces read them from.
//
// The list is this binary's own and the enumeration is packages/operator's, so what is asserted is
// that they are the same names in the same order: a name added there and not here is a row the
// console never draws, and a console drawing them in another order sends an operator looking for a
// row where the document they are reading does not put it.
func TestTheSeventeenAreTheOnesBothOperatorSurfacesRead(t *testing.T) {
	stated := namesIn(t, read(t, "packages/operator/src/deploy-split.ts"), "DEPLOY_VARS")
	if strings.Join(stated, ",") != strings.Join(DeployVars, ",") {
		t.Errorf("DEPLOY_VARS states %v and this binary holds %v", stated, DeployVars)
	}
}

// every name one `as const` list in that module holds, in the order it holds them.
func namesIn(t *testing.T, source, constant string) []string {
	t.Helper()
	block := regexp.MustCompile(`export const ` + constant + `\s*=\s*\[([^\]]*)\]`).
		FindStringSubmatch(source)
	if block == nil {
		t.Fatalf("no %s is stated", constant)
	}
	names := []string{}
	for _, match := range regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(block[1], -1) {
		names = append(names, match[1])
	}
	if len(names) == 0 {
		t.Fatalf("%s names nothing", constant)
	}
	return names
}

// the closed sets the deployment answers in, against the modules that state them.
//
// Gated the way the seventeen are and for the same reason: a member added there and not here is an
// answer this binary reads as one it has no state for, which a screen draws as an answer it could
// not read rather than as the thing the deployment said.
func TestTheAnswersTheDeploymentSendsAreTheOnesItStates(t *testing.T) {
	for _, one := range []struct {
		source   string
		constant string
		held     []string
	}{
		{"packages/operator/src/console/org.ts", "ORG_PROFILE_FIELDS", OrgProfileFields},
		{"packages/operator/src/console/test-send.ts", "TEST_SEND_OUTCOMES", TestSendOutcomes},
		{"packages/operator/src/console/recurring.ts", "RECURRING_STANDINGS", RecurringStandings},
		{
			"packages/operator/src/console/recurring.ts",
			"RECURRING_SETUP_OUTCOMES", RecurringSetupOutcomes,
		},
		{
			"packages/operator/src/console/recurring.ts",
			"RECURRING_SETUP_REASONS", RecurringSetupReasons,
		},
		{"packages/operator/src/console/payments.ts", "PAYMENT_PROCESSORS", PaymentProcessors},
		{"packages/operator/src/console/payments.ts", "RAIL_STANDINGS", RailStandings},
		{"packages/operator/src/console/payments.ts", "RAIL_EVIDENCE", RailEvidence},
		{
			"packages/operator/src/console/payments.ts",
			"WEBHOOK_SECRET_STANDINGS", WebhookSecretStandings,
		},
		{
			"packages/operator/src/console/stripe-read.ts",
			"STRIPE_UNREADABLE_REASONS", StripeUnreadableReasons,
		},
		{"packages/operator/src/console/payments.ts", "WALLETS", Wallets},
		{"packages/operator/src/console/payments.ts", "WALLET_STATES", WalletStates},
		{
			"packages/operator/src/console/payments.ts",
			"WALLET_HOST_STANDINGS", WalletHostStandings,
		},
	} {
		stated := namesIn(t, read(t, one.source), one.constant)
		if strings.Join(stated, ",") != strings.Join(one.held, ",") {
			t.Errorf("%s states %v and this binary holds %v", one.constant, stated, one.held)
		}
	}
}

// the endpoint's spelling, against the module both ends of it read.
//
// Gated the way the seventeen are: the console registers the endpoint and the deployment serves it,
// so a path joined one way here and another there is an endpoint that reads as absent to the reader
// it was registered for — packages/operator/src/stripe/webhook-endpoint.ts's own header is the
// whole argument.
func TestTheEndpointIsSpelledTheWayBothEndsSpellIt(t *testing.T) {
	source := read(t, "packages/operator/src/stripe/webhook-endpoint.ts")
	for _, one := range []struct {
		constant string
		held     string
	}{
		{"STRIPE_WEBHOOK_PATH", StripeWebhookPath},
		{"API_VERSION", StripeAPIVersion},
	} {
		if stated := quoted(t, source, one.constant); stated != one.held {
			t.Errorf("%s states %q and this binary holds %q", one.constant, stated, one.held)
		}
	}

	// the subscription is composed there out of three lists and is flattened here, so the order is
	// that module's composition read back rather than a list of its own: a member added to any of
	// the three and not to this binary is a delivery the endpoint is registered without.
	stated := []string{}
	for _, constant := range []string{
		"SETTLEMENT_EVENT_TYPES",
		"RECURRING_COLLECTION_EVENT_TYPES",
		"RECURRING_COMMITMENT_EVENT_TYPES",
	} {
		stated = append(stated, namesIn(t, source, constant)...)
	}
	if strings.Join(stated, ",") != strings.Join(SubscribedEventTypes, ",") {
		t.Errorf("the endpoint subscribes to %v and this binary holds %v", stated, SubscribedEventTypes)
	}
}

// the stamp's key, against the module both ends read it from.
//
// The chain stamps an endpoint's fingerprint under it at creation and the deployment compares its
// stored secret against that stamp, so a key stated there and not here is a stamp nothing finds.
func TestTheStampIsTheOneBothEndsRead(t *testing.T) {
	stamp := read(t, "packages/operator/src/stripe/secret-fingerprint.ts")
	if stated := quoted(t, stamp, "FINGERPRINT_METADATA_KEY"); stated != FingerprintMetadataKey {
		t.Errorf("FINGERPRINT_METADATA_KEY states %q and this binary holds %q",
			stated, FingerprintMetadataKey)
	}
}

// the single-quoted literal one `export const` in a module states.
func quoted(t *testing.T, source, constant string) string {
	t.Helper()
	match := regexp.MustCompile(`export const ` + constant + `\s*=\s*'([^']+)'`).
		FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("no %s is stated", constant)
	}
	return match[1]
}

// the shortest dashboard password, against the module both operator surfaces read it from.
//
// Gated rather than trusted, and the door is why: ADMIN_PASSWORD crosses no parse on the
// deployment that could refuse it, so a minimum raised in that module and not here is a press this
// binary takes and a deployment nobody can sign in to —
// packages/operator/src/admin-password.ts's own header is the whole argument.
func TestTheShortestPasswordIsTheOneADeploymentAuthenticatesAgainst(t *testing.T) {
	source := read(t, "packages/operator/src/admin-password.ts")
	if stated := counted(t, source, "MIN_ADMIN_PASSWORD_LENGTH"); stated != MinAdminPasswordLength {
		t.Errorf("MIN_ADMIN_PASSWORD_LENGTH states %d and this binary holds %d",
			stated, MinAdminPasswordLength)
	}
}

// the number one `export const` in a module states.
func counted(t *testing.T, source, constant string) int {
	t.Helper()
	match := regexp.MustCompile(`export const ` + constant + `\s*=\s*(\d+)`).
		FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("no %s is stated", constant)
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatalf("%s is %q, which is not a number", constant, match[1])
	}
	return value
}

// the account the run's press names is one the wire names: a processor spelled differently here is
// a press the deployment refuses for a name no processor answers to, and a run that would report
// the account it just stored a key for as one nobody could act on.
func TestTheAccountTheRunPressesAboutIsOneTheWireNames(t *testing.T) {
	if !slices.Contains(PaymentProcessors, StripeProcessor) {
		t.Errorf("%q is no processor a deployment charges on: %v", StripeProcessor, PaymentProcessors)
	}
}
