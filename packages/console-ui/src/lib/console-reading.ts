import { data, isRouteErrorResponse, redirect } from 'react-router';
import { consoleVersion, homeReading, homeShape } from '../api/client';
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
// **`/` hands its reading over to the navigation it redirects to.** that redirect is a navigation of
// its own with a request of its own, and what it reads is exactly what `/` just read: nothing ran in
// between. the reading handed over is taken by the next read and by nothing after it.
//
// every face is a browser fetch, so none of it is there when the document arrives: what stands
// until the first of them lands is ../root.tsx's own waiting face, which is where a client-rendered
// app is allowed to put one.

/** every reading, off the binary. */
async function takeReading() {
	const [home, release, read] = await Promise.all([homeShape(), consoleVersion(), homeReading()]);

	return {
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
