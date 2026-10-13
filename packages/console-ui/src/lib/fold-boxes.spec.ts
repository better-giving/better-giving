import { describe, expect, it, vi } from 'vitest';
import type { NonprofitOrganisation } from '../api/types';
import { foundBoxes } from './ein-lookup';
import { firstNeeded, heldBoxes, putBoxes } from './fold-boxes';

// the Organisation fold's reach into its own boxes, which the IRS lookup's fill runs through
// (`found` in ./org-fold.tsx). ../../vite.config.ts pins `node` and there is no dom, so the two
// element classes the reach tells a box by are stood in for, and a form's controls are a lookup by
// name — which is the whole of what the fold hands it.

class Box extends EventTarget {
	value = '';
	/** every input event the box was made to fire, which is what both form layers count. */
	said = 0;
	constructor(value = '') {
		super();
		this.value = value;
		this.addEventListener('input', () => {
			this.said += 1;
		});
	}
}
class Input extends Box {}
class TextArea extends Box {}

/** a form's controls, as `elements` hands them over. */
const controls = (boxes: Record<string, Box>) =>
	({ namedItem: (name: string) => boxes[name] ?? null }) as unknown as HTMLFormControlsCollection;

/** the organisation the list answers with, holding a mission. */
const ORGANISATION: NonprofitOrganisation = {
	ein: '12-3456789',
	name: 'Riverside Community Food Bank',
	address_line1: '400 Mill Road',
	city: 'Riverside',
	region: 'CA',
	postal_code: '92501',
	deductible: true,
	revokedOn: '',
	website: 'riversidefoodbank.org',
	mission: 'Food for every family in Riverside County.'
};

/** the fill as the fold makes it, where no fill has written a box yet, against the boxes now. */
function fill(form: HTMLFormControlsCollection): number {
	return putBoxes(form, foundBoxes(ORGANISATION, {}, heldBoxes(form, ['mission', 'city'])));
}

describe('the lookup’s fill, reaching the boxes', () => {
	it('puts the filing’s mission into the mission’s textarea and makes it say so', () => {
		vi.stubGlobal('HTMLInputElement', Input);
		vi.stubGlobal('HTMLTextAreaElement', TextArea);
		const mission = new TextArea();
		const form = controls({ mission, city: new Input() });

		fill(form);

		expect(mission.value).toBe('Food for every family in Riverside County.');
		expect(mission.said).toBe(1);
	});

	it('leaves a typed mission', () => {
		vi.stubGlobal('HTMLInputElement', Input);
		vi.stubGlobal('HTMLTextAreaElement', TextArea);
		const mission = new TextArea();
		const city = new Input();
		const form = controls({ mission, city });

		mission.value = 'Feeding Riverside.';
		fill(form);

		expect(mission.value).toBe('Feeding Riverside.');
		expect(mission.said).toBe(0);
		expect(city.value).toBe('Riverside');
	});

	it('reads a typed mission out of its textarea', () => {
		vi.stubGlobal('HTMLInputElement', Input);
		vi.stubGlobal('HTMLTextAreaElement', TextArea);
		const form = controls({ mission: new TextArea('Feeding Riverside.') });

		expect(heldBoxes(form, ['mission', 'vision'])).toEqual({
			mission: 'Feeding Riverside.',
			vision: ''
		});
	});

	it('puts nothing into a control that is not a box', () => {
		vi.stubGlobal('HTMLInputElement', Input);
		vi.stubGlobal('HTMLTextAreaElement', TextArea);
		const notABox = new Box();

		expect(putBoxes(controls({ mission: notABox }), { mission: 'x' })).toBe(0);
		expect(notABox.value).toBe('');
	});
});

describe('where focus goes once a number is locked in', () => {
	const LOCKED = { tax_id: '12-3456789' };

	it('is the first required box still empty, in the order the fold draws them', () => {
		expect(firstNeeded(LOCKED)).toBe('legal_name');
		expect(
			firstNeeded({ ...LOCKED, legal_name: 'Riverside Community Food Bank', city: 'Riverside' })
		).toBe('address_line1');
	});

	it('passes over a box marked optional', () => {
		expect(
			firstNeeded({
				...LOCKED,
				legal_name: 'Riverside Community Food Bank',
				address_line1: '400 Mill Road',
				city: 'Riverside',
				country: 'United States'
			})
		).toBe('mission');
	});

	it('is nothing, which is Save, where every required box holds something', () => {
		expect(
			firstNeeded({
				...LOCKED,
				legal_name: 'Riverside Community Food Bank',
				address_line1: '400 Mill Road',
				city: 'Riverside',
				country: 'United States',
				mission: 'Food for every family in Riverside County.'
			})
		).toBeNull();
	});
});
