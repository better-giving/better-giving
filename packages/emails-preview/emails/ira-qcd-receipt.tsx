import { receipt } from '@better-giving/emails';

// the receipt for a qualified charitable distribution from an IRA: the amount and the day the
// custodian's check arrived, as on any gift, and the QCD's own sentence that nothing was given in
// return. every other part of the receipt is ./receipt.tsx's to show.
export default function IraQcdReceipt() {
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
		donorName: 'James Whitfield',
		contribution: {
			totalMinor: 480_000,
			nonDeductibleMinor: 0,
			currency: 'USD',
			receivedAt: new Date('2026-11-17T00:00:00Z')
		},
		goodsOrServices: { kind: 'none' },
		tribute: null,
		program: null,
		crypto: null,
		pledge: { method: 'ira_qcd' }
	}).node;
}
