import { Column } from '@better-giving/operator/components/shell/Layout';
import type { ZapierPress } from '@better-giving/operator/console/zapier';
import { ZAPIER_PRESSES } from '@better-giving/operator/console/zapier';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { useSubmit } from 'react-router';
import { pressZapier, readZapier } from '../api/client';
import { notReady, readConsole } from '../lib/console-reading';
import { consoleRereads } from '../lib/dialog-params';
import { forgetReadings, readKeptPage } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import type { ZapierAnswer } from '../lib/zapier-section';
import { ZapierSection } from '../lib/zapier-section';
import { zapierIntent } from '../lib/zapier-standing';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.zapier';

// /zapier — the key Zapier presents to this deployment, drawn by ../lib/zapier-section.tsx whole.
//
// the address Zapier asks for beside the key is the sections layout's reading (./_sections.tsx);
// where the key stands is this page's own, taken off the deployment through the binary.
//
// **nothing here decides what to draw**, ./_sections.quickbooks.tsx's arrangement: each press is a
// callback the section makes and this turns into a post, and the answer goes back as it came.

const TITLE = 'Zapier';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

/** which press `intent` names, or `null` where it names none. */
const pressOf = (intent: unknown): ZapierPress | null =>
	ZAPIER_PRESSES.find((press) => zapierIntent(press) === intent) ?? null;

/**
 * where the key stands, under the same ready check every page under this layout makes, and kept
 * between visits as every page that reads the deployment for itself is (../lib/processor-cache.ts).
 *
 * **only a reading with no key is served to a second visit.** a Zap is turned on at Zapier and never
 * on this console, and the listening count is what an operator comes back here to see, so a reading
 * with a key could have moved with nothing pressed here. with no key, nothing can subscribe.
 */
export function clientLoader(args: Route.ClientLoaderArgs) {
	return readKeptPage(
		args,
		async () => {
			const read = await readConsole(args.request);
			if (read.reading.face.kind !== 'ready') notReady(read);
			return { zapier: await readZapier() };
		},
		{ standing: ({ zapier }) => zapier.kind === 'read' && zapier.report.key === null }
	);
}

/** the make or the replace, each one call on the loopback address. */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const press = pressOf((await request.formData()).get('intent'));
	if (press === null) return { unknown: true as const };

	// the press travels back with the answer: the deployment says nothing at all where there is no
	// report, and an outcome reports at the control that caused it.
	return { zapier: { press, pressed: await pressZapier({ press }) } };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function ZapierPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const submit = useSubmit();
	const { intent } = usePress();

	const answered = actionData && 'zapier' in actionData ? actionData.zapier : null;
	const answer: ZapierAnswer | null =
		answered === null
			? null
			: answered.pressed.kind === 'reported'
				? { kind: 'reported', report: answered.pressed.report }
				: { kind: 'unanswered', press: answered.press, read: answered.pressed.read };

	return (
		<Column>
			<ZapierSection
				zapier={loaderData.zapier}
				answer={answer}
				pending={pressOf(intent)}
				address={shell.address}
				onPress={(press) =>
					void submit({ intent: zapierIntent(press) }, { method: 'post', preventScrollReset: true })
				}
			/>
		</Column>
	);
}
