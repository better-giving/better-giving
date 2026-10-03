import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createDb } from '../db/client';
import { listDeliveries } from './deliver';

// a destination's page reads its latest deliveries on every load, and `webhook_delivery` rows are
// never cleared, so what the read must not do is sort the destination's whole history to take 50.

it('reads a destination’s latest deliveries through its recent index, never a sort of its history', async () => {
	const { sql, params } = listDeliveries(
		createDb(env.DB),
		'019fb300-0000-7000-8000-000000000001',
		50
	).toSQL();

	expect(sql).toMatch(
		/order by "webhook_delivery"."created_at" desc, "webhook_delivery"."id" desc/
	);
	const { results } = await env.DB.prepare(`explain query plan ${sql}`)
		.bind(...params)
		.all<{ detail: string }>();
	const plan = results.map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(
			/^SEARCH webhook_delivery USING INDEX webhook_delivery_recent_idx \(destination_id=\?\)/
		)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE FOR ORDER BY/));
});
