import { describe, expect, it } from 'vitest';
import { projectTribute } from './tributes';

// node pool, no database: the projection is a pure function over two columns, and the values it is
// given here are written by hand precisely so a case can hold a shape no writer in this app can
// produce — `donation.tribute_kind` carries no CHECK, and
// `$lib/server/db/donation-tribute.workers.spec.ts` is where that is asserted against real D1.

describe('the dedication projection', () => {
	it('states the kind and the person it names, as the two columns hold them', () => {
		expect(projectTribute('memory', 'Margaret Chen')).toEqual({
			kind: 'memory',
			honoree: 'Margaret Chen'
		});
	});

	it('states nothing for a kind outside the vocabulary', () => {
		// the column carries no CHECK and cannot be given one, so the database takes `'honour'` or
		// anything else. `parseTribute` in `$lib/server/donations/quote-input.ts` is the only writer
		// that holds it to the two, and a row that got in past it is a row with no sentence any
		// surface could state.
		expect(projectTribute('honour', 'Margaret Chen')).toBeNull();
	});

	it('states nothing for half a pair, whichever half is missing', () => {
		// a kind naming nobody and a name with no kind are both rows this table accepts and neither
		// is a state the form can produce.
		expect(projectTribute('memory', null)).toBeNull();
		expect(projectTribute(null, 'Margaret Chen')).toBeNull();
	});

	it('states nothing where the name is blank', () => {
		// a stored blank renders the sentence with its subject missing — `In memory of ` and then
		// nothing — which reads as a defect in the screen rather than in the row.
		expect(projectTribute('honor', '   ')).toBeNull();
	});

	it('states a gift carrying no dedication at all as none', () => {
		expect(projectTribute(null, null)).toBeNull();
	});
});
