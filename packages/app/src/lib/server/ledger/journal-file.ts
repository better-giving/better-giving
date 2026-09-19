import { minorUnitDigits } from '../../donations/money';
import { ENTRY_SOURCE_LABELS } from '../../ledger/sources';
import { pickableAccounts } from '../db/accounts';
import type { EntryGroupListRow } from './queries';

// the accountant's download: the entries a range holds, shaped into a file one accounting
// package will import. it reads entries and returns text — no database, no request, no response
// headers — so ./queries.ts stays the only module here that names a table.
//
// two files and not one, one per target, because a single csv cannot satisfy both importers:
// QuickBooks splits an amount across a debit column and a credit column while Xero takes one
// signed column, Xero identifies an account by code where QuickBooks takes the name, and Xero
// marks where one journal ends by leaving the next row's date and narration blank. each of those
// alone makes the other file unimportable. Aplos is not a third target here and nothing is built
// toward one: it takes a spreadsheet rather than a csv and wants a fund on every line, which
// these books do not carry.
//
// the header rows below are contracts of different strengths, which is why they are written out
// rather than derived. Xero's must match its manual-journal template exactly — a changed heading
// fails the import. QuickBooks' importer maps columns by hand at import time and ignores what the
// header says, so drift there is survivable; it is spelled correctly anyway because the operator
// reads it while mapping.

/** which accounting package the file is shaped for. */
export const JOURNAL_TARGETS = ['quickbooks', 'xero'] as const;
export type JournalTarget = (typeof JOURNAL_TARGETS)[number];

/**
 * why a range produced no file, with the number that caused it.
 *
 * a refusal and never a truncation or a split: an export missing rows nobody was told about is a
 * set of books that does not balance in the target, and a range silently cut in two is the same
 * entry arriving under two journal numbers. the screen words these; the figures are here so it
 * can name what the operator has to narrow.
 */
export type JournalFileRefusal =
	| {
			readonly reason: 'too_many_rows';
			/** data rows the range would produce — one per ledger line. */
			readonly rows: number;
			/** the most the target accepts in one file. */
			readonly cap: number;
	  }
	| {
			readonly reason: 'mixed_currency';
			/** every currency the range holds, alphabetical. */
			readonly currencies: string[];
	  };

export type JournalFileResult =
	| { readonly ok: true; readonly csv: string }
	| { readonly ok: false; readonly refusal: JournalFileRefusal };

/**
 * the most data rows each target takes in one file.
 *
 * Xero documents three hundred lines per manual-journal import. QuickBooks documents "fewer than
 * 1,000 rows", and it bounds the *spreadsheet* — **the header row is counted against the
 * thousand**, which is why this is 998 and not 999 or 1,000. the two rows are not there to be
 * reclaimed by a reader who reads the figure as a data-row count.
 *
 * both are counted in ledger lines rather than in entries, because every line is one row in both
 * files.
 */
const ROW_CAPS: Record<JournalTarget, number> = {
	quickbooks: 998,
	xero: 300
};

/**
 * the account a line names, by the id `ledger_entry.account_id` carries.
 *
 * off `pickableAccounts()` rather than over `POSTING_ACCOUNTS` again: it is already the accessor
 * that hands out a code and a name per postable account, and a second walk of the map here is a
 * second place an account added by a migration has to be remembered.
 */
const ACCOUNTS_BY_ID = new Map(
	pickableAccounts().map((account) => [account.id as string, account])
);

/**
 * `mm/dd/yyyy` in UTC.
 *
 * one format for both files: QuickBooks picks its date format at import and Xero's US format
 * accepts this one. UTC because that is what `occurred_at` is stored as — reading it in the
 * worker's local zone would move a gift made just before midnight into the previous day, and the
 * books are the same books wherever the download was pressed.
 */
function usDate(at: Date): string {
	const month = String(at.getUTCMonth() + 1).padStart(2, '0');
	const day = String(at.getUTCDate()).padStart(2, '0');
	return `${month}/${day}/${at.getUTCFullYear()}`;
}

/**
 * a signed minor amount as major units, at `digits` decimal places — `-2500` → `-25.00` at two,
 * and → `-2500` at none.
 *
 * **the width comes off the currency and never from a constant hundred.** JPY has no minor unit
 * and KWD has three, so a fixed divisor exports a ¥2,500 gift as ¥25 — and neither template
 * carries a currency column, so the importer has nothing to notice it with and the figure posts.
 * `minorUnitDigits` in ../../donations/money.ts is where that width is read, the same one a screen
 * shows the same gift at.
 *
 * built out of integers and never `amount / scale`. the division is exact for every amount either
 * of these books will ever hold, and stops being exact at magnitudes approaching the safe-integer
 * limit — where it is out by a cent with nothing in the file looking odd. the integer form costs
 * nothing and has no such edge.
 */
function majorUnits(amountMinor: number, digits: number): string {
	const sign = amountMinor < 0 ? '-' : '';
	const abs = Math.abs(amountMinor);
	const scale = 10 ** digits;
	const minor = abs % scale;
	const whole = (abs - minor) / scale;
	// a currency with no minor unit has no decimal point either — `2500.` is not a figure.
	return digits === 0
		? `${sign}${whole}`
		: `${sign}${whole}.${String(minor).padStart(digits, '0')}`;
}

/**
 * the words an entry is filed under.
 *
 * `memo` is nullable and an empty narration is an error in Xero, so a missing one falls back to
 * what the entry was posted because of rather than to a blank. the label is the same word
 * /admin/books draws over the entry, so the file and the screen name it the same way.
 */
function narrative(group: EntryGroupListRow): string {
	return group.memo ?? `${ENTRY_SOURCE_LABELS[group.sourceType]} ${group.sourceId}`;
}

/**
 * the narrative with the entry's own id after it.
 *
 * the id rides here because neither file has room for it anywhere else: QuickBooks' journal
 * number is the file's own sequence (a uuid is thirty-six characters into a field with no
 * documented cap) and Xero has no journal-number column at all. without it a row in the target
 * cannot be traced back to the entry group it came from.
 */
function description(group: EntryGroupListRow): string {
	return `${narrative(group)} (${group.id})`;
}

// how each target identifies an account: QuickBooks matches on the name, Xero on the code. each
// file carrying the other's identifier imports as an unmatched account rather than failing.
//
// the fallback is unreachable — `ledger_entry`'s composite foreign key refuses a line naming
// anything but an `is_postable = 1` account, and ../db/accounts.workers.spec.ts asserts that set is
// exactly the seeded map. it hands back the id rather than a blank because an id fails the import
// loudly in the target, where a blank posts the line to whatever the importer defaults to.

function accountName(accountId: string): string {
	return ACCOUNTS_BY_ID.get(accountId)?.name ?? accountId;
}

function accountCode(accountId: string): string {
	return ACCOUNTS_BY_ID.get(accountId)?.code ?? accountId;
}

/**
 * one cell, quoted where the value would otherwise break the row.
 *
 * RFC 4180: a comma, a quote or a newline inside a value needs the whole value in quotes and
 * every inner quote doubled. `memo` is text an operator typed, so all three are reachable — a
 * memo with a comma in it silently shifts every column after it.
 */
function cell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CRLF, which is what RFC 4180 specifies and both importers read. */
const ROW_SEPARATOR = '\r\n';

const QUICKBOOKS_HEADER = [
	'Journal No.',
	'Journal Date',
	'Account Name',
	'Journal/Description',
	'Debits',
	'Credits'
];

/**
 * QuickBooks Online's journal import.
 *
 * the amount is split across two columns, both positive, with exactly one of them filled per row
 * — which is where the ledger's signed convention (`+` debit, `−` credit; ./posting.ts) is
 * translated and the only place in this file it is.
 *
 * every row of one entry repeats the journal number, the date and the description; QuickBooks
 * groups rows by that number, so blanking the continuation rows the way Xero requires would split
 * one entry into several journals here.
 */
function quickbooksRows(groups: readonly EntryGroupListRow[], digits: number): string[][] {
	return groups.flatMap((group, index) => {
		const journalNo = String(index + 1);
		const date = usDate(group.occurredAt);
		const text = description(group);
		return group.lines.map((line) => [
			journalNo,
			date,
			accountName(line.accountId),
			text,
			line.amountMinor > 0 ? majorUnits(line.amountMinor, digits) : '',
			line.amountMinor < 0 ? majorUnits(-line.amountMinor, digits) : ''
		]);
	});
}

const XERO_HEADER = ['Narration', 'Date', 'Description', 'AccountCode', 'TaxRate', 'Amount'];

/**
 * Xero's manual-journal import.
 *
 * an entry's first row carries the date and the narration and every row after it leaves both
 * blank — that blank is how Xero knows a row belongs to the journal above rather than opening a
 * new one, so filling them in the way QuickBooks needs would turn a two-line correction into two
 * unbalanced journals.
 *
 * the amount is one signed column with debit positive and credit negative, which is what
 * `amount_minor` already is — no translation.
 *
 * `TaxRate` ships empty. Xero accepts the file that way and then refuses to *post* the journal
 * until a rate is set, which the operator does in Xero: nothing in these books carries one, and a
 * rate invented here would be a tax position this app is not entitled to take.
 */
function xeroRows(groups: readonly EntryGroupListRow[], digits: number): string[][] {
	return groups.flatMap((group) => {
		const narration = narrative(group);
		const date = usDate(group.occurredAt);
		const text = description(group);
		return group.lines.map((line, lineIndex) => [
			lineIndex === 0 ? narration : '',
			lineIndex === 0 ? date : '',
			text,
			accountCode(line.accountId),
			'',
			majorUnits(line.amountMinor, digits)
		]);
	});
}

const SHAPES: Record<
	JournalTarget,
	{ header: string[]; rows: (g: readonly EntryGroupListRow[], digits: number) => string[][] }
> = {
	quickbooks: { header: QUICKBOOKS_HEADER, rows: quickbooksRows },
	xero: { header: XERO_HEADER, rows: xeroRows }
};

/**
 * the entries of a range as one importable file, or the refusal that stopped it.
 *
 * the two refusals are checked before anything is shaped, so a range that cannot produce a usable
 * file produces no text at all rather than text the operator has to be told not to import.
 *
 * an empty range is not one of them: it returns the header row and nothing under it. a range an
 * organisation took no gifts in is an ordinary answer, and a file saying so imports as zero
 * journals — an error there would read as a broken download.
 */
export function journalFile(
	target: JournalTarget,
	groups: readonly EntryGroupListRow[]
): JournalFileResult {
	const currencies = [...new Set(groups.map((group) => group.currency))].sort();
	// no template has a currency column and Xero takes base currency only, so there is nowhere for
	// a second currency to go — the amounts would silently be read as the company's own.
	if (currencies.length > 1)
		return { ok: false, refusal: { reason: 'mixed_currency', currencies } };

	const rows = groups.reduce((total, group) => total + group.lines.length, 0);
	const cap = ROW_CAPS[target];
	if (rows > cap) return { ok: false, refusal: { reason: 'too_many_rows', rows, cap } };

	// one currency per file, the refusal above having settled that, so the minor-unit width is read
	// once here rather than per line. an empty range names no currency and has no amount for a
	// width to apply to.
	const [currency] = currencies;
	const digits = currency === undefined ? 0 : minorUnitDigits(currency);

	const shape = SHAPES[target];
	const lines = [shape.header, ...shape.rows(groups, digits)];
	return { ok: true, csv: lines.map((row) => row.map(cell).join(',')).join(ROW_SEPARATOR) };
}
