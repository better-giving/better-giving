import {
	createEmployerWrite,
	createEstimateRead,
	createPledgeTold,
	createQuote,
	createStatusRead,
	createTickerRead
} from '@better-giving/form/embed/api';
import type { PaymentSurface } from '@better-giving/form/embed/stripe';
import { quoteThrough } from '@better-giving/form/embed/surface';
import type { CheckoutPorts } from '@better-giving/form/ports';

// the outside world, for the deployment's own donation page.
//
// the set `CheckoutPorts` names. three of them are the payment surface's — `confirm` and `resume`
// are its own, and the write is wrapped so the provider's fields learn the total the server just
// named. then the read of a crypto gift the donor sends from their own wallet, the estimate a coin
// amount is priced at on the first step, the thank-you's
// employer write, the clock, and the two pledge rails' ports: the same write unwrapped, since no
// processor stands behind a pledge, and the pending screen's told press. and beside the set, the
// ticker search the first step's unit panel makes, which is the panel's and not the flow's.
//
// this is the client half of the rule CLAUDE.md states about payments: nothing here imports a
// payment SDK. `createPaymentSurface` in @better-giving/form/embed/surface is the seam, and the
// adapters behind it are the only modules on either side of the wire that know which processor a
// gift is going through. the surface stays singular however many of them a served config names,
// which is why this function still takes exactly one.

/**
 * where the quote is posted and a crypto gift is read, which is nowhere: this page and `/api/v1` are
 * one deployment.
 *
 * `createQuote` and `createStatusRead` build `${origin}/api/v1/forms/:id/donations…`,
 * `createTickerRead` `${origin}/api/v1/forms/:id/tickers?q=`, and
 * `createEmployerWrite` `${origin}/api/v1/forms/:id/gifts/:token/employer`, and `createPledgeTold`
 * `${origin}/api/v1/forms/:id/donations/:pledgeId/told`, so an empty
 * origin is a path and each request is same-origin by construction rather than by a stored address
 * anyone can get wrong. it
 * is not the absent origin that module refuses on — that is `null`, which is the embed being unable
 * to tell which deployment served it, and this page can always tell.
 */
const SAME_DEPLOYMENT = '';

/**
 * a version 4 UUID (RFC 9562), the `pledgeId` a pledge's save carries, as `pledgeUuid` in
 * packages/form/src/embed/runtime.ts mints it (pinned by ./ports.spec.ts).
 *
 * drawn from `crypto.getRandomValues`, the one `Crypto` member an insecure context keeps (MDN,
 * Crypto.getRandomValues): a deployment may serve this page over http, where `crypto.randomUUID`
 * does not exist and the press that called it would throw.
 */
function pledgeUuid(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * the ports one card runs on.
 *
 * the surface is passed in rather than built here, because it is built once per card against a
 * mounted node and the ports are a reading of it. nothing is decided in this module: the total is
 * the server's, the payer is the one the request was made for, and both are handed on as they came.
 */
export function deploymentPorts(surface: PaymentSurface): CheckoutPorts {
	const post = createQuote(SAME_DEPLOYMENT);
	return {
		// the write, wrapped the way the embed's runtime wraps it, so the surface hears of the quote
		// on the press and again once it lands.
		quote: quoteThrough(surface, post),
		confirm: surface.confirm,
		resume: surface.resume,
		status: createStatusRead(SAME_DEPLOYMENT),
		estimate: createEstimateRead(SAME_DEPLOYMENT),
		employer: createEmployerWrite(SAME_DEPLOYMENT),
		now: () => Date.now(),
		pledges: {
			id: pledgeUuid,
			save: post,
			told: createPledgeTold(SAME_DEPLOYMENT)
		}
	};
}

/** the unit panel's ticker search (`UnitPanelHandlers` in @better-giving/form/unit-panel). */
export function deploymentTickerSearch(formId: string) {
	return createTickerRead(SAME_DEPLOYMENT, formId);
}
