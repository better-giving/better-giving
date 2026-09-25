import { describe, expect, it } from 'vitest';
import { documentHeaders } from './document-policy';

// the policy builder on its own, for the one thing a request through the worker cannot show: a
// build's answer. vitest runs every pool with `import.meta.env.DEV` set, so a request there only
// ever sees the dev server's variant, and the flag is passed here rather than read. which document
// gets which policy, and the nonce on its scripts, is ./entry.server.workers.spec.ts's.

/** a policy's `style-src` sources, or `undefined` where it states none and `default-src` applies. */
function styleSources(headers: Record<string, string>): string[] | undefined {
	const directive = (headers['Content-Security-Policy'] ?? '')
		.split(';')
		.map((each) => each.trim().split(/\s+/))
		.find(([name]) => name === 'style-src');
	return directive?.slice(1);
}

describe('an operator document', () => {
	it('allows no inline style in a build', () => {
		expect(styleSources(documentHeaders('operator', 'n0nce', { dev: false }))).toBeUndefined();
	});

	it('allows inline style under the dev server', () => {
		expect(styleSources(documentHeaders('operator', 'n0nce', { dev: true }))).toEqual([
			"'self'",
			"'unsafe-inline'"
		]);
	});
});

describe('the donor page', () => {
	it('allows inline style in a build and under the dev server alike', () => {
		for (const dev of [false, true]) {
			expect(styleSources(documentHeaders('donor', 'n0nce', { dev }))).toEqual([
				"'self'",
				"'unsafe-inline'"
			]);
		}
	});
});
