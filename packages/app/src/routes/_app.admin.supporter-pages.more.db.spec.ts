import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { SUPPORTER_PAGE_LIST_LIMIT } from '$lib/server/supporters/admin';
import {
	emptySupporterTables,
	STARTED_AT,
	startDeps,
	startInput
} from '$lib/server/supporters/fundraiser.testing';
import { startFundraiser } from '$lib/server/supporters/start';
import { freshDeployment, page, signInAsDeployer, signInAsMember } from '../webhook-routes.testing';
import * as screen from './_app.admin.supporter-pages';
import * as more from './_app.admin.supporter-pages.more';

// Show more on /admin/supporter-pages, through the protected layout against the real database: the
// batch after the cursor the screen's last batch ended on, each row as the screen's own loader maps
// it. how a batch resumes is `$lib/server/supporters/admin.db.spec.ts`'s.

const SCREEN = '/admin/supporter-pages';
const screenAt = page('admin/supporter-pages', screen);
const moreAt = page('admin/supporter-pages/more', more);

let db: Db;
let staff: string;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await freshDeployment();
	staff = await signInAsDeployer(db);
});

/** `count` pending pages started a minute apart, the newest last. */
async function pagesStarted(count: number) {
	for (let i = 0; i < count; i += 1) {
		const { deps, settled } = startDeps(db, { now: new Date(STARTED_AT.getTime() + i * 60_000) });
		const started = await startFundraiser(
			deps,
			startInput({ email: `runner${i}@example.org`, title: `Run number ${i}` })
		);
		if (!started.ok) throw new Error(`start ${i} was refused: ${started.reason}`);
		await settled();
	}
}

type Row = { id: string; title: string; address: string; openHref: string };
type Listed = { pages: Row[]; total: number; next: string | null };

const morePath = (after: string) => `${SCREEN}/more?${new URLSearchParams({ after })}`;

describe('GET /admin/supporter-pages/more', () => {
	it('answers the batch after the screen’s first, mapped as the screen maps its rows', async () => {
		await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT + 2);
		const first = (await (await screenAt.get(SCREEN, staff)).json()) as Listed;
		expect(first.pages).toHaveLength(SUPPORTER_PAGE_LIST_LIMIT);
		expect(first.total).toBe(SUPPORTER_PAGE_LIST_LIMIT + 2);
		expect(first.next).toEqual(expect.any(String));

		const answer = await moreAt.get(morePath(first.next ?? ''), staff);
		expect(answer.status).toBe(200);
		const batch = (await answer.json()) as Listed & { kind: string };
		expect(batch).toMatchObject({
			kind: 'pages',
			total: SUPPORTER_PAGE_LIST_LIMIT + 2,
			next: null
		});
		expect(batch.pages.map((row) => row.title)).toEqual(['Run number 1', 'Run number 0']);
		const [, oldest] = batch.pages;
		// never published, so Open is the staff preview.
		expect(oldest).toMatchObject({
			address: '/f/run-number-0',
			openHref: `/admin/supporter-pages/${oldest?.id}/preview`
		});
		expect(Object.keys(oldest ?? {}).toSorted()).toEqual(
			Object.keys(first.pages[0] ?? {}).toSorted()
		);
	});

	it('answers a member as it answers staff, as the screen does', async () => {
		await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT + 1);
		const member = await signInAsMember(db);
		const first = (await (await screenAt.get(SCREEN, member)).json()) as Listed;
		const answer = await moreAt.get(morePath(first.next ?? ''), member);
		expect(answer.status).toBe(200);
		expect(((await answer.json()) as Listed).pages).toHaveLength(1);
	});

	it('refuses a cursor it never handed out, or none, with a 400', async () => {
		const forged = await moreAt.get(morePath('not-a-cursor'), staff);
		expect(forged.status).toBe(400);
		expect(await forged.json()).toEqual({ kind: 'refused' });
		expect((await moreAt.get(`${SCREEN}/more`, staff)).status).toBe(400);
	});

	it('reads nothing for a caller with no session', async () => {
		const after = Buffer.from(`${Date.UTC(2027, 0, 1)}.z`).toString('base64url');
		const answer = await moreAt.get(morePath(after), '');
		expect(answer.status).toBeGreaterThanOrEqual(300);
		expect(answer.status).toBeLessThan(400);
	});
});
