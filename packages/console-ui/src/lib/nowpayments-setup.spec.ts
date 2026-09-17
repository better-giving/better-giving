import { describe, expect, it } from 'vitest';
import type { NowpaymentsPress, NowpaymentsSaved, PaymentsRead, RailLine } from '../api/types';
import {
	CURRENCY_UNKNOWN,
	KEY_REFUSED,
	NOWPAYMENTS_BLANK,
	NOWPAYMENTS_FIELD,
	NOWPAYMENTS_FORM,
	nowpaymentsAnswer,
	nowpaymentsAsks,
	nowpaymentsPhase,
	nowpaymentsPosted,
	railsToDraw
} from './nowpayments-setup';

const TYPED: NowpaymentsPress = {
	apiKey: 'NP1-NEW',
	ipnSecret: 'ipn-new',
	outcomeCurrency: 'usdttrc20'
};

const HELD_SEEDS = {
	NOWPAYMENTS_API_KEY: 'NP1-OLD',
	NOWPAYMENTS_IPN_SECRET: 'ipn-old',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20'
};

const HELD = new Set(Object.keys(HELD_SEEDS));

const body = (boxes: Partial<NowpaymentsPress>): FormData => {
	const posted = new FormData();
	for (const [box, value] of Object.entries(boxes)) {
		posted.set(NOWPAYMENTS_FIELD(box as keyof NowpaymentsPress), value);
	}
	return posted;
};

describe('the three boxes', () => {
	it('refuses every box left empty, by the field it posts under', () => {
		const parsed = NOWPAYMENTS_FORM.schema.safeParse({});
		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
			[NOWPAYMENTS_FIELD('apiKey'), NOWPAYMENTS_BLANK],
			[NOWPAYMENTS_FIELD('ipnSecret'), NOWPAYMENTS_BLANK],
			[NOWPAYMENTS_FIELD('outcomeCurrency'), NOWPAYMENTS_BLANK]
		]);
	});

	it('takes a box of spaces as empty', () => {
		const parsed = NOWPAYMENTS_FORM.schema.safeParse({
			[NOWPAYMENTS_FIELD('apiKey')]: '   ',
			[NOWPAYMENTS_FIELD('ipnSecret')]: 'ipn',
			[NOWPAYMENTS_FIELD('outcomeCurrency')]: 'usdttrc20'
		});
		expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual([
			NOWPAYMENTS_FIELD('apiKey')
		]);
	});
});

describe('what a press posted', () => {
	it('reads all three, with the space around each trimmed off', () => {
		// the binary turns down a value with space around it, and the trim is the repair.
		expect(
			nowpaymentsPosted(
				body({ apiKey: ' NP1-NEW ', ipnSecret: 'ipn-new\n', outcomeCurrency: 'usdttrc20' })
			)
		).toEqual({ ok: true, press: TYPED });
	});

	it('refuses every box that arrived empty or not at all', () => {
		expect(nowpaymentsPosted(body({ apiKey: 'NP1-NEW', ipnSecret: ' ' }))).toEqual({
			ok: false,
			errors: {
				[NOWPAYMENTS_FIELD('ipnSecret')]: NOWPAYMENTS_BLANK,
				[NOWPAYMENTS_FIELD('outcomeCurrency')]: NOWPAYMENTS_BLANK
			}
		});
	});
});

describe('the confirm a press asks through', () => {
	it('asks nothing where the deployment holds no key', () => {
		// a first save takes nothing away, so a card would ask the operator to agree to the press they
		// just made.
		expect(nowpaymentsAsks(TYPED, {}, new Set())).toBe(null);
	});

	it('asks nothing where the key stays the one held', () => {
		expect(
			nowpaymentsAsks({ ...TYPED, apiKey: 'NP1-OLD', ipnSecret: 'ipn-other' }, HELD_SEEDS, HELD)
		).toBe(null);
	});

	it('itemises the boxes a replaced key is saved with, and none left as they were', () => {
		expect(nowpaymentsAsks(TYPED, HELD_SEEDS, HELD)).toEqual([
			{ box: 'apiKey', act: 'Replaced' },
			{ box: 'ipnSecret', act: 'Replaced' }
		]);
	});

	it('states a box the deployment holds nothing under as set', () => {
		const seeds = { NOWPAYMENTS_API_KEY: 'NP1-OLD' };
		expect(nowpaymentsAsks(TYPED, seeds, new Set(Object.keys(seeds)))).toEqual([
			{ box: 'apiKey', act: 'Replaced' },
			{ box: 'ipnSecret', act: 'Set' },
			{ box: 'outcomeCurrency', act: 'Set' }
		]);
	});

	it('reads a key held in a form nothing can read back as replaced by any key typed', () => {
		// its box is drawn empty over a key that is there, so whatever is typed takes its place.
		const seeds = { ...HELD_SEEDS, NOWPAYMENTS_API_KEY: '' };
		expect(nowpaymentsAsks(TYPED, seeds, HELD)?.[0]).toEqual({ box: 'apiKey', act: 'Replaced' });
	});
});

const saved = (answer: NowpaymentsSaved) => nowpaymentsAnswer({ refused: null, saved: answer });

describe('where an answer reports', () => {
	it('reports nothing where no press was answered', () => {
		expect(nowpaymentsAnswer({ refused: null, saved: null })).toEqual({
			boxes: null,
			said: null,
			unanswered: null,
			written: null,
			stored: false
		});
	});

	it('hands the boxes the route refused on to the boxes', () => {
		const refused = { [NOWPAYMENTS_FIELD('apiKey')]: NOWPAYMENTS_BLANK };
		expect(nowpaymentsAnswer({ refused, saved: null }).boxes).toEqual(refused);
	});

	it('puts a turned-down key at the key box, with NOWPayments’ words under it', () => {
		const answer = saved({ kind: 'key_refused', detail: 'Invalid api key' });
		expect(answer.boxes).toEqual({ [NOWPAYMENTS_FIELD('apiKey')]: KEY_REFUSED });
		expect(answer.said).toEqual({ box: 'apiKey', detail: 'Invalid api key' });
		expect(answer.unanswered).toBe(null);
	});

	it('puts an unknown coin at the currency box', () => {
		const answer = saved({ kind: 'currency_unknown', detail: 'no such coin' });
		expect(answer.boxes).toEqual({ [NOWPAYMENTS_FIELD('outcomeCurrency')]: CURRENCY_UNKNOWN });
		expect(answer.said).toEqual({ box: 'outcomeCurrency', detail: 'no such coin' });
	});

	it('puts no answer at the press and at no box', () => {
		const answer = saved({ kind: 'unanswered', detail: 'timed out' });
		expect(answer.boxes).toBe(null);
		expect(answer.said).toBe(null);
		expect(answer.unanswered).toBe('timed out');
	});

	it('reads a write as stored only where it set the values', () => {
		expect(saved({ kind: 'written', written: { kind: 'set' } }).stored).toBe(true);
		const refused = saved({ kind: 'written', written: { kind: 'unreachable', detail: 'x' } });
		expect(refused.stored).toBe(false);
		expect(refused.written).toEqual({ kind: 'unreachable', detail: 'x' });
	});
});

const phase = (over: Partial<Parameters<typeof nowpaymentsPhase>[0]> = {}) =>
	nowpaymentsPhase({
		own: false,
		revalidating: false,
		busy: false,
		stored: false,
		spent: false,
		...over
	});

describe('whether the boxes are closed', () => {
	it('leaves them open at rest', () => {
		expect(phase()).toEqual({ inFlight: false, underway: false, closed: false });
	});

	it('closes them while the press is sent', () => {
		expect(phase({ own: true, busy: true })).toEqual({
			inFlight: true,
			underway: true,
			closed: true
		});
	});

	it('reopens them the moment an answer that stored nothing lands', () => {
		// the page is still being read again over it, and a box closed then is one the refusal's focus
		// move cannot reach.
		expect(phase({ own: true, busy: true, revalidating: true })).toEqual({
			inFlight: false,
			underway: false,
			closed: false
		});
	});

	it('keeps them closed over a stored write until the reading behind it lands', () => {
		expect(phase({ own: true, busy: true, revalidating: true, stored: true }).closed).toBe(true);
		expect(phase({ stored: true }).closed).toBe(true);
		expect(phase({ stored: true, spent: true }).closed).toBe(false);
	});

	it('closes them while another press on the page writes', () => {
		expect(phase({ busy: true })).toEqual({ inFlight: false, underway: false, closed: true });
	});
});

const CRYPTO: RailLine = { rail: 'crypto', label: 'Crypto', standing: 'approved', note: null };

const reported = (rails: RailLine[]): PaymentsRead => ({
	kind: 'read',
	report: {
		processors: [
			{
				processor: 'nowpayments',
				label: 'NOWPayments',
				state: 'configured',
				rails: { state: 'read', chargesEnabled: true, evidence: 'credentials_only', rails },
				webhook: { state: 'unconfirmable', detail: null },
				subscription: { state: 'not_applicable' },
				wallets: null
			}
		]
	}
});

describe('the rail lines drawn', () => {
	it('draws none where the rail is approved, since working says nothing', () => {
		expect(railsToDraw(reported([CRYPTO]))).toEqual([]);
	});

	it('draws a rail the account has not switched on, with the deployment\u2019s note', () => {
		const off: RailLine = { ...CRYPTO, standing: 'not_approved', note: 'select a coin' };
		expect(railsToDraw(reported([off]))).toEqual([off]);
	});

	it('draws none where nothing was read or NOWPayments is not configured', () => {
		expect(railsToDraw(null)).toEqual([]);
		expect(
			railsToDraw({
				kind: 'read',
				report: {
					processors: [
						{ processor: 'nowpayments', label: 'NOWPayments', state: 'unconfigured', unset: [] }
					]
				}
			})
		).toEqual([]);
	});
});
