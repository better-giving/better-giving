import { Column } from '@better-giving/operator/components/shell/Layout';
import type { QuickbooksPress } from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_PRESSES } from '@better-giving/operator/console/quickbooks';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { redirect, useSubmit } from 'react-router';
import { freeWithheldVars, pressQuickbooks, readQuickbooks } from '../api/client';
import type { QuickbooksPressBody } from '../api/types';
import { readConsole } from '../lib/console-reading';
import { consoleRereads } from '../lib/dialog-params';
import { groupPress } from '../lib/group-press';
import { forgetReadings, readKeptPage } from '../lib/processor-cache';
import type { QuickbooksAnswer } from '../lib/quickbooks-section';
import { QuickbooksSection } from '../lib/quickbooks-section';
import { quickbooksIntent } from '../lib/quickbooks-standing';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.quickbooks';

// /quickbooks — where this deployment's books go, drawn by ../lib/quickbooks-section.tsx whole.
//
// the account, the worker and the values are the sections layout's reading (./_sections.tsx); where
// the books stand is this page's own, taken off the deployment through the binary.
//
// **the reading is awaited rather than handed over as a promise.** the section resolves none of its
// own, and the whole of the page is under it: the three boxes are drawn from values the layout
// already holds, and everything below them is a company this deployment is connected to or the way
// to connect one.
//
// **nothing here decides what to draw.** every press is a callback the section makes and this turns
// into a post, and the answer goes back as it came: the whole of what this page settles is which
// press an intent names and what that press carries.

const TITLE = 'QuickBooks';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

/**
 * where the books stand, under the same ready check every page under this layout makes, and kept
 * between visits as every page that reads the deployment for itself is (../lib/processor-cache.ts).
 *
 * the face is read before the deployment is asked anything, for ../lib/processor-reading.ts's
 * reason: any other face is `/`'s, and the redirect is decided before this page renders.
 *
 * **a reading carrying no connected company is served to no second visit.** connecting finishes in
 * a browser at the deployment and never on this console
 * (packages/operator/src/console/quickbooks.ts), so a company connected between two visits to this
 * page is learned by reading again — and a read that did not land is not an answer to keep either.
 */
export function clientLoader(args: Route.ClientLoaderArgs) {
	return readKeptPage(
		args,
		async () => {
			const { reading } = await readConsole(args.request);
			if (reading.face.kind !== 'ready') throw redirect('/', 307);
			return { books: await readQuickbooks() };
		},
		{
			standing: ({ books }) =>
				books.kind === 'read' && books.report.connection.state === 'connected'
		}
	);
}

/**
 * the five presses over the connection, the three boxes' own press, and the press that frees a
 * value held in a form nothing can read back — each one call on the loopback address.
 *
 * the boxes post the shared group intent and are answered by the press every other group's are
 * (../lib/group-press.ts), so nothing about the three values is decided here.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	const group = await groupPress(intent, posted);
	if (group !== null) return group;

	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// the press is the intent read back against the enumeration, so a body naming one this surface
	// does not take reaches the deployment with nothing.
	const press = QUICKBOOKS_PRESSES.find((name) => quickbooksIntent(name) === intent);
	if (press === undefined) return { unknown: true as const };

	// the press travels back with the answer: the deployment names it on a report and says nothing at
	// all where there is no report, and an outcome reports at the control that caused it.
	return { quickbooks: { press, pressed: await pressQuickbooks(pressBody(press, posted)) } };
}

/** what one press carries, which is the press and whatever that press acts on. */
function pressBody(press: QuickbooksPress, posted: FormData): QuickbooksPressBody {
	if (press === 'accounts')
		return {
			press,
			income: String(posted.get('income') ?? ''),
			fee: String(posted.get('fee') ?? ''),
			deposit: String(posted.get('deposit') ?? '')
		};
	if (press === 'start-date' || press === 'start-date-preview')
		return { press, startAt: String(posted.get('startAt') ?? '') };
	return { press };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function QuickbooksPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const submit = useSubmit();
	const { intent, busy, revalidating } = usePress();

	const answered = actionData && 'quickbooks' in actionData ? actionData.quickbooks : null;
	const answer: QuickbooksAnswer | null =
		answered === null
			? null
			: answered.pressed.kind === 'reported'
				? { kind: 'reported', report: answered.pressed.report }
				: { kind: 'unanswered', press: answered.press, read: answered.pressed.read };

	/* every press posts on its own rather than through a `<Form>`: the section's forms are about the
	   values in them and hand what was typed back as a callback, so what is posted here is the
	   intent and whatever that press acts on. `preventScrollReset` because each of them reports at
	   its own control, and the page under the reader does not move. */
	const make = (press: QuickbooksPress, values?: Record<string, string>) =>
		void submit(
			{ intent: quickbooksIntent(press), ...values },
			{ method: 'post', preventScrollReset: true }
		);

	return (
		<Column>
			<QuickbooksSection
				values={shell.reading.values}
				books={loaderData.books}
				workerName={shell.workerName}
				accountName={shell.account}
				secrets={actionData && 'secrets' in actionData ? actionData.secrets : null}
				answer={answer}
				freed={actionData && 'freed' in actionData ? actionData.freed : null}
				busy={busy}
				pending={intent}
				revalidating={revalidating}
				onConnect={() => make('connect')}
				onAccounts={(picks) => make('accounts', { ...picks })}
				onStartDate={(day) => make('start-date', { startAt: day })}
				onRetry={() => make('retry')}
				onDisconnect={() => make('disconnect')}
			/>
		</Column>
	);
}
