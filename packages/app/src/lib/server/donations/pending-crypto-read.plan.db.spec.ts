import { expect, it } from 'vitest';
import { createPaymentProviders } from '../payments/factory';
import { readPendingCryptoGifts } from './pending-crypto-read';
import { statementsOf } from '../integrations/statements.testing';
import { all, stmt } from '$lib/server/db/database.testing';

// the scheduled read runs every thirty minutes over a table that grows with every gift ever taken,
// so what it must not do is scan `payment`. the plan is read for the statement the read itself
// prepares, with the values it binds: a partial index is only chosen when sqlite can see the bound
// `method` and `status` match the index's own `where`.

it('reads pending crypto gifts through their partial index, never a scan of payment', async () => {
	const processors = createPaymentProviders({
		NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
		NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
		NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret'
	});
	const email = { send: async () => ({ ok: true as const }) };

	const prepared = await statementsOf((db) =>
		readPendingCryptoGifts({ db, processors, email }, new Date())
	);

	const [read] = prepared;
	expect(read?.sql).toMatch(/from "payment"/);
	const results = await all<{ detail: string }>(
		stmt(`explain query plan ${read?.sql}`, ...(read?.params ?? []))
	);
	const plan = results.map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(/USING INDEX payment_pending_crypto_provider_created_at_idx\b/)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN payment\b/));
});
