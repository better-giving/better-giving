import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '../../forms/definition';
import { BLOCK_FORMS, type BlockFormId, editorBlocks } from '../../page/block-edit';
import { HEADING_MAX, type Page, parsePage } from '../../page/catalog';
import { defaultCampaign } from '../../page/defaults';
import type { RichTextDocument } from '../../rich-text/document';
import { createDb, type Db } from '../db/client';
import { createImage } from '../images/queries';
import { draftIllustrations, editorDraft, saveBlockForm } from './blocks';
import { draftTurn } from './draft';
import { answering, insertPage, SETTINGS } from './page-row.testing';
import { readPage } from './queries';

// a workers spec because every press reads the page's draft and writes it back against the version
// the editor was drawn at. the target is a campaign throughout; the Donation page is the same write
// by its type (./queries.ts's `SettingsTarget`), and each editor route's spec presses it once.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
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
	form: BlockFormId,
	fields: [string, string][],
	version?: number
) {
	const { row } = await stored(pageId);
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, String(version ?? row.updatedAt.getTime()));
	for (const [name, value] of fields) body.append(name, value);
	return saveBlockForm(db, { type: 'campaign', id: pageId }, form, body, GONE);
}

function blockOf(draft: Page, id: string) {
	return draft.blocks.find((block) => block.id === id);
}

describe('a block’s words', () => {
	it('are written to the draft by Done, and read back as the sheet’s seed', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, BLOCK_FORMS.title, [
			['block_id', 'title'],
			['heading', 'Coats before the first frost'],
			['lede', 'Every child warm by December.']
		]);

		expect(answer).toEqual({ saved: 'block' });
		const { draft } = await stored(pageId);
		expect(blockOf(draft, 'title')).toEqual({
			id: 'title',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: 'Coats before the first frost',
			lede: 'Every child warm by December.'
		});
		expect(
			editorBlocks(draft, SETTINGS.currency, new Set()).find((block) => block.id === 'title')
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

	it('are refused under the box the catalog rule names, keeping what was typed and writing nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);
		const heading = 'a'.repeat(HEADING_MAX + 1);

		const answer = await press(pageId, BLOCK_FORMS.title, [
			['block_id', 'title'],
			['heading', heading],
			['lede', 'Every child warm by December.']
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { heading: [`a heading holds at most ${HEADING_MAX} characters`] },
			typed: { block_id: 'title', heading, lede: 'Every child warm by December.' }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('are refused when the page has been saved since the sheet was drawn, and the later save stands', async () => {
		const pageId = await insertPage(db, 'campaign');
		const drawn = (await stored(pageId)).row.updatedAt.getTime();
		await press(pageId, BLOCK_FORMS.title, [
			['block_id', 'title'],
			['heading', 'Saved first'],
			['lede', '']
		]);

		const answer = await press(
			pageId,
			BLOCK_FORMS.title,
			[
				['block_id', 'title'],
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
		expect(blockOf((await stored(pageId)).draft, 'title')).toMatchObject({
			heading: 'Saved first'
		});
	});

	it('take the story from the rich-text box, and refuse one that is not a document under that box', async () => {
		const pageId = await insertPage(db, 'campaign');
		const body = richText('Last winter we handed out 400 coats.');

		expect(
			await press(pageId, BLOCK_FORMS.story, [
				['block_id', 'story'],
				['body', JSON.stringify(body)]
			])
		).toEqual({ saved: 'block' });
		expect(blockOf((await stored(pageId)).draft, 'story')).toMatchObject({ body });

		const refused = await press(pageId, BLOCK_FORMS.story, [
			['block_id', 'story'],
			['body', '{"type":"doc","content":[{"type":"heading"}]}']
		]);
		expect(refusal(refused)).toMatchObject({
			status: 400,
			error: { body: [expect.stringContaining('heading')] }
		});
		expect(blockOf((await stored(pageId)).draft, 'story')).toMatchObject({ body });
	});

	it('read impact tiers from their rows in the page’s currency, leaving out a row emptied of both', async () => {
		const pageId = await insertPage(db, 'campaign', withBlocks(TIERS));

		const answer = await press(pageId, BLOCK_FORMS.impactTiers, [
			['block_id', 'tiers'],
			['tier_amount[0]', '25'],
			['tier_buys[0]', 'a coat'],
			['tier_amount[1]', ''],
			['tier_buys[1]', ''],
			['tier_amount[2]', '12.50'],
			['tier_buys[2]', 'a hat and gloves']
		]);

		expect(answer).toEqual({ saved: 'block' });
		expect(blockOf((await stored(pageId)).draft, 'tiers')).toMatchObject({
			tiers: [
				{ amountMinor: 2500, buys: 'a coat' },
				{ amountMinor: 1250, buys: 'a hat and gloves' }
			]
		});
		expect(
			editorBlocks((await stored(pageId)).draft, SETTINGS.currency, new Set()).find(
				({ id }) => id === 'tiers'
			)
		).toMatchObject({
			text: {
				kind: 'impact-tiers',
				currency: 'USD',
				tiers: [
					{ amount: '25', buys: 'a coat' },
					{ amount: '12.50', buys: 'a hat and gloves' }
				]
			}
		});
	});

	it('refuse an impact tier under the row’s own box', async () => {
		const pageId = await insertPage(db, 'campaign', withBlocks(TIERS));

		const answer = await press(pageId, BLOCK_FORMS.impactTiers, [
			['block_id', 'tiers'],
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
		expect(blockOf((await stored(pageId)).draft, 'tiers')).toEqual(TIERS[0]);
	});

	it('read questions from their rows, and refuse a blank question under its own box', async () => {
		const pageId = await insertPage(db, 'campaign', withBlocks(FAQ));
		const answer = richText('Yes, a receipt reaches you by email.');

		expect(
			await press(pageId, BLOCK_FORMS.faq, [
				['block_id', 'faq'],
				['question[0]', 'Is my gift tax-deductible?'],
				['answer[0]', JSON.stringify(answer)],
				['question[1]', ''],
				['answer[1]', JSON.stringify(BLANK)]
			])
		).toEqual({ saved: 'block' });
		expect(blockOf((await stored(pageId)).draft, 'faq')).toMatchObject({
			items: [{ question: 'Is my gift tax-deductible?', answer }]
		});

		const refused = await press(pageId, BLOCK_FORMS.faq, [
			['block_id', 'faq'],
			['question[0]', ''],
			['answer[0]', JSON.stringify(answer)]
		]);
		expect(refusal(refused)).toMatchObject({
			status: 400,
			error: { 'question[0]': ['a question is not blank'] }
		});
	});
});

describe('a photo', () => {
	const upload = () =>
		createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);

	async function withPhoto() {
		const placed = await upload();
		const draft: Page = { ...defaultCampaign(), settings: SETTINGS };
		draft.blocks[0] = {
			id: 'hero',
			type: 'hero',
			variant: 'wide',
			background: 'none',
			imageId: placed,
			alt: 'Volunteers'
		};
		return insertPage(db, 'campaign', draft);
	}

	it('replaced by hand swaps the photo and keeps the block, a blank description decorative', async () => {
		const pageId = await withPhoto();
		const replacement = await upload();

		const answer = await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'hero'],
			['image_id', replacement],
			['alt', '  ']
		]);

		expect(answer).toEqual({ saved: 'block' });
		const { draft, published } = await stored(pageId);
		expect(draft.blocks[0]).toEqual({
			id: 'hero',
			type: 'hero',
			variant: 'wide',
			background: 'none',
			imageId: replacement,
			alt: null
		});
		expect(published).toBeNull();
	});

	it('keeps what describes it', async () => {
		const pageId = await withPhoto();
		const replacement = await upload();
		await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'hero'],
			['image_id', replacement],
			['alt', ' Coats handed out in March ']
		]);
		expect((await stored(pageId)).draft.blocks[0]).toMatchObject({
			alt: 'Coats handed out in March'
		});
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
		const pageId = await withPhoto();
		const before = await stored(pageId);

		const answer = await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'hero'],
			['image_id', imageId],
			['alt', '']
		]);

		expect(refusal(answer)).toMatchObject({ status: 400, error: { '': [reason] } });
		expect(await stored(pageId)).toEqual(before);
	});

	it('refuses a description past its length under its own box, and writes nothing', async () => {
		const pageId = await withPhoto();
		const before = await stored(pageId);
		const answer = await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'hero'],
			['image_id', await upload()],
			['alt', 'a'.repeat(251)]
		]);
		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { alt: ['a photo’s description holds at most 250 characters'] }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('replaced by hand over an illustration is flagged as one no longer, on the editor’s next load', async () => {
		const illustration = await createImage(
			db,
			{ kind: 'illustration', contentType: 'image/webp', width: 4, height: 3, alt: 'a van' },
			new Uint8Array([1, 2, 3])
		);
		const draft: Page = { ...defaultCampaign(), settings: SETTINGS };
		draft.blocks[0] = {
			id: 'hero',
			type: 'hero',
			variant: 'wide',
			background: 'none',
			imageId: illustration,
			alt: 'a van'
		};
		const pageId = await insertPage(db, 'campaign', draft);
		const hero = async () => {
			const { row } = await stored(pageId);
			const { blocks } = editorDraft(row, SETTINGS.currency, await draftIllustrations(db, row));
			return blocks.find((block) => block.id === 'hero');
		};
		expect(await hero()).toMatchObject({ illustration: true });

		await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'hero'],
			['image_id', await upload()],
			['alt', 'Volunteers']
		]);

		expect(await hero()).toMatchObject({ illustration: false });
	});

	it('is refused on a block that holds no photo, naming what it is', async () => {
		const pageId = await withPhoto();
		const answer = await press(pageId, BLOCK_FORMS.photo, [
			['block_id', 'title'],
			['image_id', await upload()],
			['alt', '']
		]);
		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { '': ['block "title" is a title, and this sheet edits a hero or an image'] }
		});
	});
});

describe('a follow-up message in the chat', () => {
	it('keeps a hand edit it was not asked to change', async () => {
		const pageId = await insertPage(db, 'campaign');
		const story = richText('Last winter we handed out 400 coats.');
		await press(pageId, BLOCK_FORMS.story, [
			['block_id', 'story'],
			['body', JSON.stringify(story)]
		]);
		const AI = answering({
			say: 'A warmer title.',
			page: {
				kind: 'patch',
				ops: [{ op: 'replace', path: '/blocks/1/props/heading', value: 'Keep a child warm' }]
			}
		});

		const turn = await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'warmer title', imageIds: [], timeZone: 'UTC', now: Date.now() }
		);

		expect(turn).toMatchObject({ ok: true, outcome: 'accepted' });
		const { draft } = await stored(pageId);
		expect(blockOf(draft, 'title')).toMatchObject({ heading: 'Keep a child warm' });
		expect(blockOf(draft, 'story')).toMatchObject({ body: story });
	});
});

describe('a picture', () => {
	it('picks a block’s variant into the draft, leaving its words and the live page as they were', async () => {
		const live = withBlocks(FAQ);
		const pageId = await insertPage(db, 'campaign', live, live);

		expect(
			await press(pageId, BLOCK_FORMS.variant, [
				['block_id', 'faq'],
				['variant', 'open']
			])
		).toEqual({ saved: 'block' });

		const after = await stored(pageId);
		expect(blockOf(after.draft, 'faq')).toEqual({ ...FAQ[0], variant: 'open' });
		expect(JSON.parse(after.published ?? 'null')).toEqual(live);
		expect(after.row.state).toBe('live');
	});

	it('picks the page’s layout into the draft', async () => {
		const pageId = await insertPage(db, 'campaign');

		expect(await press(pageId, BLOCK_FORMS.layout, [['layout', 'banner']])).toEqual({
			saved: 'block'
		});

		expect((await stored(pageId)).draft.layout).toBe('banner');
	});

	it('refuses a name off the catalog’s list, naming it, and writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const variant = await press(pageId, BLOCK_FORMS.variant, [
			['block_id', 'story'],
			['variant', 'zigzag']
		]);
		const layout = await press(pageId, BLOCK_FORMS.layout, [['layout', 'sideways']]);

		expect(refusal(variant)).toMatchObject({
			status: 400,
			error: { variant: ['"zigzag" is not a variant of story; it is plain, lede or split'] }
		});
		expect(refusal(layout)).toMatchObject({
			status: 400,
			error: { layout: [expect.stringMatching(/^"sideways" is not a layout; /)] }
		});
		expect(await stored(pageId)).toEqual(before);
	});

	it('is refused for the donation box, which has one way to draw it', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, BLOCK_FORMS.variant, [
			['block_id', 'donate'],
			['variant', 'plain']
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { variant: ['the donation box has one way to draw it and takes no variant'] }
		});
	});
});

const BLANK: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

const FAQ: Page['blocks'] = [
	{
		id: 'faq',
		type: 'faq',
		variant: 'accordion',
		background: 'none',
		items: [{ question: 'Where do the coats go?', answer: BLANK }]
	}
];

const TIERS: Page['blocks'] = [
	{
		id: 'tiers',
		type: 'impact-tiers',
		variant: 'cards',
		background: 'none',
		tiers: [
			{ amountMinor: 5000, buys: 'a coat' },
			{ amountMinor: 10_000, buys: 'two coats' }
		]
	}
];

/** a campaign with `blocks` added after its title. */
function withBlocks(blocks: Page['blocks']): Page {
	const page = { ...defaultCampaign(), settings: SETTINGS };
	return { ...page, blocks: [...page.blocks.slice(0, 1), ...blocks, ...page.blocks.slice(1)] };
}

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
