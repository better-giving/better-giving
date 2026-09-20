import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as exportScreen from './_app.admin.donations.export';

// the export screen's `loader`, driven through the chain the deployment serves it under.
//
// **it reads no books, and that is the thing worth holding here.** a press on this screen goes
// straight at the file (./_app.admin.donations.export_.journal.ts), so nothing is counted or
// shaped before one — what this loader does is echo the range back to the boxes and turn what a
// refused press was sent back with into something the screen can draw.
//
// a workers spec even so, because the chain above it is real: the protected layout, a real session
// and the deployment's own gate. what is asserted is the screen's own half — the values off the
// address, and the closed set the problem is read against.
//
// the file itself is ./_app.admin.donations.export_.journal.workers.spec.ts's, the shaping is
// `$lib/server/ledger/journal-file.spec.ts`'s, and what the screen draws out of all this is
// ./_app.admin.donations.export.dom.spec.tsx's.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the screen, which is also the address a refused press is sent back to. */
const SCREEN = '/admin/donations/export';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations/export', module: exportScreen }
	]);
	session = await signIn();
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/**
 * what the screen is handed, off one visit through the chain the deployment serves it under.
 *
 * `query` is what the address carries: the range and the target a press named, and the problem it
 * was sent back with where it was refused ($lib/ledger/journal-range.ts). a visit with none is the
 * first one.
 */
async function visit(query: Record<string, string> = {}) {
	const url = new URL(SCREEN, ORIGIN);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const response = await request(new Request(url, { headers: { cookie: session } }));
	expect(response.status).toBe(200);
	return (await response.json()) as {
		asked: { from: string; to: string; target: string };
		problem: string | null;
		targets: { value: string; label: string; brand: string }[];
	};
}

describe('the presses the screen offers', () => {
	it('is one per accounting system this app shapes a file for', async () => {
		const { targets } = await visit();

		// each carries the brand whose mark the press draws, mapped rather than read off the target's
		// own value: the packages and the brands are two sets, and a third package added to one and
		// not the other is a press wearing another company's logo.
		expect(targets).toEqual([
			{ value: 'quickbooks', label: 'QuickBooks Online', brand: 'quickbooks' },
			{ value: 'xero', label: 'Xero', brand: 'xero' }
		]);
	});
});

describe('the range the boxes go back to holding', () => {
	it('is the one the address carries, echoed as the text it arrived as', async () => {
		const { asked } = await visit({ from: '2026-03-01', to: '2026-03-31', target: 'quickbooks' });

		expect(asked).toEqual({ from: '2026-03-01', to: '2026-03-31', target: 'quickbooks' });
	});

	it('is empty on a first visit, because a guessed range is one nobody asked about', async () => {
		const { asked } = await visit();

		expect(asked).toEqual({ from: '', to: '', target: '' });
	});

	it('keeps a day the calendar does not have, so it can be corrected rather than cleared', async () => {
		const { asked } = await visit({ from: 'last March', to: '2026-03-31', target: 'xero' });

		expect(asked.from).toBe('last March');
	});
});

describe('what a refused press was sent back with', () => {
	it('reaches the screen as the problem the file’s route named', async () => {
		const { problem } = await visit({
			from: '2026-03-01',
			to: '2026-03-31',
			target: 'xero',
			problem: 'nothing_given'
		});

		expect(problem).toBe('nothing_given');
	});

	it('is nothing where the address names none', async () => {
		const { problem } = await visit({ from: '2026-03-01', to: '2026-03-31', target: 'xero' });

		expect(problem).toBeNull();
	});

	it('is nothing where the address names one this app does not state', async () => {
		// an address is something an operator can be handed, and the screen words what this names —
		// so a problem off the closed set is no problem at all rather than a sentence of somebody
		// else's choosing.
		const { problem } = await visit({
			from: '2026-03-01',
			to: '2026-03-31',
			target: 'xero',
			problem: 'the books are on fire'
		});

		expect(problem).toBeNull();
	});
});
