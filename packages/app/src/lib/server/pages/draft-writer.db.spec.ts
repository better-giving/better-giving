import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { pngHeader } from '../images/headers.testing';
import { createImage, stored } from '../images/image.testing';
import { editPageDraft } from './draft-writer';
import { heroShowing, insertPage } from './page-row.testing';
import { readPage } from './queries';
import { client, stmt } from '$lib/server/db/database.testing';

// the one writer of a page's draft: what it writes, what it refuses and with which path, a write
// against a version that moved, a page that is gone, and the photo a write lets go of.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await client.batch([
		stmt('delete from page'),
		stmt('delete from form'),
		stmt('delete from image_bytes'),
		stmt('delete from image')
	]);
});

async function versionOf(id: string): Promise<Date> {
	const row = await readPage(db, id);
	if (row === null) throw new Error(`no page ${id}`);
	return row.updatedAt;
}

describe('editPageDraft', () => {
	it('writes what the command makes of the draft, and answers the new version', async () => {
		const id = await insertPage(db, 'campaign');
		const written = await editPageDraft(
			db,
			{ type: 'campaign', id },
			await versionOf(id),
			(draft) => ({
				ok: true,
				draft: { ...draft, goalMinor: 500_000 }
			})
		);

		expect(written.kind).toBe('written');
		const row = await readPage(db, id);
		expect(JSON.parse(row?.draft ?? '{}').goalMinor).toBe(500_000);
		expect(row?.published).toBeNull();
	});

	it('refuses a draft the page rule refuses, with the path it names, and writes nothing', async () => {
		const id = await insertPage(db, 'campaign');
		const before = (await readPage(db, id))?.draft;
		const written = await editPageDraft(db, { type: 'campaign', id }, 'current', (draft) => ({
			ok: true,
			draft: { ...draft, goalMinor: -1 }
		}));

		expect(written).toMatchObject({ kind: 'refused', path: ['goalMinor'] });
		expect((await readPage(db, id))?.draft).toBe(before);
	});

	it('passes on a refusal the command makes itself', async () => {
		const id = await insertPage(db, 'campaign');
		const written = await editPageDraft(db, { type: 'campaign', id }, 'current', () => ({
			ok: false,
			path: ['blocks', 0],
			message: 'no'
		}));

		expect(written).toEqual({ kind: 'refused', path: ['blocks', 0], message: 'no' });
	});

	it('writes nothing against a version the page has moved past', async () => {
		const id = await insertPage(db, 'campaign');
		const written = await editPageDraft(db, { type: 'campaign', id }, new Date(1), (draft) => ({
			ok: true,
			draft
		}));

		expect(written).toEqual({ kind: 'stale' });
	});

	it('answers gone for a campaign that is not there', async () => {
		const written = await editPageDraft(
			db,
			{ type: 'campaign', id: '019fb300-0000-7000-8000-000000000999' },
			'current',
			(draft) => ({ ok: true, draft })
		);

		expect(written).toEqual({ kind: 'gone' });
	});

	it('frees the photo the old draft placed and the new one does not', async () => {
		const imageId = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/png', width: 4, height: 3, alt: null },
			pngHeader(4, 3)
		);
		const id = await insertPage(db, 'campaign', heroShowing(imageId));

		await editPageDraft(db, { type: 'campaign', id }, 'current', (draft) => ({
			ok: true,
			draft: { ...draft, hero: undefined }
		}));

		expect(await stored(db, imageId)).toEqual({ row: false, bytes: false });
	});
});
