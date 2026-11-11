import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESERVED_SEGMENTS } from '../../page/slug';
import { createDb, type Db } from '../db/client';
import { page } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { emptySupporterTables, pendingPage } from '../supporters/fundraiser.testing';
import { client } from '$lib/server/db/database.testing';
import { createCampaign } from './campaign';
import { planSlugMove } from './queries';

// the address rule run the other way from `startFundraiser` (../supporters/start.ts): a campaign's
// address, made or moved, refuses one a supporter's fundraiser holds, and the words the supporter
// routes answer on at the top level.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

async function slugOf(pageId: string) {
	const [row] = await db.select({ slug: page.slug }).from(page).where(eq(page.id, pageId));
	return row?.slug;
}

describe('a campaign’s address beside supporters’ fundraisers', () => {
	it('is made past an address a fundraiser holds', async () => {
		const fundraiser = await pendingPage(db, { title: 'Winter coat drive' });
		expect(fundraiser.slug).toBe('winter-coat-drive');

		const { pageId } = await createCampaign(db, { name: 'Winter coat drive' });
		expect(await slugOf(pageId)).toBe('winter-coat-drive-2');
	});

	it('is refused as taken when moved to an address a fundraiser holds', async () => {
		await pendingPage(db, { title: 'Run for the shelter' });
		const { pageId } = await createCampaign(db, { name: 'Spring appeal' });
		const [row] = await db.select().from(page).where(eq(page.id, pageId));
		if (!row) throw new Error('the campaign was not written');

		const plan = await planSlugMove(
			db,
			row,
			'run-for-the-shelter',
			{ move: true, takeover: true },
			Date.now()
		);
		expect(plan).toEqual({ kind: 'taken', by: 'a supporter’s fundraiser' });
	});

	it.each(['f', 'fundraise'])('is never %s, which the supporter routes answer on', (word) => {
		expect(RESERVED_SEGMENTS.has(word)).toBe(true);
	});
});
