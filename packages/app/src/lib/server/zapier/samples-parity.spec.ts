import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_DONOR, SAMPLE_GIFT } from './payload';

// the guard on packages/zapier's static samples: the event a Zap editor shows before any gift or
// donor exists has the keys a live event has, nested ones included.
//
// read off disk rather than imported, because nothing in the workspace imports packages/zapier and
// it imports nothing back. the samples are its own JSON so its build ships them, and this spec is
// the one place the two sides meet.

const SAMPLES = resolve(import.meta.dirname, '../../../../../zapier/src/samples');

function sample(trigger: string): unknown {
	return JSON.parse(readFileSync(resolve(SAMPLES, `${trigger}.json`), 'utf8'));
}

/** every key path in `value`, `first_gift.amount` style, sorted. */
function keyPaths(value: unknown, prefix = ''): string[] {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.entries(value)
		.flatMap(([key, inner]) => [`${prefix}${key}`, ...keyPaths(inner, `${prefix}${key}.`)])
		.sort();
}

describe("packages/zapier's static samples", () => {
	it('new_gift has the keys of SAMPLE_GIFT', () => {
		expect(keyPaths(sample('new_gift'))).toEqual(keyPaths(SAMPLE_GIFT));
	});

	it('new_donor has the keys of SAMPLE_DONOR', () => {
		expect(keyPaths(sample('new_donor'))).toEqual(keyPaths(SAMPLE_DONOR));
	});
});
