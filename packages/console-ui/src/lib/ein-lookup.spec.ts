import { describe, expect, it, vi } from 'vitest';
import type { NonprofitLookup, NonprofitOrganisation } from '../api/types';
import {
	LOOKUP_UNANSWERED,
	NOT_DEDUCTIBLE,
	NOT_LISTED,
	US_COUNTRY,
	einCaret,
	foundBoxes,
	matchBoxes,
	revokedNote,
	watchEin
} from './ein-lookup';

// when the Legal details fold asks the IRS list about the EIN box, and what it says and fills when
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
	website: 'https://riversidefood.org'
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
	website: ''
};

const found = (over: Partial<NonprofitOrganisation> = {}): NonprofitLookup => ({
	state: 'found',
	organisation: { ...ORGANISATION, ...over }
});

/** a watch over a stub that answers `answer`, and what it said and filled. */
function watched(answer: () => Promise<NonprofitLookup>) {
	const lookUp = vi.fn((_ein: string, _signal: AbortSignal) => answer());
	const notes: string[] = [];
	const fills: NonprofitOrganisation[] = [];
	const watch = watchEin({
		lookUp,
		onNote: (note) => notes.push(note),
		onFound: (organisation) => fills.push(organisation)
	});
	return { watch, lookUp, notes, fills, note: () => notes.at(-1) ?? '' };
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
		expect(foundBoxes(ORGANISATION, '')).toEqual({
			legal_name: 'Riverside Community Food Bank',
			address_line1: '400 Mill Road',
			city: 'Riverside',
			region: 'CA',
			postal_code: '92501',
			country: 'United States'
		});
	});

	it('leaves a box alone where the list holds nothing for it', () => {
		expect(foundBoxes({ ...ORGANISATION, postal_code: '', address_line1: '' }, '')).toEqual({
			legal_name: 'Riverside Community Food Bank',
			city: 'Riverside',
			region: 'CA',
			country: US_COUNTRY
		});
	});

	it('leaves a Country box holding anything as it is', () => {
		expect(foundBoxes(ORGANISATION, 'USA')).not.toHaveProperty('country');
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

describe('where the caret stands after the EIN box is re-spelled', () => {
	it('stays after the digit just typed when the dash arrives', () => {
		// `123|` re-spelled `12-3|`: three digits before the caret, so it stands after the third.
		expect(einCaret('123', 3, '12-3')).toBe(4);
	});

	it('stays where the operator was typing in the middle of the number', () => {
		// a digit typed after the first: `19|2-3456789` reads `192345678…`, re-spelled `19-2345678`,
		// and the caret stays after the second digit rather than jumping to the end.
		expect(einCaret('192-3456789', 2, '19-2345678')).toBe(2);
		expect(einCaret('12-93456789', 4, '12-9345678')).toBe(4);
	});

	it('steps past the dash when the caret sat after the second digit', () => {
		// a third digit typed straight after `12`: `123|456789` → `12-3|456789`.
		expect(einCaret('123456789', 3, '12-3456789')).toBe(4);
	});

	it('stays put where a letter typed was dropped', () => {
		expect(einCaret('12-34a', 6, '12-34')).toBe(5);
	});

	it('stands at the start where no digit is before it', () => {
		expect(einCaret('x12-3456789', 1, '12-3456789')).toBe(0);
	});
});

describe('the revocation date', () => {
	it('is said the way a fundraiser reads a date', () => {
		expect(revokedNote('2023-05-15')).toBe('Tax-exempt status revoked May 15, 2023.');
		expect(revokedNote('2019-01-01')).toBe('Tax-exempt status revoked January 1, 2019.');
	});
});
