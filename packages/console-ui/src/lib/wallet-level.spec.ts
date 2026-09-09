import { describe, expect, it } from 'vitest';
import type { WalletHostLine, WalletsLevel } from '../api/types';
import { walletTrouble } from './wallet-level';

// what a site-list save says about wallet buttons, held to the properties tsc cannot see.
//
// what tsc already holds is the covering: `walletTrouble` in ./wallet-level.ts switches over every
// kind of `WalletsLevel` and ends on a `never`, so a kind added to ../api/types.ts with no sentence
// is a compile error rather than a case here. what it cannot hold is that an arm which is drawn
// says anything, that the arms drawn are the right ones, or that each one names the press that
// repairs it — every one of them type-checks perfectly while returning `null`, which is the state
// this module exists to prevent: a levelling that failed and a screen that never showed it.
//
// so the list below is stated rather than derived, which is ./widget-level.spec.ts's shape for the
// same reason. the states are not one per `kind` here — three of them are arms of the report inside
// `reported` — so each case carries its own name.
//
// this package has no DOM pool (../../vite.config.ts), so nothing here is a claim about what
// ./sites-fold.tsx draws. it is a claim about the values that fold draws from.

/** a site the account holds and draws every button on. */
const drawing = (host: string): WalletHostLine => ({
	host,
	own: false,
	standing: 'drawing',
	wallets: {
		apple_pay: { state: 'active', detail: null },
		google_pay: { state: 'active', detail: null },
		link: { state: 'active', detail: null }
	}
});

/** a site the account holds nothing for, which is what one just added is. */
const unregistered = (host: string): WalletHostLine => ({
	host,
	own: false,
	standing: 'unregistered'
});

/** one of every state, named, in the shape the press answers with. */
const ARMS: readonly { name: string; level: WalletsLevel | null }[] = [
	{ name: 'not asked', level: null },
	{
		name: 'unanswered',
		level: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'EOF' } }
	},
	{
		name: 'unreadable',
		level: {
			kind: 'reported',
			report: { state: 'unreadable', reason: 'failed', detail: 'Stripe said no' }
		}
	},
	{
		name: 'no key',
		level: {
			kind: 'reported',
			report: {
				state: 'unreadable',
				reason: 'no_key',
				detail: '`STRIPE_SECRET_KEY` is not set.'
			}
		}
	},
	{
		name: 'all drawing',
		level: {
			kind: 'reported',
			report: {
				state: 'levelled',
				hosts: [{ line: drawing('example.org'), changed: true, detail: null }]
			}
		}
	},
	{
		name: 'one short, with a sentence',
		level: {
			kind: 'reported',
			report: {
				state: 'levelled',
				hosts: [
					{ line: drawing('give.example.org'), changed: false, detail: null },
					{ line: unregistered('shop.elsewhere.test'), changed: false, detail: 'Stripe said no' }
				]
			}
		}
	},
	{
		name: 'one short, with nothing said',
		level: {
			kind: 'reported',
			report: {
				state: 'levelled',
				hosts: [{ line: unregistered('shop.elsewhere.test'), changed: false, detail: null }]
			}
		}
	}
];

/** the states the fold is silent over, and the only ones it may be silent over. */
const SILENT = ['not asked', 'all drawing'];

/** the one state that says something but does not send the operator to a press. */
const NO_PRESS = ['no key'];

const arm = (name: string): WalletsLevel | null => {
	const found = ARMS.find((one) => one.name === name);
	if (found === undefined) throw new Error(`no arm called ${name}`);
	return found.level;
};

describe('what a save says about wallet buttons on the sites it stored', () => {
	it('has a state of each kind to read', () => {
		// a list that stopped covering the answer would pass every case below by having nothing in it
		// to fail on, which is the loudest way a sweep passes.
		expect([...new Set(ARMS.map((one) => one.name))].sort()).toEqual(
			[
				'all drawing',
				'no key',
				'not asked',
				'one short, with a sentence',
				'one short, with nothing said',
				'unanswered',
				'unreadable'
			].sort()
		);
	});

	it('says nothing where every site draws them, or where nothing was asked', () => {
		expect(
			ARMS.filter((one) => SILENT.includes(one.name)).filter(
				(one) => walletTrouble(one.level) !== null
			)
		).toEqual([]);
	});

	it('says something about every registration that did not happen', () => {
		// every one of these is a press that stored a list and left a donor on the new site without
		// buttons, so a fold reading the widget's levelling alone reports a save and says nothing
		// about them.
		expect(
			ARMS.filter((one) => !SILENT.includes(one.name)).filter(
				(one) => (walletTrouble(one.level)?.said ?? '') === ''
			)
		).toEqual([]);
	});

	it('sends every one of them to the press that repairs it, except the one it cannot reach', () => {
		// the sentences differ and the door does not: there is one press for all three levelled
		// arms and the account-level failure, on another fold, and an arm that named none would be
		// a finding with nowhere to act on it. `no key` is excluded on purpose — the payments fold
		// draws no ledger and no press for it either, so the press does not exist to be sent to.
		expect(
			ARMS.filter((one) => !SILENT.includes(one.name) && !NO_PRESS.includes(one.name)).filter(
				(one) => !(walletTrouble(one.level)?.said ?? '').includes('Register all sites')
			)
		).toEqual([]);
	});

	it('sends a keyless deployment to the boxes instead of a press that is not drawn', () => {
		const said = walletTrouble(arm('no key'))?.said ?? '';
		expect(said).not.toContain('Register all sites');
		expect(said).not.toBe('');
	});

	it('names the sites a donor is offered nothing on', () => {
		expect(walletTrouble(arm('one short, with a sentence'))?.said).toContain('shop.elsewhere.test');
		// and never the one that is fine, which would send an operator to look at a site that works.
		expect(walletTrouble(arm('one short, with a sentence'))?.said).not.toContain(
			'give.example.org'
		);
	});

	it('quotes the deployment wherever there are words to quote', () => {
		expect(walletTrouble(arm('unreadable'))?.detail).toBe('Stripe said no');
		expect(walletTrouble(arm('one short, with a sentence'))?.detail).toBe('Stripe said no');
		expect(walletTrouble(arm('no key'))?.detail).toBe('`STRIPE_SECRET_KEY` is not set.');
	});

	it('invents no sentence where the press left none', () => {
		expect(walletTrouble(arm('unanswered'))?.detail).toBeNull();
		expect(walletTrouble(arm('one short, with nothing said'))?.detail).toBeNull();
	});
});
