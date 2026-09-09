import { createQuote } from '@better-giving/form/embed/api';
import type { PaymentSurface } from '@better-giving/form/embed/stripe';
import type { CheckoutPorts } from '@better-giving/form/ports';

// the outside world, for the deployment's own donation page.
//
// four functions, exactly the set `CheckoutPorts` names. three of them are the payment surface's —
// `confirm` and `resume` are its own, and the write is wrapped so the provider's fields learn the
// total the server just named. the fourth is the clock.
//
// this is the client half of the rule CLAUDE.md states about payments: nothing here imports a
// payment SDK. `createPaymentSurface` in @better-giving/form/embed/stripe is the seam, and it is
// the only module on either side of the wire that knows which processor this is.

/**
 * where the quote is posted, which is nowhere: this page and `/api/v1` are one deployment.
 *
 * `createQuote` builds `${origin}/api/v1/forms/:id/donations`, so an empty origin is a path and the
 * request is same-origin by construction rather than by a stored address anyone can get wrong. it
 * is not the absent origin that module refuses on — that is `null`, which is the embed being unable
 * to tell which deployment served it, and this page can always tell.
 */
const SAME_DEPLOYMENT = '';

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
		// the write, wrapped so the provider's own fields learn what the server just decided. the
		// order matters and is the runtime's: the surface is told before the quote is returned to the
		// flow, so the figures on the card and the fields beside them are never a frame apart.
		quote: async (request) => {
			const minted = await post(request);
			surface.quoted(request, minted);
			return minted;
		},
		confirm: surface.confirm,
		resume: surface.resume,
		now: () => Date.now()
	};
}
