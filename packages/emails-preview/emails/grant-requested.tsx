import { grantRequested } from '@better-giving/emails';

// the notice a donor gets when their fund has the request for a gift. the organisation's registered
// name arrives proven — a deployment that has none writes no notice at all, and that refusal is
// the app's rather than the template's.
export default function GrantRequested() {
	return grantRequested.template({
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		amountMinor: 50_000,
		currency: 'USD',
		dedication: { label: 'In memory of', honoree: 'Grace Hopper' }
	}).node;
}
