// the nonce the runtime's own script tag carries, for the vendor scripts injected beside it.
//
// a host page whose Content-Security-Policy is `script-src 'nonce-…'` without `'strict-dynamic'`
// refuses every tag injected by a script it did allow, unless that tag carries the same nonce. two
// vendor scripts are injected on that page — the payment SDK's and the challenge widget's — and
// either one refused is a donor stopped at a step they cannot skip.
//
// read here, at this module's evaluation, rather than where it is used: `document.currentScript`
// holds the element only while the runtime's own top-level statements are running, and both
// installs happen long after that — the payment script when a donor reaches the card fields, the
// challenge script when they reach the step whose press spends the token.
//
// that reading rests on the runtime being a classic script, since `currentScript` is null inside a
// module one. `emits a self-executing classic script` in ./build.spec.ts is what pins that, on the
// runtime half of the embed build.
//
// the `document` guard is not defensive: this module is reached from the node pool, where there is
// no DOM and a bare read throws while the module is being evaluated — see ./nonce.spec.ts.

import { scriptNonce } from './loader';

export const INJECTING_NONCE: string =
	typeof document === 'undefined' ? '' : scriptNonce(document.currentScript);
