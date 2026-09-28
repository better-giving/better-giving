import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createDb } from '../db/client';
import { readGiftPage } from './gift';

// the read API walks every settled gift newest first, over a table that grows with every payment
// ever taken, so what the page must not do is scan `payment` or sort it. the plan is read for the
// statement the page itself prepares, with the values it binds: a partial index is only chosen
// when sqlite can see the bound `status` and `direction` match the index's own `where`.

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

it('walks settled gifts newest first through their partial index, never a scan or a sort of payment', async () => {
	const { handle, prepared } = recording(env.DB);

	await readGiftPage(createDb(handle));

	const [page] = prepared;
	expect(page?.sql).toMatch(/from "payment"/);
	const { results } = await env.DB.prepare(`explain query plan ${page?.sql}`)
		.bind(...(page?.params ?? []))
		.all<{ detail: string }>();
	const plan = results.map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(/^SCAN payment USING INDEX payment_settled_gift_occurred_at_idx\b/)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE FOR ORDER BY/));
});
