import { describe, expect, it } from 'vitest';
import { FORM_READINESS_SEVERITIES } from '$lib/forms/readiness';
import type { OrgProfile } from '../db/schema';
import { formsReadiness, ORG_LABEL } from './readiness';

// a node spec: this module reads a row that is handed to it and issues no query — the same split
// ./form-input.ts draws against ./queries.ts. CLAUDE.md splits the pools by what a spec needs, and
// nothing here needs a D1.

/**
 * a saved profile, as the row arrives from the database.
 *
 * cast because `OrgProfile` carries columns this module never reads — the address, the
 * timestamps — and naming them here would be a fixture that has to be kept in step with a table
 * for no assertion's sake. the three it does read are stated.
 */
function profile(over: Partial<OrgProfile> = {}): OrgProfile {
	return {
		legalName: 'Hope Foundation',
		taxId: '12-3456789',
		deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
		...over
	} as OrgProfile;
}

/** the line under `label`, or a failure naming the one that went missing. */
function line(lines: ReturnType<typeof formsReadiness>, label: string) {
	const found = lines?.find((l) => l.label === label);
	if (!found) throw new Error(`the block has no ${label} line`);
	return found;
}

describe('formsReadiness', () => {
	/**
	 * the block names what stops a form being served, and a blank statement stops nothing.
	 *
	 * the standard 501(c)(3) wording is what a config carries where the column is empty
	 * (`servedDeductibilityStatement` in ../org/deductibility.ts), so a deployment that never
	 * wrote one serves forms — and a blocker over it would be this screen refusing a deployment
	 * the donation path accepts.
	 */
	it('says nothing about a blank deductibility statement', () => {
		expect(formsReadiness(profile({ deductibilityStatement: null }))).toBe(null);
	});

	it('names every identity field that is blank, not the first of them', () => {
		// filling them in is one trip rather than one trip each, and the words are the ones put on
		// those boxes — a sentence naming a column would be a scavenger hunt.
		const detail = line(formsReadiness(null), ORG_LABEL).detail ?? '';
		expect(detail).toContain('Registered name');
		expect(detail).toContain('EIN');
	});

	it('renders no block at all once the row is filled in', () => {
		// a panel reporting that nothing is wrong is a panel an operator learns to scroll past, and
		// these screens are about forms rather than about configuration.
		expect(formsReadiness(profile())).toBe(null);
	});

	/**
	 * what a line may carry, asserted over the vocabulary rather than over the arms this file
	 * happens to build.
	 *
	 * a severity with no sentence beside it is a word an operator cannot act on. nothing says where
	 * to go about it and nothing may — see the header on `FormReadinessLine` in
	 * `$lib/forms/readiness.ts` — so the assertion is that a line is a name, a word and a sentence,
	 * and that a line naming a deployment capability is not among them.
	 */
	it('says something about every line it does not call resolved, and points nowhere', () => {
		for (const row of [null, profile(), profile({ taxId: null })]) {
			for (const l of formsReadiness(row) ?? []) {
				expect(FORM_READINESS_SEVERITIES).toContain(l.severity);
				expect(l.label).toBe(ORG_LABEL);
				if (l.severity === 'resolved') expect(l.detail).toBe(null);
				else expect(l.detail).toBeTypeOf('string');
				expect(Object.keys(l).sort()).toEqual(['detail', 'label', 'severity']);
			}
		}
	});

	/**
	 * the deployment's own capabilities are not in this block, and this is what holds that.
	 *
	 * the keys that take a card and the mail that sends the receipt are facts about the deployment
	 * rather than about a record: they are settled on the console when the keys are pasted
	 * (`packages/console-ui/src/lib/payments-fold.tsx`), and a screen here could only ever report them
	 * and point somewhere else. so the block reports on rows and on nothing else, whatever this
	 * deployment's environment holds.
	 */
	it('draws the organisation’s line and nothing else, on a deployment set up with nothing', () => {
		expect(formsReadiness(null)?.map((l) => l.label)).toEqual([ORG_LABEL]);
	});
});
