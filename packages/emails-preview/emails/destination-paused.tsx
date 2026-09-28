import { destinationPaused } from '@better-giving/emails';

// a destination that failed for the pause rule's three days, on a deployment whose own address is
// pinned. a 410's wording and the path shown where no address is known are the two other shapes,
// held by packages/emails/src/templates/destination-paused.spec.tsx.
export default function DestinationPaused() {
	return destinationPaused.template({
		url: 'https://crm.example.org/hooks/gifts',
		cause: { reason: 'failing', days: 3 },
		webhooksPath: '/admin/integrations/webhooks',
		origin: 'https://donate.example.org'
	}).node;
}
