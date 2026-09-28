import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createDb } from '../db/client';
import { readGiftPage } from './gift';

// the read API walks every settled gift newest first, over a table that grows with every payment
// ever taken, so what a page must not do is scan `payment` or sort it. the plan is read for the
// walk's own statement (`newestKeys` in ./gift.ts, past a cursor by `pastKeyset` in ./paging.ts),
// with the values it binds: a partial index is only chosen when sqlite can see the bound `status`
// and `direction` match the index's own `where`.

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

it.each([
	['the first page', null],
	[
		'a page past a cursor',
		{ at: Date.parse('2026-09-10T12:00:00.000Z'), id: '019fb300-0000-7000-8000-000000000004' }
	]
] as const)(
	'walks settled gifts newest first through their partial index for %s, never a scan or a sort of payment',
	async (_, after) => {
		const { handle, prepared } = recording(env.DB);

		await readGiftPage(createDb(handle), { order: 'newest', limit: 50, after });

		const [walk] = prepared;
		expect(walk?.sql).toMatch(/from "payment"/);
		expect(walk?.sql).toMatch(/order by "payment"."occurred_at" desc, "payment"."id" desc/);
		const { results } = await env.DB.prepare(`explain query plan ${walk?.sql}`)
			.bind(...(walk?.params ?? []))
			.all<{ detail: string }>();
		const plan = results.map((step) => step.detail);
		expect(plan).toContainEqual(
			expect.stringMatching(
				/^(?:SCAN|SEARCH) payment USING (?:COVERING )?INDEX payment_settled_gift_occurred_at_idx\b/
			)
		);
		expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE FOR ORDER BY/));
	}
);
