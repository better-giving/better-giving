import { receipt } from '@better-giving/emails';

// the ordinary receipt with the employer match note: nothing provided in return, given for nobody
// and against no cause, and closing on the line that links the donor's own gift page.
export default function ReceiptMatchNote() {
	return receipt.template({
		org: {
			legalName:
				'Greenfield Community Food Bank and Family Resource Network of Hamilton County, Inc.',
			taxId: '84-2761093',
			addressLine1: '1250 Mill Street',
			addressLine2: 'Suite 200',
			city: 'Cincinnati',
			region: 'OH',
			postalCode: '45202',
			country: 'United States'
		},
		donorName: 'Maya Reyes',
		contribution: {
			totalMinor: 15_000,
			nonDeductibleMinor: 0,
			currency: 'USD',
			receivedAt: new Date('2026-11-12T15:00:00Z')
		},
		goodsOrServices: { kind: 'none' },
		tribute: null,
		program: null,
		crypto: null,
		giftPageUrl: 'https://giving.greenfieldfoodbank.example/gift/7Qk3-mVx9Lr2NpA4'
	}).node;
}
