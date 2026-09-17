import { cryptoPending } from '@better-giving/emails';

// the notice a donor gets when they are shown an address, at its fullest: a coin that requires a
// memo, so the memo row and its warning both print. the cases that drop something — no memo, an
// optional one, an unnamed donor — are in
// packages/emails/src/templates/crypto-pending.spec.tsx, which asserts them.
export default function CryptoPending() {
	return cryptoPending.template({
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		coinName: 'XRP',
		network: 'XRP',
		coinAmount: '87.412305',
		address: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
		memo: '104729',
		memoRequired: true,
		validUntil: new Date('2026-09-24T15:04:00Z')
	}).node;
}
