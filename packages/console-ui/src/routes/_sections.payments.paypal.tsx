import { Column } from '@better-giving/operator/components/shell/Layout';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, setUpRecurring, setVars, startPaypalSetup } from '../api/client';
import type { RecurringSetup, VarsWritten } from '../api/types';
import { consoleRereads } from '../lib/dialog-params';
import { CHARITY_INTENT, charityEdit } from '../lib/paypal-charity';
import type { PaypalPress } from '../lib/paypal-section';
import { PaypalSection } from '../lib/paypal-section';
import { PAYPAL_SETUP_INTENT, paypalPairPosted } from '../lib/paypal-setup';
import { forgetReadings, readProcessorPage } from '../lib/processor-cache';
import { RECURRING_INTENT } from '../lib/recurring-block';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.payments.paypal';

// /payments/paypal — PayPal's page, one of the two under the rail's donation processor heading.
// what it draws is ../lib/paypal-section.tsx whole.
//
// the account, the worker and the deploy-time values are the sections layout's reading
// (./_sections.tsx); what this page reads on top of them is ../lib/processor-reading.ts's, kept between
// visits by ../lib/processor-cache.ts.

const TITLE = 'PayPal';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

export function clientLoader(args: Route.ClientLoaderArgs) {
	return readProcessorPage(args, 'paypal');
}

/**
 * every press this page draws, and nothing else — each one call on the loopback address, with the
 * account, the worker and the address it is spent on read inside the binary and never posted.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * asks the deployment to put what a repeating gift is charged against on every processor account
	 * it holds the keys for. nothing is posted with it, for the reason
	 * ./_sections.payments.stripe.tsx states over the same press.
	 */
	if (intent === RECURRING_INTENT) return { recurring: await setUpRecurring() };

	/**
	 * stores whether PayPal has approved this organisation for its charity rate, or takes the name
	 * off.
	 *
	 * **it is one of the deploy-time values and goes through the same door every other one does**, so
	 * there is nothing here but the two positions the switch can be in: the payload is composed from them
	 * rather than from what the body claimed (`charityEdit` in ../lib/paypal-charity.ts), which is
	 * what keeps a third spelling off a door that refuses one with a 400.
	 *
	 * it is a press of its own rather than a name in PayPal's group: the credentials and their address
	 * are one errand off one PayPal app, and this is an answer about the organisation given months after
	 * them (../lib/secret-groups.ts).
	 */
	if (intent === CHARITY_INTENT) return { charity: await setVars(charityEdit(posted)) };

	/**
	 * sets PayPal up from the pair and the address it is sent to: the binary checks the pair there,
	 * settles the listener at this deployment's address and writes the pair, that address and that
	 * listener's id in one write (`packages/console/internal/paypal`).
	 *
	 * started rather than awaited, for the Stripe press's reason (./_sections.payments.stripe.tsx),
	 * and the pair is read by the boxes' own rule first so the binary is sent nothing it would turn down
	 * (../lib/paypal-setup.ts).
	 */
	if (intent === PAYPAL_SETUP_INTENT) {
		const read = paypalPairPosted(posted);
		if (!read.ok) return { paypal: { errors: read.errors } };
		const pressed = await startPaypalSetup(read.pair);
		if ('turnedDown' in pressed) return { paypal: { turnedDown: true as const } };
		if ('unwritten' in pressed) return { paypal: { unwritten: pressed.unwritten } };
		return { paypal: { started: true as const } };
	}

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it, so the
	 * boxes beside the press can set them. which names are freed is read inside the binary off
	 * cloudflare's own answer and never posted.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on this page posts anything else. a body naming nothing, or naming a press drawn
	// elsewhere, is answered rather than run.
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function PaypalPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const press = usePress();
	/* a setup run counts as this page writing, although no request is open for it: it writes the
	   pair and the listener's id onto the deployment (`packages/console/internal/paypal`), and a
	   second press made under it would be reading what this one is still changing. */
	const busy = press.busy || loaderData.run?.kind === 'running';

	/* the set-up press: its run off the loader, and the three answers that started none. */
	const answer = actionData && 'paypal' in actionData ? actionData.paypal : null;
	const paypal: PaypalPress = {
		run: loaderData.run,
		refused: answer !== null && 'errors' in answer ? answer.errors : null,
		turnedDownPair: answer !== null && 'turnedDown' in answer,
		unwritten: answer !== null && 'unwritten' in answer ? answer.unwritten : null
	};
	/* how the press of the charity-rate switch went, which is one var written through the same door
	   every other value goes through. */
	const charity: VarsWritten | null =
		actionData && 'charity' in actionData ? actionData.charity : null;
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;
	const provision: RecurringSetup | null =
		actionData && 'recurring' in actionData ? actionData.recurring : null;

	return (
		<Column>
			<PaypalSection
				values={shell.reading.values}
				payments={loaderData.payments}
				recurring={loaderData.recurring}
				workerName={shell.workerName}
				accountName={shell.account}
				paypal={paypal}
				charity={charity}
				freed={freed}
				provision={provision}
				revalidating={press.revalidating}
				busy={busy}
				pending={press.intent}
			/>
		</Column>
	);
}
