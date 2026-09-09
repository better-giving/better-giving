// ./tokens.css's values, re-stated for the one reader that cannot read css.
//
// this is not a second token file and defines nothing. every value below is a copy of a
// declaration in ./tokens.css, resolved through its `var()` chain to the leaf literal, and that
// file stays the only place a value is decided. ./tokens.spec.ts reads the css and asserts each
// copy still equals it, because two statements of one value with nothing holding them together is
// the drift this whole system is arranged to refuse.
//
// the reader is packages/emails, and nothing else may import this. an operator screen reads the
// custom properties: it has a stylesheet, a document and a cascade. a mail has none of the three —
// an html mail is rendered by clients with no `<style>` support and a `<head>` that is frequently
// discarded, so every value has to arrive as a literal in an inline style attribute
// (packages/emails/src/components/layout.tsx argues that from its own side). a worker has no file
// system at send time either, so the values cannot be read out of the css when a mail is rendered.
// they have to be in the module graph, which is this file.
//
// only what a mail reads is here. a token nobody outside the css reads has no copy, because a copy
// is a second thing to keep true and a name with no reader behind it cannot be seen to be wrong.
// packages/emails/src/tokens.ts is what turns these into what a mail client renders — a hex triple,
// a pixel count — and no conversion happens here: what this file holds is the css text.

/** the copied declarations, keyed by the custom property each one is a copy of. */
export const ADMIN_TOKENS = {
	// ---- colour ----
	// the ground the document is read on, and the two grounds a block inside it sits on. the three
	// are the same stack an operator screen is built from: a page, a band on it, a heavier band on
	// that.
	'--admin-page': 'oklch(0.986 0.003 250)',
	'--admin-surface-sunken': 'oklch(0.965 0.005 250)',
	'--admin-surface-fill': 'oklch(0.938 0.007 250)',
	'--admin-divider': 'oklch(0.878 0.011 250)',
	'--admin-ink': 'oklch(0.27 0.013 250)',
	'--admin-ink-muted': 'oklch(0.54 0.019 250)',
	'--admin-link': 'oklch(0.556 0.15 247.3)',

	// ---- type ----
	// both stacks are copied whole, first face included. that face is self-hosted by ./fonts.css and
	// a mail client fetches nothing, so it is never found and the stack falls through to the system
	// faces behind it — which is how a mail keeps the operator surfaces' own stack without loading a
	// web font, the thing packages/emails/src/components/layout.tsx says its shell may not grow.
	'--admin-font-sans': "'Red Hat Text', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
	'--admin-font-mono': "'Red Hat Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
	// the steps of the type scale rather than the roles above them, and that is the one place a mail
	// reads this system differently from a screen. the roles are screen roles — a title, a standfirst,
	// a field — and a mail has none of them; `--admin-body-size` is 14px because an operator screen
	// is dense, and a mail is read in somebody's client at whatever size they read mail at.
	'--admin-text-base': '0.875rem',
	'--admin-text-md': '1rem',
	'--admin-text-lg': '1.125rem',
	'--admin-code-size': '0.8125rem',
	'--admin-lh-heading': '1.25',
	'--admin-lh-body': '1.55',
	'--admin-code-lh': '1.6',
	'--admin-weight-bold': '700',

	// ---- spacing, borders and the measure ----
	'--admin-space-2': '0.25rem',
	'--admin-space-4': '0.5rem',
	'--admin-space-6': '1rem',
	'--admin-space-8': '1.5rem',
	'--admin-border-width': '1px',
	'--admin-border-width-strong': '2px',
	'--admin-edge': '3px',
	'--admin-measure-dialog': '34rem'
} as const;
