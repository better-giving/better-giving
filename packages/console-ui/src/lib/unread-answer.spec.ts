import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNREAD_ANSWER_TITLE, readableRefusal, unreadAnswer } from './unread-answer';

// the console's gate over one claim it cannot make.
//
// an answer the console could not read is several findings in one state (./unread-answer.ts), so a
// screen naming any single cause names it for the rest — and the one that was named sends an
// operator to redeploy a deployment that is answering correctly. what is asserted is that the
// sentence says what was not read, and that no screen says the other thing anywhere.
//
// the sweep is over the sources rather than over the states, for the reason the shape of
// ../closed-while-writing.spec.ts states: what goes wrong here is a fifth screen written against
// the four, and a case per state would pass while that screen said it.

/** the claim about two versions that no reading on this console supports. */
const DRIFT = ['This deployment and this', 'console are out of step'].join(' ');

/** every source on the console but the specs, which quote what they are guarding against. */
const sources = globSync('src/**/*.{ts,tsx}').filter((file) => !file.includes('.spec.'));

describe('the sentence for an answer the console could not read', () => {
	it('says what was not read and names no cause for it', () => {
		const said = unreadAnswer('nothing was saved');

		expect(said).toBe("The console couldn't read this deployment's answer, so nothing was saved.");
	});

	it('carries what the request cost, which the caller states', () => {
		expect(unreadAnswer('there is nothing to edit here yet')).toContain(
			'there is nothing to edit here yet'
		);
	});

	it('heads the face that draws nothing else with the same finding', () => {
		expect(UNREAD_ANSWER_TITLE).toBe("Can't read this deployment's answer");
	});
});

describe('a refusal the deployment wrote on purpose', () => {
	it('is its own words and its way out, not an answer the console could not read', () => {
		// a 400 from a save naming an account outside its place: sorted as unreadable by the binary,
		// and read perfectly well.
		expect(
			readableRefusal({
				kind: 'unreadable',
				error: 'account_wrong_type',
				detail: '`deposit` names Accounts receivable, whose type is Accounts Receivable.',
				fix: 'Send the `id` of an account of type Bank.'
			})
		).toEqual({
			message: '`deposit` names Accounts receivable, whose type is Accounts Receivable.',
			fix: 'Send the `id` of an account of type Bank.'
		});
	});

	it('is nothing where the answer carried no code, which is an answer genuinely not read', () => {
		expect(
			readableRefusal({
				kind: 'unreadable',
				error: null,
				detail: 'This deployment answered 502',
				fix: null
			})
		).toBeNull();
		expect(readableRefusal({ kind: 'unreachable', detail: 'EOF' })).toBeNull();
	});
});

describe('no console source blames an unreadable answer on two versions', () => {
	it('finds the files it is meant to be guarding', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('says it nowhere', () => {
		const said = sources.filter((file) => readFileSync(file, 'utf8').includes(DRIFT));

		expect(said).toEqual([]);
	});
});
