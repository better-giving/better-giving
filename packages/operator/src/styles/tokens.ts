// ./tokens.css's values, re-stated for the one reader that cannot read css.
//
// this is not a second token file and defines nothing. every value below is a copy of a
// declaration in ./tokens.css, resolved through its `var()` chain to the leaf literal. the colours
// and the two radii resolve to the design registry's copied files (../registry/styles). the faces
// resolve to ./fonts.css, which re-points the registry's `--font-*` roles at plain red hat over
// the registry's own values. the type steps, line heights, weight, spacing, border widths and
// measure resolve to ./tokens.css, because the registry has none of them. the registry's files,
// ./fonts.css and ./tokens.css are the only places a value is decided. ./tokens.spec.ts reads the
// css and asserts each copy still equals it, because two statements of one value with nothing
// holding them together is the drift this whole system is arranged to refuse.
//
// the reader is packages/emails, and nothing else may import this. an operator screen reads the
// custom properties: it has a stylesheet, a document and a cascade. a mail has none of the three —
// an html mail is rendered by clients with no `<style>` support and a `<head>` that is frequently
// discarded, so every value has to arrive as a literal in an inline style attribute
// (packages/emails/src/components/layout.tsx argues that from its own side). nor can a mail read
// them out of the stylesheet at send time: the `runtime` stage of the root Dockerfile carries
// packages/app and none of packages/operator, so ./tokens.css is not on disk where a mail renders.
// the values have to be in the module graph, which is this file.
//
// only what a mail reads is here. a token nobody outside the css reads has no copy, because a copy
// is a second thing to keep true and a name with no reader behind it cannot be seen to be wrong.
// packages/emails/src/tokens.ts is what makes these what a mail client renders — it checks each
// colour is a hex triple and turns each length into a pixel count — and nothing is converted here:
// what this file holds is the css text.

/** the copied declarations, keyed by the custom property each one is a copy of. */
export const ADMIN_TOKENS = {
	// ---- colour ----
	// the ground the document is read on, the plane its body is set on, and the two grounds a block
	// on that plane sits on. the four are the same stack an operator screen is built from: a page, a
	// plane on it, and the two bands on the plane, both step 3 in ./tokens.css and named apart so
	// either may move. the page is the solid `--admin-page` and never its wash: a gradient is a
	// background image, which a mail client may drop, and the solid is the step-2 ground the wash's
	// tints are laid over.
	'--admin-page': '#f6f9fd',
	'--admin-surface': '#fbfcfe',
	'--admin-surface-sunken': '#ecf1f7',
	'--admin-surface-fill': '#ecf1f7',
	'--admin-divider': '#d2dbe7',
	'--admin-ink': '#1a2029',
	'--admin-ink-muted': '#5d656f',
	'--admin-link': '#1e6dab',
	// a literal inside a sentence: its ground and its ink.
	'--admin-code-bg': '#ecf1f7',
	'--admin-code-ink': '#1a2029',
	// the band an instruction is set on: the base banner's tone, which carries no hue.
	'--admin-tone-note-tint': '#ecf1f7',

	// ---- type ----
	// both stacks are copied whole, first face included. that face is self-hosted by ./fonts.css and
	// a mail client fetches nothing, so it is never found and the stack falls through to the system
	// faces behind it — which is how a mail keeps the operator surfaces' own stack without loading a
	// web font, the thing packages/emails/src/components/layout.tsx says its shell may not grow.
	'--admin-font-sans': "'Red Hat Text', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
	'--admin-font-mono':
		"'Red Hat Mono', ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
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
	'--admin-space-1': '0.125rem',
	'--admin-space-2': '0.25rem',
	'--admin-space-4': '0.5rem',
	'--admin-space-6': '1rem',
	'--admin-space-8': '1.5rem',
	'--admin-border-width': '1px',
	'--admin-border-width-strong': '2px',
	'--admin-radius': '0.375rem',
	'--admin-radius-plane': '0.75rem',
	'--admin-measure-dialog': '34rem'
} as const;
