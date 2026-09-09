import { adminAlert } from '@better-giving/emails';

// the alert at its fullest: facts to read and something to do about them. the two blocks are
// decided independently, so a message with neither, and one with facts and nothing to do, are
// both real shapes — packages/emails/src/templates/admin-alert.spec.tsx holds them.
export default function AdminAlert() {
	return adminAlert.template({
		headline: 'A Stripe webhook could not be processed',
		body: 'One payment event was received and not recorded. The books are unchanged.',
		facts: [
			{ label: 'Event', value: 'evt_1PqR2s3T4u5V6w7X8y9Z0aBc' },
			{ label: 'Type', value: 'payment_intent.succeeded' },
			{ label: 'Status', value: '500' }
		],
		action: 'Replay the event from the Stripe dashboard.'
	}).node;
}
