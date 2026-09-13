// Package release is what this binary was baked to know about the deployment it operates.
//
// **an operator never types any of these and the binary cannot read them off a checkout.** every
// one of them is stated in a file in this repository — the worker name and the database in
// packages/app/wrangler.jsonc, the migrations off that directory, the widget's name in the module
// that states it — and a binary an operator downloads has none of those beside it. so they are read
// by ./bake.go, which ../../cmd/bake is the command for, and written into ./config.json, which is
// committed and travels inside the binary.
//
// **./config.json is the whole of what this package reads, and never the sources it came from.**
// the bake is a step somebody runs, and ./config_test.go is the gate that keeps the committed json
// equal to those sources, so a rename in packages/app that nobody rebakes fails `go test` rather
// than shipping a binary looking for a worker nobody has.
package release

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed config.json
var configJSON []byte

// Config is the deployment this binary was built for.
type Config struct {
	// Name is what `wrangler deploy` uploads under, and what makes one account one deployment.
	Name string `json:"name"`
	// DatabaseName is what this deployment's D1 database is called; every path resolves it by name.
	DatabaseName string `json:"database_name"`
	// MigrationsDir is where packages/app keeps them, as its wrangler config states it.
	MigrationsDir string `json:"migrations_dir"`
	// Migrations is every filename in that directory, in the order wrangler applies them — which is
	// what a deployment's own `d1_migrations` table is compared against.
	Migrations []string `json:"migrations"`
	// TurnstileWidgetName is what the anti-abuse widget is called on the cloudflare account.
	TurnstileWidgetName string `json:"turnstileWidgetName"`
	// Commit is the revision the bake ran at, which the `version` subcommand prints.
	Commit string `json:"commit"`
}

// Manifest is what a release bundle states about the app it was packed from.
//
// It is the baked config copied rather than a second derivation of it: the two are held equal
// before a deploy applies anything (internal/bundle), and a manifest derived at release time would
// carry the tag's revision where the binary carries the one its config was baked at — so every
// deploy would refuse over a field neither half got wrong.
type Manifest = Config

// ReadManifest is one bundle's manifest.json, read the way the baked config is.
func ReadManifest(source []byte) (Manifest, error) { return Parse(source) }

// WriteManifest is the bytes a bundle's manifest.json holds, which are ./config.json's own.
func WriteManifest(manifest Manifest) ([]byte, error) {
	written, err := json.MarshalIndent(manifest, "", "\t")
	if err != nil {
		return nil, err
	}
	return append(written, '\n'), nil
}

// Upload is the shape of this deployment's worker on the way up, which no config carries.
//
// **it is stated here rather than baked, and the deploy states it rather than reading a wrangler
// config.** there is no wrangler and no checkout where the binary runs, so the bindings, the
// runtime and the observability setting travel as this binary's own code — one org, one worker, one
// fixed shape (CLAUDE.md's founding rule), and a `wrangler.jsonc` interpreter would be a second
// reader of a file the operator does not have.
//
// ./config_test.go is the gate: every field below is compared against what
// packages/app/wrangler.jsonc declares, so a binding added there and not here fails `go test`
// rather than shipping a deployment missing it.
var Upload = UploadShape{
	D1Binding: "DB",
	RateLimits: []RateLimit{
		{Name: "API_RATE_LIMITER", NamespaceID: "7412", Simple: Simple{Limit: 600, Period: 60}},
		{Name: "QUOTE_RATE_LIMITER", NamespaceID: "7413", Simple: Simple{Limit: 60, Period: 60}},
		{Name: "SIGN_IN_RATE_LIMITER", NamespaceID: "7414", Simple: Simple{Limit: 10, Period: 60}},
	},
	CompatibilityDate:  "2026-07-22",
	CompatibilityFlags: []string{"nodejs_compat"},
	Observability:      true,
}

// UploadShape is everything the script upload states about the worker that is not in the bundle.
type UploadShape struct {
	// D1Binding is the name the app's own queries reach its database under.
	D1Binding string
	// RateLimits is every bucket this deployment is uploaded with.
	RateLimits []RateLimit
	// CompatibilityDate and CompatibilityFlags are the runtime the worker runs under.
	CompatibilityDate  string
	CompatibilityFlags []string
	// Observability is whether the deployment reports its own requests.
	Observability bool
}

// RateLimit is one of this deployment's buckets, in the shape the script upload sends it.
//
// The namespace is account-wide and each bucket has one of its own, which
// packages/app/wrangler.jsonc argues on the block itself — so the whole entry travels rather than
// its name. The binding's `type` is not here: it is the api's word for this kind of binding rather
// than something that config states, and internal/deploy sets it.
type RateLimit struct {
	Name        string `json:"name"`
	NamespaceID string `json:"namespace_id"`
	Simple      Simple `json:"simple"`
}

// Simple is the one limit shape a rate limit binding takes: how many in how many seconds.
type Simple struct {
	Limit  int `json:"limit"`
	Period int `json:"period"`
}

// Baked is the config this binary carries.
//
// It panics on a config that will not parse, which is a build whose own test did not run: the file
// is committed and ./config_test.go reads it, so there is no path to a released binary that gets
// here with anything else.
var Baked = mustParse(configJSON)

// Parse reads one baked config, and refuses one that states nothing.
func Parse(source []byte) (Config, error) {
	var config Config
	if err := json.Unmarshal(source, &config); err != nil {
		return Config{}, err
	}
	if config.Name == "" || config.DatabaseName == "" {
		return Config{}, fmt.Errorf("a baked config naming no worker or no database")
	}
	return config, nil
}

func mustParse(source []byte) Config {
	config, err := Parse(source)
	if err != nil {
		panic("internal/release/config.json: " + err.Error())
	}
	return config
}

// DeployVars is the seventeen values a deployment is configured with, and every one of them is a
// plain worker var.
//
// **stated here rather than baked, and gated rather than trusted.** the list is
// packages/operator/src/deploy-split.ts's — both operator surfaces read it — and ./config_test.go
// holds this one to that module's, so a name added there and not here fails `go test` rather than
// shipping a console that draws sixteen rows. it is a list rather than a bake because it is this
// binary's own reading of the deployment and not a fact about the checkout it was baked from.
//
// **the order is the source's and is not a preference**: it is the order every screen draws the
// rows in, and a console listing them differently from the document an operator is reading is a
// row they look for and do not find.
//
// `CONSOLE_TOKEN` is off this list and is not a configuration value: the console mints it for its
// own session and stores it as a worker secret, which is argued at ../deployment's
// ConsoleTokenName.
var DeployVars = []string{
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USERNAME",
	"SMTP_PASSWORD",
	"MAIL_FROM",
	"TURNSTILE_SITE_KEY",
	"TURNSTILE_SECRET_KEY",
	"STRIPE_SECRET_KEY",
	"STRIPE_PUBLISHABLE_KEY",
	"STRIPE_WEBHOOK_SECRET",
	"PAYPAL_CLIENT_ID",
	"PAYPAL_CLIENT_SECRET",
	"PAYPAL_WEBHOOK_ID",
	"PAYPAL_CHARITY_RATE_APPROVED",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"ADMIN_PASSWORD",
}

// the closed sets a deployment answers its own console surface in.
//
// **stated here and gated rather than trusted, the way the seventeen above are.** each of them is
// one operator surface's statement in packages/operator/src/console/, and ./config_test.go holds
// these lists to it — so a member added there and not here fails `go test` rather than shipping a
// console that reads a real answer as one it has no state for. what a member means is written
// beside it in that module and is not written again here.
//
// **the order is the source's**, because it is the order a screen draws a row in and a console
// listing them differently sends an operator looking for a row where the document does not put it.
var (
	// OrgProfileFields is the organisation's legal identity: the field names, which are also the
	// keys a refusal is drawn under and the columns a save states.
	OrgProfileFields = []string{
		"legal_name",
		"tax_id",
		"address_line1",
		"address_line2",
		"city",
		"region",
		"postal_code",
		"country",
		"notification_email",
	}
	// TestSendOutcomes is what a test message did.
	TestSendOutcomes = []string{"sent", "failed"}
	// RecurringStandings is what the deployment's processor account holds for gifts that repeat.
	RecurringStandings = []string{"ready", "absent", "archived"}
	// RecurringSetupOutcomes is what one press to provision it did.
	RecurringSetupOutcomes = []string{"set_up", "already_set_up", "failed"}
	// RecurringSetupReasons is why one account's press did not land: a credential the deployment is
	// not serving yet, or the processor refusing the call it was made with.
	RecurringSetupReasons = []string{"no_key", "failed"}
	// PaymentProcessors is every processor a deployment can be set up to charge on, which the
	// payments reading carries one entry per whether or not the deployment holds its credentials.
	PaymentProcessors = []string{"stripe", "paypal"}
	// RailStandings is where one way of paying stands on that account.
	RailStandings = []string{
		"approved",
		"in_review",
		"not_approved",
		"never_requested",
		"switched_off",
		"account_cannot_charge",
	}
	// RailEvidence is what a rails reading's standings are worth: whether the processor published an
	// approval per rail, or whether nothing was proven but that the credentials authenticate.
	RailEvidence = []string{"per_rail_approval", "credentials_only"}
	// WebhookSecretStandings is whether deliveries from the processor verify.
	WebhookSecretStandings = []string{"verifying", "stale", "unset", "unconfirmable"}
	// StripeUnreadableReasons is why a reading the deployment makes against that account could not
	// be made at all.
	StripeUnreadableReasons = []string{"no_key", "failed"}
	// Wallets is every wallet the deployment draws inside the payment element, which is also every
	// wallet a registered hostname answers for.
	Wallets = []string{"apple_pay", "google_pay", "link"}
	// WalletStates is how far the processor has got with one wallet on one registered hostname.
	WalletStates = []string{"active", "inactive"}
	// WalletHostStandings is where one hostname stands for wallets on that account.
	WalletHostStandings = []string{"drawing", "wallet_inactive", "switched_off", "unregistered"}
)

// StripeProcessor is what the processor list above calls the account this binary sets up, and is
// what the run's own press names when it asks a deployment about that account alone.
//
// Held to that list by ./config_test.go rather than spelled wherever it is needed: a processor
// renamed on the wire fails `go test` here rather than shipping a run that presses about an account
// no deployment answers to, and is refused for a name no processor answers to.
const StripeProcessor = "stripe"

// what the deployment's webhook endpoint is: the path it answers on, the version its deliveries are
// serialised in, and everything it subscribes to.
//
// **stated here and gated rather than trusted, the way the seventeen above are.** the source is
// packages/operator/src/stripe/webhook-endpoint.ts, which both ends of the endpoint read — this
// binary registers it on the processor account and the deployment serves it — and ./config_test.go
// holds these to that module's. what each of them costs when the two ends disagree is written
// there, at the constant it is about, and is not written again here.
//
// **the subscription is flattened, and the order is that module's composition.** it goes up as
// `enabled_events` on the create, so a member missing from this list is a delivery that is never
// sent and a gift that never reaches the books.
var (
	StripeWebhookPath    = "/api/stripe/webhook"
	StripeAPIVersion     = "2026-07-29.dahlia"
	SubscribedEventTypes = []string{
		"payment_intent.succeeded",
		"payment_intent.payment_failed",
		"payment_intent.processing",
		"payment_intent.canceled",
		"payment_intent.requires_action",
		"invoice.paid",
		"invoice.payment_failed",
		"customer.subscription.updated",
		"customer.subscription.deleted",
	}
)

// MinAdminPasswordLength is the shortest dashboard password a deployment will authenticate
// against.
//
// **stated here and gated against packages/operator/src/admin-password.ts.** the reading that names
// a box and writes the sentence is the browser's (packages/console-ui/src/lib), and this is the same
// reading made again at the door: ADMIN_PASSWORD
// crosses no parse on the deployment able to refuse it — it is written straight to the cloudflare
// account and first met when somebody signs in — so a value stored under this length is a
// deployment that reports itself set up and turns every sign-in away.
//
// What the length costs and why there is no second value to guess is that module's header, and is
// not written again here.
const MinAdminPasswordLength = 12

// FingerprintMetadataKey is the metadata key an endpoint's signing-secret fingerprint is written
// under, from packages/operator/src/stripe/secret-fingerprint.ts.
//
// The deployment reads the stamp back off the endpoint to say whether what it holds is still the
// right secret, so a key spelled differently at the two ends is a stamp nothing can find — which
// reads exactly like the missing secret it exists to detect.
const FingerprintMetadataKey = "signing_secret_fingerprint"
