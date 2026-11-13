import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultCampaign } from '../../page/defaults';
import { RESERVED_SEGMENTS } from '../../page/slug';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { page, supporterPage } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { emptySupporterTables, pendingPage } from '../supporters/fundraiser.testing';
import { client } from '$lib/server/db/database.testing';
import { createCampaign } from './campaign';
import { ensureDonationPage } from './donation-page';
import { insertPage, SETTINGS } from './page-row.testing';
import { publishPage } from './publish';
import { planSlugMove } from './queries';

// the address rule run the other way from `startFundraiser` (../supporters/start.ts): a campaign's
// address, made or moved, refuses one a supporter's fundraiser holds, and the words the supporter
// routes answer on at the top level; and the database holding the rule where a campaign and a
// fundraiser take one address in the same instant.

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

/**
 * two handles on the one real database, `[first, second]`, whose first `batch()` each waits until
 * both have reached it, so both writers read the free addresses before either writes: the race two
 * requests run when they arrive together. `second` writes once `first`'s write has settled.
 */
function readBothThenWrite(real: Db): [Db, Db] {
	let arrived = 0;
	let bothArrive: () => void = () => {};
	const bothArrived = new Promise<void>((resolve) => {
		bothArrive = resolve;
	});
	let firstSettle: () => void = () => {};
	const firstSettled = new Promise<void>((resolve) => {
		firstSettle = resolve;
	});
	const held = (order: 0 | 1): Db => {
		let racing = true;
		return new Proxy(real, {
			get(target, key, receiver) {
				if (key !== 'batch') return Reflect.get(target, key, receiver);
				return async (...args: Parameters<Db['batch']>) => {
					if (!racing) return target.batch(...args);
					racing = false;
					arrived += 1;
					if (arrived === 2) bothArrive();
					await bothArrived;
					if (order === 1) await firstSettled;
					try {
						return await target.batch(...args);
					} finally {
						if (order === 0) firstSettle();
					}
				};
			}
		});
	};
	return [held(0), held(1)];
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

	it.each(['campaign', 'fundraiser'] as const)(
		'is never the address a fundraiser started in the same instant takes, the %s writing first',
		async (first) => {
			// made ahead, so the first batch each side runs is the one taking the address.
			await ensureDonationPage(db);
			const [early, late] = readBothThenWrite(db);
			const [made, started] = await Promise.all([
				createCampaign(first === 'campaign' ? early : late, { name: 'Winter coat drive' }),
				pendingPage(first === 'campaign' ? late : early, { title: 'Winter coat drive' })
			]);

			const [won, lost] =
				first === 'campaign'
					? [await slugOf(made.pageId), started.slug]
					: [started.slug, await slugOf(made.pageId)];
			expect([won, lost]).toEqual(['winter-coat-drive', 'winter-coat-drive-2']);
		}
	);

	it('is refused at Publish where a fundraiser started in the same instant took the drafted link', async () => {
		await ensureDonationPage(db);
		const drafted = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(
			db,
			'campaign',
			{ ...drafted, slug: 'run-for-the-shelter' },
			drafted
		);
		const [before] = await db.select().from(page).where(eq(page.id, pageId));
		if (!before) throw new Error('the campaign was not written');

		const [early, late] = readBothThenWrite(db);
		const [, published] = await Promise.all([
			pendingPage(early, { title: 'Run for the shelter' }),
			publishPage(late, { type: 'campaign', id: pageId }, before.updatedAt, { now: Date.now() })
		]);

		expect(published).toMatchObject({ kind: 'refused' });
		expect(JSON.stringify(published)).toContain(
			'the link /run-for-the-shelter is taken by a supporter’s fundraiser'
		);
		expect(await slugOf(pageId)).toBe(before.slug);
	});

	it('cannot be moved onto an address a fundraiser holds', async () => {
		await pendingPage(db, { title: 'Run for the shelter' });
		const { pageId } = await createCampaign(db, { name: 'Spring appeal' });

		expect(
			await rejectionCode(() =>
				db.update(page).set({ slug: 'run-for-the-shelter' }).where(eq(page.id, pageId))
			)
		).toContain('SQLITE_CONSTRAINT_TRIGGER');
	});

	it('takes no fundraiser moved onto an address a campaign holds', async () => {
		const { pageId } = await createCampaign(db, { name: 'Winter coat drive' });
		const fundraiser = await pendingPage(db, { title: 'Run for the shelter' });
		const held = await slugOf(pageId);
		if (!held) throw new Error('the campaign holds no address');

		expect(
			await rejectionCode(() =>
				db.update(supporterPage).set({ slug: held }).where(eq(supporterPage.id, fundraiser.pageId))
			)
		).toContain('SQLITE_CONSTRAINT_TRIGGER');
	});

	it.each(['f', 'fundraise'])('is never %s, which the supporter routes answer on', (word) => {
		expect(RESERVED_SEGMENTS.has(word)).toBe(true);
	});
});
