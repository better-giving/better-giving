import { holdBar, isDrawn, passOver } from '@better-giving/operator/progress-bar';
import type { LoaderFunctionArgs } from 'react-router';
import type { CacheAdapter } from 'remix-client-cache';
import { cache, cacheClientLoader } from 'remix-client-cache';
import { chariotRun, paypalRun, stripeRun } from '../api/client';
import type { PaymentProcessor } from '../api/types';
import { PROCESSORS } from './processor-links';
import { readProcessorScreen } from './processor-reading';

// what a page that reads the deployment for itself was last read as, kept between visits, so opening
// it a second time draws at once rather than taking those round trips again. every processor page is
// one (./processor-reading.ts), and so are the books page (../routes/_sections.quickbooks.tsx) and
// the Zapier page (../routes/_sections.zapier.tsx).
//
// **the store is `remix-client-cache`'s own in-memory map and never a `Storage`**: the reading holds
// the account's payments as promises, which no storage can hold, and nothing about a deployment
// belongs on disk after the console closes. an entry is keyed by the pathname, so a dialog opened
// over the page (./dialog-params.ts) reads the page's entry.
//
// **an entry is served only to a move into its page**, and read past in three cases:
// - a re-read of the page already on the screen — a press's revalidation, and the page asking again
//   once a run stops (./stripe-section.tsx) — which wants what the binary says now;
// - an entry the page itself reads past (`standing`), because what it holds could have moved with
//   nothing pressed here: a run going or ended — a going one has since moved on, and an ended one's
//   report was consumed by the reading that kept it (../api/client.ts), so it is never drawn twice
//   from here — a books page with no company connected, since a company is connected in a
//   browser at the deployment and never here, and a Zapier page with a key, since a Zap is turned
//   on at Zapier;
// - anything after a press, on any page: every `clientAction` forgets every entry before it writes
//   (`forgetReadings`), so nothing drawn after a write was read before it. a reading that was in
//   flight when that happened is thrown away when it lands rather than kept. a press that writes
//   nothing — the books page's start-date preview — forgets nothing.
//
// an entry whose payments or recurring reading rejects is dropped, so the next visit asks again
// rather than meeting the same error from memory.
//
// **the bar over the screen being replaced is finished by a reading that reaches the binary**: a
// processor page is opened from the rail, which reads nothing again above it, and is an address an
// operator can reload — both put a bar on the screen until the reading is in
// (packages/operator/src/progress-bar.ts). an entry served from here reaches nothing and takes no
// pass, so no bar is drawn over it.
//
// **a rail cell for a processor page reads that page ahead of the press** (`warmProcessorPage`, from
// ./router-link.tsx), when it is hovered or focused and nothing is kept for it yet. that reading
// stands behind no bar, one at a time per page, and a press made while it is in flight waits for it
// behind the bar rather than reading a second time — a run that landed is consumed by the reading
// that observed it (../api/client.ts), so a second read would lose the report.
//
// **and never for the page already on the screen**, whose cell is under the pointer as often as not.
// that page asks after its own run (./stripe-section.tsx), and a reading ahead that got to the landed
// run first would leave its poll holding a run that is going forever — the page frozen busy.

/**
 * each processor page's setup run, which is the one reading the pages differ by. NOWPayments' press
 * is a save that starts none, so its page reads a run that is always `null` and is otherwise kept,
 * served and read ahead like the rest.
 */
const RUNS = {
	stripe: stripeRun,
	paypal: paypalRun,
	chariot: chariotRun,
	nowpayments: async () => null
} satisfies Record<PaymentProcessor, () => Promise<unknown>>;

type RunOf<P extends PaymentProcessor> = Awaited<ReturnType<(typeof RUNS)[P]>>;

/** what a processor page is drawn out of. */
export type ProcessorScreen<P extends PaymentProcessor> = Awaited<
	ReturnType<typeof readProcessorScreen<RunOf<P>>>
>;

type Kept = ProcessorScreen<PaymentProcessor>;

/** how many times every entry has been forgotten: a reading started under an older count is stale. */
let forgotten = 0;

/** every key written, which is what forgetting walks: the store names none of its own. */
const written = new Set<string>();

/** the reading ahead of a press, per page, and the count it was started under. `null` read nothing. */
const warming = new Map<string, { under: number; screen: Promise<Kept | null> }>();

/** the store, with a write from a reading started before the last forgetting dropped. */
function storeUnder(under: number): CacheAdapter {
	return {
		getItem: (key) => cache.getItem(key),
		setItem: (key, value) => {
			if (under !== forgotten) return;
			written.add(key);
			return cache.setItem(key, value);
		},
		removeItem: (key) => cache.removeItem(key)
	};
}

/** drops `screen`'s kept entry once either of its promises rejects, unless a later reading replaced it. */
function dropOnFailure(key: string, screen: Kept): void {
	Promise.all([screen.payments, screen.recurring]).catch(async () => {
		if ((await cache.getItem(key)) === screen) await cache.removeItem(key);
	});
}

/** whether a kept entry may be drawn for a load of `key`. */
function servable<T>(key: string, kept: T | undefined, standing: (kept: T) => boolean): kept is T {
	return kept !== undefined && !isDrawn(key) && standing(kept);
}

/**
 * the `clientLoader` of a page whose reading is kept, on the rules above: `read` is what reaches the
 * binary where nothing servable is kept, `standing` is what the page reads its own entry past, and
 * `took` is handed the reading that reached the binary where one did.
 */
export async function readKeptPage<T>(
	args: LoaderFunctionArgs,
	read: () => Promise<T>,
	{ standing, took }: { standing: (kept: T) => boolean; took?: (read: T) => void }
): Promise<T> {
	const key = new URL(args.request.url).pathname;
	const under = forgotten;
	const kept: T | undefined = await cache.getItem(key);

	if (servable(key, kept, standing)) passOver(key);
	else if (kept !== undefined) await cache.removeItem(key);

	let taken: T | null = null;
	return cacheClientLoader<LoaderFunctionArgs & { serverLoader: () => Promise<T> }>(
		{
			...args,
			serverLoader: async () => {
				// finished on every way out: this pass supersedes the layout's for the same move, so a
				// gate thrown out of `read` would otherwise replace the page under a bar part full.
				const bar = holdBar(key);
				try {
					taken = await read();
					return taken;
				} finally {
					await bar.finish();
				}
			}
		},
		{ type: 'normal', key, adapter: storeUnder(under) }
	).then((loaded) => {
		if (taken !== null) took?.(taken);
		return loaded;
	});
}

/** a processor page's `clientLoader`. */
export function readProcessorPage<P extends PaymentProcessor>(
	args: LoaderFunctionArgs,
	processor: P
): Promise<ProcessorScreen<P>> {
	const { request } = args;
	const key = new URL(request.url).pathname;

	// a reading ahead is joined by a move into its page and never by a re-read of the page on the
	// screen, which wants what the binary says now. one that failed is no answer for the press, which
	// asks again for itself.
	const warm = isDrawn(key) ? undefined : warming.get(key);
	const joined = warm?.under === forgotten ? warm.screen.catch(() => null) : null;
	const readRun = RUNS[processor] as () => Promise<RunOf<P>>;

	return readKeptPage<ProcessorScreen<P>>(
		args,
		async () =>
			((await joined) as ProcessorScreen<P> | null) ??
			(await readProcessorScreen(request, readRun)),
		{ standing: (kept) => kept.run === null, took: (read) => dropOnFailure(key, read) }
	);
}

/** every writing `clientAction`'s first step: nothing read before a press is drawn after it. */
export async function forgetReadings(): Promise<void> {
	forgotten += 1;
	warming.clear();
	const keys = [...written];
	written.clear();
	await Promise.all(keys.map((key) => cache.removeItem(key)));
}

/** which processor's page `href` is, and `null` for any other address. */
function processorAt(href: string): PaymentProcessor | null {
	for (const [processor, { href: page }] of Object.entries(PROCESSORS)) {
		if (page === href) return processor as PaymentProcessor;
	}
	return null;
}

/**
 * reads the page at `href` ahead of a press, where it is a processor page not on the screen, with
 * nothing kept and no reading of it already in flight. `origin` is the console's own, which the address is read against.
 *
 * a reading that fails keeps nothing: the press reads again, and meets the failure there.
 */
export function warmProcessorPage(href: string, origin: string): void {
	const processor = processorAt(href);
	if (processor === null || isDrawn(href) || warming.has(href)) return;
	const under = forgotten;
	const screen = (async (): Promise<Kept | null> => {
		if ((await cache.getItem(href)) !== undefined) return null;
		const readRun: () => Promise<Kept['run']> = RUNS[processor];
		const read = await readProcessorScreen(new Request(new URL(href, origin)), readRun);
		if ((await cache.getItem(href)) === undefined) await storeUnder(under).setItem(href, read);
		dropOnFailure(href, read);
		return read;
	})();
	warming.set(href, { under, screen });
	const settled = () => {
		if (warming.get(href)?.screen === screen) warming.delete(href);
	};
	screen.then(settled, settled);
}
