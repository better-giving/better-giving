import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { useNavigation } from 'react-router';
import {
	freeWithheldVars,
	paypalRun,
	setUpRecurring,
	setVars,
	startPaypalSetup
} from '../api/client';
import type { RecurringSetup, VarsWritten } from '../api/types';
import { ConsoleStopped } from '../lib/deployment-states';
import { CHARITY_INTENT, charityEdit } from '../lib/paypal-charity';
import type { PaypalPress } from '../lib/paypal-section';
import { PaypalSection } from '../lib/paypal-section';
import { PAYPAL_SETUP_INTENT, paypalPairPosted } from '../lib/paypal-setup';
import { ProcessorPage } from '../lib/processor-page';
import { readProcessorScreen } from '../lib/processor-reading';
import { ProductFoot } from '../lib/product-foot';
import { RECURRING_INTENT } from '../lib/recurring-block';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/payments_.paypal';

// /payments/paypal — PayPal's screen, one of the two rows the home page's payments fold lists
// (../lib/processor-rows.tsx). what it draws is ../lib/paypal-section.tsx whole.
//
// `payments_` and not `payments`, for ./payments_.stripe.tsx's reason: without the underscore this
// is a child of ./payments.tsx, whose redirect would send it home. every read is
// ../lib/processor-reading.ts's.

const TITLE = 'PayPal';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

export function clientLoader({ request }: Route.ClientLoaderArgs) {
	return readProcessorScreen(request, paypalRun);
}

/**
 * every press this screen draws, and nothing else — each one call on the loopback address, for
 * ./_index.tsx's reason.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * asks the deployment to put what a repeating gift is charged against on every processor account
	 * it holds the keys for. nothing is posted with it, for the reason ./payments_.stripe.tsx states
	 * over the same press.
	 */
	if (intent === RECURRING_INTENT) return { recurring: await setUpRecurring() };

	/**
	 * stores whether PayPal has approved this organisation for its charity rate, or takes the name
	 * off.
	 *
	 * **it is one of the seventeen and goes through the same door every other value does**, so there
	 * is nothing here but the two positions the switch can be in: the payload is composed from them
	 * rather than from what the body claimed (`charityEdit` in ../lib/paypal-charity.ts), which is
	 * what keeps a third spelling off a door that refuses one with a 400.
	 *
	 * it is a press of its own rather than a name in PayPal's group: the three credentials are one
	 * errand off one PayPal app, and this is an answer about the organisation given months after
	 * them (../lib/secret-groups.ts).
	 */
	if (intent === CHARITY_INTENT) return { charity: await setVars(charityEdit(posted)) };

	/**
	 * sets PayPal up from the pair: the binary checks it, settles the listener at this deployment's
	 * address and writes the pair and that listener's id in one write (`packages/console/internal/paypal`).
	 *
	 * started rather than awaited, for the Stripe press's reason (./payments_.stripe.tsx), and the
	 * pair is read by the boxes' own rule first so the binary is sent nothing it would turn down
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
	 * boxes beside the press can set them. the same press the home page's folds draw, answered the
	 * same way (./_index.tsx says why the names are never posted).
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on this screen posts anything else. a body naming nothing, or naming a press drawn
	// elsewhere, is answered rather than run.
	return { unknown: true as const };
}

export default function PaypalScreen({ loaderData, actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	/* the router has this press's answer and is re-reading the screen over it: the posted intent is
	   carried through the re-read as well as through the request, so it cannot say this itself
	   (../lib/stripe-press.ts). */
	const revalidating = navigation.state === 'loading';
	/* a setup run counts as this screen writing, although no request is open for it: it writes the
	   pair and the listener's id onto the deployment (`packages/console/internal/paypal`), and a
	   second press made under it would be reading what this one is still changing. */
	const busy = intent !== null || loaderData.run?.kind === 'running';

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
		<ProcessorPage
			title={TITLE}
			version={loaderData.version}
			account={loaderData.account}
			accountId={loaderData.accountId}
			remembered={loaderData.remembered}
			notKept={loaderData.notKept}
		>
			<PaypalSection
				values={loaderData.values}
				payments={loaderData.payments}
				recurring={loaderData.recurring}
				workerName={loaderData.workerName}
				accountName={loaderData.account}
				paypal={paypal}
				charity={charity}
				freed={freed}
				provision={provision}
				revalidating={revalidating}
				busy={busy}
				pending={intent}
			/>
		</ProcessorPage>
	);
}

// the binary stopped answering, drawn in the home page's words and frame (./_index.tsx's own
// boundary says why the strip stands with no release in it).
export function ErrorBoundary() {
	return (
		<PanelRoute foot={<ProductFoot version="" />}>
			<title>{CONSOLE_TITLE}</title>
			<ConsoleStopped />
		</PanelRoute>
	);
}
