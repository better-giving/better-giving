import { consoleVersion, homeReading, homeShape } from '../api/client';
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
			// the twenty-one as cloudflare answered for them: the pages draw the rows and the boxes out
			// of the same answer the rail's statuses were read from.
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
