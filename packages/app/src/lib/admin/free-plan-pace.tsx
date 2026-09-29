import { Banner } from '@better-giving/operator/components/status/Banner';

// the standing note over a page whose deliveries the Cloudflare plan paces: how many go out a
// minute on the Free plan, the pace the delivery run claims at until the operator states the
// account is on Workers Paid (`deliveryPace` in $lib/server/outbox/budget.ts). the page's loader
// hands the Free pace, or null once Paid is stated, and the note is gone with it.

export function FreePlanPace({
	perMinute,
	deliveries,
	reach
}: {
	/** deliveries a minute on the Free plan, or null where the account is stated as Paid. */
	readonly perMinute: number | null;
	/** what goes out, as the sentence names it: `webhook deliveries`. */
	readonly deliveries: string;
	/** where they are going, as the sentence names it: `every destination`. */
	readonly reach: string;
}) {
	if (perMinute === null) return null;
	return (
		<Banner word="Delivery pace">
			On the Cloudflare Free plan, {deliveries} go out {perMinute} a minute, so a busy day can take
			hours to reach {reach}. If this account is on the Workers Paid plan, say so on the console’s
			Cloudflare plan page.
		</Banner>
	);
}
