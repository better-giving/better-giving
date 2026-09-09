import { describe, expect, it } from 'vitest';
import type { SignIn, SignInStatus } from '../api/types';
import { connectFace } from './connect-face';

// which face of the connect panel the operator is looking at, decided in one place off three facts:
// this machine's sign-in, the sign-in that may be open in a browser right now, and what this
// machine already recorded.
//
// it is a function of those three and of nothing else, which is what lets every state be looked at
// without a cloudflare account, a network or a browser.

const hound = { id: 'c8b0cf21be22bec40c6fd4dec7a6bbf7', name: 'hound-haven' };
const salas = { id: '457b5d4a3344c1fd84107230619b9acf', name: 'justin-salas' };

const oauth = (...accounts: { id: string; name: string }[]): SignIn => ({
	kind: 'oauth',
	email: 'operator@example.org',
	accounts,
	detail: ''
});

/** every phase the binary answers with, in the shape it answers in. */
const idle: Pick<SignInStatus, 'phase' | 'address' | 'why' | 'detail'> = {
	phase: 'signed-in',
	address: '',
	why: '',
	detail: ''
};

const face = (over: Partial<Parameters<typeof connectFace>[0]> = {}) =>
	connectFace({
		signIn: oauth(hound, salas),
		login: idle,
		chosen: null,
		tokenSet: false,
		...over
	});

describe('signing this machine in', () => {
	const out: SignIn = { kind: 'signed-out', email: null, accounts: [], detail: '' };

	it('offers the sign-in when this machine holds none', () => {
		expect(
			face({ signIn: out, login: { phase: 'idle', address: '', why: '', detail: '' } })
		).toEqual({
			kind: 'signed-out'
		});
	});

	it('waits, with the address, while one is open in a browser', () => {
		expect(
			face({
				signIn: out,
				login: {
					phase: 'waiting',
					address: 'https://dash.cloudflare.com/oauth2/auth?x=1',
					why: '',
					detail: ''
				}
			})
		).toEqual({ kind: 'waiting', address: 'https://dash.cloudflare.com/oauth2/auth?x=1' });
	});

	it('waits with nothing to copy where the binary named no address', () => {
		expect(
			face({ signIn: out, login: { phase: 'waiting', address: '', why: '', detail: '' } })
		).toEqual({
			kind: 'waiting',
			address: null
		});
	});

	it('says why the last one did not finish', () => {
		expect(
			face({
				signIn: out,
				login: { phase: 'unfinished', address: '', why: 'timed-out', detail: '' }
			})
		).toEqual({ kind: 'unfinished', why: 'timed-out', detail: '' });
	});

	it('says a sign-in cloudflare allowed and the binary could not keep', () => {
		// the machine holds no credential either way, and what the operator does about it is not
		// what they do about a browser they closed. the folder the record would have gone in is
		// carried with it, because the sentence that sends the operator to make one writable cannot
		// say which one otherwise.
		expect(
			face({
				signIn: out,
				login: {
					phase: 'unfinished',
					address: '',
					why: 'not-kept',
					detail: '/Users/x/Library/Application Support/better-giving'
				}
			})
		).toEqual({
			kind: 'unfinished',
			why: 'not-kept',
			detail: '/Users/x/Library/Application Support/better-giving'
		});
	});

	it('says the saved sign-in was turned down', () => {
		expect(
			face({
				signIn: {
					kind: 'refused',
					email: null,
					accounts: [],
					detail: 'Invalid access token [code: 9109]'
				}
			})
		).toEqual({ kind: 'expired', token: false });
	});

	it('marks a turned-down API token as its own thing, because signing in again is refused', () => {
		// there is nothing to sign in again as: what is in use came from the terminal the console
		// was started in, so the sentence telling this operator to sign in again would send them to
		// a control that is not drawn.
		expect(
			face({
				signIn: {
					kind: 'refused',
					email: null,
					accounts: [],
					detail: 'Invalid access token [code: 9109]'
				},
				tokenSet: true
			})
		).toEqual({ kind: 'expired', token: true });
	});
});

describe('before an account is recorded', () => {
	it('says so, and carries no list of the accounts the sign-in reaches', () => {
		// the account is chosen at the terminal, so what the panel draws is the command that records
		// one — a list here would be a chooser this console has no press for.
		expect(face()).toEqual({ kind: 'unchosen', token: false, email: 'operator@example.org' });
	});

	it('says the same where the sign-in carries one account — the choice is recorded, never inferred', () => {
		expect(face({ signIn: oauth(hound) })).toEqual({
			kind: 'unchosen',
			token: false,
			email: 'operator@example.org'
		});
	});

	it('says the same where the sign-in carries none, which is the most likely first run', () => {
		expect(face({ signIn: oauth() })).toMatchObject({ kind: 'unchosen' });
	});

	it('says a token is in use, so no sign-in control is drawn', () => {
		expect(
			face({ signIn: { kind: 'token', email: null, accounts: [hound], detail: '' } })
		).toMatchObject({ kind: 'unchosen', token: true, email: null });
	});
});

describe('once an account is recorded', () => {
	const unreachable: SignIn = {
		kind: 'unreachable',
		email: null,
		accounts: [],
		detail: 'fetch failed'
	};

	it('says which one, checked against the sign-in that is on this machine now', () => {
		expect(face({ chosen: { account: hound, remembered: true } })).toEqual({
			kind: 'connected',
			account: hound,
			email: 'operator@example.org',
			remembered: true,
			verified: true,
			notKept: null
		});
	});

	it('carries no address where the account is the one this machine wrote down', () => {
		// nothing was read to say which sign-in it is being shown under, and an api token carries no
		// address at all — so the screen states the account and says nothing about a sign-in.
		expect(
			face({ signIn: unreachable, chosen: { account: hound, remembered: true } })
		).toMatchObject({ kind: 'connected', email: null });
	});

	it('takes the name from the sign-in rather than from what was written down', () => {
		// a cloudflare account can be renamed, and the recorded name is a copy taken at the moment
		// it was chosen. the id is what everything is scoped to, so the name shown is the current
		// one and the record is only how the id is remembered.
		expect(
			face({ chosen: { account: { id: hound.id, name: 'old name' }, remembered: true } })
		).toMatchObject({ account: hound });
	});

	it('blocks when the recorded account is not on this sign-in any more', () => {
		expect(face({ signIn: oauth(salas), chosen: { account: hound, remembered: true } })).toEqual({
			kind: 'account-gone',
			account: hound,
			email: 'operator@example.org',
			token: false
		});
	});

	it('shows what it recorded, marked unchecked, when cloudflare cannot be reached', () => {
		expect(face({ signIn: unreachable, chosen: { account: hound, remembered: true } })).toEqual({
			kind: 'connected',
			account: hound,
			email: null,
			remembered: true,
			verified: false,
			notKept: null
		});
	});

	it('blocks on the unreachable read when there is nothing recorded to fall back to', () => {
		expect(face({ signIn: unreachable })).toEqual({ kind: 'unreachable' });
	});

	it('says the choice will be asked for again when this machine could not write it down', () => {
		expect(face({ chosen: { account: hound, remembered: false } })).toMatchObject({
			remembered: false
		});
	});

	it('says a renewed sign-in this machine could not write down, while it is still signed in', () => {
		// the credential in hand is good and the loss shows at the next launch, so the binary
		// answers `signed-in` with the reason beside it — and the face carries the folder, because
		// the sentence that sends the operator to make one writable cannot say which one otherwise.
		expect(
			face({
				chosen: { account: hound, remembered: true },
				login: {
					phase: 'signed-in',
					address: '',
					why: 'not-kept',
					detail: '/Users/x/Library/Application Support/better-giving'
				}
			})
		).toMatchObject({
			kind: 'connected',
			notKept: '/Users/x/Library/Application Support/better-giving'
		});
	});

	it('says nothing about a sign-in that was written down', () => {
		expect(face({ chosen: { account: hound, remembered: true } })).toMatchObject({
			notKept: null
		});
	});

	it('says it over a sign-in cloudflare could not be asked about either', () => {
		// the two are unrelated readings and both are true at once: the account is what this machine
		// wrote down, and the sign-in behind it is one the next launch will not have.
		expect(
			face({
				signIn: unreachable,
				chosen: { account: hound, remembered: true },
				login: { phase: 'signed-in', address: '', why: 'not-kept', detail: '/x/config' }
			})
		).toMatchObject({ kind: 'connected', verified: false, notKept: '/x/config' });
	});
});
