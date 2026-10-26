import { beforeAll, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '../../forms/definition';
import { HEADING_MAX, LEDE_MAX, type Page, parsePage } from '../../page/catalog';
import { CONTENT_FORMS, type ContentFormId, editorSections } from '../../page/content-edit';
import { defaultCampaign } from '../../page/defaults';
import type { RichTextDocument } from '../../rich-text/document';
import { createDb, type Db } from '../db/client';
import { createImage, stored as imageStored } from '../images/image.testing';
import { saveContentForm } from './content';
import { heroShowing, insertPage, SETTINGS } from './page-row.testing';
import { readPage } from './queries';
import { client } from '$lib/server/db/database.testing';

// a db spec because every press reads the page's draft and writes it back against the version
// the editor was drawn at. the target is a campaign unless a test says the Donation page; each
// editor route's spec presses it once.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

const GONE = 'no campaign has that id';

async function stored(pageId: string) {
	const row = await readPage(db, pageId);
	if (row === null) throw new Error('the page is gone');
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(draft.message);
	return { row, draft: draft.page, published: row.published };
}

async function press(
	pageId: string,
	form: ContentFormId,
	fields: [string, string][],
	version?: number,
	type: 'campaign' | 'donation_page' = 'campaign'
) {
	const { row } = await stored(pageId);
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, String(version ?? row.updatedAt.getTime()));
	for (const [name, value] of fields) body.append(name, value);
	return saveContentForm(db, { type, id: pageId }, form, body, GONE);
}

const SAVED = { saved: 'content' };

const upload = () =>
	createImage(
		db,
		{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
		new Uint8Array([1, 2, 3])
	);

function withPage(extra: Partial<Page>): Page {
	return { ...defaultCampaign(), settings: SETTINGS, ...extra };
}

describe('a title', () => {
	it('is written to the draft by Done, and read back as the sheet’s seed', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, CONTENT_FORMS.title, [
			['heading', 'Coats before the first frost'],
			['lede', 'Every child warm by December.']
		]);

		expect(answer).toEqual(SAVED);
		const { draft } = await stored(pageId);
		expect(draft).toMatchObject({
			heading: 'Coats before the first frost',
			lede: 'Every child warm by December.'
		});
		expect(
			editorSections(draft, 'campaign', SETTINGS.currency).find(({ id }) => id === 'title')
		).toMatchObject({
			label: 'Title',
			summary: 'Coats before the first frost',
			text: {
				kind: 'title',
				heading: 'Coats before the first frost',
				lede: 'Every child warm by December.'
			}
		});
	});

	it('takes a blank lede off the page', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({ heading: 'H', lede: 'Warm.' }));

		await press(pageId, CONTENT_FORMS.title, [
			['heading', 'H'],
			['lede', '   ']
		]);

		expect((await stored(pageId)).draft.lede).toBeUndefined();
	});

	it('is refused under the box the catalog rule names, keeping what was typed and writing nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);
		const heading = 'a'.repeat(HEADING_MAX + 1);

		const answer = await press(pageId, CONTENT_FORMS.title, [
			['heading', heading],
			['lede', 'Every child warm by December.']
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { heading: [`a heading holds at most ${HEADING_MAX} characters`] },
			typed: { heading, lede: 'Every child warm by December.' }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('refuses a lede past its length under the lede box', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, CONTENT_FORMS.title, [
			['heading', 'H'],
			['lede', 'a'.repeat(LEDE_MAX + 1)]
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { lede: [`a lede holds at most ${LEDE_MAX} characters`] }
		});
	});

	it('is refused when the page has been saved since the sheet was drawn, and the later save stands', async () => {
		const pageId = await insertPage(db, 'campaign');
		const drawn = (await stored(pageId)).row.updatedAt.getTime();
		await press(pageId, CONTENT_FORMS.title, [
			['heading', 'Saved first'],
			['lede', '']
		]);

		const answer = await press(
			pageId,
			CONTENT_FORMS.title,
			[
				['heading', 'Drawn before it'],
				['lede', '']
			],
			drawn
		);

		expect(refusal(answer)).toMatchObject({
			status: 409,
			error: {
				'': [expect.stringMatching(/^Nothing was changed: this page has been saved since/)]
			},
			typed: { heading: 'Drawn before it' }
		});
		expect((await stored(pageId)).draft.heading).toBe('Saved first');
	});

	it('is answered 404 with the editor’s own sentence when the page is gone', async () => {
		const body = new FormData();
		body.set(WHICH_FORM, CONTENT_FORMS.title);
		body.set(RECORD_VERSION, '1');
		body.append('heading', 'H');
		body.append('lede', '');

		const answer = await saveContentForm(
			db,
			{ type: 'campaign', id: '01926f3e-0000-7b2e-9d4f-3a5b6c7d8e9f' },
			CONTENT_FORMS.title,
			body,
			GONE
		);

		expect(refusal(answer)).toMatchObject({ status: 404, error: { '': [GONE] } });
	});

	it('keeps the Donation page’s title alone, dropping a posted lede', async () => {
		const pageId = await insertPage(db, 'donation_page', { ...defaultCampaign() });

		const answer = await press(
			pageId,
			CONTENT_FORMS.title,
			[
				['heading', 'Give today'],
				['lede', 'ignored']
			],
			undefined,
			'donation_page'
		);

		expect(answer).toEqual(SAVED);
		const { draft } = await stored(pageId);
		expect(draft.heading).toBe('Give today');
		expect(draft.lede).toBeUndefined();
	});
});

describe('a story', () => {
	it('is taken from the rich-text box, and a box that is not a document is refused under that box', async () => {
		const pageId = await insertPage(db, 'campaign');
		const story = richText('Last winter we handed out 400 coats.');

		expect(await press(pageId, CONTENT_FORMS.story, [['body', JSON.stringify(story)]])).toEqual(
			SAVED
		);
		expect((await stored(pageId)).draft.story).toEqual(story);

		const refused = await press(pageId, CONTENT_FORMS.story, [
			['body', '{"type":"doc","content":[{"type":"heading"}]}']
		]);
		expect(refusal(refused)).toMatchObject({
			status: 400,
			error: { body: [expect.stringContaining('heading')] }
		});
		const notJson = await press(pageId, CONTENT_FORMS.story, [['body', 'not json']]);
		expect(refusal(notJson)).toMatchObject({
			status: 400,
			error: { body: [expect.stringContaining('not JSON')] }
		});
		expect((await stored(pageId)).draft.story).toEqual(story);
	});

	it('clears the story when the box is emptied', async () => {
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({ story: richText('Words.') as Page['story'] })
		);

		expect(await press(pageId, CONTENT_FORMS.story, [['body', JSON.stringify(BLANK)]])).toEqual(
			SAVED
		);

		const { draft } = await stored(pageId);
		expect(draft.story).toBeUndefined();
		expect(
			editorSections(draft, 'campaign', SETTINGS.currency).find(({ id }) => id === 'story')
		).toMatchObject({ empty: true, summary: 'No story yet' });
	});

	it('is refused on the Donation page, which has no story, under the story box', async () => {
		const pageId = await insertPage(db, 'donation_page', { ...defaultCampaign() });

		const answer = await press(
			pageId,
			CONTENT_FORMS.story,
			[['body', JSON.stringify(richText('Hello.'))]],
			undefined,
			'donation_page'
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { body: ['the Donation page has no story; only a campaign does'] }
		});
		expect((await stored(pageId)).draft.story).toBeUndefined();
	});
});

describe('impact tiers', () => {
	it('are read from their rows in the page’s currency, leaving out a row emptied of both', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({ tiers: TIERS }));

		const answer = await press(pageId, CONTENT_FORMS.tiers, [
			['tier_amount[0]', '25'],
			['tier_buys[0]', 'a coat'],
			['tier_amount[1]', ''],
			['tier_buys[1]', ''],
			['tier_amount[2]', '12.50'],
			['tier_buys[2]', 'a hat and gloves']
		]);

		expect(answer).toEqual(SAVED);
		const { draft } = await stored(pageId);
		expect(draft.tiers).toEqual([
			{ amountMinor: 2500, buys: 'a coat' },
			{ amountMinor: 1250, buys: 'a hat and gloves' }
		]);
		expect(
			editorSections(draft, 'campaign', SETTINGS.currency).find(({ id }) => id === 'tiers')
		).toMatchObject({
			text: {
				kind: 'tiers',
				currency: 'USD',
				tiers: [
					{ amount: '25', buys: 'a coat' },
					{ amount: '12.50', buys: 'a hat and gloves' }
				]
			}
		});
	});

	it('are taken off the page when every row is emptied', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({ tiers: TIERS }));

		expect(
			await press(pageId, CONTENT_FORMS.tiers, [
				['tier_amount[0]', ''],
				['tier_buys[0]', '']
			])
		).toEqual(SAVED);

		expect((await stored(pageId)).draft.tiers).toBeUndefined();
	});

	it('refuse a tier under the row’s own box', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({ tiers: TIERS }));

		const answer = await press(pageId, CONTENT_FORMS.tiers, [
			['tier_amount[0]', '25'],
			['tier_buys[0]', 'a coat'],
			['tier_amount[1]', 'lots'],
			['tier_buys[1]', 'a sleeping bag'],
			['tier_amount[2]', '40'],
			['tier_buys[2]', '']
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: {
				'tier_amount[1]': [expect.stringMatching(/^must be an amount/)],
				'tier_buys[2]': ['a tier says what its amount buys']
			}
		});
		expect((await stored(pageId)).draft.tiers).toEqual(TIERS);
	});
});

describe('questions', () => {
	it('are read from their rows, leaving out a row with neither a question nor an answer', async () => {
		const pageId = await insertPage(db, 'campaign');
		const answer = richText('Yes, a receipt reaches you by email.');

		expect(
			await press(pageId, CONTENT_FORMS.faq, [
				['question[0]', 'Is my gift tax-deductible?'],
				['answer[0]', JSON.stringify(answer)],
				['question[1]', ''],
				['answer[1]', JSON.stringify(BLANK)]
			])
		).toEqual(SAVED);

		expect((await stored(pageId)).draft.faq).toEqual([
			{ question: 'Is my gift tax-deductible?', answer }
		]);
	});

	it('refuse a blank question that has an answer under its own box', async () => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const refused = await press(pageId, CONTENT_FORMS.faq, [
			['question[0]', ''],
			['answer[0]', JSON.stringify(richText('Yes.'))]
		]);

		expect(refusal(refused)).toMatchObject({
			status: 400,
			error: { 'question[0]': ['a question is not blank'] }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('are taken off the page when every row is emptied', async () => {
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({ faq: [{ question: 'Where?', answer: BLANK }] })
		);

		await press(pageId, CONTENT_FORMS.faq, [
			['question[0]', ''],
			['answer[0]', JSON.stringify(BLANK)]
		]);

		expect((await stored(pageId)).draft.faq).toBeUndefined();
	});
});

describe('a photo', () => {
	it('placed in the cover swaps the cover and leaves the live page, a blank description decorative', async () => {
		const first = await upload();
		const pageId = await insertPage(db, 'campaign', heroShowing(first));
		const replacement = await upload();

		const answer = await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', replacement],
			['alt', '  ']
		]);

		expect(answer).toEqual(SAVED);
		const { draft, published } = await stored(pageId);
		expect(draft.hero).toEqual({ imageId: replacement, alt: null });
		expect(published).toBeNull();
	});

	it('keeps what describes it', async () => {
		const pageId = await insertPage(db, 'campaign');
		await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', await upload()],
			['alt', ' Coats handed out in March ']
		]);
		expect((await stored(pageId)).draft.hero?.alt).toBe('Coats handed out in March');
	});

	it('placed in an existing slot replaces that photo and no other', async () => {
		const [a, b, c] = [await upload(), await upload(), await upload()];
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({
				photos: [
					{ imageId: a, alt: 'a' },
					{ imageId: b, alt: 'b' }
				]
			})
		);

		await press(pageId, CONTENT_FORMS.photo, [
			['slot', '1'],
			['image_id', c],
			['alt', 'c']
		]);

		expect((await stored(pageId)).draft.photos).toEqual([
			{ imageId: a, alt: 'a' },
			{ imageId: c, alt: 'c' }
		]);
	});

	it('placed in a new slot is added after the rest', async () => {
		const a = await upload();
		const added = await upload();
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({ photos: [{ imageId: a, alt: 'a' }] })
		);

		await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'new'],
			['image_id', added],
			['alt', '']
		]);

		expect((await stored(pageId)).draft.photos).toEqual([
			{ imageId: a, alt: 'a' },
			{ imageId: added, alt: null }
		]);
	});

	it.each([
		['a place past the photos held', '3'],
		['a word that is no slot', 'sideways'],
		['a place with a leading zero', '01']
	])('is refused for %s, naming what the slot takes, and nothing is written', async (_, slot) => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const answer = await press(pageId, CONTENT_FORMS.photo, [
			['slot', slot],
			['image_id', await upload()],
			['alt', '']
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: {
				'': [expect.stringContaining('`slot` names no photo on this page')]
			}
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it.each([
		[
			'no stored photo',
			'01926f3e-0000-7b2e-9d4f-3a5b6c7d8e9f',
			'no stored photo has the id "01926f3e-0000-7b2e-9d4f-3a5b6c7d8e9f"'
		],
		[
			'an address',
			'https://elsewhere.example/a.png',
			'an image id is the id a stored photo was given on upload, never an address'
		]
	])('is refused when it names %s, and nothing is written', async (_, imageId, reason) => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const answer = await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', imageId],
			['alt', '']
		]);

		expect(refusal(answer)).toMatchObject({ status: 400, error: { '': [reason] } });
		expect(await stored(pageId)).toEqual(before);
	});

	it('refuses a description past its length under the alt box, and writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const answer = await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', await upload()],
			['alt', 'a'.repeat(251)]
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { alt: ['a photo’s description holds at most 250 characters'] }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('is refused on the Donation page, which has no cover photo', async () => {
		const pageId = await insertPage(db, 'donation_page', { ...defaultCampaign() });

		const answer = await press(
			pageId,
			CONTENT_FORMS.photo,
			[
				['slot', 'cover'],
				['image_id', await upload()],
				['alt', '']
			],
			undefined,
			'donation_page'
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { '': [expect.stringContaining('the Donation page has no cover photo')] }
		});
		expect((await stored(pageId)).draft.hero).toBeUndefined();
	});
});

describe('taking a photo off', () => {
	it('empties the cover, and a photo goes from the list leaving the rest in order', async () => {
		const [cover, a, b] = [await upload(), await upload(), await upload()];
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({
				hero: { imageId: cover, alt: null },
				photos: [
					{ imageId: a, alt: null },
					{ imageId: b, alt: null }
				]
			})
		);

		expect(await press(pageId, CONTENT_FORMS.photoRemove, [['slot', '0']])).toEqual(SAVED);
		expect((await stored(pageId)).draft.photos).toEqual([{ imageId: b, alt: null }]);

		expect(await press(pageId, CONTENT_FORMS.photoRemove, [['slot', '0']])).toEqual(SAVED);
		expect((await stored(pageId)).draft.photos).toBeUndefined();

		expect(await press(pageId, CONTENT_FORMS.photoRemove, [['slot', 'cover']])).toEqual(SAVED);
		expect((await stored(pageId)).draft.hero).toBeUndefined();
	});

	it('is refused for a photo not yet placed and for a place the page does not hold', async () => {
		const pageId = await insertPage(db, 'campaign');

		const added = await press(pageId, CONTENT_FORMS.photoRemove, [['slot', 'new']]);
		const past = await press(pageId, CONTENT_FORMS.photoRemove, [['slot', '2']]);

		expect(refusal(added)).toMatchObject({
			status: 400,
			error: { '': ['a photo not yet placed has nothing to take off'] }
		});
		expect(refusal(past)).toMatchObject({
			status: 400,
			error: { '': [expect.stringContaining('`slot` names no photo on this page')] }
		});
	});
});

describe('a photo the draft lets go of', () => {
	it('is freed when a photo replaces it, row and bytes, and the new one kept', async () => {
		const first = await upload();
		const pageId = await insertPage(db, 'campaign', heroShowing(first));
		const second = await upload();

		const answer = await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', second],
			['alt', '']
		]);

		expect(answer).toEqual(SAVED);
		expect(await imageStored(db, first)).toEqual({ row: false, bytes: false });
		expect(await imageStored(db, second)).toEqual({ row: true, bytes: true });
	});

	it('is kept when replaced while the live page still places it', async () => {
		const first = await upload();
		const pageId = await insertPage(db, 'campaign', heroShowing(first), heroShowing(first));

		await press(pageId, CONTENT_FORMS.photo, [
			['slot', 'cover'],
			['image_id', await upload()],
			['alt', '']
		]);

		expect(await imageStored(db, first)).toEqual({ row: true, bytes: true });
	});

	it('is freed when taken off, and kept while the live page still places it', async () => {
		const gone = await upload();
		const goneId = await insertPage(db, 'campaign', heroShowing(gone));
		const live = await upload();
		const liveId = await insertPage(db, 'campaign', heroShowing(live), heroShowing(live));

		await press(goneId, CONTENT_FORMS.photoRemove, [['slot', 'cover']]);
		await press(liveId, CONTENT_FORMS.photoRemove, [['slot', 'cover']]);

		expect((await stored(goneId)).draft.hero).toBeUndefined();
		expect(await imageStored(db, gone)).toEqual({ row: false, bytes: false });
		expect((await stored(liveId)).draft.hero).toBeUndefined();
		expect(await imageStored(db, live)).toEqual({ row: true, bytes: true });
	});

	it('is kept when the save is stale, since the draft still places it', async () => {
		const first = await upload();
		const pageId = await insertPage(db, 'campaign', heroShowing(first));
		const drawn = (await stored(pageId)).row.updatedAt.getTime();
		await press(pageId, CONTENT_FORMS.title, [
			['heading', 'Saved first'],
			['lede', '']
		]);

		const answer = await press(pageId, CONTENT_FORMS.photoRemove, [['slot', 'cover']], drawn);

		expect(refusal(answer)).toMatchObject({ status: 409 });
		expect((await stored(pageId)).draft.hero).toBeDefined();
		expect(await imageStored(db, first)).toEqual({ row: true, bytes: true });
	});
});

const BLANK: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

const TIERS: Page['tiers'] = [
	{ amountMinor: 5000, buys: 'a coat' },
	{ amountMinor: 10_000, buys: 'two coats' }
];

function richText(text: string) {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** a rejection as the editor reads it: the status, the messages by box, and the boxes sent back. */
function refusal(answer: unknown) {
	const { data, init } = answer as {
		data: { form: { result: { error: unknown; initialValue: unknown } } };
		init: { status: number };
	};
	return {
		status: init.status,
		error: data.form.result.error,
		typed: data.form.result.initialValue
	};
}
