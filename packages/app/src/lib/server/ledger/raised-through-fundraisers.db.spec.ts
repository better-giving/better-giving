import { eq, type SQL, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { all, client, stmt } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { dispute, gift, refund } from '$lib/server/pages/settled-gifts.testing';
import { emptySupporterTables, pendingPage } from '$lib/server/supporters/fundraiser.testing';
import { statementsOf } from '../integrations/statements.testing';
import { readRaisedThroughFundraisers } from './queries';

// a fundraiser's total is read on every view of its page, so the read starts from the page and
// reaches its gifts through `donation_supporter_page_id_idx`: started from `entry_group_source_idx`
// instead, each total would walk every payment the organisation has ever taken. nothing here runs
// ANALYZE, so the plan read off the empty file is the plan production gets.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

/** a started page and the settings row a gift through it names. */
async function fundraiser(email: string) {
	const { pageId } = await pendingPage(db, { email });
	const [row] = await db
		.select({ supporterId: supporterPage.supporterId, formId: supporterPage.formId })
		.from(supporterPage)
		.where(eq(supporterPage.id, pageId));
	if (!row) throw new Error(`page ${pageId} was not written`);
	return { pageId, ...row };
}

/** sqlite's plan steps for the one statement the read prepares under `where`. */
async function planUnder(where: SQL): Promise<string[]> {
	const [read, ...rest] = await statementsOf((db) => readRaisedThroughFundraisers(db, where));
	expect(rest).toEqual([]);
	const steps = await all<{ detail: string }>(
		stmt(`explain query plan ${read?.sql}`, ...(read?.params ?? []))
	);
	return steps.map((step) => step.detail);
}

describe('a fundraiser total’s plan', () => {
	it.each([
		['one page', () => eq(supporterPage.id, '019fb500-0000-7000-8000-000000000001')],
		['one supporter’s pages', () => eq(supporterPage.supporterId, 'someone')],
		['every page', () => sql`1`]
	])('reaches %s’s gifts by the page index, never by every payment group', async (_, where) => {
		const plan = await planUnder(where());
		const gifts = plan.findIndex((step) => step.includes('donation_supporter_page_id_idx'));
		const groups = plan.findIndex((step) => step.startsWith('SEARCH entry_group'));
		expect(gifts).toBeGreaterThanOrEqual(0);
		expect(groups).toBeGreaterThan(gifts);
		expect(plan[groups]).toMatch(/\(source_type=\? AND source_id=\?\)$/);
	});
});

describe('a fundraiser total', () => {
	it('nets refunds and withdrawn disputes, ignores fees, and counts only its own gifts', async () => {
		const maya = await fundraiser('maya@example.org');
		const theo = await fundraiser('theo@example.org');

		await gift(db, maya.formId, 10_000);
		await refund(db, await gift(db, maya.formId, 5_000), 2_000);
		await refund(db, await gift(db, maya.formId, 3_000), 3_000);
		await dispute(db, await gift(db, maya.formId, 4_000));
		await dispute(db, await gift(db, maya.formId, 1_000), null, 'won');
		await gift(db, maya.formId, 7_000, false);
		await gift(db, theo.formId, 2_500);

		const everyPage = await readRaisedThroughFundraisers(db, sql`1`);
		expect(everyPage.toSorted((a, b) => a.raisedMinor - b.raisedMinor)).toEqual([
			{ pageId: theo.pageId, raisedMinor: 2_500, gifts: 1 },
			{ pageId: maya.pageId, raisedMinor: 14_000, gifts: 3 }
		]);
		expect(await readRaisedThroughFundraisers(db, eq(supporterPage.id, maya.pageId))).toEqual([
			{ pageId: maya.pageId, raisedMinor: 14_000, gifts: 3 }
		]);
		expect(
			await readRaisedThroughFundraisers(db, eq(supporterPage.supporterId, theo.supporterId))
		).toEqual([{ pageId: theo.pageId, raisedMinor: 2_500, gifts: 1 }]);
	});

	it('is no row for a page with no settled gift', async () => {
		const maya = await fundraiser('maya@example.org');
		await gift(db, maya.formId, 7_000, false);

		expect(await readRaisedThroughFundraisers(db, eq(supporterPage.id, maya.pageId))).toEqual([]);
	});
});
