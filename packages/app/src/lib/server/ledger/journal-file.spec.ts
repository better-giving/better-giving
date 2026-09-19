import { describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS, postableId } from '../db/accounts';
import type { EntryGroupListRow } from './queries';
import { journalFile } from './journal-file';

// the two files an accountant downloads, and nothing about how they are served.
//
// a pure spec in the node pool: the shaping takes entries it is handed and returns text, so
// nothing here touches D1 — the read that produces those entries is ./queries.workers.spec.ts's.
//
// the expected rows are written out as literals rather than assembled the way the module
// assembles them. each vendor's header is a contract their importer either accepts or rejects,
// so a spec that built the line from the same constant the source does would pass whatever the
// constant said.

/** one balanced correction, with whatever the case under test needs changed. */
const entry = (over: Partial<EntryGroupListRow> = {}): EntryGroupListRow => ({
	id: '019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9',
	sourceType: 'adjustment',
	sourceId: '019fb0d2-7d57-7c5e-a7df-baed1f27b405',
	currency: 'USD',
	occurredAt: new Date('2026-03-04T09:00:00.000Z'),
	createdAt: new Date('2026-03-05T09:00:00.000Z'),
	memo: 'Corrects a miskeyed cheque',
	lines: [
		{ id: 'line-1', accountId: postableId('bankCash'), amountMinor: 2_500 },
		{ id: 'line-2', accountId: postableId('donationsDeductible'), amountMinor: -2_500 }
	],
	...over
});

/** the file's rows, header included, as a reader of the csv sees them. */
const rowsOf = (csv: string): string[] => csv.split('\r\n');

/** the csv, or a failure naming the refusal the case did not expect. */
const csvOf = (target: 'quickbooks' | 'xero', groups: EntryGroupListRow[]): string => {
	const result = journalFile(target, groups);
	if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
	return result.csv;
};

describe('journalFile() for QuickBooks Online', () => {
	it('opens with the header its importer is mapped against', () => {
		expect(rowsOf(csvOf('quickbooks', [entry()]))[0]).toBe(
			'Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits'
		);
	});

	it('repeats one journal number across an entry’s rows and counts entries from one', () => {
		// the number is the file's own sequence and not the entry's uuid — thirty-six characters
		// into a field with no documented cap. every row of one entry carries the same number,
		// which is how the importer knows the rows are one journal.
		const csv = csvOf('quickbooks', [
			entry({ occurredAt: new Date('2026-03-04T09:00:00.000Z') }),
			entry({
				id: '019fb0b4-ec6e-7ff7-960c-a441e2c603d7',
				occurredAt: new Date('2026-03-05T09:00:00.000Z')
			})
		]);

		expect(
			rowsOf(csv)
				.slice(1)
				.map((row) => row.split(',')[0])
		).toEqual(['1', '1', '2', '2']);
	});
	it('puts a debit and a credit in their own columns, both positive, and names the account', () => {
		// the ledger stores one signed amount (`+` debit, `−` credit; ./posting.ts) and this
		// importer takes two columns with exactly one of them filled. a sign left on a credit, or
		// both cells filled, is a journal QuickBooks rejects or posts twice over.
		expect(rowsOf(csvOf('quickbooks', [entry()])).slice(1)).toEqual([
			'1,03/04/2026,Bank / Cash,Corrects a miskeyed cheque (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9),25.00,',
			'1,03/04/2026,Tax-Deductible Donations,Corrects a miskeyed cheque (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9),,25.00'
		]);
	});

	it('quotes a memo an operator typed a comma into', () => {
		// `memo` is free text. unquoted, one comma shifts every column after it — the amounts land
		// in the wrong columns and the file still imports.
		const csv = csvOf('quickbooks', [entry({ memo: 'Cheque 41, re-keyed' })]);
		expect(rowsOf(csv)[1]).toContain(
			'"Cheque 41, re-keyed (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9)"'
		);
	});

	it('refuses a range past its row cap, naming the count and the cap', () => {
		// never truncated and never split: rows dropped without being reported are books that do
		// not balance in QuickBooks, and one range across two files is one entry under two journal
		// numbers.
		//
		// the cap is data rows and the figure it reports is data rows, with the header counted
		// against Intuit's thousand inside the constant rather than out here.
		const many = Array.from({ length: 500 }, () => entry());
		expect(journalFile('quickbooks', many)).toEqual({
			ok: false,
			refusal: { reason: 'too_many_rows', rows: 1_000, cap: 998 }
		});
		// 499 entries is 998 lines — the cap exactly, and the file it writes is 999 rows with its
		// header, which is the number Intuit bounds.
		const atTheCap = journalFile('quickbooks', many.slice(0, 499));
		expect(atTheCap.ok && atTheCap.csv.split('\r\n')).toHaveLength(999);
	});
});

describe('journalFile() for Xero', () => {
	it('opens with the manual-journal template’s header, exactly', () => {
		// exactly, because Xero matches on the heading text: a renamed column fails the import
		// outright rather than arriving empty.
		expect(rowsOf(csvOf('xero', [entry()]))[0]).toBe(
			'Narration,Date,Description,AccountCode,TaxRate,Amount'
		);
	});

	it('dates and narrates an entry’s first row only, leaving its continuation rows blank', () => {
		// the blank is the grouping: Xero reads a row with no date as belonging to the journal
		// above it. repeating the date the way QuickBooks needs turns one balanced correction into
		// two unbalanced journals.
		//
		// the amount is the signed column the ledger already stores, the account is the code and
		// never the name, and `TaxRate` is empty — Xero takes the file and refuses to post the
		// journal until the operator sets a rate there, which nothing in these books carries.
		expect(rowsOf(csvOf('xero', [entry()])).slice(1)).toEqual([
			'Corrects a miskeyed cheque,03/04/2026,Corrects a miskeyed cheque (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9),1010,,25.00',
			',,Corrects a miskeyed cheque (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9),4110,,-25.00'
		]);
	});

	it('refuses a range past its own cap, which is not QuickBooks’', () => {
		const many = Array.from({ length: 151 }, () => entry());
		expect(journalFile('xero', many)).toEqual({
			ok: false,
			refusal: { reason: 'too_many_rows', rows: 302, cap: 300 }
		});
		expect(journalFile('xero', many.slice(0, 150)).ok).toBe(true);
		// and the same range QuickBooks takes without complaint.
		expect(journalFile('quickbooks', many).ok).toBe(true);
	});
});

describe('journalFile(), whichever target', () => {
	it('falls back to what an entry was posted because of where it carries no memo', () => {
		// `entry_group.memo` is nullable and an empty narration is an error in Xero, so no row may
		// carry one. the fallback is the word /admin/books draws over the same entry, with the id
		// of the record that caused it.
		const none = entry({ memo: null, sourceType: 'payment', sourceId: 'pay-991' });

		expect(rowsOf(csvOf('quickbooks', [none]))[1]).toContain(
			'Gift settled pay-991 (019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9)'
		);
		expect(rowsOf(csvOf('xero', [none]))[1]).toMatch(/^Gift settled pay-991,03\/04\/2026,/);
	});

	it('refuses a range holding two currencies, naming both', () => {
		// no template carries a currency column and Xero takes base currency only, so a euro
		// amount imports as whatever the company's own currency is, silently.
		expect(journalFile('xero', [entry(), entry({ currency: 'EUR' })])).toEqual({
			ok: false,
			refusal: { reason: 'mixed_currency', currencies: ['EUR', 'USD'] }
		});
	});

	it('shapes a range holding nothing into a header row and no data rows', () => {
		// an ordinary answer rather than an error: a month with no gifts in it imports as zero
		// journals, and a refusal here would read as a broken download.
		expect(csvOf('quickbooks', [])).toBe(
			'Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits'
		);
		expect(csvOf('xero', [])).toBe('Narration,Date,Description,AccountCode,TaxRate,Amount');
	});

	it('converts minor units exactly at a magnitude where dividing by a hundred stops being', () => {
		// `8146238794341726 / 100` is `81462387943417.27` once it has been through a double, and
		// the exact answer is `.26`. no set of books reaches that figure, and the integer form
		// costs nothing — what this holds is that the conversion never became a division.
		const huge = entry({
			lines: [
				{ id: 'line-1', accountId: postableId('bankCash'), amountMinor: 8_146_238_794_341_726 },
				{
					id: 'line-2',
					accountId: postableId('donationsDeductible'),
					amountMinor: -8_146_238_794_341_726
				}
			]
		});

		expect(
			rowsOf(csvOf('xero', [huge]))
				.slice(1)
				.map((row) => row.split(',')[5])
		).toEqual(['81462387943417.26', '-81462387943417.26']);
		expect(
			rowsOf(csvOf('quickbooks', [huge]))
				.slice(1)
				.map((row) => row.split(','))
		).toEqual([
			expect.arrayContaining(['81462387943417.26']),
			expect.arrayContaining(['81462387943417.26'])
		]);
	});

	it('reads the minor-unit width off the currency, so a yen figure is not a hundredth of itself', () => {
		// JPY has no minor unit at all, so `amount_minor` already *is* the figure — divided by a
		// hundred, a ¥2,500 gift exports as ¥25. neither template carries a currency column, so
		// nothing downstream can notice: it imports clean and posts wrong.
		const yen = entry({
			currency: 'JPY',
			lines: [
				{ id: 'line-1', accountId: postableId('bankCash'), amountMinor: 2_500 },
				{ id: 'line-2', accountId: postableId('donationsDeductible'), amountMinor: -2_500 }
			]
		});

		// no decimal point either — `2500.` is not a figure.
		expect(
			rowsOf(csvOf('xero', [yen]))
				.slice(1)
				.map((row) => row.split(',')[5])
		).toEqual(['2500', '-2500']);
		expect(
			rowsOf(csvOf('quickbooks', [yen]))
				.slice(1)
				.map((row) => row.split(',').slice(-2))
		).toEqual([
			['2500', ''],
			['', '2500']
		]);

		// and the same stored figure in USD is still two decimals and a hundredth of the size.
		expect(
			rowsOf(csvOf('xero', [entry()]))
				.slice(1)
				.map((row) => row.split(',')[5])
		).toEqual(['25.00', '-25.00']);
	});

	it('names an account by name for QuickBooks and by code for Xero, never the other way', () => {
		// QuickBooks matches the account by its name and Xero by its code; each file carrying the
		// other's identifier imports as an unmatched account rather than failing.
		const both = entry();
		expect(csvOf('quickbooks', [both])).toContain(POSTING_ACCOUNTS.bankCash.name);
		expect(csvOf('quickbooks', [both])).not.toContain(`,${POSTING_ACCOUNTS.bankCash.code},`);
		expect(csvOf('xero', [both])).toContain(`,${POSTING_ACCOUNTS.bankCash.code},`);
		expect(csvOf('xero', [both])).not.toContain(POSTING_ACCOUNTS.bankCash.name);
	});
});
