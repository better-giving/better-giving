import { afterAll, afterEach } from 'vitest';

// no spec reaches the live IRS nonprofit API: every lookup there spends the keyless allowance of
// the machine running the suite (./filing.ts). a setup file of the workers pool and of the node
// `server` project (../../../../vitest.workers.config.ts, ../../../../vitest.config.ts), so a spec
// that forgets to mock ./filing.ts is caught without a line of its own.
//
// a request to the host is refused before it leaves, and every other request goes on to the fetch
// the pool already had. the refusal alone is not enough: `lookUpFiling` answers null over any
// failure, so a spec would stay green. each refusal is kept, and the test it happened in fails at
// its end; one made outside a test fails the file.
//
// the host is written here and not read from ./filing.ts: a module a setup file imports is cached
// before a spec's `vi.mock` runs, so importing it would leave every spec's mock of it real.
// ./live-api.workers.spec.ts holds the two to the same address.
//
// assigned, not `vi.stubGlobal`ed: both pools run with `unstubGlobals`, which would take the guard
// down after the first test. a spec that stubs `fetch` itself gets this guard back when it is
// restored.

const LIVE_API_HOST = 'nonprofits.better.giving';

const refused: string[] = [];

const onward = globalThis.fetch;

globalThis.fetch = (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (URL.parse(url)?.hostname !== LIVE_API_HOST) return onward(input, init);
	const message =
		`a spec reached the live nonprofit API at ${url}, and the request was refused unsent: ` +
		'mock src/lib/server/nonprofits/filing.ts as src/lib/server/pages/draft.workers.spec.ts does, ' +
		'or stub `fetch` as src/lib/server/nonprofits/filing.spec.ts does';
	refused.push(message);
	return Promise.reject(new Error(message));
};

/** throws every refusal since the last call, which fails the test or file it ran in. */
export function refuseLiveApiCalls(): void {
	if (refused.length === 0) return;
	throw new Error(refused.splice(0).join('\n'));
}

afterEach(refuseLiveApiCalls);
afterAll(refuseLiveApiCalls);
