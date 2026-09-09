import { uncollected } from '@better-giving/emails';

// the notice a donor gets when a bank debit did not go through. the organisation's registered
// name arrives proven — a deployment that has none writes no notice at all, and that refusal is
// the app's rather than the template's.
export default function Uncollected() {
	return uncollected.template({
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		amountMinor: 10_000,
		currency: 'USD'
	}).node;
}
