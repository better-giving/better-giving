// what this deployment's Turnstile widget is called, in the one place that name is stated.
//
// **nothing imports this module, and two readers depend on its source text.** the name is lifted
// out of this file with a regex by the console's bake (`packages/console/internal/release/bake.go`),
// which is go and reads this file as text, and by `packages/app/scripts/turnstile-keys.js`, which
// is plain node and cannot load a module behind a `$lib` alias. both match
// `TURNSTILE_WIDGET_NAME\s*=\s*'([^']+)'` — so the constant's name, its single quotes and its
// literal value are the interface, and rewriting any of the three breaks a read that no import
// graph shows. `packages/console/internal/release/config_test.go` and
// `packages/app/scripts/turnstile-keys.spec.js` are what fail when it does.
//
// the widget itself is created, adopted and levelled by the console's binary
// (`packages/console/internal/widget`), and DEPLOY.md's "Spam protection" sends an operator to that
// screen. nothing on this deployment runs any part of that errand.
//
// not under `$lib/server/**`: it is a literal with no binding behind it, and it is the one thing
// the readers above are pointed at.

/**
 * what the widget is called on the Cloudflare account it is created in.
 *
 * the app's own name. that is not a deployment artifact under the no-artifacts rule in AGENTS.md →
 * Never — a fork keeps the name and renames it when it renames the app — and one name across both
 * is what makes a second widget on the same account obviously a second one.
 */
export const TURNSTILE_WIDGET_NAME = 'better-giving';
