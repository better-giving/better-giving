import { destinationPaused } from '@better-giving/emails';

// a destination paused for failing, on a deployment whose own address is pinned. the other
// wordings are held by packages/emails/src/templates/destination-paused.spec.tsx.
export default function DestinationPaused() {
	return destinationPaused.template({
		url: 'https://crm.example.org/hooks/gifts',
		cause: { reason: 'failing', days: 3 },
		webhooksPath: '/admin/integrations/webhooks',
		origin: 'https://donate.example.org'
	}).node;
}
