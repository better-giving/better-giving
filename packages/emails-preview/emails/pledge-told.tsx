import { pledgeTold } from '@better-giving/emails';

// a stock pledge whose donor has asked their broker. the IRA (QCD) wording is held by
// packages/emails/src/templates/pledge-told.spec.tsx.
export default function PledgeTold() {
	return pledgeTold.template({
		donorName: 'Maya Okafor',
		donorEmail: 'maya.okafor@example.org',
		reference: 'CFCP-AAPL-7Q2D',
		pledged: { method: 'stock', ticker: 'AAPL', shares: '50' }
	}).node;
}
