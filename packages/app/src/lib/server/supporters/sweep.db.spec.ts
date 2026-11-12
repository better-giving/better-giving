import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { all, client, run, stmt } from '$lib/server/db/database.testing';
import { createImage, stored } from '$lib/server/images/image.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { heroShowing, insertPage } from '$lib/server/pages/page-row.testing';
import { heldAddresses } from '$lib/server/pages/queries';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { signInWithLink } from './links';
import { PENDING_PAGE_KEEP_MS, sweepSupporterLeftovers } from './sweep';

// the hourly sweep of what a supporter's sign-in leaves behind, against the real tables.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

const SUPPORTER = '019fb600-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const HOUR = 60 * 60_000;
const at = (offset: number) => NOW.getTime() + offset;

beforeEach(async () => {
	await emptySupporterTables();
	await run(
		stmt(
			`insert into supporter (id, email, name, created_at) values (?, 'maya@example.org', 'Maya', 0)`,
			SUPPORTER
		)
	);
});

/** a sign-in link whose hash is `tag` repeated, expiring at `expiresAt`, used at `usedAt`. */
async function link(tag: string, expiresAt: number, usedAt: number | null = null) {
	await run(
		stmt(
			`insert into supporter_link (token_hash, supporter_id, purpose, created_at, expires_at, used_at)
			 values (?, ?, 'sign_in', ?, ?, ?)`,
			tag.repeat(64),
			SUPPORTER,
			expiresAt - HOUR,
			expiresAt,
			usedAt
		)
	);
}

async function session(tag: string, expiresAt: number) {
	await run(
		stmt(
			`insert into supporter_session (token_hash, supporter_id, created_at, expires_at)
			 values (?, ?, 0, ?)`,
			tag.repeat(64),
			SUPPORTER,
			expiresAt
		)
	);
}

const left = async (table: 'supporter_link' | 'supporter_session') =>
	(await all<{ token_hash: string }>(stmt(`select token_hash from ${table} order by token_hash`)))
		.map((row) => row.token_hash[0])
		.join('');

describe('sweeping supporter leftovers', () => {
	it('deletes links a day past their expiry, used or not, and keeps the rest', async () => {
		await link('a', at(-25 * HOUR));
		await link('b', at(-25 * HOUR), at(-26 * HOUR));
		await link('c', at(-23 * HOUR), at(-23.5 * HOUR));
		await link('d', at(HOUR / 2));
		await link('e', at(HOUR / 2), at(-HOUR / 4));

		await sweepSupporterLeftovers(db, NOW);

		expect(await left('supporter_link')).toBe('cde');
	});

	it('deletes sessions past their expiry, and keeps the live ones', async () => {
		await session('a', at(-1));
		await session('b', at(0));
		await session('c', at(1));

		await sweepSupporterLeftovers(db, NOW);

		expect(await left('supporter_session')).toBe('c');
	});
});

describe('sweeping photos nothing holds', () => {
	beforeEach(async () => {
		await emptySupporterTables();
		for (const table of ['image_bytes', 'image']) await run(stmt(`delete from ${table}`));
		await writeOrgRow(client);
	});

	/** a stored photo made `age` before the sweep runs. */
	async function photo(age: number): Promise<string> {
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 1200, height: 800, alt: null },
			new Uint8Array([0x52, 0x49, 0x46, 0x46])
		);
		await run(stmt('update image set created_at = ? where id = ?', at(-age), id));
		return id;
	}

	it('frees one a day old that no page holds, bytes and all', async () => {
		const unsaved = await photo(25 * HOUR);

		await sweepSupporterLeftovers(db, NOW);

		expect(await stored(db, unsaved)).toEqual({ row: false, bytes: false });
	});

	it('keeps one not yet a day old, though nothing holds it', async () => {
		const fresh = await photo(23 * HOUR);

		await sweepSupporterLeftovers(db, NOW);

		expect(await stored(db, fresh)).toEqual({ row: true, bytes: true });
	});

	it('keeps an old one a fundraiser or a page document holds', async () => {
		const onFundraiser = await photo(25 * HOUR);
		const onCampaign = await photo(25 * HOUR);
		const { pageId } = await pendingPage(db);
		await run(stmt('update supporter_page set photo_id = ? where id = ?', onFundraiser, pageId));
		await insertPage(db, 'campaign', heroShowing(onCampaign));

		await sweepSupporterLeftovers(db, NOW);

		expect(await stored(db, onFundraiser)).toEqual({ row: true, bytes: true });
		expect(await stored(db, onCampaign)).toEqual({ row: true, bytes: true });
	});
});

describe('sweeping fundraisers nobody confirmed', () => {
	beforeEach(async () => {
		await emptySupporterTables();
		for (const table of ['image_bytes', 'image']) await run(stmt(`delete from ${table}`));
		await writeOrgRow(client);
	});

	/** a sweep `offset` past the end of the confirm window of a page started at `STARTED_AT`. */
	const pastWindow = (offset: number) =>
		new Date(STARTED_AT.getTime() + PENDING_PAGE_KEEP_MS + offset);

	/** a pending page holding a photo, with what it owns. */
	async function pendingWithPhoto() {
		const { pageId, slug, token } = await pendingPage(db);
		const photoId = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 1200, height: 800, alt: null },
			new Uint8Array([0x52, 0x49, 0x46, 0x46])
		);
		await run(stmt('update supporter_page set photo_id = ? where id = ?', photoId, pageId));
		const [owned] = await all<{ form_id: string }>(
			stmt('select form_id from supporter_page where id = ?', pageId)
		);
		return { pageId, slug, token, photoId, formId: owned?.form_id ?? '' };
	}

	const count = async (sql: string, ...args: string[]) =>
		(await all<{ n: number }>(stmt(`select count(*) as n from ${sql}`, ...args)))[0]?.n;

	it('deletes one past its window, with its settings row, its photo and its links', async () => {
		const { pageId, photoId, formId } = await pendingWithPhoto();
		// a link Send it again mailed late in the window, still open when the sweep runs.
		await run(stmt('update supporter_link set expires_at = ?', pastWindow(60_000).getTime()));

		await sweepSupporterLeftovers(db, pastWindow(1));

		expect(await count('supporter_page where id = ?', pageId)).toBe(0);
		expect(await count('form where id = ?', formId)).toBe(0);
		expect(await count('supporter_link where supporter_page_id = ?', pageId)).toBe(0);
		expect(await stored(db, photoId)).toEqual({ row: false, bytes: false });
	});

	// its first link is a day past expiry by then, and goes by the rule for every link.
	it('keeps one still inside its window, with its settings row and its photo', async () => {
		const { pageId, photoId, formId } = await pendingWithPhoto();

		await sweepSupporterLeftovers(db, pastWindow(-1));

		expect(await count('supporter_page where id = ?', pageId)).toBe(1);
		expect(await count('form where id = ?', formId)).toBe(1);
		expect(await stored(db, photoId)).toEqual({ row: true, bytes: true });
	});

	it('keeps one its confirm link published, however old', async () => {
		const { pageId, token, photoId, formId } = await pendingWithPhoto();
		const opened = await signInWithLink(
			db,
			new Request('https://give.example/fundraise/open'),
			token,
			new Date(STARTED_AT.getTime() + 60_000)
		);
		expect(opened).toMatchObject({ ok: true, published: true });

		await sweepSupporterLeftovers(db, pastWindow(1));

		expect(await count('supporter_page where id = ?', pageId)).toBe(1);
		expect(await count('form where id = ?', formId)).toBe(1);
		expect(await stored(db, photoId)).toEqual({ row: true, bytes: true });
	});

	it('frees its address for a campaign', async () => {
		const { slug } = await pendingWithPhoto();
		expect((await heldAddresses(db)).has(slug)).toBe(true);

		await sweepSupporterLeftovers(db, pastWindow(1));

		expect((await heldAddresses(db)).has(slug)).toBe(false);
	});
});
