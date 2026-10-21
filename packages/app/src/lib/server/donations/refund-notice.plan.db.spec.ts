import { expect, it } from 'vitest';
import { sendOwedRefundNotices } from './refund-notice';
import { statementsOf } from '../integrations/statements.testing';
import { all, stmt } from '$lib/server/db/database.testing';

// the refund notices still owed are read twice an hour over a table that grows with every gift
// ever taken, so what the read must not do is scan `payment`. the plan is read for the statement
// the run itself prepares, with the values it binds: the partial index is only chosen when sqlite
// can see the bound `direction` match the index's own `where`.

it('reads the notices owed through the refunds’ index by time, never a scan of payment', async () => {
	const email = { send: async () => ({ ok: true as const }) };

	const prepared = await statementsOf((db) => sendOwedRefundNotices({ db, email }, new Date()));

	const [read] = prepared;
	expect(read?.sql).toMatch(/from "payment"/);
	const results = await all<{ detail: string }>(
		stmt(`explain query plan ${read?.sql}`, ...(read?.params ?? []))
	);
	const plan = results.map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(
			/^SEARCH payment USING INDEX payment_refund_created_at_idx \(created_at>\? AND created_at<\?\)/
		)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN (?:payment|gift)\b/));
});
