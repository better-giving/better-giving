import { destinationPaused } from '@better-giving/emails';
import { type MailDeps, mailOperator } from '../donations/delivery';
import {
	DESTINATION_PAUSE_AFTER_MS,
	type PausedDestination,
	type WebhookDeliveryDeps
} from './deliver';

// the mail a pause sends: `onPaused` for ./deliver.ts, to the address every operational alert goes
// to (`mailOperator` in ../donations/delivery.ts).
//
// once per pause, and a send that did not go is logged and never retried: ./deliver.ts tells the
// hook of each pause once, and a retry here would be the second mail that rule exists to prevent.
// the destination's `paused_at` is the lasting record of the pause.

/** the dashboard's Webhooks page, where a paused destination is resumed. */
export const WEBHOOKS_PAGE_PATH = '/admin/integrations/webhooks';

const DAY_MS = 24 * 60 * 60_000;

/**
 * the hook that mails a pause. `origin` is where this deployment answers, or null where nothing
 * states it — a cron run has no request to read one off — and the mail then names the page by its
 * path.
 */
export function mailPause(
	deps: MailDeps & { readonly origin: string | null }
): WebhookDeliveryDeps['onPaused'] {
	return async (destination: PausedDestination) => {
		const sent = await mailOperator(
			deps,
			destinationPaused.template({
				url: destination.url,
				cause:
					destination.reason === 'failing'
						? { reason: 'failing', days: DESTINATION_PAUSE_AFTER_MS / DAY_MS }
						: { reason: 'gone' },
				webhooksPath: WEBHOOKS_PAGE_PATH,
				origin: deps.origin
			})
		);
		if (sent !== 'no_address' && sent.ok) return;
		const why =
			sent === 'no_address'
				? 'no notifications address is saved'
				: `${sent.reason}: ${sent.detail}`;
		console.error(
			`the mail saying destination ${destination.id} was paused was not sent, and is not retried — ${why}`
		);
	};
}
