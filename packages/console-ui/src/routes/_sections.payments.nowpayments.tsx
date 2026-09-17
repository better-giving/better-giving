import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, saveNowpayments } from '../api/client';
import type { VarsWritten } from '../api/types';
import { consoleRereads } from '../lib/dialog-params';
import { NowpaymentsSection } from '../lib/nowpayments-section';
import type { NowpaymentsAnswer } from '../lib/nowpayments-setup';
import { NOWPAYMENTS_SAVE_INTENT, nowpaymentsPosted } from '../lib/nowpayments-setup';
import { forgetReadings, readProcessorPage } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.payments.nowpayments';

// /payments/nowpayments — NOWPayments' page, the fourth under the rail's donation processor heading.
// what it draws is ../lib/nowpayments-section.tsx whole.
//
// the account, the worker and the values are the sections layout's reading (./_sections.tsx); what
// this page reads on top of them is the payments reading of ../lib/processor-reading.ts, kept between
// visits by ../lib/processor-cache.ts. its press starts no run, so the reading's run is always `null`.

const TITLE = 'NOWPayments';

/** a page nothing has been pressed on yet. */
const UNPRESSED: NowpaymentsAnswer = { refused: null, saved: null };

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

export function clientLoader(args: Route.ClientLoaderArgs) {
	return readProcessorPage(args, 'nowpayments');
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
	 * stores the three boxes: the binary checks the key and the payout currency against NOWPayments
	 * and writes all three in this one request, so the answer is awaited rather than polled for.
	 *
	 * the boxes are read by their own rule first (../lib/nowpayments-setup.ts), so the binary is sent
	 * nothing it would turn down.
	 */
	if (intent === NOWPAYMENTS_SAVE_INTENT) {
		const read = nowpaymentsPosted(posted);
		if (!read.ok) return { nowpayments: { refused: read.errors, saved: null } };
		return { nowpayments: { refused: null, saved: await saveNowpayments(read.press) } };
	}

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it, so the
	 * boxes beside the press can set them.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on this page posts anything else. a body naming nothing, or naming a press drawn
	// elsewhere, is answered rather than run.
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function NowpaymentsPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const press = usePress();

	/* the answer as the action returned it and never rebuilt here: the section moves focus on its
	   identity, which changes with each press and with nothing else. */
	const nowpayments: NowpaymentsAnswer =
		actionData && 'nowpayments' in actionData ? actionData.nowpayments : UNPRESSED;
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;

	return (
		<Column>
			<PageHeader title={TITLE} />
			<NowpaymentsSection
				values={shell.reading.values}
				payments={loaderData.payments}
				workerName={shell.workerName}
				accountName={shell.account}
				nowpayments={nowpayments}
				freed={freed}
				revalidating={press.revalidating}
				busy={press.busy}
				pending={press.intent}
			/>
		</Column>
	);
}
