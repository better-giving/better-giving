import { describe, expect, it } from 'vitest';
import { INJECTING_NONCE } from './nonce';

// the node pool, where there is no document at all — which is the whole of what this file checks.
//
// ./stripe.ts and ./turnstile.ts both read this constant, and both are reachable from a spec that
// runs with no DOM under it. a bare `document.currentScript` at module scope throws there while
// the module is being evaluated, which is a spec file that never collects rather than one
// assertion that fails, so nothing points at the line that did it.
describe('the nonce the injecting script carried', () => {
	it('is nothing at all where there is no document to read one from', () => {
		expect(INJECTING_NONCE).toBe('');
	});
});
