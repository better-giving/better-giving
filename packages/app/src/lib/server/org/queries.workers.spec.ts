import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultCampaign } from '../../page/defaults';
import type { Page } from '../../page/catalog';
import { createDb, type Db } from '../db/client';
import { chatTurn, program } from '../db/schema';
import { d1BytesPort } from '../images/bytes';
import { createImage, firstMissingImage } from '../images/queries';
import { insertPage, SETTINGS } from '../pages/page-row.testing';
import { parseOrgProfile, type OrgProfileFormValues, type ParsedOrgProfile } from './org-input';
import {
	readOrgLogo,
	readOrgProfile,
	removeOrgProfileLogo,
	saveOrgProfile,
	setOrgProfileLogo,
	updateOrgLogo
} from './queries';

// real D1 inside workerd, over the committed migrations — so the singleton check, the
// not-blank CHECKs and `STRICT` are all the deployed ones.
//
// the `org_profile` table object is deliberately not imported here: every read and write of
// it lives in ./queries.ts, and the probes below reach past drizzle on purpose — a check is
// a property of the database, so the statement that tests it should be the one a
// hand-written `wrangler d1 execute` would send.

/** raised by a check constraint, i.e. not by the type system. */
const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

let db: Db;
beforeAll(() => {
	// the request-path constructor, not a fixture: what these tests exercise is what `requestDb`
	// builds for every request (src/request-context.ts).
	db = createDb(env.DB);
});

// storage is isolated per test file, not per test, so rows written by one `it` are visible
// to the next — and this table holds at most one row, so every case would otherwise depend
// on execution order.
beforeEach(async () => {
	await env.DB.prepare('delete from org_profile').run();
});

/**
 * runs `fn`, requires D1 to have rejected it, and hands back the message. fails loudly
 * rather than returning a sentinel if the statement succeeded.
 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

/** parses and saves in one step — the path the settings form action takes. */
async function save(values: OrgProfileFormValues) {
	const result = parseOrgProfile(values, []);
	if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
	return saveOrgProfile(db, result.value satisfies ParsedOrgProfile);
}

/**
 * the six boxes the save refuses blank, and nothing else — the smallest thing `save` accepts.
 *
 * `legal_name`, the three address parts a receipt is printed from, and the EIN no donation form is
 * served without; the other four columns may be emptied, which is what the cases below spread this
 * one to show.
 */
const REQUIRED: OrgProfileFormValues = {
	legal_name: 'Hope Foundation',
	tax_id: '12-3456789',
	address_line1: '12 Kigali Road',
	city: 'Kigali',
	country: 'Rwanda'
};

const FULL: OrgProfileFormValues = {
	legal_name: 'Hope Foundation',
	tax_id: '12-3456789',
	address_line1: '12 Kigali Road',
	address_line2: 'Suite 4',
	city: 'Kigali',
	region: 'Kigali City',
	postal_code: '00000',
	country: 'Rwanda',
	notification_email: 'giving@example.org'
};

async function rowCount(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from org_profile').first<{ n: number }>();
	return row?.n ?? -1;
}

describe('readOrgProfile', () => {
	it('returns null when nothing has been saved', async () => {
		// absent means not set. there is no seeded row precisely so this is answerable — a
		// seeded row of blanks would read as filled in to every caller that asks.
		expect(await readOrgProfile(db)).toBeNull();
	});

	it('returns the saved row', async () => {
		await save(FULL);
		expect(await readOrgProfile(db)).toMatchObject({
			id: 'default',
			legalName: 'Hope Foundation',
			taxId: '12-3456789',
			city: 'Kigali'
		});
	});
});

describe('saveOrgProfile', () => {
	it('inserts the first save and returns the stored row', async () => {
		const row = await save(FULL);
		expect(row).toMatchObject({
			legalName: 'Hope Foundation',
			taxId: '12-3456789',
			addressLine1: '12 Kigali Road',
			addressLine2: 'Suite 4',
			city: 'Kigali',
			region: 'Kigali City',
			postalCode: '00000',
			country: 'Rwanda',
			notificationEmail: 'giving@example.org'
		});
	});

	it('fills id, created_at and updated_at without being told to', async () => {
		const row = await save(FULL);
		expect(row.id).toBe('default');
		expect(row.createdAt).toBeInstanceOf(Date);
		expect(row.updatedAt).toBeInstanceOf(Date);
	});

	it('updates rather than duplicating on the second save', async () => {
		await save(FULL);
		const row = await save({ ...FULL, legal_name: 'Hope Foundation Inc.', city: 'Huye' });
		expect(row.legalName).toBe('Hope Foundation Inc.');
		expect(row.city).toBe('Huye');
		expect(await rowCount()).toBe(1);
	});

	it('clears a field the operator emptied', async () => {
		// the update names every writable column, so a field left blank on the form is
		// written back as null rather than keeping the value it used to have. every column that
		// may be emptied at all is here — the six in `REQUIRED` are refused blank by the parser,
		// so a save can never be the thing that clears one.
		await save(FULL);
		const row = await save(REQUIRED);
		expect(row).toMatchObject({
			addressLine2: null,
			region: null,
			postalCode: null,
			notificationEmail: null
		});
	});

	it('leaves a fork’s deductibility statement alone across a save', async () => {
		// the one column no screen posts and this write may not clear: a fork writes its own
		// wording on its own deployment (../org/deductibility.ts), and an operator saving their
		// address afterwards would otherwise withdraw a claim they never touched. absent from the
		// `set` is what preserves it.
		await save(FULL);
		await env.DB.prepare('update org_profile set deductibility_statement = ?')
			.bind('Gifts to this charity are tax-exempt.')
			.run();
		const row = await save({ ...FULL, city: 'Musanze' });
		expect(row.deductibilityStatement).toBe('Gifts to this charity are tax-exempt.');
		expect(row.city).toBe('Musanze');
	});

	it('keeps created_at from the first save and moves updated_at on the second', async () => {
		// `$onUpdateFn` is load-bearing on the conflict path too, and this is the
		// deterministic way to see it: seed the row with both timestamps at 0 rather than
		// racing workerd's frozen clock across two saves.
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, created_at, updated_at)
			 values ('default', 'Seeded', 0, 0)`
		).run();

		const row = await save(FULL);
		expect(row.createdAt.getTime()).toBe(0);
		expect(row.updatedAt.getTime()).toBeGreaterThan(0);
	});
});

/**
 * a parsed `FULL` with the four values the console's widened save states beside the nine. the
 * parse that fills them from a submission is not ./org-input.ts's yet, so the spec mints them.
 */
async function saveWithPresence(presence: {
	mission: string | null;
	vision: string | null;
	brandColour: string | null;
	socialLinks: ParsedOrgProfile['socialLinks'];
}) {
	const result = parseOrgProfile(FULL, []);
	if (!result.ok) throw new Error('FULL did not parse');
	return saveOrgProfile(db, { ...result.value, ...presence } as ParsedOrgProfile);
}

describe('mission, vision, brand colour and social links', () => {
	it('read back as saved', async () => {
		await saveWithPresence({
			mission: 'Clean water for every school.\nAnd every clinic.',
			vision: 'A district where no child walks for water.',
			brandColour: '#0a7c5c',
			socialLinks: [
				{ platform: 'instagram', href: 'https://instagram.com/hopefoundation' },
				{ platform: 'facebook', href: 'https://www.facebook.com/hopefoundation' }
			]
		});
		expect(await readOrgProfile(db)).toMatchObject({
			mission: 'Clean water for every school.\nAnd every clinic.',
			vision: 'A district where no child walks for water.',
			brandColour: '#0a7c5c',
			socialLinks: [
				{ platform: 'instagram', href: 'https://instagram.com/hopefoundation' },
				{ platform: 'facebook', href: 'https://www.facebook.com/hopefoundation' }
			]
		});
	});

	it('are null and no links on a profile saved without them', async () => {
		await save(FULL);
		expect(await readOrgProfile(db)).toMatchObject({
			mission: null,
			vision: null,
			brandColour: null,
			socialLinks: [],
			logoImageId: null
		});
	});

	it('are cleared by a save that states none', async () => {
		await saveWithPresence({
			mission: 'Clean water.',
			vision: 'No child walks for water.',
			brandColour: '#0a7c5c',
			socialLinks: [{ platform: 'x', href: 'https://x.com/hope' }]
		});
		await save(FULL);
		expect(await readOrgProfile(db)).toMatchObject({
			mission: null,
			vision: null,
			brandColour: null,
			socialLinks: []
		});
	});

	it('read as no links on a row written before the column was stated', async () => {
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, created_at, updated_at)
			 values ('default', 'Seeded', 0, 0)`
		).run();
		expect((await readOrgProfile(db))?.socialLinks).toEqual([]);
	});
});

describe('the brand colour and social links constraints', () => {
	/** an insert of the singleton stating one column, as raw SQL. */
	const insertWith = (column: string, value: string) =>
		env.DB.prepare(
			`insert into org_profile (id, legal_name, created_at, updated_at, ${column})
			 values ('default', 'Hope Foundation', 0, 0, ?)`
		)
			.bind(value)
			.run();

	it('takes a lowercase #rrggbb', async () => {
		await insertWith('brand_colour', '#0a7c5c');
		expect((await readOrgProfile(db))?.brandColour).toBe('#0a7c5c');
	});

	it.each([
		['upper-case', '#0A7C5C'],
		['without its #', '0a7c5c'],
		['three digits', '#0a7'],
		['seven digits', '#0a7c5c0'],
		['not hex', '#0a7c5g'],
		['a name', 'green']
	])('refuses a brand colour %s', async (_, value) => {
		const message = await rejection(() => insertWith('brand_colour', value));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_profile_brand_colour_check');
	});

	it.each([
		['an object', '{"platform":"x","href":"https://x.com/hope"}'],
		['a string', '"https://x.com/hope"'],
		['not JSON', '[{"platform":"x"']
	])('refuses social links that are %s', async (_, value) => {
		const message = await rejection(() => insertWith('social_links', value));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_profile_social_links_array_check');
	});
});

describe('the singleton constraint', () => {
	it('refuses a second row under any other id', async () => {
		// this is what makes "which profile is live" a lookup rather than a query with an
		// ordering in it. it is the database's promise, not the app's — so the probe is raw
		// SQL, the shape a hand-written `wrangler d1 execute` would take.
		await save(FULL);
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into org_profile (id, legal_name, created_at, updated_at)
				 values ('second', 'Other Org', 0, 0)`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_profile_id_check');
	});
});

describe('the not-blank constraints', () => {
	it('refuses a blank legal name', async () => {
		// `notNull` is satisfied by `''` and `STRICT` says a blank string is a well-typed
		// text, so this check is the only thing standing between a receipt and no name on it.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into org_profile (id, legal_name, created_at, updated_at)
				 values ('default', '', 0, 0)`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_profile_legal_name_not_blank_check');
	});

	it('refuses a legal name that is only a non-breaking space', async () => {
		// U+00A0 is what a paste out of a word processor leaves behind; it renders as a
		// blank cell everywhere. the one-argument `trim()` would not have caught it.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into org_profile (id, legal_name, created_at, updated_at)
				 values ('default', char(160), 0, 0)`
			).run()
		);
		expect(message).toContain('org_profile_legal_name_not_blank_check');
	});

	it('refuses an empty string in an optional column while allowing NULL', async () => {
		// null is "not stated", `''` is "stated as nothing", and only the second is the bug
		// the parser turns into null before it ever gets here. asserted on `region`, which is
		// nullable and optional at every layer — `city` is refused blank by the parser now, so a
		// check on it would be reporting the second of two refusals rather than the column's own.
		await save(REQUIRED);
		const message = await rejection(() =>
			env.DB.prepare(`update org_profile set region = '' where id = 'default'`).run()
		);
		expect(message).toContain('org_profile_region_not_blank_check');
	});

	it.each(['mission', 'vision'])('refuses a blank %s', async (column) => {
		await save(REQUIRED);
		const message = await rejection(() =>
			env.DB.prepare(`update org_profile set ${column} = char(10, 32) where id = 'default'`).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`org_profile_${column}_not_blank_check`);
	});

	it('refuses a blank deductibility statement', async () => {
		// the column the parser is protecting: a receipt carrying `Tax deductibility: ` with
		// nothing after it states nothing while looking like it states something. null is
		// "not written yet" and is what the embed reads as no config.
		await save(REQUIRED);
		const message = await rejection(() =>
			env.DB.prepare(
				`update org_profile set deductibility_statement = '' where id = 'default'`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_profile_deductibility_statement_not_blank_check');
	});
});

describe('the profile logo', () => {
	const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

	const storeImage = (kind: 'photo' | 'illustration' = 'photo') =>
		createImage(db, { kind, contentType: 'image/webp', width: 400, height: 400, alt: null }, BYTES);

	/** whether the image's row and its bytes are each still stored. */
	async function stored(id: string) {
		return {
			row: (await firstMissingImage(db, [id])) === null,
			bytes: (await d1BytesPort(db).get(id)) !== null
		};
	}

	const logo = async () => (await readOrgProfile(db))?.logoImageId;

	/** a campaign document with `imageId` as its hero's photo. */
	function showing(imageId: string): Page {
		const draft = { ...defaultCampaign(), settings: SETTINGS };
		return {
			...draft,
			blocks: draft.blocks.map((block) => (block.type === 'hero' ? { ...block, imageId } : block))
		};
	}

	it('stores the id it is set to', async () => {
		await save(FULL);
		const id = await storeImage();
		expect(await setOrgProfileLogo(db, id)).toBe('written');
		expect(await logo()).toBe(id);
	});

	it('frees the logo it replaces, row and bytes, and keeps the new one', async () => {
		await save(FULL);
		const first = await storeImage();
		const second = await storeImage();
		await setOrgProfileLogo(db, first);
		expect(await setOrgProfileLogo(db, second)).toBe('written');
		expect(await logo()).toBe(second);
		expect(await stored(first)).toEqual({ row: false, bytes: false });
		expect(await stored(second)).toEqual({ row: true, bytes: true });
	});

	it('keeps the logo set again to the same id', async () => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		expect(await setOrgProfileLogo(db, id)).toBe('written');
		expect(await logo()).toBe(id);
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});

	it('is taken off by a remove, which frees it', async () => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		expect(await removeOrgProfileLogo(db)).toBe('written');
		expect(await logo()).toBeNull();
		expect(await stored(id)).toEqual({ row: false, bytes: false });
	});

	it('is left alone by a profile save', async () => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		await save({ ...FULL, city: 'Huye' });
		expect(await logo()).toBe(id);
	});

	it('answers a remove with no logo, or no profile, as written', async () => {
		expect(await removeOrgProfileLogo(db)).toBe('written');
		await save(FULL);
		expect(await removeOrgProfileLogo(db)).toBe('written');
	});

	const REFERENCES: [string, (id: string) => Promise<unknown>][] = [
		[
			'a cause’s photo',
			(id) => db.insert(program).values({ name: `Clean water ${id}`, imageId: id })
		],
		['the presented logo', async (id) => updateOrgLogo(db, (await readOrgLogo(db)).version, id)],
		[
			'the presented logo’s undo',
			async (id) => {
				await updateOrgLogo(db, (await readOrgLogo(db)).version, id);
				await updateOrgLogo(db, (await readOrgLogo(db)).version, null);
			}
		],
		['a page’s draft', (id) => insertPage(db, 'campaign', showing(id))],
		[
			'a page’s published document',
			(id) => insertPage(db, 'campaign', { ...defaultCampaign(), settings: SETTINGS }, showing(id))
		],
		[
			'a page’s last published document',
			async (id) => {
				const plain = { ...defaultCampaign(), settings: SETTINGS };
				const pageId = await insertPage(db, 'campaign', plain, plain);
				await env.DB.prepare('update page set last_published = ? where id = ?')
					.bind(JSON.stringify(showing(id)), pageId)
					.run();
			}
		],
		[
			'a chat turn’s photos',
			async (id) => {
				const pageId = await insertPage(db, 'campaign');
				await db.insert(chatTurn).values({
					pageId,
					seq: 1,
					author: 'operator',
					text: 'use this one',
					imageIds: JSON.stringify([await storeImage(), id])
				});
			}
		]
	];

	it.each(REFERENCES)('keeps a replaced logo that is also %s', async (_, reference) => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		await reference(id);
		expect(await setOrgProfileLogo(db, await storeImage())).toBe('written');
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});

	it.each(REFERENCES)('keeps a removed logo that is also %s', async (_, reference) => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		await reference(id);
		expect(await removeOrgProfileLogo(db)).toBe('written');
		expect(await logo()).toBeNull();
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});

	it('refuses an id no image has, and writes nothing', async () => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		expect(await setOrgProfileLogo(db, crypto.randomUUID())).toBe('unknown');
		expect(await logo()).toBe(id);
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});

	it('refuses an illustration, and writes nothing', async () => {
		await save(FULL);
		const id = await storeImage();
		await setOrgProfileLogo(db, id);
		expect(await setOrgProfileLogo(db, await storeImage('illustration'))).toBe('illustration');
		expect(await logo()).toBe(id);
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});

	it('refuses a logo before the profile is saved, and writes nothing', async () => {
		const id = await storeImage();
		expect(await setOrgProfileLogo(db, id)).toBe('no-profile');
		expect(await readOrgProfile(db)).toBeNull();
		expect(await stored(id)).toEqual({ row: true, bytes: true });
	});
});
