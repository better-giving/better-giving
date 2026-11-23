import type { Pledge } from '@better-giving/form/v1';
import * as copy from './copy';

// a saved pledge's rows and the instructions a donor emails themselves, for this page's card.
//
// the element states the same in packages/form/src/pledge.ts, which the form package's `exports`
// map does not name, so this page holds its own copy, as ./copy.ts holds its own words. the two
// must say the same thing row for row and character for character in the mailto, and
// ./pledge.spec.ts pins this one to the output packages/form/src/pledge.spec.ts pins there.

/**
 * one line of a pledge's lists: what it is, and its value as drawn.
 *
 * `copy` is the noun of the control that copies the value (`Copy {copy}`), absent on a value no donor
 * hands on. `mono` sets a value a donor checks character by character in the monospace face.
 */
export type PledgeRow = {
	readonly label: string;
	readonly value: string;
	readonly copy?: string;
	readonly mono?: true;
};

const L = copy.PLEDGE_LABELS;

/** what was pledged: the shares of a ticker, or the amount and the custodian sending it. */
export function pledgeSummary(pledge: Pledge, money: (minor: number) => string): PledgeRow[] {
	return pledge.method === 'stock'
		? [
				{ label: L.shares, value: pledge.shares },
				{ label: L.ticker, value: pledge.ticker }
			]
		: [
				{ label: L.amount, value: money(pledge.amountMinor) },
				{ label: L.custodian, value: pledge.custodian }
			];
}

/**
 * where the gift is sent, as the organisation saved it, and the reference that matches it to the
 * donor. a saved mailing address is one line per line (`Pledge` in @better-giving/form/v1) and is
 * drawn on one.
 */
export function pledgeDetails(pledge: Pledge): PledgeRow[] {
	const reference: PledgeRow = {
		label: L.reference,
		value: pledge.reference,
		copy: 'reference',
		mono: true
	};
	return pledge.method === 'stock'
		? [
				{ label: L.deliverTo, value: pledge.deliverTo },
				{ label: L.dtcNumber, value: pledge.dtcNumber, copy: 'DTC number', mono: true },
				{ label: L.accountNumber, value: pledge.accountNumber, copy: 'account number', mono: true },
				{ label: L.accountName, value: pledge.accountName },
				reference
			]
		: [
				{ label: L.payeeName, value: pledge.payeeName },
				{ label: L.ein, value: pledge.ein, copy: 'EIN', mono: true },
				{
					label: L.mailingAddress,
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
 * opens addressed to whoever they choose. the deployment mails no instructions.
 *
 * the subject names the organisation and the reference; the body is the screen's two lists in the
 * screen's order, a blank line between them, each line `{label}: {value}`, with CRLF between lines as
 * RFC 6068 has a body's line breaks.
 */
export function instructionsMailto(
	pledge: Pledge,
	org: string,
	money: (minor: number) => string
): string {
	const subject = copy.instructionsSubject(pledge.method === 'stock', org, pledge.reference);
	const line = (row: PledgeRow) => `${row.label}: ${row.value}`;
	const body = [
		...pledgeSummary(pledge, money).map(line),
		'',
		...pledgeDetails(pledge).map(line)
	].join('\r\n');
	return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
