import { describe, expect, it } from 'vitest';
import { shownName } from './shown-name';

// the name a public note is signed with on the donate page and on /admin/donations/messages:
// first name and last initial, or "Anonymous".

describe('shownName', () => {
	it('is the first name and the last initial', () => {
		expect(shownName({ firstName: 'Maya', lastName: 'Rivera' }, false)).toBe('Maya R.');
	});

	it('is Anonymous where the donor asked for it, whatever their name', () => {
		expect(shownName({ firstName: 'Maya', lastName: 'Rivera' }, true)).toBe('Anonymous');
	});

	it('is the first name alone where no last name was given', () => {
		expect(shownName({ firstName: 'Maya', lastName: null }, false)).toBe('Maya');
		expect(shownName({ firstName: 'Maya', lastName: '   ' }, false)).toBe('Maya');
	});

	it('is Anonymous where only a last name was given, so no surname is printed whole', () => {
		expect(shownName({ firstName: null, lastName: 'Rivera' }, false)).toBe('Anonymous');
		expect(shownName({ firstName: ' ', lastName: 'Rivera' }, false)).toBe('Anonymous');
	});

	it('is Anonymous where no name was given', () => {
		expect(shownName({ firstName: null, lastName: null }, false)).toBe('Anonymous');
	});

	it('prints only the first word of the first-name box, so a surname typed there is an initial', () => {
		expect(shownName({ firstName: 'Maya Rodriguez', lastName: null }, false)).toBe('Maya R.');
		expect(shownName({ firstName: 'Maya  de la Cruz', lastName: '' }, false)).toBe('Maya D.');
		expect(shownName({ firstName: 'Maya Rodriguez', lastName: 'Rivera' }, false)).toBe('Maya R.');
		expect(shownName({ firstName: 'Mary Ann', lastName: 'Smith' }, false)).toBe('Mary S.');
	});

	it('trims the first name and capitalises the initial', () => {
		expect(shownName({ firstName: '  maya ', lastName: ' rivera' }, false)).toBe('maya R.');
	});

	it('takes the whole first letter of a surname, not half of one', () => {
		expect(shownName({ firstName: 'Ana', lastName: 'Ölund' }, false)).toBe('Ana Ö.');
		expect(shownName({ firstName: 'Ana', lastName: '𝒜bbot' }, false)).toBe('Ana 𝒜.');
	});
});
