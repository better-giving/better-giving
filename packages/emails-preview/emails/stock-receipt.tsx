import { receipt } from '@better-giving/emails';

// the receipt for a gift given in stock: the shares stand in the amount's place beside the day they
// arrived, and no dollar figure prints, though staff entered one at Mark received. every other part
// of the receipt is ./receipt.tsx's to show.
export default function StockReceipt() {
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
			totalMinor: 951_240,
			nonDeductibleMinor: 0,
			currency: 'USD',
			receivedAt: new Date('2026-11-18T00:00:00Z')
		},
		goodsOrServices: { kind: 'none' },
		tribute: null,
		program: null,
		crypto: null,
		pledge: { method: 'stock', shares: '50 shares of AAPL' }
	}).node;
}
