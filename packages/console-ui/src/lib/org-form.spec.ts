import { parseWithZod } from '@conform-to/zod/v4';
import { ORG_PROFILE_FIELDS } from '@better-giving/operator/console/org';
import {
	MALFORMED_TAX_ID,
	ORG_PROFILE_FIELD_RULES,
	REQUIRED
} from '@better-giving/operator/console/org-rules';
import { fieldErrorsFrom } from '@better-giving/operator/zod-issues';
import { describe, expect, it } from 'vitest';
import {
	IDENTITY_BOXES,
	IDENTITY_FOLD,
	NOTIFICATIONS_FOLD,
	NOTIFICATION_BOXES,
	boxFold,
	carriedBoxes,
	orgRequired
} from './org-fields';
import { NOTIFICATIONS_FORM, ORG_FORM, foldErrors, listed, seedFor, storedOrg } from './org-form';
import type { OrgWrite } from '../api/types';
import type { OrgBoxes } from './org-fields';

// what the two folds that edit the profile read off what the deployment reported: what each seeds
// its boxes from, which of a refusal's sentences belongs to which fold, and what the identity
// fold's own press answers before it goes.
//
// there is no dom here and none is needed: a seed is an object keyed by box, and the rules below are
// read the way the fold reads them — as issues keyed to a box.

/** an empty profile, which is what a deployment nobody has saved one on reports. */
const BLANK: OrgBoxes = {
	legal_name: '',
	tax_id: '',
	address_line1: '',
	address_line2: '',
	city: '',
	region: '',
	postal_code: '',
	country: '',
	notification_email: ''
};

describe('what a fold seeds its boxes with', () => {
	it('holds every box the identity form states, at what the deployment holds', () => {
		const stored = { ...BLANK, legal_name: 'Hope Foundation', city: 'Portland' };

		// exactly the eight, because the seed is the one side of the reading the button is armed off
		// (./use-console-form.ts): a key for a box the form does not state reads as changed forever,
		// and a box with no key sits under a button that never arms.
		expect(seedFor(ORG_FORM, stored)).toEqual({
			legal_name: 'Hope Foundation',
			tax_id: '',
			address_line1: '',
			address_line2: '',
			city: 'Portland',
			region: '',
			postal_code: '',
			country: ''
		});
	});

	it('leaves the notification address out of the identity fold and carries nothing else into its own', () => {
		// the ninth is drawn by the other fold and posted hidden by this one, and neither seed holds
		// the other's boxes.
		const stored = { ...BLANK, legal_name: 'Hope Foundation', notification_email: 'a@example.org' };

		expect(seedFor(ORG_FORM, stored).notification_email).toBeUndefined();
		expect(seedFor(NOTIFICATIONS_FORM, stored)).toEqual({ notification_email: 'a@example.org' });
	});
});

describe('which of a refusal’s sentences one fold draws', () => {
	const refused = (errors: Record<string, string>): OrgWrite => ({
		kind: 'refused',
		message: null,
		fix: null,
		errors,
		unread: 0
	});

	it('keeps only the boxes that fold has', () => {
		// focus goes to the first key (./use-console-form.ts), and another fold's box is inside a
		// shut panel — a press answered by nothing moving.
		const errors = refused({ legal_name: 'Add it.', notification_email: 'Add it.' });

		expect(foldErrors(errors, IDENTITY_BOXES)).toEqual({ legal_name: 'Add it.' });
		expect(foldErrors(errors, NOTIFICATION_BOXES)).toEqual({ notification_email: 'Add it.' });
	});

	it('draws nothing at a box for a press that was refused over another fold alone', () => {
		expect(foldErrors(refused({ legal_name: 'Add it.' }), NOTIFICATION_BOXES)).toEqual({});
	});

	it('is nothing at all where the press was not refused', () => {
		expect(foldErrors(null, IDENTITY_BOXES)).toBe(null);
		expect(foldErrors({ kind: 'saved', org: null }, IDENTITY_BOXES)).toBe(null);
	});
});

describe('which fold draws which box', () => {
	it('gives every field of the profile to exactly one fold', () => {
		// a field on neither is a box nobody draws and a refusal nobody can be sent to; a field on
		// both is one press posting a value the other press drew.
		const drawn = [...IDENTITY_BOXES, ...NOTIFICATION_BOXES];

		expect([...drawn].sort()).toEqual([...ORG_PROFILE_FIELDS].sort());
	});

	it('names the row an operator opens to find a box', () => {
		expect(boxFold('legal_name')).toBe(IDENTITY_FOLD);
		expect(boxFold('notification_email')).toBe(NOTIFICATIONS_FOLD);
	});

	it('carries every box a fold does not draw', () => {
		// the deployment stores a profile whole, so a field left out of a body is one it clears.
		for (const drawn of [IDENTITY_BOXES, NOTIFICATION_BOXES]) {
			expect([...drawn, ...carriedBoxes(drawn)].sort()).toEqual([...ORG_PROFILE_FIELDS].sort());
			expect(carriedBoxes(drawn).filter((field) => drawn.includes(field))).toEqual([]);
		}
	});
});

describe('a list a person reads', () => {
	it('joins the last one with "and" and leaves one alone', () => {
		expect(listed(['City'])).toBe('City');
		expect(listed(['City', 'Country'])).toBe('City and Country');
		expect(listed(['Registered name', 'City', 'Country'])).toBe(
			'Registered name, City and Country'
		);
	});

	it('is empty where nothing was named', () => {
		expect(listed([])).toBe('');
	});
});

describe('what the boxes are seeded from', () => {
	const reading: OrgBoxes = { ...BLANK, legal_name: 'Hope Foundation' };

	it('takes the profile a press stored over the reading the page arrived with', () => {
		// the reading taken after a press commits a render later than the answer does, so boxes
		// seeded from it alone are re-seeded from the profile the press replaced.
		const write: OrgWrite = {
			kind: 'saved',
			org: { legal_name: 'Hope Foundation', notification_email: 'alerts@example.org' }
		};

		expect(storedOrg(reading, write).notification_email).toBe('alerts@example.org');
		expect(storedOrg(reading, write).legal_name).toBe('Hope Foundation');
	});

	it('keeps the reading where the press stored nothing', () => {
		// a refusal leaves the boxes holding what was typed, so there is something to fix.
		const refused: OrgWrite = {
			kind: 'refused',
			message: null,
			fix: null,
			errors: { legal_name: "Give the organisation's legal name." },
			unread: 0
		};

		expect(storedOrg(reading, refused)).toEqual(reading);
		expect(storedOrg(reading, null)).toEqual(reading);
	});

	it('keeps the reading where the answer carried no profile', () => {
		// a deployment older than this console answers a save with a report naming none, and boxes
		// seeded from that would be wiped by a save that landed.
		expect(storedOrg(reading, { kind: 'saved', org: undefined })).toEqual(reading);
		expect(storedOrg(reading, { kind: 'saved', org: null })).toEqual(reading);
		expect(storedOrg(reading, { kind: 'saved', org: 'Hope Foundation' })).toEqual(reading);
	});
});

describe('what the identity fold answers at its own press', () => {
	/** a form as it arrives at the rules: every box the fold posts, at what it holds. */
	const posted = (values: Partial<OrgBoxes>) =>
		Object.fromEntries(ORG_PROFILE_FIELDS.map((field) => [field, values[field] ?? '']));

	/**
	 * the sentences the fold's own press earns, keyed by the box each is about.
	 *
	 * the issues and never the parse's output: `tax_id`'s rule re-spells what it stores, and that
	 * rewrite is the deployment's — so this reads what a screen reads.
	 */
	const refusals = (values: Partial<OrgBoxes>): Record<string, string> => {
		const parsed = ORG_FORM.schema.safeParse(posted(values));
		return parsed.success ? {} : fieldErrorsFrom(parsed.error, IDENTITY_BOXES);
	};

	/** a profile the deployment would take, which is what the boxes are compared against. */
	const filled: Partial<OrgBoxes> = {
		legal_name: 'Hope Foundation',
		tax_id: '12-3456789',
		address_line1: '123 Example Street',
		city: 'Anytown',
		country: 'United States'
	};

	it('runs the rules the deployment runs, over the eight boxes it draws', () => {
		// the ninth is carried hidden at what is stored, so a sentence about it here would be one
		// keyed to a box this form has none of — focus into a panel nobody has open.
		expect(Object.keys(ORG_FORM.schema.shape).sort()).toEqual([...IDENTITY_BOXES].sort());
		expect(Object.keys(ORG_FORM.schema.shape)).not.toContain('notification_email');
	});

	it('says nothing about a profile the deployment would store', () => {
		// `region`, `postal_code` and `address_line2` are empty here and marked `(optional)`: plenty of
		// countries have neither a state level nor a postcode.
		expect(refusals(filled)).toEqual({});
	});

	it('names each empty box the save refuses, in the word the deployment uses', () => {
		// the defect this exists for: a press that spent a round trip and shut every box for it, to be
		// told what the rules on this side already knew.
		expect(refusals({ ...filled, city: '', country: '' })).toEqual({
			city: REQUIRED,
			country: REQUIRED
		});
	});

	it('reads a box holding only whitespace as blank', () => {
		// the rules trim before they decide, so a box of spaces is a blank they refuse.
		expect(refusals({ ...filled, city: ' \t ' })).toEqual({ city: REQUIRED });
	});

	it('names every box the save refuses on a form nobody has filled in', () => {
		expect(Object.keys(refusals({}))).toEqual([
			'legal_name',
			'tax_id',
			'address_line1',
			'city',
			'country'
		]);
	});

	it('says how far over its limit a name is, and by how much', () => {
		expect(refusals({ ...filled, legal_name: 'a'.repeat(201) })).toEqual({
			legal_name: 'This is 201 characters, over the 200-character limit.'
		});
	});

	it('says an EIN is nine digits and that the dash is not the problem', () => {
		expect(refusals({ ...filled, tax_id: '12345678' })).toEqual({ tax_id: MALFORMED_TAX_ID });
		// both spellings an operator can paste are taken, and neither is re-spelled on the screen:
		// what the rule stores is not what the box shows.
		expect(refusals({ ...filled, tax_id: '123456789' })).toEqual({});
		expect(refusals({ ...filled, tax_id: '12-3456789' })).toEqual({});
	});

	it('asks for the EIN before it says what shape one has', () => {
		// the pattern passes a blank deliberately: the word for an empty box has to win over the
		// shape of a value nobody typed.
		expect(refusals({ ...filled, tax_id: '' })).toEqual({ tax_id: REQUIRED });
	});

	it('never raises two sentences about one box at once', () => {
		// which is what makes both ends right about the same parse: `fieldErrorsFrom` keeps the last
		// issue on a key and the seam draws the first (./use-console-form.ts). they can only disagree
		// about a box that raised both, and none of these eight can — a value over its cap is not also
		// empty, and the EIN's pattern passes the blank its own `.min(1)` refuses.
		for (const value of ['', ' \t ', 'a'.repeat(201), 'not-an-ein', '12-3456789']) {
			const parsed = ORG_FORM.schema.safeParse(
				posted(Object.fromEntries(ORG_PROFILE_FIELDS.map((field) => [field, value])))
			);
			if (parsed.success) continue;
			const counted = new Map<string, number>();
			for (const issue of parsed.error.issues) {
				const box = String(issue.path[0]);
				counted.set(box, (counted.get(box) ?? 0) + 1);
			}
			expect([...counted].filter(([, times]) => times > 1)).toEqual([]);
		}
	});

	/** a profile with the three boxes a blank is a finished answer in filled in as well. */
	const whole: Partial<OrgBoxes> = {
		...filled,
		address_line2: 'Suite 400',
		region: 'California',
		postal_code: '97201'
	};

	/**
	 * the eight boxes through the pass the seam actually runs.
	 *
	 * `parseWithZod` rewrites the schema it is handed so that an empty box reads as `undefined`
	 * (./use-console-form.ts is where it is mounted), and `safeParse` above never sees that rewrite
	 * — so this is the only reading here that can catch a box refused for being absent.
	 */
	const submitted = (values: Partial<OrgBoxes>) => {
		const body = new FormData();
		for (const field of IDENTITY_BOXES) body.set(field, values[field] ?? '');
		// the fold posts the ninth hidden at what the deployment holds (`carriedBoxes`).
		for (const field of carriedBoxes(IDENTITY_BOXES)) body.set(field, 'held');
		return parseWithZod(body, { schema: ORG_FORM.schema });
	};

	it('takes an emptying of each box the save stores blank', () => {
		// the defect this case exists for: those three state nothing about a blank, so a rule mounted
		// on the box answered an emptied one "expected string, received undefined" — a sentence
		// written for nobody, over a save the deployment would have taken.
		for (const field of ['address_line2', 'region', 'postal_code'] as const) {
			expect(submitted({ ...whole, [field]: '' }).status).toBe('success');
		}
	});

	it('answers an emptied box in the leaf’s own words, and never in zod’s', () => {
		// which holds for all eight and not only for the three: the rules are run over the empty
		// string a box stood for rather than mounted on the boxes (./org-form.ts's `identityBox`), so
		// what an emptied box earns is what the leaf says about `''` and nothing else — a rule that
		// later loses its `.min(1)` is a box that takes a blank rather than one refused in zod's
		// words.
		for (const field of IDENTITY_BOXES) {
			const submission = submitted({ ...whole, [field]: '' });
			const said = submission.status === 'error' ? submission.error : {};
			const leaf = ORG_PROFILE_FIELD_RULES[field].safeParse('');

			expect(said).toEqual(
				leaf.success ? {} : { [field]: leaf.error.issues.map((issue) => issue.message) }
			);
		}
	});
});

describe('what the notifications fold answers at its own press', () => {
	/**
	 * the sentences the fold's own press earns, keyed by the box each is about.
	 *
	 * the box arrives the way conform hands it over rather than as the profile: every empty box is
	 * dropped before the schema sees it (`parseWithZod` in `@conform-to/zod/v4`), which is the whole
	 * reason the rule is mounted behind an optional box.
	 */
	const refusals = (typed?: string): Record<string, string> => {
		const parsed = NOTIFICATIONS_FORM.schema.safeParse(
			typed === undefined ? {} : { notification_email: typed }
		);
		return parsed.success ? {} : fieldErrorsFrom(parsed.error, NOTIFICATION_BOXES);
	};

	it('runs the rule the deployment runs, over the one box it draws', () => {
		// the other eight are carried hidden at what is stored, so a sentence about one of them here
		// would be keyed to a box this form has none of — focus into a panel nobody has open.
		expect(Object.keys(NOTIFICATIONS_FORM.schema.shape)).toEqual(['notification_email']);
	});

	it('says nothing about an address the deployment would store', () => {
		expect(refusals('alerts@example.org')).toEqual({});
	});

	it('takes an empty box, and the box a browser dropped for being empty', () => {
		// the two readings of "wanted" stay apart here: the save stores a profile holding no
		// notification address, and the box is still marked by nothing — a press over an empty one
		// is not held back and earns no sentence.
		expect(refusals('')).toEqual({});
		expect(refusals()).toEqual({});
		expect(orgRequired('notification_email')).toBe(true);
	});

	it('names a value that is not an address', () => {
		expect(refusals('alerts')).toEqual({ notification_email: 'Not an email address.' });
	});

	/**
	 * the same box, through the pass the seam actually runs.
	 *
	 * `parseWithZod` rewrites the schema it is handed so that an empty box reads as `undefined`
	 * (./use-console-form.ts is where it is mounted), and `safeParse` above never sees that rewrite
	 * — so this is the only reading here that can catch a rule the rewrite reaches through.
	 */
	const submitted = (typed: string) => {
		const posted = new FormData();
		posted.set('notification_email', typed);
		for (const field of carriedBoxes(NOTIFICATION_BOXES)) posted.set(field, 'held');
		return parseWithZod(posted, { schema: NOTIFICATIONS_FORM.schema });
	};

	it('lets an emptied box through the pass the seam runs, rewrite and all', () => {
		// the defect this case exists for: a rule mounted behind a transform that put the empty
		// string back has that string turned into `undefined` again by the rewrite, and an emptied
		// box is then answered "expected string, received undefined" with nothing sent.
		expect(submitted('').status).toBe('success');
	});

	it('keys the sentence to the box the operator is looking at', () => {
		const submission = submitted('alerts');
		const said = submission.status === 'error' ? submission.error : null;

		expect(said).toEqual({ notification_email: ['Not an email address.'] });
	});

	it('says how far over its limit an address is, and by how much', () => {
		const long = `${'a'.repeat(320)}@example.org`;

		expect(refusals(long)).toEqual({
			notification_email: `This is ${long.length} characters, over the 320-character limit.`
		});
	});
});
