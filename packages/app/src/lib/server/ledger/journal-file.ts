import { minorUnitDigits } from '../../donations/money';
import { ENTRY_SOURCE_LABELS } from '../../ledger/sources';
import { pickableAccounts } from '../db/accounts';
import type { EntryGroupListRow, EntryGroupRange } from './queries';

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
 * why a range produced no file.
 *
 * a refusal and never a truncation or a split: an export missing rows nobody was told about is a
 * set of books that does not balance in the target, and a range silently cut in two is the same
 * entry arriving under two journal numbers.
 *
 * the range's own size is not among them and cannot be: the read is bounded at the cap and stops
 * one line past it (./queries.ts), so no total exists to report. what an operator does about
 * either refusal is narrow the range, and the cap says how far on its own.
 */
export type JournalFileRefusal =
	| {
			readonly reason: 'too_many_rows';
			/** the most data rows the target accepts in one file — one per ledger line. */
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
 * the most data rows `target` takes in one file, as the bound its read is given.
 *
 * the cap leaves this module because the read is what applies it now: shaping never sees a range
 * past it, so nothing here can count one. `readEntryGroupsInRange` in ./queries.ts takes this and
 * reads one line past it, and `journalFile` below turns that into the refusal.
 */
export function journalRowCap(target: JournalTarget): number {
	return ROW_CAPS[target];
}

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
 * text a person typed, kept from running as a formula when the file is opened in a spreadsheet.
 *
 * a cell opening with `=`, `+`, `-`, `@`, a tab or a carriage return is evaluated rather than
 * shown by Excel, Sheets and LibreOffice, and the accountant opens this file as often as they
 * import it. the leading apostrophe is what all three read as "the rest of this is text".
 *
 * **it is not part of `cell` below, and must not become part of it.** Xero's amount column is one
 * signed figure, where a credit legitimately opens with a minus — an apostrophe there is a figure
 * Xero cannot read, so the guard that protects a note would corrupt every credit in the file. the
 * cells this is for are the ones built out of `memo`: QuickBooks' `Journal/Description`, and
 * Xero's `Narration` and `Description`.
 */
function freeText(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * the words an entry is filed under, as a cell a spreadsheet will not evaluate.
 *
 * `memo` is nullable and an empty narration is an error in Xero, so a missing one falls back to
 * what the entry was posted because of rather than to a blank. the label is the same word
 * /admin/books draws over the entry, so the file and the screen name it the same way.
 *
 * the guard sits here because this is where an operator's own words enter the file — every cell
 * carrying them is built from this one.
 */
function narrative(group: EntryGroupListRow): string {
	return freeText(group.memo ?? `${ENTRY_SOURCE_LABELS[group.sourceType]} ${group.sourceId}`);
}

/**
 * the narrative with the entry's own id after it.
 *
 * the id rides here because it is the only column with room for the whole thirty-six characters:
 * QuickBooks' journal number takes the first twenty-one of them (`journalNo` below) and Xero has
 * no journal-number column at all. without it a row in the target cannot be traced back to the
 * entry group it came from.
 *
 * it opens with the narrative, so the spreadsheet guard that value carries covers this cell too.
 */
function description(group: EntryGroupListRow): string {
	return `${narrative(group)} (${group.id})`;
}

/**
 * the number QuickBooks groups an entry's rows under: the entry's own id, cut to the field.
 *
 * **off the entry and never off its place in the file.** a range is what an operator picks, so a
 * number counting position gives one entry two numbers across two overlapping ranges and two
 * entries one number — inside the column the importer groups rows by. off the id it means the
 * same thing in every file, and a second import of an entry arrives under a number the company's
 * books already carry, which is the only sign of one there is: nothing records what a range
 * handed out.
 *
 * twenty-one characters because that is the field it lands in — `DocNumber`, "a string of up to
 * 21 characters"
 * (https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions). the
 * cut falls two characters into the id's fourth group rather than on the dash before it: past the
 * timestamp those characters are what tell two entries minted in the same millisecond apart, and
 * the whole id rides in the description column beside this either way.
 */
function journalNo(group: EntryGroupListRow): string {
	return group.id.slice(0, 21);
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

/**
 * CRLF, which is what RFC 4180 specifies and both importers read.
 *
 * it *terminates* a row rather than separating two, the last row included: a final record running
 * into the end of the file is one a reader may take short, and the row it would drop is a ledger
 * line.
 *
 * nothing precedes the first row — no byte-order mark. neither importer documents whether it
 * accepts one, and Xero matches its header text exactly (the module header above), so a mark
 * riding on `Narration` is the whole import failing rather than one cell reading oddly. the
 * charset reaches a reader over the response instead, in the route's `content-type`
 * (`src/routes/_app.admin.donations.export_.journal.ts`).
 */
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
	return groups.flatMap((group) => {
		const number = journalNo(group);
		const date = usDate(group.occurredAt);
		const text = description(group);
		return group.lines.map((line) => [
			number,
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
 * an empty range is not one of them: this returns the header row and nothing under it, which is a
 * file that imports as zero journals. what an operator gets for such a range is the route's
 * decision and not this one — `src/routes/_app.admin.donations.export_.journal.ts` refuses it by
 * name rather than handing over a file that answers nothing about the range they asked about.
 */
export function journalFile(target: JournalTarget, range: EntryGroupRange): JournalFileResult {
	// first of the two, because a read that stopped at the bound read part of a period: the
	// currencies below would be the truncated range's rather than the range's, and a file refused
	// for a second currency nobody can find is worse than one refused for its size.
	if (range.overCap)
		return { ok: false, refusal: { reason: 'too_many_rows', cap: ROW_CAPS[target] } };

	const groups = range.groups;
	const currencies = [...new Set(groups.map((group) => group.currency))].sort();
	// no template has a currency column and Xero takes base currency only, so there is nowhere for
	// a second currency to go — the amounts would silently be read as the company's own.
	if (currencies.length > 1)
		return { ok: false, refusal: { reason: 'mixed_currency', currencies } };

	// one currency per file, the refusal above having settled that, so the minor-unit width is read
	// once here rather than per line. an empty range names no currency and has no amount for a
	// width to apply to.
	const [currency] = currencies;
	const digits = currency === undefined ? 0 : minorUnitDigits(currency);

	const shape = SHAPES[target];
	const lines = [shape.header, ...shape.rows(groups, digits)];
	return {
		ok: true,
		csv: lines.map((row) => `${row.map(cell).join(',')}${ROW_SEPARATOR}`).join('')
	};
}
