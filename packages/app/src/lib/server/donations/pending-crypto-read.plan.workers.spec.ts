import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createDb } from '../db/client';
import { createPaymentProviders } from '../payments/factory';
import { readPendingCryptoGifts } from './pending-crypto-read';

// the scheduled read runs every thirty minutes over a table that grows with every gift ever taken,
// so what it must not do is scan `payment`. the plan is read for the statement the read itself
// prepares, with the values it binds: a partial index is only chosen when sqlite can see the bound
// `method` and `status` match the index's own `where`.

type Prepared = { readonly sql: string; readonly params: unknown[] };

/** a D1 handle that records each statement prepared on it, and what was bound to it. */
function recording(db: D1Database): { readonly handle: D1Database; readonly prepared: Prepared[] } {
	const prepared: Prepared[] = [];
	const handle = new Proxy(db, {
		get(target, key) {
			if (key !== 'prepare') return Reflect.get(target, key, target);
			return (sql: string) => {
				const entry: Prepared = { sql, params: [] };
				prepared.push(entry);
				const statement = target.prepare(sql);
				return new Proxy(statement, {
					get(stmt, method) {
						if (method !== 'bind') return Reflect.get(stmt, method, stmt);
						return (...params: unknown[]) => {
							entry.params.push(...params);
							return stmt.bind(...params);
						};
					}
				});
			};
		}
	});
	return { handle, prepared };
}

it('reads pending crypto gifts through their partial index, never a scan of payment', async () => {
	const { handle, prepared } = recording(env.DB);
	const processors = createPaymentProviders({
		NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
		NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
		NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret'
	});
	const email = { send: async () => ({ ok: true as const }) };

	await readPendingCryptoGifts({ db: createDb(handle), processors, email }, new Date());

	const [read] = prepared;
	expect(read?.sql).toMatch(/from "payment"/);
	const { results } = await env.DB.prepare(`explain query plan ${read?.sql}`)
		.bind(...(read?.params ?? []))
		.all<{ detail: string }>();
	const plan = results.map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(/USING INDEX payment_pending_crypto_provider_created_at_idx\b/)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN payment\b/));
});
