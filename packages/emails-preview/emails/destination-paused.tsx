import { destinationPaused } from '@better-giving/emails';

// a destination paused for failing, on a deployment whose own address is pinned. the other
// wordings are held by packages/emails/src/templates/destination-paused.spec.tsx.
export default function DestinationPaused() {
	return destinationPaused.template({
		url: 'https://crm.example.org/hooks/gifts',
		cause: { reason: 'failing', days: 3 },
		destinationPath: '/admin/integrations/webhooks/01926f3a-5b2c-7d4e-8f90-1a2b3c4d5e6f',
		origin: 'https://donate.example.org'
	}).node;
}
