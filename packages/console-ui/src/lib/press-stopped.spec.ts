import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REACHED_CLOUDFLARE, REACHED_STRIPE, pressStopped } from './press-stopped';

// the console's own stop, said the same way on all three presses that can meet it.
//
// what goes wrong here is a fourth press written against the three, saying it in words of its own —
// so the sweep is over the sources rather than over the states, which is ./unread-answer.spec.ts's
// shape and for its reason.

/** every source on the console but the specs, which quote what they are guarding. */
const sources = globSync('src/**/*.{ts,tsx}').filter((file) => !file.includes('.spec.'));

describe('the sentence for a press the console died inside', () => {
	it('says how far it got is not known, and names no step', () => {
		expect(pressStopped(REACHED_CLOUDFLARE)).toBe(
			"This console stopped part way through this press and doesn't know how far it got. What reached Cloudflare before it stopped is what your deployment holds now. Press it again. It reads what is already there rather than assuming."
		);
	});

	it('sends the operator to the place that press had reached', () => {
		expect(pressStopped(REACHED_STRIPE)).toContain('Stripe');
		expect(pressStopped(REACHED_STRIPE)).not.toContain('Cloudflare');
	});
});

describe('no console source says it in words of its own', () => {
	it('finds the files it is meant to be guarding', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('says it through this module or not at all', () => {
		const said = sources.filter(
			(file) =>
				file !== 'src/lib/press-stopped.ts' &&
				readFileSync(file, 'utf8').includes('stopped part way through')
		);

		expect(said).toEqual([]);
	});
});
