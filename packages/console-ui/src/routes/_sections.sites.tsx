import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { readOriginList } from '@better-giving/operator/origins';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { levelWallets, levelWidget, saveSites } from '../api/client';
import type { SitesPress, WidgetLevel } from '../api/types';
import { SITES_TITLE } from '../lib/console-pages';
import { consoleRereads } from '../lib/dialog-params';
import { forgetReadings } from '../lib/processor-cache';
import { SITES_INTENT, siteEdits } from '../lib/sites';
import { SitesFold } from '../lib/sites-fold';
import { usePress } from '../lib/use-press';
import { TITLE } from './_index';
import type { Route } from './+types/_sections.sites';

// /sites — the sites a donation form may be loaded on, drawn by ../lib/sites-fold.tsx. no job waits
// on it: a deployment with no website of its own gives on the donation page it serves at its own
// address (CLAUDE.md → Product surface), so its rail cell states what the list holds rather than
// whether anything is owed.
//
// every reading is the sections layout's (./_sections.tsx); the press is this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${SITES_TITLE} · ${TITLE}` }];
}

/**
 * the levelling that was never asked for, because the deployment stored nothing.
 *
 * every field the binary writes on every answer, empty: the shape is one the form reads uniformly,
 * so the one arm the page produces itself is written the way the binary writes the rest.
 */
const unasked: WidgetLevel = {
	kind: 'unasked',
	domains: [],
	sitekeys: [],
	read: null,
	detail: ''
};

/**
 * how the site-list press went, at the control it was made from.
 *
 * the answer carries the press and nothing else. the boxes are the form layer's and no answer
 * redraws them, so a refusal naming an address is read beside the box still holding it — which is
 * what lets this say only how the press went (../lib/sites-fold.tsx).
 */
const stored = (press: SitesPress) => ({ sites: press });

/**
 * stores the site list on the deployment, and brings cloudflare's copy of it level behind that.
 *
 * **the rule is read here, in front of the press.** what a site may be is one module both ends read
 * (`readOriginList` in `@better-giving/operator/origins`), and this is that one rule read early
 * rather than a second opinion: the deployment parses every list it is sent whatever asked it to.
 * what it buys is the press — a list turned down at the boxes rather than after the widget has been
 * levelled against hosts this deployment will not serve. the sentence says each thing that is wrong
 * with the list once and names no row, because the boxes it is about are on the screen above it.
 *
 * **the list is posted as it was typed, never as this console parsed it**: the trim, the blank-row
 * skip and the dedupe are the deployment's to make over what it stores, and a console that sent its
 * own reading would be storing a list nobody typed.
 *
 * **the widget is levelled only where the list landed**, and it is levelled to the list the
 * deployment stored rather than to the boxes that were posted: the parse that decided what a site
 * may be is the deployment's, and a row it dropped is not one the widget should cover. that order is
 * the one whose failure costs least — a removal this way round leaves cloudflare covering a host
 * nothing is served on, where the reverse would leave a host still served and no longer
 * challengeable, and every gift from it would fail.
 *
 * **the wallet registrations are levelled last and on the same condition**, so a site added here
 * draws Apple Pay, Google Pay and Link without a second press. it is last because the widget is what
 * decides whether a gift from a new site can be made at all, and the wallets only which buttons it
 * is offered on; nothing is posted with it — the hostnames are read on the deployment off the list
 * it has just stored (../lib/wallets-press.ts).
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	if (posted.get('intent') !== SITES_INTENT) return { unknown: true as const };

	const rows = siteEdits(posted);
	const { problem } = readOriginList(rows);
	if (problem !== null) {
		return stored({
			written: { kind: 'refused', message: problem, fix: null },
			widget: unasked,
			wallets: null
		});
	}

	const written = await saveSites(rows);
	if (written.kind !== 'saved') {
		return stored({ written, widget: unasked, wallets: null });
	}
	const widget = await levelWidget(written.sites);
	return stored({ written, widget, wallets: await levelWallets() });
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function SitesPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy } = usePress();
	return (
		<Column>
			{/* the cell is named for what it opens and the page states the question it answers. */}
			<PageHeader standfirst={FOLD_LABELS.sites} />
			<SitesFold
				sites={shell.reading.sites}
				donatePage={shell.reading.donatePage}
				list={actionData && 'sites' in actionData ? actionData.sites : null}
				busy={busy}
				pending={intent}
			/>
		</Column>
	);
}
