import { describe, expect, it, vi } from 'vitest';
import type { NonprofitLookup, NonprofitOrganisation } from '../api/types';
import {
	FILLED,
	LOOKUP_UNANSWERED,
	NOT_DEDUCTIBLE,
	NOT_LISTED,
	US_COUNTRY,
	einEdit,
	foundBoxes,
	matchBoxes,
	revokedNote,
	watchEin
} from './ein-lookup';

// when the Organisation details fold asks the IRS list about the EIN box, and what it says and fills when
// the answer lands. the watch is plain typescript handed the box's text, so every case here is the
// fold's own reading with no dom (../../vite.config.ts pins `node`).

const ORGANISATION: NonprofitOrganisation = {
	ein: '123456789',
	name: 'Riverside Community Food Bank',
	address_line1: '400 Mill Road',
	city: 'Riverside',
	region: 'CA',
	postal_code: '92501',
	deductible: true,
	revokedOn: '',
	website: 'https://riversidefood.org',
	mission: 'Food for every family in Riverside County.'
};

const EMPTY: NonprofitOrganisation = {
	ein: '',
	name: '',
	address_line1: '',
	city: '',
	region: '',
	postal_code: '',
	deductible: false,
	revokedOn: '',
	website: '',
	mission: ''
};

const found = (over: Partial<NonprofitOrganisation> = {}): NonprofitLookup => ({
	state: 'found',
	organisation: { ...ORGANISATION, ...over }
});

/**
 * a watch over a stub that answers `answer`, and what it said and filled. `boxes` stands in for the
 * identity boxes as they are on the screen, which a case changes while a lookup is out; the stand-in
 * for the fold's fill writes what it is handed into them, and reports whether it wrote anything.
 */
function watched(answer: () => Promise<NonprofitLookup>, boxes: Record<string, string> = {}) {
	const lookUp = vi.fn((_ein: string, _signal: AbortSignal) => answer());
	const notes: { shown: string; said: string }[] = [];
	const fills: NonprofitOrganisation[] = [];
	const watch = watchEin({
		lookUp,
		held: () => ({ ...boxes }),
		onNote: (note) => notes.push(note),
		onFound: (organisation, wrote) => {
			fills.push(organisation);
			const fill = foundBoxes(organisation, wrote, boxes);
			Object.assign(boxes, fill);
			return Object.keys(fill).length > 0;
		}
	});
	return {
		watch,
		lookUp,
		fills,
		boxes,
		note: () => notes.at(-1)?.shown ?? '',
		said: () => notes.at(-1)?.said ?? ''
	};
}

/** lets every settled promise run its handlers. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe('when the EIN box is looked up', () => {
	it('asks nothing for a number still being typed', () => {
		const { watch, lookUp } = watched(async () => found());
		for (const typed of ['1', '12', '12-3', '12-345678']) watch.typed(typed, '');

		expect(lookUp).not.toHaveBeenCalled();
	});

	it('asks once for a complete number that differs from the stored one', async () => {
		const { watch, lookUp } = watched(async () => found());
		watch.typed('12-3456789', '98-7654321');
		await settled();

		expect(lookUp).toHaveBeenCalledTimes(1);
		expect(lookUp.mock.calls[0]?.[0]).toBe('12-3456789');
	});

	it('asks nothing for the number the deployment already holds, however it is stored', () => {
		const { watch, lookUp } = watched(async () => found());
		watch.typed('12-3456789', '12-3456789');
		watch.typed('12-3456789', '123456789');

		expect(lookUp).not.toHaveBeenCalled();
	});

	it('asks once for a number edited away from and back to', async () => {
		const { watch, lookUp } = watched(async () => found());
		watch.typed('12-3456789', '');
		await settled();
		watch.typed('12-345678', '');
		watch.typed('12-3456789', '');
		await settled();

		expect(lookUp).toHaveBeenCalledTimes(1);
	});

	it('gives up the answer it was waiting for when the box moves on', async () => {
		const { watch, lookUp, fills } = watched(async () => found());
		watch.typed('12-3456789', '');
		const signal = lookUp.mock.calls[0]?.[1];
		watch.typed('12-345678', '');
		await settled();

		expect(signal?.aborted).toBe(true);
		expect(fills).toEqual([]);
	});

	it('gives up an answer when another number replaces it', async () => {
		const { watch, lookUp } = watched(async () => found());
		watch.typed('12-3456789', '');
		watch.typed('98-7654321', '');

		expect(lookUp.mock.calls[0]?.[1].aborted).toBe(true);
		expect(lookUp).toHaveBeenCalledTimes(2);
	});

	it('asks again for a pick of the number the deployment holds, since a pick wants the record', async () => {
		const { watch, lookUp, fills } = watched(async () => found());
		watch.typed('12-3456789', '12-3456789', true);
		await settled();

		expect(lookUp).toHaveBeenCalledTimes(1);
		expect(fills).toHaveLength(1);
	});

	it('fills again from the answer it has for a pick of the number it last asked about', async () => {
		const { watch, lookUp, fills } = watched(async () => found());
		watch.typed('12-3456789', '');
		await settled();
		watch.typed('12-3456789', '', true);

		expect(lookUp).toHaveBeenCalledTimes(1);
		expect(fills).toHaveLength(2);
	});
});

describe('what the answer says and fills', () => {
	it('fills the boxes and says nothing for an organisation listed and in good standing', async () => {
		const { watch, fills, note } = watched(async () => found());
		watch.typed('12-3456789', '');
		await settled();

		expect(fills).toEqual([ORGANISATION]);
		expect(note()).toBe('');
	});

	it('says an organisation is not listed as eligible for deductible gifts, and still fills', async () => {
		const { watch, fills, note } = watched(async () => found({ deductible: false }));
		watch.typed('12-3456789', '');
		await settled();

		expect(note()).toBe(NOT_DEDUCTIBLE);
		expect(note()).toBe('Not listed as eligible for tax-deductible gifts.');
		expect(fills).toHaveLength(1);
	});

	it('says when the status was revoked, ahead of not being deductible', async () => {
		const { watch, note } = watched(async () =>
			found({ deductible: false, revokedOn: '2023-05-15' })
		);
		watch.typed('12-3456789', '');
		await settled();

		expect(note()).toBe('Tax-exempt status revoked May 15, 2023.');
	});

	it('says a number is not on the list and fills nothing', async () => {
		const { watch, fills, note } = watched(async () => ({
			state: 'not_found',
			organisation: EMPTY
		}));
		watch.typed('12-3456789', '');
		await settled();

		expect(note()).toBe(NOT_LISTED);
		expect(note()).toBe('Not on the IRS list.');
		expect(fills).toEqual([]);
	});

	it('says it could not look the number up when the list is unavailable', async () => {
		const { watch, fills, note } = watched(async () => ({
			state: 'unavailable',
			organisation: EMPTY
		}));
		watch.typed('12-3456789', '');
		await settled();

		expect(note()).toBe(LOOKUP_UNANSWERED);
		expect(note()).toBe("Couldn't look this up. Fill in the details yourself.");
		expect(fills).toEqual([]);
	});

	it('reads a lookup that throws as the list being unavailable', async () => {
		const { watch, fills, note } = watched(async () => {
			throw new Error('the binary is not answering');
		});
		watch.typed('12-3456789', '');
		await settled();

		expect(note()).toBe(LOOKUP_UNANSWERED);
		expect(fills).toEqual([]);
	});

	it('asks again for a number the list could not answer for, once the box comes back to it', async () => {
		const { watch, lookUp } = watched(async () => ({ state: 'unavailable', organisation: EMPTY }));
		watch.typed('12-3456789', '');
		await settled();
		watch.typed('12-345678', '');
		watch.typed('12-3456789', '');
		await settled();

		expect(lookUp).toHaveBeenCalledTimes(2);
	});

	it('says to a reader that the boxes were filled, beside whatever note applies', async () => {
		const { watch, said, note } = watched(async () => found({ deductible: false }));
		watch.typed('12-3456789', '');
		await settled();

		expect(said()).toBe(FILLED);
		expect(FILLED).toBe('Filled from the IRS list.');
		expect(note()).toBe(NOT_DEDUCTIBLE);
	});

	it('says nothing was filled where every box had been typed in since the lookup went out', async () => {
		const boxes: Record<string, string> = {};
		const { watch, said } = watched(async () => found(), boxes);
		watch.typed('12-3456789', '');
		Object.assign(boxes, {
			legal_name: 'Riverside Food Bank Inc',
			address_line1: '1 Elm Street',
			city: 'Riverside',
			region: 'California',
			postal_code: '92502',
			country: 'USA',
			mission: 'Feeding Riverside.'
		});
		await settled();

		expect(said()).toBe('');
	});

	it('leaves a box typed in after the lookup went out as it was typed, and fills an empty one', async () => {
		const boxes: Record<string, string> = { legal_name: '', city: '' };
		const { watch } = watched(async () => found(), boxes);
		watch.typed('12-3456789', '');
		boxes.legal_name = 'Riverside Food Bank Inc';
		await settled();

		expect(boxes.legal_name).toBe('Riverside Food Bank Inc');
		expect(boxes.city).toBe('Riverside');
	});

	it('leaves a mission the operator typed before the lookup went out', async () => {
		const boxes: Record<string, string> = { mission: 'Feeding Riverside.' };
		const { watch } = watched(async () => found(), boxes);
		watch.typed('12-3456789', '');
		await settled();

		expect(boxes.mission).toBe('Feeding Riverside.');
	});

	it('replaces what an earlier fill wrote with the next answer, and keeps what was typed over it', async () => {
		const boxes: Record<string, string> = {};
		const answers = [
			found(),
			found({ name: 'Lakeside Pantry', city: 'Lakeside', mission: 'Meals for Lakeside.' })
		];
		const { watch } = watched(async () => answers.shift() ?? found(), boxes);
		watch.typed('12-3456789', '');
		await settled();
		boxes.city = 'Riverside Heights';
		watch.typed('98-7654321', '');
		await settled();

		expect(boxes.legal_name).toBe('Lakeside Pantry');
		expect(boxes.mission).toBe('Meals for Lakeside.');
		expect(boxes.city).toBe('Riverside Heights');
	});

	it('counts the name a pick wrote as a fill, so the next number replaces it', async () => {
		const boxes: Record<string, string> = {};
		const answers = [found(), found({ name: 'Lakeside Pantry', city: 'Lakeside' })];
		const { watch } = watched(async () => answers.shift() ?? found(), boxes);
		Object.assign(boxes, matchBoxes(RIVERSIDE_MATCH, ''));
		// the EIN box the match filled says it changed, then the pick asks for the record.
		watch.typed('12-3456789', '');
		watch.typed('12-3456789', '', true);
		await settled();
		watch.typed('98-7654321', '');
		await settled();

		expect(boxes.legal_name).toBe('Lakeside Pantry');
		expect(boxes.city).toBe('Lakeside');
	});

	it('takes the note down the moment the box changes, and puts it back for the same number', async () => {
		const { watch, note } = watched(async () => found({ deductible: false }));
		watch.typed('12-3456789', '');
		await settled();
		watch.typed('12-345678', '');

		expect(note()).toBe('');

		watch.typed('12-3456789', '');

		expect(note()).toBe(NOT_DEDUCTIBLE);
	});
});

const RIVERSIDE_MATCH = {
	ein: '123456789',
	name: 'Riverside Community Food Bank',
	city: 'Riverside',
	state: 'CA',
	deductible: true,
	revokedOn: ''
};

describe('the boxes a found organisation fills', () => {
	it('fills the name, the address it holds, and an empty Country box', () => {
		expect(foundBoxes(ORGANISATION, {}, {})).toEqual({
			legal_name: 'Riverside Community Food Bank',
			address_line1: '400 Mill Road',
			city: 'Riverside',
			region: 'CA',
			postal_code: '92501',
			country: 'United States',
			mission: 'Food for every family in Riverside County.'
		});
	});

	it('leaves a box alone where the list holds nothing for it', () => {
		expect(
			foundBoxes({ ...ORGANISATION, postal_code: '', address_line1: '', mission: '' }, {}, {})
		).toEqual({
			legal_name: 'Riverside Community Food Bank',
			city: 'Riverside',
			region: 'CA',
			country: US_COUNTRY
		});
	});

	it('replaces a box still holding what an earlier fill wrote', () => {
		const wrote = { legal_name: 'Old Name', city: 'Old Town' };

		expect(foundBoxes(ORGANISATION, wrote, wrote)).toMatchObject({
			legal_name: 'Riverside Community Food Bank',
			city: 'Riverside'
		});
	});

	it('leaves a box holding anything no fill wrote', () => {
		expect(
			foundBoxes(ORGANISATION, {}, { legal_name: 'Riverside Food Bank Inc' })
		).not.toHaveProperty('legal_name');
	});

	it('leaves a mission typed over what a fill wrote', () => {
		const typed = foundBoxes(
			ORGANISATION,
			{ mission: 'Food for all.' },
			{ mission: 'Feeding Riverside.' }
		);

		expect(typed).not.toHaveProperty('mission');
		expect(typed).toHaveProperty('legal_name');
	});

	it('leaves a Country box holding anything as it is, even one held since before', () => {
		expect(foundBoxes(ORGANISATION, { country: 'USA' }, { country: 'USA' })).not.toHaveProperty(
			'country'
		);
	});
});

describe('the boxes a match taken from the find dialog fills', () => {
	it('fills its number as stored, its name, its city and state, and an empty Country box', () => {
		expect(matchBoxes(RIVERSIDE_MATCH, '')).toEqual({
			tax_id: '12-3456789',
			legal_name: 'Riverside Community Food Bank',
			city: 'Riverside',
			region: 'CA',
			country: 'United States'
		});
	});

	it('leaves the city and state alone where the list holds none', () => {
		expect(matchBoxes({ ...RIVERSIDE_MATCH, city: '', state: '' }, '')).toEqual({
			tax_id: '12-3456789',
			legal_name: 'Riverside Community Food Bank',
			country: US_COUNTRY
		});
	});

	it('leaves a Country box holding anything as it is', () => {
		expect(matchBoxes(RIVERSIDE_MATCH, 'United States of America')).not.toHaveProperty('country');
	});
});

describe('the EIN box re-spelled as it is typed', () => {
	it('keeps the caret after the digit just typed when the dash arrives', () => {
		// `123|` re-spelled `12-3|`: three digits before the caret, so it stands after the third.
		expect(einEdit('123', 3, null)).toEqual({ shown: '12-3', caret: 4 });
	});

	it('keeps the caret where the operator was typing in the middle of the number', () => {
		// a digit typed after the first: `19|2-3456789`, re-spelled `19-2345678`.
		expect(einEdit('192-3456789', 2, null)).toEqual({ shown: '19-2345678', caret: 2 });
		expect(einEdit('12-93456789', 4, null)).toEqual({ shown: '12-9345678', caret: 4 });
	});

	it('steps past the dash when the caret sat after the second digit', () => {
		expect(einEdit('123456789', 3, null)).toEqual({ shown: '12-3456789', caret: 4 });
	});

	it('keeps the caret in place where a letter typed was dropped', () => {
		expect(einEdit('12-34a', 6, null)).toEqual({ shown: '12-34', caret: 5 });
	});

	it('puts the caret at the start where no digit is before it', () => {
		expect(einEdit('x12-3456789', 1, null)).toEqual({ shown: '12-3456789', caret: 0 });
	});

	it('deletes the digit after the dash when Delete took only the dash', () => {
		// `12|-3456789`, Delete: the box reads `123456789` with the caret at 2.
		expect(einEdit('123456789', 2, 'forward')).toEqual({ shown: '12-456789', caret: 2 });
	});

	it('deletes the digit before the dash when Backspace took only the dash', () => {
		// `12-|3456789`, Backspace: the box reads `123456789` with the caret at 2.
		expect(einEdit('123456789', 2, 'backward')).toEqual({ shown: '13-456789', caret: 1 });
	});

	it('leaves a deletion that took a digit as it is', () => {
		expect(einEdit('12-356789', 5, 'forward')).toEqual({ shown: '12-356789', caret: 5 });
	});
});

describe('the revocation date', () => {
	it('is said the way a fundraiser reads a date', () => {
		expect(revokedNote('2023-05-15')).toBe('Tax-exempt status revoked May 15, 2023.');
		expect(revokedNote('2019-01-01')).toBe('Tax-exempt status revoked January 1, 2019.');
	});
});
