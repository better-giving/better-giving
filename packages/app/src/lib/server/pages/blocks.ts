import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { readAmount } from '../../forms/amounts';
import { defineForm, type FormRejection } from '../../forms/definition';
import {
	BLOCK_FAQ_INPUT,
	BLOCK_FORMS,
	BLOCK_IMPACT_TIERS_INPUT,
	BLOCK_PHOTO_INPUT,
	BLOCK_STORY_INPUT,
	BLOCK_TITLE_INPUT,
	BLOCK_VARIANT_INPUT,
	type BlockFormId,
	editorBlocks,
	layoutPictures,
	PAGE_LAYOUT_INPUT
} from '../../page/block-edit';
import { BLOCK_DATA, type Block, type BlockType, type Page, parsePage } from '../../page/catalog';
import { isEmptyDocument, parseRichText } from '../../rich-text/document';
import { invalid, parseForm, type RejectionReasons, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import { type Page as PageRow, page } from '../db/schema';
import { firstMissingImage } from '../images/queries';
import { draftSettingsOf, type SettingsTarget } from './queries';

// the editor's hand edits to a page's draft, the Donation page's and a campaign's alike: a block's
// words from its sheet's one Done, and a variant or the layout from its picture. every one is
// written to the draft alone, against the version the editor was drawn at, so nothing here reaches
// donors before Publish and a press drawn before another save — a chat turn's, a rename — is
// refused rather than putting back what that save moved.
//
// the words are the block catalog's to judge ($lib/page/catalog.ts): each block's `BLOCK_DATA` rule
// runs over what its boxes posted so a refusal lands under the box that posted the value, and the
// page with the block's data replaced goes through `parsePage` before it is written, the rule a
// chat turn's draft goes through too. a hand edit replaces only the block it names, so a later chat
// turn is shown the draft with it and keeps what it was not asked to change (./draft.ts).
//
// each form's id and rules are $lib/page/block-edit.ts's. which block a body names is
// `block_id`, and one naming a block the page does not hold, or a block of another type, is
// refused naming it.
//
// a photo is replaced by the id its upload was answered with, and one no stored image has is
// refused, so a block never points at a photo the image route would not serve. the replace keeps
// the block, its id and its variant; the photo it stood in for stays stored, since a published
// page may still draw it.

const BLOCK_TITLE = defineForm({ id: BLOCK_FORMS.title, schema: BLOCK_TITLE_INPUT });
const BLOCK_STORY = defineForm({ id: BLOCK_FORMS.story, schema: BLOCK_STORY_INPUT });
const BLOCK_IMPACT_TIERS = defineForm({
	id: BLOCK_FORMS.impactTiers,
	schema: BLOCK_IMPACT_TIERS_INPUT
});
const BLOCK_FAQ = defineForm({ id: BLOCK_FORMS.faq, schema: BLOCK_FAQ_INPUT });
const BLOCK_PHOTO = defineForm({ id: BLOCK_FORMS.photo, schema: BLOCK_PHOTO_INPUT });
const BLOCK_VARIANT = defineForm({ id: BLOCK_FORMS.variant, schema: BLOCK_VARIANT_INPUT });
const PAGE_LAYOUT = defineForm({ id: BLOCK_FORMS.layout, schema: PAGE_LAYOUT_INPUT });

/**
 * what an edit makes of the draft, or the refusal it is answered with. the draft is untyped until
 * `parsePage` has read it, which every edit goes through before it is written.
 */
type DraftEdit = { ok: true; draft: unknown } | { ok: false; refusal: RejectionReasons };

type DraftWrite =
	| { kind: 'written' }
	| { kind: 'stale' }
	| { kind: 'gone' }
	| { kind: 'refused'; refusal: RejectionReasons };

/** a block's words as its boxes posted them, and the box each part of them came from. */
type Words = {
	readonly words: Record<string, unknown>;
	/** the box a refusal at `path` inside the words goes under, or null for the sheet's own. */
	readonly boxOf: (path: readonly PropertyKey[]) => string | null;
};

type ReadWords = { ok: true; read: Words } | { ok: false; refusal: RejectionReasons };

/** the draft's blocks and layout as the editor draws them; `currency` is the draft settings'. */
export function editorDraft(row: PageRow, currency: string) {
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(`page ${row.id}'s stored draft fails its rule: ${draft.message}`);
	return {
		blocks: editorBlocks(draft.page, currency),
		layout: draft.page.layout,
		layouts: layoutPictures()
	};
}

/** a press on a block's sheet, whichever form it posted; `form` is what `submittedForm` read. */
export async function saveBlockForm(
	db: Db,
	target: SettingsTarget,
	form: BlockFormId,
	body: FormData,
	gone: string
) {
	switch (form) {
		case BLOCK_FORMS.title: {
			const submission = parseForm(body, BLOCK_TITLE);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id, heading, lede } = submission.value;
			return saveWords(db, target, body, gone, submission, block_id, ['title'], async () => ({
				ok: true,
				read: { words: { heading, ...(lede === '' ? {} : { lede }) }, boxOf: firstKey }
			}));
		}
		case BLOCK_FORMS.story: {
			const submission = parseForm(body, BLOCK_STORY);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id } = submission.value;
			return saveWords(db, target, body, gone, submission, block_id, ['story'], async () => {
				const doc = postedDocument(submission.value.body);
				if (!doc.ok) return { ok: false, refusal: { fieldErrors: { body: [doc.refusal] } } };
				return { ok: true, read: { words: { body: doc.json }, boxOf: () => 'body' } };
			});
		}
		case BLOCK_FORMS.impactTiers: {
			const submission = parseForm(body, BLOCK_IMPACT_TIERS);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id, tier_amount, tier_buys } = submission.value;
			return saveWords(db, target, body, gone, submission, block_id, ['impact-tiers'], (row) =>
				readTiers(db, row, tier_amount, tier_buys)
			);
		}
		case BLOCK_FORMS.faq: {
			const submission = parseForm(body, BLOCK_FAQ);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id, question, answer } = submission.value;
			return saveWords(db, target, body, gone, submission, block_id, ['faq'], async () =>
				readQuestions(question, answer)
			);
		}
		case BLOCK_FORMS.photo: {
			const submission = parseForm(body, BLOCK_PHOTO);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id, image_id, alt } = submission.value;
			return saveWords(db, target, body, gone, submission, block_id, PHOTO_BLOCKS, () =>
				readPhoto(db, image_id, alt)
			);
		}
		case BLOCK_FORMS.variant: {
			const submission = parseForm(body, BLOCK_VARIANT);
			if (!submission.ok) return invalid(400, submission.reject());
			const { block_id, variant } = submission.value;
			const seen = submittedVersion(body);
			return answer(submission, gone, () =>
				editDraft(db, target, seen, pickedUnder('variant'), async (draft) => {
					const found = draft.blocks.find((block) => block.id === block_id);
					if (found === undefined) return noSuchBlock(draft, block_id);
					if (found.type === 'donation-box') {
						return { ok: false, refusal: { fieldErrors: { variant: [ONE_WAY] } } };
					}
					const blocks = draft.blocks.map((block) =>
						block === found ? { ...block, variant } : block
					);
					return { ok: true, draft: { ...draft, blocks } };
				})
			);
		}
		case BLOCK_FORMS.layout: {
			const submission = parseForm(body, PAGE_LAYOUT);
			if (!submission.ok) return invalid(400, submission.reject());
			const { layout } = submission.value;
			const seen = submittedVersion(body);
			return answer(submission, gone, () =>
				editDraft(db, target, seen, pickedUnder('layout'), async (draft) => ({
					ok: true,
					draft: { ...draft, layout }
				}))
			);
		}
	}
}

const ONE_WAY = 'the donation box has one way to draw it and takes no variant';

const PHOTO_BLOCKS = ['hero', 'image'] as const;

/** a replaced photo, which must be stored; an id of the wrong shape is left to the catalog's rule. */
async function readPhoto(db: Db, imageId: string, alt: string): Promise<ReadWords> {
	const described = alt.trim();
	const read = {
		words: { imageId, alt: described === '' ? null : described },
		// the id is the upload's, posted from no box the operator types in
		boxOf: ([key]: readonly PropertyKey[]) => (key === 'alt' ? 'alt' : null)
	};
	if (!BLOCK_DATA.hero.imageId.safeParse(imageId).success) return { ok: true, read };
	if ((await firstMissingImage(db, [imageId])) !== null) {
		return refusedWith(`no stored photo has the id "${imageId}"`);
	}
	return { ok: true, read };
}

/**
 * a picture's name refused by `parsePage` goes under the pictures' own name, `box`: the page's
 * `layout`, or a block's `variant`.
 */
function pickedUnder(box: 'layout' | 'variant') {
	return (path: readonly (string | number)[]) => (path.at(-1) === box ? box : null);
}

/**
 * `parsePage` opens a refusal inside a block by naming the block — `block 3 (id "story"): ` — which
 * a sentence under the block's own sheet does not need. the name is the rest, and says the value.
 */
const BLOCK_NAMED = /^block \d+(?: \(id "[^"]*"\))?: /;

/**
 * the questions as their rows posted them. a row with no question and no words in its answer is
 * left out; one with either is refused under the box the catalog's rule names.
 */
function readQuestions(questions: readonly string[], answers: readonly string[]): ReadWords {
	const kept: number[] = [];
	const items: { question: string; answer: unknown }[] = [];
	const fieldErrors: Record<string, string[]> = {};
	for (let at = 0; at < Math.max(questions.length, answers.length); at += 1) {
		const question = (questions[at] ?? '').trim();
		const answer = postedDocument(answers[at] ?? '');
		if (!answer.ok) {
			fieldErrors[`answer[${at}]`] = [answer.refusal];
			continue;
		}
		const written = parseRichText(answer.json);
		if (question === '' && written.ok && isEmptyDocument(written.doc)) continue;
		kept.push(at);
		items.push({ question, answer: answer.json });
	}
	if (Object.keys(fieldErrors).length > 0) return { ok: false, refusal: { fieldErrors } };
	const boxOf = ([, index, key]: readonly PropertyKey[]) => {
		const at = typeof index === 'number' ? kept[index] : undefined;
		if (at === undefined) return null;
		return key === 'question' ? `question[${at}]` : `answer[${at}]`;
	};
	return { ok: true, read: { words: { items }, boxOf } };
}

/**
 * the tiers as their rows posted them, each amount read in the page's currency. a row emptied of
 * both boxes is left out; one with a box left is refused under that box by the catalog's rule.
 */
async function readTiers(
	db: Db,
	row: PageRow,
	amounts: readonly string[],
	buys: readonly string[]
): Promise<ReadWords> {
	const { currency } = await draftSettingsOf(db, row);
	const kept: number[] = [];
	const tiers: { amountMinor: number | null; buys: string }[] = [];
	const fieldErrors: Record<string, string[]> = {};
	for (let at = 0; at < Math.max(amounts.length, buys.length); at += 1) {
		const amount = (amounts[at] ?? '').trim();
		const bought = (buys[at] ?? '').trim();
		if (amount === '' && bought === '') continue;
		const figure = readAmount(amount, currency);
		if (figure.problem !== null) fieldErrors[`tier_amount[${at}]`] = [figure.problem];
		kept.push(at);
		tiers.push({ amountMinor: figure.minor, buys: bought });
	}
	const boxOf = ([, index, key]: readonly PropertyKey[]) => {
		const at = typeof index === 'number' ? kept[index] : undefined;
		if (at === undefined) return null;
		return key === 'buys' ? `tier_buys[${at}]` : `tier_amount[${at}]`;
	};
	const read = { words: { tiers }, boxOf };
	if (Object.keys(fieldErrors).length === 0) return { ok: true, read };
	// an amount that could not be read is said under its box, beside what the rule says of the rest.
	const rest = dataRefusal('impact-tiers', read)?.fieldErrors ?? {};
	for (const [box, sentences] of Object.entries(rest)) fieldErrors[box] ??= sentences;
	return { ok: false, refusal: { fieldErrors } };
}

/** a refusal at `heading` goes under `heading`. */
function firstKey([key]: readonly PropertyKey[]): string | null {
	return typeof key === 'string' ? key : null;
}

/** a rich-text box's post: the editor's document as JSON, for the catalog's rule to read. */
function postedDocument(
	posted: string
): { ok: true; json: unknown } | { ok: false; refusal: string } {
	try {
		return { ok: true, json: JSON.parse(posted) };
	} catch {
		return {
			ok: false,
			refusal: 'is not a document: the box posts Tiptap JSON, and this is not JSON'
		};
	}
}

type Submission = { readonly reject: (reasons?: RejectionReasons) => FormRejection };

/** one block's words written over its data in the draft, and the press answered from the write. */
function saveWords(
	db: Db,
	target: SettingsTarget,
	body: FormData,
	gone: string,
	submission: Submission,
	blockId: string,
	types: readonly BlockType[],
	read: (row: PageRow) => Promise<ReadWords>
) {
	const seen = submittedVersion(body);
	return answer(submission, gone, () =>
		editDraft(db, target, seen, noBox, async (draft, row) => {
			const found = blockOf(draft, blockId, types);
			if (!found.ok) return found;
			const { type } = found.block;
			const posted = await read(row);
			if (!posted.ok) return posted;
			const refused = dataRefusal(type, posted.read);
			if (refused !== null) return { ok: false, refusal: refused };
			const frame = Object.entries(found.block).filter(([key]) => !(key in BLOCK_DATA[type]));
			const edited = { ...Object.fromEntries(frame), ...posted.read.words };
			return {
				ok: true,
				draft: {
					...draft,
					blocks: draft.blocks.map((block) => (block === found.block ? edited : block))
				}
			};
		})
	);
}

/** a block's words are checked box by box before the page is, so what the page's rule refuses is no box's. */
function noBox(): null {
	return null;
}

/** block `id` of the draft, which must be one of `types`, or the refusal naming what it is instead. */
function blockOf(
	draft: Page,
	id: string,
	types: readonly BlockType[]
): { ok: true; block: Block } | { ok: false; refusal: RejectionReasons } {
	const found = draft.blocks.find((block) => block.id === id);
	if (found === undefined) return noSuchBlock(draft, id);
	if (!types.includes(found.type)) {
		const edits = types.map((type) => `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`).join(' or ');
		return refusedWith(`block "${id}" is a ${found.type}, and this sheet edits ${edits}`);
	}
	return { ok: true, block: found };
}

function noSuchBlock(draft: Page, id: string): { ok: false; refusal: RejectionReasons } {
	const ids = draft.blocks.map((block) => `"${block.id}"`).join(', ');
	return refusedWith(`\`block_id\` names no block on this page: "${id}"; its blocks are ${ids}`);
}

function refusedWith(sentence: string): { ok: false; refusal: RejectionReasons } {
	return { ok: false, refusal: { formErrors: [sentence] } };
}

/**
 * the catalog's rule for one block's words, each refusal under the box it came from, or over the
 * whole sheet where no box posted it.
 */
function dataRefusal(type: BlockType, { words, boxOf }: Words): RejectionReasons | null {
	const checked = z.strictObject(BLOCK_DATA[type]).safeParse(words);
	if (checked.success) return null;
	const fieldErrors: Record<string, string[]> = {};
	const formErrors: string[] = [];
	for (const issue of checked.error.issues) {
		const box = boxOf(issue.path);
		if (box === null) formErrors.push(issue.message);
		else (fieldErrors[box] ??= []).push(issue.message);
	}
	return { fieldErrors, formErrors };
}

const STALE =
	'Nothing was changed: this page has been saved since the editor was opened. Reload it, then make this change again.';
const FAILED = 'Saving this change failed and nothing was changed. Try again.';

/** a press's answer from what its write did. */
async function answer(submission: Submission, gone: string, write: () => Promise<DraftWrite>) {
	let written: DraftWrite;
	try {
		written = await write();
	} catch (e) {
		console.error('saving a hand edit to a page draft failed:', e);
		return invalid(500, submission.reject({ formErrors: [FAILED] }));
	}
	switch (written.kind) {
		case 'written':
			return { saved: 'block' as const };
		case 'refused':
			return invalid(400, submission.reject(written.refusal));
		case 'stale':
			return invalid(409, submission.reject({ formErrors: [STALE] }));
		case 'gone':
			return invalid(404, submission.reject({ formErrors: [gone] }));
	}
}

/**
 * the draft of the page `target` names, replaced by what `edit` makes of it while the page is still
 * the version it was drawn at. the write is guarded on that version and on the draft text the edit
 * read, so a save landing between the two writes nothing.
 */
async function editDraft(
	db: Db,
	target: SettingsTarget,
	version: Date,
	boxOf: (path: readonly (string | number)[]) => string | null,
	edit: (draft: Page, row: PageRow) => Promise<DraftEdit>
): Promise<DraftWrite> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			target.type === 'campaign'
				? and(eq(page.id, target.id), eq(page.type, 'campaign'))
				: eq(page.type, 'donation_page')
		);
	if (!row) return { kind: 'gone' };
	if (row.updatedAt.getTime() !== version.getTime()) return { kind: 'stale' };
	const current = parsePage(row.type, JSON.parse(row.draft));
	if (!current.ok) {
		throw new Error(`page ${row.id}'s stored draft fails its rule: ${current.message}`);
	}
	const edited = await edit(current.page, row);
	if (!edited.ok) return { kind: 'refused', refusal: edited.refusal };
	const checked = parsePage(row.type, edited.draft);
	if (!checked.ok) {
		const box = boxOf(checked.path);
		return {
			kind: 'refused',
			refusal:
				box === null
					? { formErrors: [checked.message] }
					: { fieldErrors: { [box]: [checked.message.replace(BLOCK_NAMED, '')] } }
		};
	}
	const written = await db
		.update(page)
		.set({ draft: JSON.stringify(checked.page) })
		.where(and(eq(page.id, row.id), eq(page.updatedAt, version), eq(page.draft, row.draft)))
		.returning({ id: page.id });
	return written.length === 1 ? { kind: 'written' } : { kind: 'stale' };
}
