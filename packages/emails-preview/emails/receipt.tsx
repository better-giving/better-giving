import { receipt } from '@better-giving/emails';

// the donor's receipt, at its fullest: a quid pro quo gift over §6115's $75 threshold, so the
// disclosure block prints, given in memory of somebody and recorded against a cause, so the two
// rows under the required four print too. the cases that drop something — an unnamed donor, a gift
// given for nobody, a gift against no cause, an address with no region or postcode — are in
// packages/emails/src/templates/receipt.spec.tsx, which asserts them; this is the one that shows
// every part at once.
export default function Receipt() {
	return receipt.template({
		org: {
			legalName: 'Hope Foundation',
			taxId: '12-3456789',
			addressLine1: '1 Charity Way',
			addressLine2: null,
			city: 'Springfield',
			region: 'IL',
			postalCode: '62701',
			country: 'United States'
		},
		donorName: 'Ada Lovelace',
		contribution: {
			totalMinor: 20_000,
			nonDeductibleMinor: 6_000,
			currency: 'USD',
			receivedAt: new Date('2026-01-05T12:00:00Z')
		},
		goodsOrServices: { kind: 'provided', description: 'two gala tickets' },
		tribute: { label: 'In memory of', honoree: 'Margaret Chen' },
		program: 'Clean water'
	}).node;
}
