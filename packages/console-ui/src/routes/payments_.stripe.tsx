import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { useNavigation } from 'react-router';
import {
	freeWithheldVars,
	homeReading,
	levelWallets,
	setUpRecurring,
	setVars,
	startStripeSetup,
	stripeRun
} from '../api/client';
import type { RecurringSetup, VarsWritten, WalletsLevel } from '../api/types';
import { ConsoleStopped } from '../lib/deployment-states';
import { heldValues } from '../lib/held-values';
import { ProcessorPage } from '../lib/processor-page';
import { readProcessorScreen } from '../lib/processor-reading';
import { ProductFoot } from '../lib/product-foot';
import { RECURRING_INTENT } from '../lib/recurring-block';
import { STRIPE_REMOVAL, stripeKeyEdits } from '../lib/stripe-edits';
import { SET_UP_INTENT } from '../lib/stripe-keys';
import { StripeSection } from '../lib/stripe-section';
import { unreadHeld } from '../lib/unread-held';
import { WALLETS_INTENT } from '../lib/wallets-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/payments_.stripe';

// /payments/stripe — Stripe's screen, one of the two rows the home page's payments fold lists
// (../lib/processor-rows.tsx). what it draws is ../lib/stripe-section.tsx whole.
//
// **the trailing underscore on `payments_` is what keeps ./payments.tsx off this screen.** that
// module is the address `/payments` redirecting to `/`, and a flat route named `payments.stripe`
// would be its child: its `clientLoader` runs first and sends this address home too
// (https://reactrouter.com/how-to/file-route-conventions#nested-urls-without-layout-nesting).
//
// every read is ../lib/processor-reading.ts's, which also says why any face but ready is `/`.

const TITLE = 'Stripe';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

export function clientLoader() {
	return readProcessorScreen(stripeRun);
}

/**
 * every press this screen draws, and nothing else.
 *
 * **the binary owns all of them**, for the reason ./_index.tsx's `clientAction` states: each is one
 * call on the loopback address, and the account, the worker and the address a press is spent on are
 * read inside the binary and never posted.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * asks the deployment to put what a repeating gift is charged against on every processor account
	 * it holds the keys for.
	 *
	 * it is the one press on this screen that reaches a processor through the deployment rather than
	 * with a key an operator has just pasted — by the time this is pressed the deployment holds them,
	 * and asking it is what keeps a second processor client out of this console. nothing is posted
	 * with it: what an account holds is found by an id the deployment derives.
	 */
	if (intent === RECURRING_INTENT) return { recurring: await setUpRecurring() };

	/**
	 * asks the deployment to register the hostnames a donor is drawn wallet buttons on.
	 *
	 * it answers exactly as the press above it does and for the same reason: the call goes through
	 * the deployment with the key it holds, and nothing is posted with it — the hostnames are the
	 * deployment's own address and its own site rows, settled inside the worker.
	 *
	 * it is the repair rather than the ordinary way one gets registered: the Stripe keys run levels
	 * them as its last step and the home page's sites press levels them behind the list it stored, so
	 * what this is for is a custom domain attached to the worker after a setup
	 * (../lib/wallets-press.ts).
	 */
	if (intent === WALLETS_INTENT) return { wallets: await levelWallets() };

	/**
	 * does to the processor whatever the two Stripe boxes asked for, which is one of three acts.
	 *
	 * **which act it is follows from the secret box and is settled before anything leaves this
	 * machine** (../lib/stripe-edits.ts). a retyped secret key is the whole errand: the binary names
	 * the account, registers the webhook endpoint, stores the signing secret that registration
	 * returns, puts the item a repeating gift is collected against on the account and writes the
	 * publishable key — the whole ordering is `packages/console/internal/stripe`'s. an untouched one
	 * is that last step alone, since the press carries no key to reach the processor with. an
	 * emptied one deletes both credentials and reaches the processor not at all.
	 *
	 * **what is held is asked of the account here and never taken off the form**, for the reason
	 * the home page's group press states: a form claiming a key is stored turns an empty box into a
	 * delete, and one claiming it is not runs the whole errand over a key nobody retyped. a read
	 * that did not land is a press refused rather than a press guessed at.
	 *
	 * the two that are a run are started rather than awaited: the chain is several round trips
	 * against three hosts, and a request held open for them is a page that cannot say which part is
	 * running. what the screen reads afterwards is the run itself (../lib/stripe-section.tsx). the
	 * removal is one call and seconds, so it is answered here.
	 *
	 * the account, the worker and the address the endpoint is registered at are all read inside the
	 * binary and never posted: a name that travelled through a page is an endpoint registered, and a
	 * credential written, wherever that page said.
	 */
	if (intent === SET_UP_INTENT) {
		const read = await homeReading();
		if (read.values.vars.kind !== 'read') {
			return { stripe: { written: unreadHeld(read.values.vars) } };
		}

		const edits = stripeKeyEdits(posted, {
			secretKey: heldValues(read.values.vars.vars).seeds.STRIPE_SECRET_KEY ?? ''
		});
		// nothing leaves this machine: no call to the processor, no credential stored, no var
		// written. the boxes come back as names and sentences — what was typed in them is not in
		// this answer.
		if (!edits.ok) return { stripe: { errors: edits.errors } };

		if (edits.act === 'remove') return { stripe: { written: await setVars(STRIPE_REMOVAL) } };

		const pressed = await startStripeSetup(
			edits.act === 'errand'
				? { secret: edits.keys.secretKey, publishable: edits.keys.publishableKey }
				: { secret: '', publishable: edits.publishableKey }
		);
		// the door keeps one reading about the published slot and no run begins where it refuses, so
		// there is nothing to poll and the answer says so here (`StripeStarted` in ../api/types.ts).
		if ('turnedDown' in pressed) return { stripe: { turnedDown: true as const } };
		// a write that could not be made at all is the removal's refusal too, drawn at the same press.
		if ('unwritten' in pressed) return { stripe: { written: pressed.unwritten } };
		return { stripe: { started: true as const } };
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

export default function StripeScreen({ loaderData, actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	/* the router has this press's answer and is re-reading the screen over it: the posted intent is
	   carried through the re-read as well as through the request, so it cannot say this itself
	   (../lib/stripe-press.ts). */
	const revalidating = navigation.state === 'loading';
	/* a setup run counts as this screen writing, although no request is open for it: it writes two
	   credentials and a var onto the deployment (`packages/console/internal/stripe`), and a second
	   press made under it would be reading what this one is still changing. */
	const busy = intent !== null || loaderData.run?.kind === 'running';

	/* which Stripe boxes the last press came back naming, and `null` on the press that started a run:
	   how that one is getting on is read off the run rather than off this answer. */
	const stripe = actionData && 'stripe' in actionData ? actionData.stripe : null;
	/* and the press the binary's own door turned down before any run began, which is the same thing
	   about the pair that a key Stripe refuses is — so the screen says it in the same sentence and in
	   the same place (../lib/stripe-section.tsx). */
	const turnedDownPair = stripe !== null && 'turnedDown' in stripe;
	/* how the one act that is a single call went. the other two answer as a run rather than as a
	   body, so this is `null` on both of them. */
	const removed: VarsWritten | null =
		stripe !== null && 'written' in stripe ? stripe.written : null;
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;
	const provision: RecurringSetup | null =
		actionData && 'recurring' in actionData ? actionData.recurring : null;
	// the screen's own levelling press, which is the repair a site press and the keys run both stand
	// in front of.
	const wallets: WalletsLevel | null =
		actionData && 'wallets' in actionData ? actionData.wallets : null;

	return (
		<ProcessorPage
			title={TITLE}
			version={loaderData.version}
			account={loaderData.account}
			accountId={loaderData.accountId}
			remembered={loaderData.remembered}
			notKept={loaderData.notKept}
		>
			<StripeSection
				address={loaderData.address}
				values={loaderData.values}
				payments={loaderData.payments}
				recurring={loaderData.recurring}
				workerName={loaderData.workerName}
				accountName={loaderData.account}
				refused={stripe !== null && 'errors' in stripe ? stripe.errors : null}
				turnedDownPair={turnedDownPair}
				revalidating={revalidating}
				run={loaderData.run}
				removed={removed}
				freed={freed}
				provision={provision}
				wallets={wallets}
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
