import { editPageDraft } from './draft-writer';
import { readAmount } from '../../forms/amounts';
import { defineForm, type FormRejection } from '../../forms/definition';
import { photo as photoRule, SECTION_DATA, type Page } from '../../page/catalog';
import {
	BOXES,
	CONTENT_FAQ_INPUT,
	CONTENT_FORMS,
	CONTENT_PHOTO_INPUT,
	CONTENT_PHOTO_REMOVE_INPUT,
	CONTENT_STORY_INPUT,
	CONTENT_TIERS_INPUT,
	CONTENT_TITLE_INPUT,
	type ContentFormId,
	editorSections,
	editorShareMessage,
	newPhotoSection,
	PAGE_SHARE_MESSAGE_INPUT,
	parseSlot,
	rowBox,
	type Slot
} from '../../page/content-edit';
import { isEmptyDocument, parseRichText } from '../../rich-text/document';
import { invalid, parseForm, type RejectionReasons, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import type { Page as PageRow } from '../db/schema';
import { firstMissingImage } from '../images/queries';
import { readableDraft } from './document';
import { draftSettingsOf, type SettingsTarget } from './queries';

// the editor's hand edits to a page's content, the Donation page's and a campaign's alike: a
// section's words from its sheet's one Done, a photo placed or taken off, and the share message.
// every one is written to the draft alone, against the version the editor was drawn at, so nothing
// here reaches donors before Publish, and a press drawn before another save — another section's, a
// rename — is refused rather than putting back what that save moved.
//
// there is nothing here that lays a page out: no section is added, removed, moved or drawn another
// way, and the layout is $lib/page/shape.ts's to pick from what the content holds.
//
// the words are the catalog's to judge ($lib/page/catalog.ts): each section's `SECTION_DATA` rule
// runs over what its boxes posted so a refusal lands under the box that posted the value, and the
// page with the section replaced goes through `parsePage` before it is written. each form's id and
// rules are $lib/page/content-edit.ts's.
//
// a photo is placed by the id its upload was answered with, and one no stored image has when the
// press is read is refused, so the page names only a photo that was stored a moment ago. a photo the
// draft lets go of, replaced or taken off, is freed in the draft's own write, and kept while the
// live page, the page Undo would put back or anything else still places it (../images/free.ts).

const CONTENT_TITLE = defineForm({ id: CONTENT_FORMS.title, schema: CONTENT_TITLE_INPUT });
const CONTENT_STORY = defineForm({ id: CONTENT_FORMS.story, schema: CONTENT_STORY_INPUT });
const CONTENT_TIERS = defineForm({ id: CONTENT_FORMS.tiers, schema: CONTENT_TIERS_INPUT });
const CONTENT_FAQ = defineForm({ id: CONTENT_FORMS.faq, schema: CONTENT_FAQ_INPUT });
const CONTENT_PHOTO = defineForm({ id: CONTENT_FORMS.photo, schema: CONTENT_PHOTO_INPUT });
const CONTENT_PHOTO_REMOVE = defineForm({
	id: CONTENT_FORMS.photoRemove,
	schema: CONTENT_PHOTO_REMOVE_INPUT
});
const PAGE_SHARE_MESSAGE = defineForm({
	id: CONTENT_FORMS.shareMessage,
	schema: PAGE_SHARE_MESSAGE_INPUT
});

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

/** a section's values as its boxes posted them, and the box each part of them came from. */
type Words = {
	readonly words: Partial<Page>;
	/** the box a refusal at `path` inside the words goes under, or null for the sheet's own. */
	readonly boxOf: (path: readonly PropertyKey[]) => string | null;
};

type ReadWords = { ok: true; read: Words } | { ok: false; refusal: RejectionReasons };

/** the draft's sections and share message as the editor draws them; `currency` is the draft settings'. */
export function editorDraft(row: PageRow, currency: string) {
	const draft = readableDraft(row);
	return {
		sections: editorSections(draft, row.type, currency),
		newPhoto: row.type === 'campaign' ? newPhotoSection(draft) : null,
		shareMessage: editorShareMessage(draft)
	};
}

/** a press on a section's sheet or the share message, whichever form it posted. */
export async function saveContentForm(
	db: Db,
	target: SettingsTarget,
	form: ContentFormId,
	body: FormData,
	gone: string
) {
	const seen = submittedVersion(body);
	const write = (
		submission: Submission,
		change: (draft: Page, row: PageRow) => Promise<DraftEdit>
	) => answer(submission, gone, () => editDraft(db, target, seen, change));

	switch (form) {
		case CONTENT_FORMS.title: {
			const submission = parseForm(body, CONTENT_TITLE);
			if (!submission.ok) return invalid(400, submission.reject());
			const { heading, lede } = submission.value;
			return write(submission, async (draft, row) => {
				const words: Partial<Page> =
					row.type === 'campaign'
						? { heading, lede: lede.trim() === '' ? undefined : lede }
						: { heading };
				return replaced(draft, { words, boxOf: firstKey });
			});
		}
		case CONTENT_FORMS.story: {
			const submission = parseForm(body, CONTENT_STORY);
			if (!submission.ok) return invalid(400, submission.reject());
			return write(submission, async (draft) => {
				const doc = postedDocument(submission.value.body);
				if (!doc.ok)
					return { ok: false, refusal: { fieldErrors: { [BOXES.body]: [doc.refusal] } } };
				const written = parseRichText(doc.json);
				const story = written.ok && isEmptyDocument(written.doc) ? undefined : doc.json;
				return replaced(draft, {
					words: { story: story as Page['story'] },
					boxOf: () => BOXES.body
				});
			});
		}
		case CONTENT_FORMS.tiers: {
			const submission = parseForm(body, CONTENT_TIERS);
			if (!submission.ok) return invalid(400, submission.reject());
			const { tier_amount, tier_buys } = submission.value;
			return write(submission, async (draft, row) => {
				const read = await readTiers(db, row, tier_amount, tier_buys);
				return read.ok ? replaced(draft, read.read) : read;
			});
		}
		case CONTENT_FORMS.faq: {
			const submission = parseForm(body, CONTENT_FAQ);
			if (!submission.ok) return invalid(400, submission.reject());
			const { question, answer: answers } = submission.value;
			return write(submission, async (draft) => {
				const read = readQuestions(question, answers);
				return read.ok ? replaced(draft, read.read) : read;
			});
		}
		case CONTENT_FORMS.photo: {
			const submission = parseForm(body, CONTENT_PHOTO);
			if (!submission.ok) return invalid(400, submission.reject());
			const { slot: posted, image_id, alt } = submission.value;
			return write(submission, async (draft) => {
				const slot = slotOf(draft, posted);
				if (!slot.ok) return slot;
				const read = await readPhoto(db, image_id, alt);
				if (!read.ok) return read;
				return replaced(draft, placed(draft, slot.slot, read.photo));
			});
		}
		case CONTENT_FORMS.photoRemove: {
			const submission = parseForm(body, CONTENT_PHOTO_REMOVE);
			if (!submission.ok) return invalid(400, submission.reject());
			return write(submission, async (draft) => {
				const slot = slotOf(draft, submission.value.slot);
				if (!slot.ok) return slot;
				if (slot.slot.kind === 'new')
					return refusedWith('a photo not yet placed has nothing to take off');
				if (slot.slot.kind === 'cover') {
					return { ok: true, draft: { ...draft, hero: undefined } };
				}
				const { at } = slot.slot;
				const photos = (draft.photos ?? []).filter((_, each) => each !== at);
				return { ok: true, draft: { ...draft, photos: photos.length === 0 ? undefined : photos } };
			});
		}
		case CONTENT_FORMS.shareMessage: {
			const submission = parseForm(body, PAGE_SHARE_MESSAGE);
			if (!submission.ok) return invalid(400, submission.reject());
			const said = submission.value.share_message?.trim() ?? '';
			return write(submission, async (draft) => ({
				ok: true,
				draft: { ...draft, shareMessage: said === '' ? undefined : said }
			}));
		}
	}
}

/** the draft with `words` written over the sections they name, each checked by its own rule first. */
function replaced(draft: Page, { words, boxOf }: Words): DraftEdit {
	const fieldErrors: Record<string, string[]> = {};
	const formErrors: string[] = [];
	for (const [key, value] of Object.entries(words)) {
		const rule = SECTION_DATA[key as keyof typeof SECTION_DATA];
		if (rule === undefined || value === undefined) continue;
		const checked = rule.safeParse(value);
		if (checked.success) continue;
		for (const issue of checked.error.issues) {
			const box = boxOf([key, ...issue.path]);
			if (box === null) formErrors.push(issue.message);
			else (fieldErrors[box] ??= []).push(issue.message);
		}
	}
	if (Object.keys(fieldErrors).length > 0 || formErrors.length > 0) {
		return { ok: false, refusal: { fieldErrors, formErrors } };
	}
	return { ok: true, draft: { ...draft, ...words } };
}

/** the photos the draft holds with `photo` in `slot`: over the cover, over a photo, or after the rest. */
function placed(draft: Page, slot: Slot, photo: NonNullable<Page['hero']>): Words {
	const boxOf = (path: readonly PropertyKey[]) => (path.includes('alt') ? BOXES.alt : null);
	if (slot.kind === 'cover') return { words: { hero: photo }, boxOf };
	const photos = [...(draft.photos ?? [])];
	if (slot.kind === 'new') photos.push(photo);
	else photos[slot.at] = photo;
	return { words: { photos }, boxOf };
}

/** the slot a photo press names, which must be the cover, a photo the draft holds, or a new one. */
function slotOf(
	draft: Page,
	posted: string
): { ok: true; slot: Slot } | { ok: false; refusal: RejectionReasons } {
	const slot = parseSlot(posted);
	const held = draft.photos?.length ?? 0;
	if (slot === null || (slot.kind === 'photo' && slot.at >= held)) {
		return refusedWith(
			`\`slot\` names no photo on this page: ${JSON.stringify(posted)}; it takes "cover", "new" or the place of one of its ${held} photos`
		);
	}
	return { ok: true, slot };
}

type ReadPhoto =
	| { ok: true; photo: NonNullable<Page['hero']> }
	| { ok: false; refusal: RejectionReasons };

/** a placed photo, which must be stored; one off the photo rule is refused under its box or the sheet. */
async function readPhoto(db: Db, imageId: string, alt: string): Promise<ReadPhoto> {
	const described = alt.trim();
	const checked = photoRule.safeParse({ imageId, alt: described === '' ? null : described });
	if (!checked.success) {
		const fieldErrors: Record<string, string[]> = {};
		const formErrors: string[] = [];
		for (const issue of checked.error.issues) {
			if (issue.path[0] === 'alt') (fieldErrors[BOXES.alt] ??= []).push(issue.message);
			else formErrors.push(issue.message);
		}
		return { ok: false, refusal: { fieldErrors, formErrors } };
	}
	if ((await firstMissingImage(db, [imageId])) !== null) {
		return refusedWith(`no stored photo has the id "${imageId}"`);
	}
	return { ok: true, photo: checked.data };
}

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
			fieldErrors[rowBox(BOXES.answer, at)] = [answer.refusal];
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
		return rowBox(key === 'question' ? BOXES.question : BOXES.answer, at);
	};
	return {
		ok: true,
		read: { words: { faq: (items.length === 0 ? undefined : items) as Page['faq'] }, boxOf }
	};
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
		if (figure.problem !== null) fieldErrors[rowBox(BOXES.tierAmount, at)] = [figure.problem];
		kept.push(at);
		tiers.push({ amountMinor: figure.minor, buys: bought });
	}
	const boxOf = ([, index, key]: readonly PropertyKey[]) => {
		const at = typeof index === 'number' ? kept[index] : undefined;
		if (at === undefined) return null;
		return rowBox(key === 'buys' ? BOXES.tierBuys : BOXES.tierAmount, at);
	};
	const words = { tiers: (tiers.length === 0 ? undefined : tiers) as Page['tiers'] };
	if (Object.keys(fieldErrors).length === 0) return { ok: true, read: { words, boxOf } };
	// an amount that could not be read is said under its box, beside what the rule says of the rest.
	const rest = sectionRefusal('tiers', tiers, boxOf);
	for (const [box, sentences] of Object.entries(rest)) fieldErrors[box] ??= sentences;
	return { ok: false, refusal: { fieldErrors } };
}

/** what a section's rule says of `value`, by the box each sentence goes under. */
function sectionRefusal(
	key: keyof typeof SECTION_DATA,
	value: unknown,
	boxOf: Words['boxOf']
): Record<string, string[]> {
	const checked = SECTION_DATA[key].safeParse(value);
	const fieldErrors: Record<string, string[]> = {};
	if (checked.success) return fieldErrors;
	for (const issue of checked.error.issues) {
		const box = boxOf([key, ...issue.path]);
		if (box !== null) (fieldErrors[box] ??= []).push(issue.message);
	}
	return fieldErrors;
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

function refusedWith(sentence: string): { ok: false; refusal: RejectionReasons } {
	return { ok: false, refusal: { formErrors: [sentence] } };
}

const STALE =
	'Nothing was changed: this page has been saved since the editor was opened. Reload it, then make this change again.';
const FAILED = 'Saving this change failed and nothing was changed. Try again.';

/** what every content press answers once its write lands. */
const CONTENT_SAVED = { saved: 'content' } as const;

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
			return CONTENT_SAVED;
		case 'refused':
			return invalid(400, submission.reject(written.refusal));
		case 'stale':
			return invalid(409, submission.reject({ formErrors: [STALE] }));
		case 'gone':
			return invalid(404, submission.reject({ formErrors: [gone] }));
	}
}

/** the box a refusal by `parsePage` at `path` goes under. */
const PAGE_BOXES: Readonly<Record<string, string>> = {
	heading: BOXES.heading,
	lede: BOXES.lede,
	story: BOXES.body,
	shareMessage: BOXES.shareMessage
};

/**
 * the draft of the page `target` names, replaced by what `edit` makes of it while the page is still
 * the version it was drawn at. the write is guarded on that version and on the draft text the edit
 * read, so a save landing between the two writes nothing.
 */
async function editDraft(
	db: Db,
	target: SettingsTarget,
	version: Date,
	edit: (draft: Page, row: PageRow) => Promise<DraftEdit>
): Promise<DraftWrite> {
	const own: { refusal?: RejectionReasons } = {};
	const written = await editPageDraft(db, target, version, async (draft, row) => {
		const edited = await edit(draft, row);
		if (edited.ok) return edited;
		own.refusal = edited.refusal;
		return { ok: false, path: [], message: '' };
	});
	if (written.kind !== 'refused') return { kind: written.kind };
	if (own.refusal !== undefined) return { kind: 'refused', refusal: own.refusal };
	const [key] = written.path;
	const box = typeof key === 'string' ? PAGE_BOXES[key] : undefined;
	return {
		kind: 'refused',
		refusal:
			box === undefined
				? { formErrors: [written.message] }
				: { fieldErrors: { [box]: [written.message] } }
	};
}
