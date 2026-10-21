import { describe, expect, it } from 'vitest';
import { causeChain, sqliteResultCode } from './rejection';

// the walk, exercised on the shapes drizzle over D1 and over libSQL produce.
//
// pure string work, so it runs in the node pool. that libSQL's shape is what a real file throws is
// ./rejection.db.spec.ts's claim.

/** an error with a cause, as drizzle rethrows one. */
const wrapped = (outer: string, inner: string): Error =>
	new Error(outer, { cause: new Error(inner) });

/**
 * a D1 rejection, spelled the way D1 spells one.
 *
 * both codes, in this order — read off a real foreign key failure inside workerd rather than
 * written from memory. the primary code comes first and the extended one is parenthesised after
 * it, which is why a first-match read of this string answers `SQLITE_CONSTRAINT` and tells a
 * caller nothing.
 */
const D1_FOREIGNKEY =
	'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)';

describe('sqliteResultCode()', () => {
	it('reaches the code through drizzle’s wrapper', () => {
		const error = wrapped(
			'Failed query: insert into "payment" ("id", "donation_id") values (?, ?)',
			'D1_ERROR: UNIQUE constraint failed: payment.provider, payment.provider_txn_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
		);

		expect(sqliteResultCode(error)).toBe('SQLITE_CONSTRAINT_UNIQUE');
	});

	it('prefers the extended code over the primary one beside it', () => {
		// the whole reason this is not a first-match read: `SQLITE_CONSTRAINT` is shared by every
		// constraint there is, so a mapping built on it cannot tell a duplicate from a missing row.
		expect(sqliteResultCode(new Error(D1_FOREIGNKEY))).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
	});

	it('answers a primary code where that is all the message carries', () => {
		expect(sqliteResultCode(new Error('D1_ERROR: SQLITE_BUSY'))).toBe('SQLITE_BUSY');
	});

	it('answers null for an error the database did not produce', () => {
		expect(sqliteResultCode(new TypeError('cannot read properties of undefined'))).toBeNull();
	});

	it('answers null for a thrown value that is not an Error', () => {
		expect(sqliteResultCode('SQLITE_CONSTRAINT_UNIQUE')).toBeNull();
	});
});

describe('causeChain()', () => {
	it('reports every message, outermost first', () => {
		expect(causeChain(wrapped('outer', 'inner'))).toEqual(['outer', 'inner']);
	});

	it('stops at a cause that is not an Error', () => {
		expect(causeChain(new Error('outer', { cause: 'a string' }))).toEqual(['outer']);
	});
});
