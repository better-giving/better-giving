import { describe, expect, it } from 'vitest';
import { refusalStanding } from './refusal-standing';

// which of a refused press's sentences still stand once the operator has typed somewhere.
//
// pure values: this package has no DOM pool (../../vite.config.ts), so ./use-console-form.ts draws
// from this reading and the reading is what is held here.

const KEY = 'chariot:apiKey';
const ADDRESS = 'chariot:address';
const PAIR = [KEY, ADDRESS];

describe('a refusal about two boxes together', () => {
	it('stands over both boxes until either is typed in', () => {
		const read = refusalStanding({ named: [KEY], fixed: [], together: PAIR });
		expect(read.unfixed).toEqual([KEY]);
		expect(read.listening).toEqual([KEY, ADDRESS]);
	});

	// the key turned down at this address is fixed as well by a new address as by a new key.
	it('goes when the box it is not keyed to is typed in, and lets the next press through', () => {
		const read = refusalStanding({ named: [KEY], fixed: [ADDRESS], together: PAIR });
		expect(read.unfixed).toEqual([]);
		expect(read.listening).toEqual([]);
	});

	it('goes when the box it is keyed to is typed in', () => {
		expect(refusalStanding({ named: [KEY], fixed: [KEY], together: PAIR }).unfixed).toEqual([]);
	});
});

describe('a refusal naming each box on its own', () => {
	it('still stands over a box when a different box is typed in', () => {
		const read = refusalStanding({ named: [KEY], fixed: [ADDRESS], together: [] });
		expect(read.unfixed).toEqual([KEY]);
		expect(read.listening).toEqual([KEY]);
	});

	it('goes one box at a time', () => {
		const read = refusalStanding({ named: [KEY, ADDRESS], fixed: [ADDRESS], together: [] });
		expect(read.unfixed).toEqual([KEY]);
	});
});
