import { receipt } from '@better-giving/emails';

// the receipt for a gift given in crypto: the coin and what arrived stand in the amount's place,
// with the dollar figure named as its value when received. every other part of the receipt is
// ./receipt.tsx's to show.
export default function CryptoReceipt() {
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
			totalMinor: 25_000,
			nonDeductibleMinor: 0,
			currency: 'USD',
			receivedAt: new Date('2026-09-18T09:30:00Z')
		},
		goodsOrServices: { kind: 'none' },
		tribute: null,
		program: null,
		crypto: { coinName: 'Bitcoin', coinAmount: '0.00403918' }
	}).node;
}
