import { matchReminder } from '@better-giving/emails';

// the one reminder, three days after the pack, to a donor who has not marked the gift filed.
export default function MatchReminder() {
	return matchReminder.template({
		displayName: 'Greenfield Food Bank',
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		amountMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		giftPageUrl: 'https://giving.greenfieldfoodbank.example/gift/7Qk3-mVx9Lr2NpA4'
	}).node;
}
