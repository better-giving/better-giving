import { data, isRouteErrorResponse, redirect } from 'react-router';
import { consoleVersion, homeReading, homeShape, writesAnswered } from '../api/client';
import { type CloudflareGate, cloudflareGate } from './cloudflare-gate';
import { heldNames, readSections } from './home-sections';
import { orgBoxes } from './org-fields';
import { processorLinks } from './processor-links';

// every reading the console's pages are a function of, taken once per navigation.
//
// **three loaders ask for it and one read answers them.** `/` reads it to decide which face to draw
// or which page to send a ready deployment to (../routes/_index.tsx), the sections layout reads it
// for the rail and the foot (../routes/_sections.tsx), and a processor page reads it to be sure the
// deployment is ready before it reads that processor's run (./processor-reading.ts). each read is
// several loopback round trips, one of them out to cloudflare, so a second copy is a second or more
// on every page an operator opens.
//
// **a navigation is one `Request`, handed to every loader it runs**, which is what the read is
// joined on: two loaders of one navigation share it, and a later navigation — the re-read after a
// press — takes a fresh one, so nothing drawn after a write was read before it.
//
// **a reading is never taken while a write this page made is unanswered**: it waits until every
// one has been answered (`writesAnswered` in ../api/client.ts). a press is answered before its own
// re-read is asked, so what this waits on is a write still out while something else reads: a
// fetcher's, or one whose navigation another replaced, which the router has stopped waiting for
// while the binary goes on writing. a setup chain's writes after its press answered are the
// binary's and not waited on, and a reading handed over below was taken by `/` and is not asked
// again.
//
// **whether the reading on screen predates a dropped press is a count compared** ({@link
// droppedSinceRead}). the router throws away the answer to a press whose navigation another
// replaced, and never says so to the navigation that replaced it; that navigation is the one
// ./dialog-params.ts judges. every dropped press counts one ({@link watchPress}), every reading is
// stamped with the count it was taken after, and the stamp that counts is the one on the reading
// the screen draws: the last one a drawing loader handed over ({@link drawsReading}) whose
// navigation was not itself abandoned, since an abandoned one is never drawn. a reading taken and
// left — a move abandoned after its reading landed, a page read ahead of its press — clears
// nothing.
//
// **`/` hands its reading over to the navigation it redirects to.** that redirect is a navigation of
// its own with a request of its own, and what it reads is exactly what `/` just read: nothing ran in
// between. the reading handed over is taken by the next read and by nothing after it.
//
// every face is a browser fetch, so none of it is there when the document arrives: what stands
// until the first of them lands is ../root.tsx's own waiting face, which is where a client-rendered
// app is allowed to put one.

let drops = 0;

const stamps = new WeakMap<ConsoleReading, number>();

/** a reading a loader handed over to be drawn, and the navigation it rides on. */
type Drawn = { signal: AbortSignal; stamp: number };

let drawn: Drawn[] = [];

/** the newest reading handed over whose navigation has not been abandoned: the one on screen. */
const onScreen = (): Drawn | undefined => drawn.filter(({ signal }) => !signal.aborted).pop();

/**
 * the first call of every `clientAction` (../every-press-forgets.spec.ts): marks the press if the
 * router abandons its request before its answer is drawn, which it does when another navigation
 * replaces the press's own, in its action or in the re-read after it — the re-read carries the same
 * signal.
 */
export function watchPress(request: Request): void {
	request.signal.addEventListener(
		'abort',
		() => {
			drops += 1;
		},
		{ once: true }
	);
}

/**
 * what a loader that draws the reading states as it hands it over: the sections layout, and `/`
 * where it draws a face. the reading on screen before this one is kept beside it, since this one's
 * navigation can still be abandoned.
 */
export function drawsReading(request: Request, reading: ConsoleReading): void {
	const standing = onScreen();
	drawn = [
		...(standing === undefined ? [] : [standing]),
		{ signal: request.signal, stamp: stamps.get(reading) ?? 0 }
	];
}

/** whether a press has been dropped since the reading on screen was taken ({@link watchPress}). */
export const droppedSinceRead = (): boolean => drops > (onScreen()?.stamp ?? 0);

/** every reading, off the binary, once every write out has been answered. */
async function takeReading() {
	await writesAnswered();
	const after = drops;
	const [home, release, read] = await Promise.all([homeShape(), consoleVersion(), homeReading()]);

	const reading = {
		// the release, printed at the foot of every screen.
		version: release.version,
		account: home.account.name,
		// what cloudflare resolves that name by. the foot states it beside the name because the name
		// is not unique and this is.
		accountId: home.account.id,
		remembered: home.remembered,
		notKept: home.notKept,
		workerName: home.workerName,
		databaseName: home.databaseName,
		reading: {
			face: read.face,
			sections: readSections(read),
			// the seed both pages that edit the profile read.
			stored: orgBoxes(read.org),
			// the deploy-time values as cloudflare answered for them: the pages draw the rows and the
			// boxes out of the same answer the rail's statuses were read from.
			values: read.values,
			sites: read.sites,
			donatePage: read.donatePage,
			// the rail's processor cells, which read the held values and nothing about either account:
			// what each processor answers is read on its own page.
			processors: processorLinks(heldNames(read.values.vars))
		}
	};
	stamps.set(reading, after);
	return reading;
}

export type ConsoleReading = Awaited<ReturnType<typeof takeReading>>;

const joined = new WeakMap<Request, Promise<ConsoleReading>>();

let handedOver: ConsoleReading | null = null;

/** the reading for this navigation, taken by the first loader to ask and joined by the rest. */
export function readConsole(request: Request): Promise<ConsoleReading> {
	const already = joined.get(request);
	if (already !== undefined) return already;
	const taken = handedOver;
	handedOver = null;
	const read = taken === null ? takeReading() : Promise.resolve(taken);
	joined.set(request, read);
	return read;
}

/** `/`'s side, just before it redirects: the navigation it starts reads this rather than again. */
export function handOver(reading: ConsoleReading): void {
	handedOver = reading;
}

/** what a page behind a gate is drawn from: the gate, and the head and foot around it. */
export type GatedPage = {
	gate: CloudflareGate;
	account: string;
	accountId: string;
	remembered: boolean;
	notKept: string | null;
	version: string;
};

/** the gate this reading stands behind, with what draws around it, or `null` where there is none. */
export function gatedPage(read: ConsoleReading): GatedPage | null {
	const gate = cloudflareGate(read.reading.face, read.reading.values.vars, {
		workerName: read.workerName,
		accountName: read.account
	});
	if (gate === null) return null;
	const { account, accountId, remembered, notKept, version } = read;
	return { gate, account, accountId, remembered, notKept, version };
}

/**
 * where a section page goes when the deployment is not ready: called by the sections layout and by
 * every page under it that reads the deployment for itself (../routes/_sections.tsx).
 *
 * **a gate is thrown to the layout's error boundary, which draws it in place of the whole shell.**
 * the page keeps its address, so the read again the gate offers lands back on it. every other face
 * that is not ready is `/`'s, which is where that face is drawn and where its way out is.
 */
export function notReady(read: ConsoleReading): never {
	const gated = gatedPage(read);
	if (gated !== null) throw data(gated, { status: 503 });
	throw redirect('/', 307);
}

/** the gated page an error boundary was handed, or `null` where what it caught is anything else. */
export function gatedBy(error: unknown): GatedPage | null {
	if (!isRouteErrorResponse(error) || error.status !== 503) return null;
	const page: unknown = error.data;
	return typeof page === 'object' && page !== null && 'gate' in page ? (page as GatedPage) : null;
}
