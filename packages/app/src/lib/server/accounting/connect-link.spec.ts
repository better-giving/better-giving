import { describe, expect, it } from 'vitest';
import {
	CONNECT_LINK_LIFETIME_MS,
	connectStateCookie,
	connectStateFrom,
	mintConnectLink,
	mintConnectState,
	readConnectLink
} from './connect-link';

// the guard on who may begin a connection, both halves in one file: the console mints, the route
// that redirects to Intuit reads. a case here holds the pair against each other, which is the only
// thing worth asserting about a signature — that the reader accepts what the minter made, and
// nothing else.

const SECRET = 'a-signing-key-as-long-as-a-real-one-would-be';
const ORIGIN = 'https://give.example.workers.dev';
const NOW = new Date('2026-03-01T10:00:00.000Z');

/** the address as the operator's browser would open it. */
const start = (now = NOW): Promise<string> =>
	mintConnectLink({ secret: SECRET, origin: ORIGIN, now });

const reads = (link: string, now = NOW, secret = SECRET): Promise<boolean> =>
	readConnectLink({ secret, url: new URL(link), now });

describe('the start address', () => {
	it('is good the moment it was minted', async () => {
		expect(await reads(await start())).toBe(true);
	});

	it('is refused once it has run out', async () => {
		const later = new Date(NOW.getTime() + CONNECT_LINK_LIFETIME_MS);
		expect(await reads(await start(), later)).toBe(false);
	});

	it('is refused where the expiry was pushed out and the signature left alone', async () => {
		const link = new URL(await start());
		link.searchParams.set('exp', String(NOW.getTime() + CONNECT_LINK_LIFETIME_MS * 10));
		expect(await reads(link.toString())).toBe(false);
	});

	it('is refused where it carries no signature at all', async () => {
		const link = new URL(await start());
		link.searchParams.delete('sig');
		expect(await reads(link.toString())).toBe(false);
	});

	it('is refused by a deployment holding a different signing key', async () => {
		expect(await reads(await start(), NOW, 'some-other-deployments-key')).toBe(false);
	});
});

describe('the state cookie', () => {
	it('reads back the value it was set with, beside whatever else the browser holds', () => {
		const state = mintConnectState();
		const header = connectStateCookie(state).split(';')[0] ?? '';
		expect(
			connectStateFrom(new Headers({ cookie: `better-auth.session_token=abc; ${header}` }))
		).toBe(state);
	});

	it('mints a different value every time, which is what makes it a check at all', () => {
		expect(mintConnectState()).not.toBe(mintConnectState());
	});

	it('reads nothing off a request carrying no cookie at all', () => {
		expect(connectStateFrom(new Headers())).toBeNull();
	});
});
