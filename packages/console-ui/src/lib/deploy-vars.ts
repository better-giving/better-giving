import type { DeployVarName } from '../api/types';

// the values no group's press sets, and why each is in no group.
//
// **no fold on this console draws a box for these four.** `STRIPE_PUBLISHABLE_KEY` has one of its
// own beside the secret key, because one press pastes the pair and the chain writes both
// (./stripe-section.tsx) — it is not in a group because that press is not a group's.
// `TURNSTILE_SITE_KEY` is minted with the widget on the first deploy out of the answer that made it
// (`packages/console/internal/first`), so there is no value for an operator to paste. and
// `BETTER_AUTH_URL` has a box on no screen at all: the app falls back to the origin a request
// arrived on where nothing is pinned, and where one is pinned it is also the address registered at
// Intuit (`connectFlowOrigin` in
// packages/app/src/lib/server/accounting/connect-link.ts) — ../routes/_index.tsx states what a box
// here would cost.
//
// `PAYPAL_CHARITY_RATE_APPROVED` is here for `STRIPE_PUBLISHABLE_KEY`'s reason and not for want of
// somewhere to type it: the payments fold's PayPal section draws it, as a two-position switch with
// a press of its own (./paypal-charity.ts). it is in no group because it is no credential — it is
// the organisation's answer about which of two published fee tables a donor covering fees is quoted
// from, set months after the keys are — and PayPal's three credentials are one group beside it
// (`PAYPAL_GROUP` in ./secret-groups.ts).
//
// it is a list rather than a remark in a header because ./secret-groups.spec.ts reads it: the
// covering there is two-directional, so a name added to the enumeration lands in a group or here,
// and a name that lands in neither is a value with nowhere to be typed.

export const UNGROUPED_VARS: readonly DeployVarName[] = [
	'STRIPE_PUBLISHABLE_KEY',
	'TURNSTILE_SITE_KEY',
	'BETTER_AUTH_URL',
	'PAYPAL_CHARITY_RATE_APPROVED'
];
