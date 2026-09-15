import { grantReceived } from '@better-giving/emails';

// the thank-you a donor gets once the gift their fund granted has arrived. the organisation's
// registered name arrives proven — a deployment that has none writes no notice at all, and that
// refusal is the app's rather than the template's.
export default function GrantReceived() {
	return grantReceived.template({
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		amountMinor: 50_000,
		currency: 'USD',
		dedication: null
	}).node;
}
