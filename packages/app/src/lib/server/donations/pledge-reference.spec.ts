import { describe, expect, it } from 'vitest';
import { mintPledgeReference, orgInitials, REFERENCE_ALPHABET } from './pledge-reference';

// node pool: a reference is a pure function of the legal name, the pledge and four random picks.

describe('orgInitials', () => {
	it('takes each word’s first letter and leaves a company suffix out', () => {
		expect(orgInitials('Cedar Fork Community Pantry Inc.')).toBe('CFCP');
		expect(orgInitials('Hope Foundation')).toBe('HF');
		expect(orgInitials('the friends of élan, LLC')).toBe('TFOE');
	});

	it('stops at four letters', () => {
		expect(orgInitials('North River Valley Food Bank Alliance')).toBe('NRVF');
	});

	it('falls back to GIFT where the name has no letter to take', () => {
		expect(orgInitials('123 · 456')).toBe('GIFT');
	});
});

describe('mintPledgeReference', () => {
	it('names the ticker or IRA between the initials and four characters with no lookalikes', () => {
		const stock = mintPledgeReference('CFCP', { method: 'stock', ticker: 'AAPL' });
		const ira = mintPledgeReference('CFCP', { method: 'ira_qcd' });
		expect(stock).toMatch(/^CFCP-AAPL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
		expect(ira).toMatch(/^CFCP-IRA-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
	});

	it('has no 0, 1, I, L or O to misread', () => {
		expect(REFERENCE_ALPHABET).not.toMatch(/[01ILO]/);
	});
});
