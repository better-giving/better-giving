import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// the constraints on the columns a `crypto` payment carries, which are one-way for the reason
// ./donation-schema.workers.spec.ts opens with: each is a rebuild of `payment` to change.
//
// what is deliberately not here, on that file's redundancy rule: `payment_coin_not_blank_check`
// and `payment_coin_network_not_blank_check` (the shared `optionalNotBlank` body, pinned there on
// `payment.provider_txn_id`), and `parent_payment_id`'s `NO ACTION` (read off sqlite's catalogue by
// ./strict.workers.spec.ts).
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const CONTACT_ID = '019fb400-0000-7000-8000-000000000001';
const DONATION_ID = '019fb400-0000-7000-8000-000000000002';

beforeAll(async () => {
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, created_at, updated_at)
		 values (?, 'individual', 'Probe Donor', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, 10000, 'USD', 0, 0)`
	)
		.bind(DONATION_ID, CONTACT_ID)
		.run();
});

/** a payment with every column a probe varies exposed; `id` doubles as its NOWPayments id. */
const insertPayment = (opts: {
	id: string;
	method?: string;
	provider?: string;
	coin?: string | null;
	coinNetwork?: string | null;
	coinAmount?: string | null;
	parentPaymentId?: string | null;
}) =>
	env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at,
		                      coin, coin_network, coin_amount, valid_until, parent_payment_id)
		 values (?, ?, 10000, 'USD', 'inbound', ?, 'succeeded', ?, ?, 0, 0, ?, ?, ?, 0, ?)`
	)
		.bind(
			opts.id,
			DONATION_ID,
			opts.method ?? 'crypto',
			opts.provider ?? 'nowpayments',
			`np_${opts.id}`,
			opts.coin === undefined ? 'usdttrc20' : opts.coin,
			opts.coinNetwork === undefined ? 'trx' : opts.coinNetwork,
			opts.coinAmount === undefined ? '25.5' : opts.coinAmount,
			opts.parentPaymentId ?? null
		)
		.run();

describe('a crypto gift is a row the schema admits', () => {
	it('stores crypto carried by nowpayments, with its coin facts as written', async () => {
		await insertPayment({ id: 'p-crypto', coinAmount: '0.000000000000000001' });
		const row = await env.DB.prepare(
			`select method as m, provider as p, coin as c, coin_network as n, coin_amount as a,
			        typeof(coin_amount) as t
			 from payment where id = ?`
		)
			.bind('p-crypto')
			.first();
		expect(row).toEqual({
			m: 'crypto',
			p: 'nowpayments',
			c: 'usdttrc20',
			n: 'trx',
			a: '0.000000000000000001',
			t: 'text'
		});
	});
});

describe('a coin amount has one spelling per number', () => {
	it.each(['1', '12', '10', '0.5', '25.5', '1.000000001', '100.05'])(
		'accepts %s',
		async (amount) => {
			const id = `p-amount-ok-${amount}`;
			await insertPayment({ id, coinAmount: amount });
			const row = await env.DB.prepare('select coin_amount as a from payment where id = ?')
				.bind(id)
				.first();
			expect(row).toEqual({ a: amount });
		}
	);

	// each a spelling a float-to-string, a locale or a lazy formatter actually produces.
	it.each([
		['0', 'nothing arrived is null, not zero'],
		['', 'blank'],
		['0.50', 'trailing zero'],
		['0.0', 'zero with a point'],
		['05', 'leading zero'],
		['00.5', 'leading zero before the point'],
		['.5', 'no integer part'],
		['5.', 'no fraction after the point'],
		['1e-7', 'exponent, what JSON.stringify writes for 0.0000001'],
		['-1', 'sign'],
		['1.2.3', 'two points'],
		['1,5', 'decimal comma'],
		[' 1', 'whitespace']
	])('refuses %j (%s)', async (amount) => {
		const message = await rejection(() =>
			insertPayment({ id: `p-amount-bad-${amount}`, coinAmount: amount })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_coin_amount_canonical_check');
	});
});

describe('coin facts belong to a crypto payment with a coin', () => {
	it('refuses an amount with no coin to read it in', async () => {
		const message = await rejection(() =>
			insertPayment({ id: 'p-amount-no-coin', coin: null, coinNetwork: null })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_coin_facts_need_coin_check');
	});

	it('refuses a network with no coin', async () => {
		const message = await rejection(() =>
			insertPayment({ id: 'p-network-no-coin', coin: null, coinAmount: null })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_coin_facts_need_coin_check');
	});

	it.each(['USDTTRC20', 'Btc'])('refuses %s, a coin code not lowercased', async (coin) => {
		const message = await rejection(() => insertPayment({ id: `p-coin-case-${coin}`, coin }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_coin_lowercase_check');
	});

	it('refuses a coin on a card payment', async () => {
		const message = await rejection(() =>
			insertPayment({ id: 'p-card-coin', method: 'card', provider: 'stripe' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_coin_needs_crypto_check');
	});

	it('admits a pending crypto row that has a coin and nothing received yet', async () => {
		await insertPayment({ id: 'p-awaiting', coinAmount: null });
		const row = await env.DB.prepare('select coin as c, coin_amount as a from payment where id = ?')
			.bind('p-awaiting')
			.first();
		expect(row).toEqual({ c: 'usdttrc20', a: null });
	});
});

describe('a repeat deposit points at the payment it follows', () => {
	it('accepts a parent that is a payment row', async () => {
		await insertPayment({ id: 'p-parent' });
		await insertPayment({ id: 'p-child', parentPaymentId: 'p-parent' });
		const row = await env.DB.prepare('select parent_payment_id as p from payment where id = ?')
			.bind('p-child')
			.first();
		expect(row).toEqual({ p: 'p-parent' });
	});

	it('refuses a parent that is not a payment row, such as the processor’s own id for it', async () => {
		const message = await rejection(() =>
			insertPayment({ id: 'p-orphan', parentPaymentId: 'np_p-parent' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});
});
