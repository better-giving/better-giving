// a saved pledge as the form reads it: whether a save's answer is one a screen may draw, the rows its
// screens list, and the instructions a donor emails themselves.
//
// no DOM and no flow: ./checkout.machine.ts guards on `pledgeIsUsable`, and ./views.ts draws the rows
// below and links `instructionsMailto` from the pending screen. the rows are stated once, so the
// screen and the email a donor sends themselves list the same words in the same order.

import type { Pledge } from './v1';
import type { PledgeRail } from './embed/rails';

/**
 * one line of a pledge's lists: what it is, and its value as drawn.
 *
 * `copy` is the noun of the control that copies the value (`Copy {copy}`), absent on a value no donor
 * hands on character by character. `mono` sets a value a donor checks character by character — a code
 * or a number — in the monospace face.
 */
export type PledgeRow = {
	readonly label: string;
	readonly value: string;
	readonly copy?: string;
	readonly mono?: true;
};

/** what was pledged: the shares of a ticker, or the amount and the custodian sending it. */
export function pledgeSummary(pledge: Pledge, money: (minor: number) => string): PledgeRow[] {
	return pledge.method === 'stock'
		? [
				{ label: 'Shares', value: pledge.shares },
				{ label: 'Ticker', value: pledge.ticker }
			]
		: [
				{ label: 'Amount', value: money(pledge.amountMinor) },
				{ label: 'Custodian', value: pledge.custodian }
			];
}

/**
 * where the gift is sent, as the organisation saved it, and the reference that matches it to the
 * donor. a saved mailing address is one line per line (`Pledge` in ./v1.ts) and is drawn on one,
 * since the value's whitespace collapses.
 */
export function pledgeDetails(pledge: Pledge): PledgeRow[] {
	const reference: PledgeRow = {
		label: 'Reference',
		value: pledge.reference,
		copy: 'reference',
		mono: true
	};
	return pledge.method === 'stock'
		? [
				{ label: 'Deliver to', value: pledge.deliverTo },
				{ label: 'DTC number', value: pledge.dtcNumber, copy: 'DTC number', mono: true },
				{
					label: 'Account number',
					value: pledge.accountNumber,
					copy: 'account number',
					mono: true
				},
				{ label: 'Account name', value: pledge.accountName },
				reference
			]
		: [
				{ label: 'Payee name', value: pledge.payeeName },
				{ label: 'EIN', value: pledge.ein, copy: 'EIN', mono: true },
				{
					label: 'Mailing address',
					value: pledge.mailingAddress
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line !== '')
						.join(', '),
					copy: 'mailing address'
				},
				reference
			];
}

/**
 * the "Email these instructions" link: a `mailto:` with no recipient, so the donor's own mail client
 * opens addressed to whoever they choose — their broker, their custodian or themselves.
 *
 * built in the browser from the pledge the screen holds, and sent by nobody: the deployment mails no
 * instructions, and an address typed into a box here would be one more value this form asked for.
 * the subject names the organisation and the reference; the body is the screen's two lists in the
 * screen's order, a blank line between them, each line `{label}: {value}` with CRLF between lines as
 * RFC 6068 has a body's line breaks.
 */
export function instructionsMailto(
	pledge: Pledge,
	org: string,
	money: (minor: number) => string
): string {
	const kind = pledge.method === 'stock' ? 'Stock' : 'IRA (QCD)';
	const subject = `${kind} gift to ${org}, reference ${pledge.reference}`;
	const line = (row: PledgeRow) => `${row.label}: ${row.value}`;
	const body = [
		...pledgeSummary(pledge, money).map(line),
		'',
		...pledgeDetails(pledge).map(line)
	].join('\r\n');
	return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** a string a screen can draw as a value: present, and not blank. */
function filled(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * whether `value` is the pledge a save under `id` on `method` answered with, whole.
 *
 * the answer is untrusted json off a deployment, and every field here is a value the pending screen
 * shows and a donor hands to their broker or custodian. a pledge missing one would draw an empty row
 * a donor copies, so the answer is refused instead. the id and the rail are matched to the save:
 * a pledge answered for another id or rail is not the one this donor pledged. `receiptTo` alone may
 * be blank: the endpoint answers `''` for a pledge with no address on file, and it is no row a donor
 * copies — the thank-you leaves the receipt out instead (`pledgedScreen` in ./views.ts).
 */
export function pledgeIsUsable(value: unknown, method: PledgeRail, id: string): value is Pledge {
	if (typeof value !== 'object' || value === null) return false;
	const pledge = value as Record<string, unknown>;
	if (pledge.id !== id || pledge.method !== method) return false;
	if (!filled(pledge.reference) || typeof pledge.receiptTo !== 'string') return false;
	if (method === 'stock') {
		return [
			pledge.ticker,
			pledge.shares,
			pledge.deliverTo,
			pledge.dtcNumber,
			pledge.accountNumber,
			pledge.accountName
		].every(filled);
	}
	return (
		Number.isSafeInteger(pledge.amountMinor) &&
		(pledge.amountMinor as number) > 0 &&
		[pledge.custodian, pledge.payeeName, pledge.ein, pledge.mailingAddress].every(filled)
	);
}
