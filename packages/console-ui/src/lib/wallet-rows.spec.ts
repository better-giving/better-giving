import { describe, expect, it } from 'vitest';
import type { PaymentsRead, Wallet, WalletHostLine, WalletsLevel } from '../api/types';
import { linkStanding, walletHostLines, walletRow, walletRows } from './wallet-rows';

// the reading behind the wallet panels, held to the properties tsc cannot see.
//
// what tsc holds is the shape: a standing added to ../api/types.ts is a compile error inside
// `walletRow`. what it cannot hold is that the answer is about the wallet being asked after — every
// arm below type-checks perfectly while reporting the site's whole standing, which is the state
// this module exists to prevent: a panel headed Google Pay reporting a site as fine because
// Apple Pay is drawn on it.
//
// this package has no DOM pool (../../vite.config.ts), so nothing here is a claim about what
// ./payments-fold.tsx draws. it is a claim about the values that fold draws from.

/** one wallet drawn, and the account with nothing to say about it. */
const active = { state: 'active', detail: null } as const;

/** a site the account holds and draws every button on. */
const drawing = (host: string, own = false): WalletHostLine => ({
	host,
	own,
	standing: 'drawing',
	wallets: { apple_pay: active, google_pay: active, link: active }
});

/** a site the account holds and is drawing all but the one named. */
const held = (host: string, wallet: Wallet, detail: string | null): WalletHostLine => ({
	host,
	own: false,
	standing: 'wallet_inactive',
	wallets: {
		apple_pay: active,
		google_pay: active,
		link: active,
		[wallet]: { state: 'inactive', detail }
	}
});

const switchedOff = (host: string): WalletHostLine => ({
	host,
	own: false,
	standing: 'switched_off',
	wallets: { apple_pay: active, google_pay: active, link: active }
});

const unregistered = (host: string): WalletHostLine => ({
	host,
	own: false,
	standing: 'unregistered'
});

describe('one site, one wallet', () => {
	it('reads a site the account holds nothing for as unregistered', () => {
		expect(walletRow(unregistered('a.org'), 'apple_pay')).toStrictEqual({
			host: 'a.org',
			own: false,
			standing: 'unregistered',
			detail: null
		});
	});

	it('reads a registration the account is not honouring as switched off, whatever the wallets say', () => {
		// the line carries all three wallets active and the site still draws none of them, which
		// is the whole reason `switched_off` outranks what the wallets report.
		expect(walletRow(switchedOff('a.org'), 'link').standing).toBe('switched_off');
	});

	it('reads a wallet the account is drawing as showing', () => {
		expect(walletRow(drawing('a.org', true), 'google_pay')).toStrictEqual({
			host: 'a.org',
			own: true,
			standing: 'showing',
			detail: null
		});
	});

	it('reads a wallet the account is holding back as not showing, with what it said', () => {
		expect(walletRow(held('a.org', 'apple_pay', 'Domain not verified'), 'apple_pay')).toStrictEqual(
			{
				host: 'a.org',
				own: false,
				standing: 'not_showing',
				detail: 'Domain not verified'
			}
		);
	});

	it('reports the wallet being asked after and not the site’s whole standing', () => {
		// one line, two panels: the site is short of Apple Pay and is drawing Google Pay, so the
		// two rows drawn from it say different things.
		const line = held('a.org', 'apple_pay', null);
		expect(walletRow(line, 'apple_pay').standing).toBe('not_showing');
		expect(walletRow(line, 'google_pay').standing).toBe('showing');
	});

	it('keeps the deployment’s own order', () => {
		const rows = walletRows([drawing('own.workers.dev', true), unregistered('b.org')], 'link');
		expect(rows.map((row) => row.host)).toStrictEqual(['own.workers.dev', 'b.org']);
	});
});

describe('what the whole list says about Link', () => {
	it('is everywhere where every site draws it', () => {
		expect(linkStanding(walletRows([drawing('a.org'), drawing('b.org')], 'link'))).toBe(
			'everywhere'
		);
	});

	it('is not everywhere where one site does not', () => {
		expect(linkStanding(walletRows([drawing('a.org'), unregistered('b.org')], 'link'))).toBe(
			'not_everywhere'
		);
	});

	it('is not everywhere where no site does', () => {
		expect(linkStanding(walletRows([switchedOff('a.org'), unregistered('b.org')], 'link'))).toBe(
			'not_everywhere'
		);
	});

	it('is not everywhere where there are no sites at all', () => {
		// `every` over an empty list is true, so this is the arm that would otherwise draw a tick over
		// an empty panel.
		expect(linkStanding([])).toBe('not_everywhere');
	});
});

describe('which sites a panel is drawn from', () => {
	const read = (hosts: WalletHostLine[]): PaymentsRead => ({
		kind: 'read',
		report: {
			rails: { state: 'read', chargesEnabled: true, rails: [] },
			webhook: { state: 'verifying', detail: null },
			subscription: { state: 'complete' },
			wallets: { state: 'read', hosts }
		}
	});

	const levelled = (hosts: WalletHostLine[]): WalletsLevel => ({
		kind: 'reported',
		report: {
			state: 'levelled',
			hosts: hosts.map((line) => ({ line, changed: true, detail: null }))
		}
	});

	it('draws from the account reading where no press has been made', () => {
		expect(
			walletHostLines(null, read([unregistered('a.org')]))?.map((line) => line.standing)
		).toStrictEqual(['unregistered']);
	});

	it('draws from the press’s answer where there is one, and not from the reading behind it', () => {
		// the reading was taken before the press and still says unregistered; what the panel redraws
		// from is what the press left behind.
		expect(
			walletHostLines(levelled([drawing('a.org')]), read([unregistered('a.org')]))?.map(
				(line) => line.standing
			)
		).toStrictEqual(['drawing']);
	});

	it('falls back to the reading where the press never reached the account', () => {
		const unreadable: WalletsLevel = {
			kind: 'reported',
			report: { state: 'unreadable', reason: 'failed', detail: 'Stripe said no' }
		};
		expect(
			walletHostLines(unreadable, read([drawing('a.org')]))?.map((line) => line.host)
		).toStrictEqual(['a.org']);
	});

	it('draws nothing where the site read could not be made', () => {
		const blind: PaymentsRead = {
			kind: 'read',
			report: {
				rails: { state: 'read', chargesEnabled: true, rails: [] },
				webhook: { state: 'verifying', detail: null },
				subscription: { state: 'complete' },
				wallets: { state: 'unreadable', reason: 'failed', detail: 'Stripe said no' }
			}
		};
		expect(walletHostLines(null, blind)).toBeNull();
	});

	it('draws nothing where the deployment answered nothing at all', () => {
		expect(walletHostLines(null, { kind: 'unread', read: { kind: 'no-session' } })).toBeNull();
	});
});
