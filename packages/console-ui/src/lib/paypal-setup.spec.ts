import { describe, expect, it, vi } from 'vitest';
import { startPaypalSetup } from '../api/client';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import {
	LINES,
	PAIR_BLANK,
	PAYPAL_FIELD,
	PAYPAL_FORM,
	PAYPAL_LIVE,
	PAYPAL_NOT_ADDRESS,
	PAYPAL_SANDBOX,
	boxesStanding,
	isPaypalAddress,
	lineAt,
	pairArmed,
	pairTurnedDown,
	paypalPairPosted,
	reportStands
} from './paypal-setup';

const ended = (stage: PaypalStage, outcome: PaypalSetup): PaypalRunRead => ({
	kind: 'ended',
	stage,
	facts: { registration: null, elsewhere: [] },
	outcome
});

const body = (clientId: string, secret: string, address = PAYPAL_LIVE): FormData => {
	const posted = new FormData();
	posted.set(PAYPAL_FIELD('PAYPAL_CLIENT_ID'), clientId);
	posted.set(PAYPAL_FIELD('PAYPAL_CLIENT_SECRET'), secret);
	posted.set(PAYPAL_FIELD('PAYPAL_API_URL'), address);
	return posted;
};

describe('the address box', () => {
	it('takes live and sandbox, with or without one trailing slash', () => {
		expect(isPaypalAddress(PAYPAL_LIVE)).toBe(true);
		expect(isPaypalAddress(`${PAYPAL_SANDBOX}/`)).toBe(true);
	});

	it('refuses anything past the origin, and anything not https', () => {
		for (const typed of [
			'http://api-m.paypal.com',
			'https://api-m.paypal.com/v1',
			'https://api-m.paypal.com//',
			'https://api-m.paypal.com?x=1',
			'https://user@api-m.paypal.com',
			'api-m.paypal.com'
		]) {
			expect(isPaypalAddress(typed), typed).toBe(false);
		}
	});
});

describe('the pair a press posts', () => {
	it('trims every box rather than sending the binary a value it turns down', () => {
		expect(paypalPairPosted(body('  id ', '\tsecret\n', ` ${PAYPAL_SANDBOX} `))).toEqual({
			ok: true,
			pair: { clientId: 'id', secret: 'secret', address: PAYPAL_SANDBOX }
		});
	});

	it('takes an emptied address, which the binary reads as live', () => {
		expect(paypalPairPosted(body('id', 'secret', ''))).toEqual({
			ok: true,
			pair: { clientId: 'id', secret: 'secret', address: '' }
		});
	});

	it('refuses each box by its own name', () => {
		expect(paypalPairPosted(body(' ', '', 'https://example.org/path'))).toEqual({
			ok: false,
			errors: {
				PAYPAL_CLIENT_ID: PAIR_BLANK,
				PAYPAL_CLIENT_SECRET: PAIR_BLANK,
				PAYPAL_API_URL: PAYPAL_NOT_ADDRESS
			}
		});
	});

	it('is the rule the form runs first, on what conform hands over', () => {
		const schema = PAYPAL_FORM.schema;
		const pair = {
			[PAYPAL_FIELD('PAYPAL_CLIENT_ID')]: 'id',
			[PAYPAL_FIELD('PAYPAL_CLIENT_SECRET')]: 'secret'
		};
		expect(schema.safeParse(pair).success).toBe(true);
		const refused = schema.safeParse({
			...pair,
			[PAYPAL_FIELD('PAYPAL_API_URL')]: 'https://example.org/path'
		});
		expect(refused.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
			[PAYPAL_FIELD('PAYPAL_API_URL'), PAYPAL_NOT_ADDRESS]
		]);
	});

	it('reaches the binary with the address in the one body the keys go in', async () => {
		// the route's own composition: the body read by the boxes' rules, then handed on whole.
		const sent: unknown[] = [];
		vi.stubGlobal('fetch', (_path: string, init: RequestInit | undefined) => {
			sent.push(JSON.parse(String(init?.body)));
			return Promise.resolve(new Response(JSON.stringify({ run: null }), { status: 200 }));
		});
		const read = paypalPairPosted(body('id', 'secret', PAYPAL_SANDBOX));
		if (!read.ok) throw new Error('the boxes were refused');
		await startPaypalSetup(read.pair);
		expect(sent).toEqual([{ clientId: 'id', secret: 'secret', address: PAYPAL_SANDBOX }]);
	});
});

describe('the ledger lines', () => {
	it('draws one line per stage, in the order the chain reaches them', () => {
		expect(LINES.map((line) => line.stage)).toEqual([
			'authorizing',
			'registering',
			'storing',
			'repeating'
		]);
	});

	it('draws repeating gifts as the last line, so the store reads done while it runs', () => {
		expect(lineAt('repeating')).toBe(3);
		expect(lineAt('storing')).toBeLessThan(lineAt('repeating'));
	});
});

describe('where a stopped run reports', () => {
	const refused = ended('authorizing', {
		kind: 'unauthorized',
		failure: { kind: 'refused', detail: 'invalid_client' }
	});
	const unreachable = ended('authorizing', {
		kind: 'unauthorized',
		failure: { kind: 'unreachable', detail: 'timeout' }
	});
	const full = ended('registering', { kind: 'full', listeners: [] });

	it('says a turned-down pair at the boxes and nowhere else', () => {
		expect(pairTurnedDown(refused)).toBe(true);
		expect(reportStands(refused, false)).toBe(false);
	});

	it('keeps a ledger for PayPal not answering at the key check, which is not the pair', () => {
		expect(pairTurnedDown(unreachable)).toBe(false);
		expect(reportStands(unreachable, false)).toBe(true);
	});

	it('keeps a ledger for repeating gifts that did not get set up', () => {
		const unrepeating = ended('repeating', {
			kind: 'unrepeating',
			setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
			awaitingKey: true
		});
		expect(reportStands(unrepeating, false)).toBe(true);
	});

	it('stands under the boxes only while no card is up', () => {
		expect(reportStands(full, false)).toBe(true);
		expect(reportStands(full, true)).toBe(false);
	});

	it('draws nothing for a run that landed or is still going', () => {
		expect(reportStands(ended('storing', { kind: 'done' }), false)).toBe(false);
		expect(
			reportStands(
				{
					kind: 'running',
					stage: 'registering',
					facts: { registration: null, elsewhere: [] },
					outcome: null
				},
				false
			)
		).toBe(false);
	});
});

describe('what the boxes are seeded from', () => {
	const reported = {
		PAYPAL_CLIENT_ID: 'old',
		PAYPAL_CLIENT_SECRET: 'old-secret',
		PAYPAL_API_URL: PAYPAL_LIVE
	};
	const sent = {
		PAYPAL_CLIENT_ID: 'new',
		PAYPAL_CLIENT_SECRET: 'new-secret',
		PAYPAL_API_URL: PAYPAL_SANDBOX
	};

	it('is what was sent, from the moment the run says it stored it until the re-read lands', () => {
		const done = ended('storing', { kind: 'done' });
		expect(boxesStanding({ reported, sent, run: done, reread: false })).toEqual({
			seeded: sent,
			spent: true
		});
		expect(boxesStanding({ reported, sent, run: done, reread: true })).toEqual({
			seeded: reported,
			spent: true
		});
	});

	it('is what was sent where repeating gifts stopped, which is past the store', () => {
		const unrepeating = (awaitingKey: boolean) =>
			ended('repeating', {
				kind: 'unrepeating',
				setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
				awaitingKey
			});
		for (const awaitingKey of [true, false]) {
			expect(
				boxesStanding({ reported, sent, run: unrepeating(awaitingKey), reread: false })
			).toEqual({ seeded: sent, spent: true });
		}
	});

	it('is what was sent where the run stopped before the write landed', () => {
		const unstored = ended('storing', {
			kind: 'unstored',
			listenerId: 'WH-1',
			written: { kind: 'unreachable', detail: 'timeout' }
		});
		const unauthorized = ended('authorizing', {
			kind: 'unauthorized',
			failure: { kind: 'unreachable', detail: 'timeout' }
		} as PaypalSetup);
		for (const run of [unstored, unauthorized]) {
			expect(boxesStanding({ reported, sent, run, reread: false })).toEqual({
				seeded: sent,
				spent: false
			});
		}
	});

	it('is what the deployment reported on a page that pressed nothing, whatever run it holds', () => {
		const unstored = ended('storing', {
			kind: 'unstored',
			listenerId: 'WH-1',
			written: { kind: 'unreachable', detail: 'timeout' }
		});
		for (const run of [unstored, null]) {
			expect(boxesStanding({ reported, sent: null, run, reread: false })).toEqual({
				seeded: reported,
				spent: false
			});
		}
		expect(boxesStanding({ reported, sent, run: null, reread: false })).toEqual({
			seeded: reported,
			spent: false
		});
	});
});

describe('whether Save is armed over unchanged boxes', () => {
	it('is, after any stop before the pair was stored', () => {
		const stops: PaypalRunRead[] = [
			ended('authorizing', {
				kind: 'unauthorized',
				failure: { kind: 'refused', detail: 'invalid_client' }
			}),
			ended('registering', { kind: 'full', listeners: [] }),
			ended('storing', {
				kind: 'unstored',
				listenerId: 'WH-1',
				written: { kind: 'unreachable', detail: 'timeout' }
			}),
			ended('storing', { kind: 'console-stopped' })
		];
		for (const run of stops) expect(pairArmed(run), run.outcome?.kind).toBe(true);
	});

	it('is not once the pair is stored, while a run is going, or with no run held', () => {
		const unrepeating = ended('repeating', {
			kind: 'unrepeating',
			setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
			awaitingKey: false
		});
		const running: PaypalRunRead = {
			kind: 'running',
			stage: 'registering',
			facts: { registration: null, elsewhere: [] },
			outcome: null
		};
		for (const run of [ended('storing', { kind: 'done' }), unrepeating, running, null]) {
			expect(pairArmed(run)).toBe(false);
		}
	});
});
