import { matchPack } from '@better-giving/emails';

// the pack a donor gets on naming their employer, at its fullest: a profile with a mailing address
// and a receipt already sent, so every row of the filing block prints, and the reminder it promises. the cases that drop a row are
// in packages/emails/src/templates/match-pack.spec.tsx.
export default function MatchPack() {
	return matchPack.template({
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		filer: {
			legalName:
				'Greenfield Community Food Bank and Family Resource Network of Hamilton County, Inc.',
			ein: '84-2761093',
			address: '1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States'
		},
		amountMinor: 15_000,
		givenMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		receiptSentAt: new Date('2026-11-12T15:01:00Z'),
		giftPageUrl: 'https://giving.greenfieldfoodbank.example/gift/7Qk3-mVx9Lr2NpA4',
		reminds: true
	}).node;
}
