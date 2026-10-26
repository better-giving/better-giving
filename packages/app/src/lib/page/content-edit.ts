// what the editor edits a page's content through: the forms each section's sheet and the share
// message post, and the page's sections as those sheets are drawn from the draft. every value a page
// document holds but its donation settings and switches, goal, end date and name — which
// $lib/server/pages/editor.ts, page-settings.ts and the editor routes write — has a form here. each
// form's id and rules are here, where the sheets ($lib/admin/editor/section-edit.tsx) post them and
// the save ($lib/server/pages/content.ts) states and parses them, and both editors' actions name
// the ids.
//
// there is nothing to lay out: no section is added, removed, moved or drawn another way. a campaign
// holds every section whether or not it has content yet, and the page shows those that do in the
// layout ./shape.ts picks. the Donation page holds its title alone, beside the share message.
//
// the boxes carry text and a photo's id, already uploaded, and every value is the catalog's to judge
// (./catalog.ts): the save makes the change to the draft and runs the page through `parsePage`.
//
// pure and not under `$lib/server/**`: a component draws what `editorSections` returns.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { groupedEntry } from '../forms/amounts';
import { plainText, type RichTextDocument } from '../rich-text/document';
import type { Page } from './catalog';
import type { PageType } from './keys';

export const CONTENT_FORMS = {
	title: 'content-title',
	story: 'content-story',
	tiers: 'content-tiers',
	faq: 'content-faq',
	photo: 'content-photo',
	photoRemove: 'content-photo-remove',
	shareMessage: 'page-share-message'
} as const;

export type ContentFormId = (typeof CONTENT_FORMS)[keyof typeof CONTENT_FORMS];

/** every form above, for an editor's `submittedForm`. */
export const CONTENT_FORM_IDS = Object.values(CONTENT_FORMS) as ContentFormId[];

/**
 * the name each form below posts a box under, and the key its schema reads it by: the sheets that
 * post the boxes and the save that parses them both spell a box from here, so a box renamed here is
 * renamed on both sides. a row's box adds its place — `tier_amount[1]` (`rowBox`).
 */
export const BOXES = {
	heading: 'heading',
	lede: 'lede',
	body: 'body',
	tierAmount: 'tier_amount',
	tierBuys: 'tier_buys',
	question: 'question',
	answer: 'answer',
	slot: 'slot',
	imageId: 'image_id',
	alt: 'alt',
	shareMessage: 'share_message'
} as const;

/** a row's box by its place, as a list of rows posts it — `tier_amount[1]`. */
export const rowBox = (box: string, at: number) => `${box}[${at}]`;

/** a blank heading draws the page's own name, and a blank lede is none. */
export const CONTENT_TITLE_INPUT = z.object({
	[BOXES.heading]: z.string().default(''),
	[BOXES.lede]: z.string().default('')
});

/** the story, the document's JSON as the rich-text box posts it. */
export const CONTENT_STORY_INPUT = z.object({ [BOXES.body]: z.string('required') });

/**
 * the tiers as rows of two boxes, `tier_amount[i]` in major units of the page's currency beside
 * `tier_buys[i]`: two lists, since a form's fields are flat ($lib/server/conform.ts).
 */
export const CONTENT_TIERS_INPUT = z.object({
	[BOXES.tierAmount]: z.array(z.string().default('')),
	[BOXES.tierBuys]: z.array(z.string().default(''))
});

/** the questions as rows, `question[i]` beside `answer[i]`, the answer's document as JSON. */
export const CONTENT_FAQ_INPUT = z.object({
	[BOXES.question]: z.array(z.string().default('')),
	[BOXES.answer]: z.array(z.string().default(''))
});

/**
 * where a photo goes: the cover, the place of a photo beside it, or a new one after the rest.
 * `parseSlot` reads it.
 */
export const SLOTS = { cover: 'cover', added: 'new' } as const;

/**
 * a photo, by the id the images route (src/routes/_app.admin.images.ts) answered its upload with,
 * into `slot`, and what describes it; a blank description is a decorative photo.
 */
export const CONTENT_PHOTO_INPUT = z.object({
	[BOXES.slot]: z.string('required'),
	[BOXES.imageId]: z.string('required'),
	[BOXES.alt]: z.string().default('')
});

/** the photo in `slot` taken off the page: the cover falls back to the logo where there is one, and a photo goes. */
export const CONTENT_PHOTO_REMOVE_INPUT = z.object({ [BOXES.slot]: z.string('required') });

/** what a share says beside the page's address; a blank box removes it, and the title is said. */
export const PAGE_SHARE_MESSAGE_INPUT = z.object({ [BOXES.shareMessage]: z.string().optional() });

/** a photo's slot as posted: the cover, the place of a photo beside it, a new one, or none. */
export type Slot = { kind: 'cover' } | { kind: 'photo'; at: number } | { kind: 'new' };

export function parseSlot(posted: string): Slot | null {
	if (posted === SLOTS.cover) return { kind: 'cover' };
	if (posted === SLOTS.added) return { kind: 'new' };
	return /^(0|[1-9][0-9]?)$/.test(posted) ? { kind: 'photo', at: Number(posted) } : null;
}

/** a section by the id the preview reports and the sheet is keyed on. */
export type SectionId = 'title' | 'story' | 'cover' | `photo-${number}` | 'tiers' | 'faq';

/** a section's words as its sheet's boxes are seeded with them. */
export type SectionText =
	| { readonly kind: 'title'; readonly heading: string; readonly lede: string | null }
	| { readonly kind: 'story'; readonly body: RichTextDocument }
	| {
			readonly kind: 'tiers';
			/** the three-letter code the amounts are in. */
			readonly currency: string;
			/** each amount as its box is seeded: major units, grouped as the box draws it. */
			readonly tiers: readonly { readonly amount: string; readonly buys: string }[];
	  }
	| {
			readonly kind: 'faq';
			readonly items: readonly { readonly question: string; readonly answer: RichTextDocument }[];
	  }
	| {
			readonly kind: 'photo';
			/** the slot the sheet posts: `cover`, a photo's place, or `new`. */
			readonly slot: string;
			/** null until a photo is placed. */
			readonly imageId: string | null;
			readonly alt: string;
			/** a placed photo may be taken off the page. */
			readonly removable: boolean;
	  };

/** one section of the draft, as Settings lists it and its sheet draws it. */
export type EditorSection = {
	readonly id: SectionId;
	/** the section's name — Title, Story, Cover photo — its row's label and its sheet's title. */
	readonly label: string;
	/** a line of what it holds, or what stands in where it holds nothing. */
	readonly summary: string;
	/** it holds nothing yet, and the page leaves it out. */
	readonly empty: boolean;
	readonly text: SectionText;
};

const BLANK_STORY: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

/** the draft's sections in the order Settings lists them; `currency` is the draft settings'. */
export function editorSections(draft: Page, type: PageType, currency: string): EditorSection[] {
	const title: EditorSection = {
		id: 'title',
		label: 'Title',
		summary: draft.heading === '' ? 'The page’s name' : clipped(draft.heading),
		empty: false,
		text: {
			kind: 'title',
			heading: draft.heading,
			lede: type === 'campaign' ? (draft.lede ?? '') : null
		}
	};
	if (type !== 'campaign') return [title];
	const story = draft.story ?? BLANK_STORY;
	const storyWords = plainText(story);
	const tiers = draft.tiers ?? [];
	const faq = draft.faq ?? [];
	const photos = draft.photos ?? [];
	return [
		title,
		{
			id: 'story',
			label: 'Story',
			summary: storyWords === '' ? 'No story yet' : clipped(storyWords),
			empty: storyWords === '',
			text: { kind: 'story', body: story }
		},
		{
			id: 'cover',
			label: 'Cover photo',
			summary: draft.hero === undefined ? 'No photo yet' : clipped(draft.hero.alt ?? 'A photo'),
			empty: draft.hero === undefined,
			text: {
				kind: 'photo',
				slot: SLOTS.cover,
				imageId: draft.hero?.imageId ?? null,
				alt: draft.hero?.alt ?? '',
				removable: draft.hero !== undefined
			}
		},
		...photos.map(
			(photo, at): EditorSection => ({
				id: `photo-${at}`,
				label: `Photo ${at + 1}`,
				summary: clipped(photo.alt ?? 'A photo'),
				empty: false,
				text: {
					kind: 'photo',
					slot: String(at),
					imageId: photo.imageId,
					alt: photo.alt ?? '',
					removable: true
				}
			})
		),
		{
			id: 'tiers',
			label: 'Impact tiers',
			summary:
				tiers.length === 0
					? 'None yet'
					: tiers.map((tier) => formatMinorBrief(tier.amountMinor, currency)).join(', '),
			empty: tiers.length === 0,
			text: {
				kind: 'tiers',
				currency,
				tiers: tiers.map((tier) => ({
					amount: groupedEntry(tier.amountMinor, currency),
					buys: tier.buys
				}))
			}
		},
		{
			id: 'faq',
			label: 'Questions',
			summary: faq.length === 0 ? 'None yet' : clipped(faq.map((item) => item.question).join(', ')),
			empty: faq.length === 0,
			text: { kind: 'faq', items: faq }
		}
	];
}

/** the sheet Add a photo opens: a photo with none placed yet, posted after the rest. */
export function newPhotoSection(draft: Page): EditorSection {
	const at = draft.photos?.length ?? 0;
	return {
		id: `photo-${at}`,
		label: 'Add a photo',
		summary: '',
		empty: true,
		text: { kind: 'photo', slot: SLOTS.added, imageId: null, alt: '', removable: false }
	};
}

/** the share message as the draft holds it: `''` where the page has none, and a share says the title. */
export function editorShareMessage(draft: Page): string {
	return draft.shareMessage ?? '';
}

/** the first words a summary shows; the row cuts what it cannot fit. */
const SUMMARY_MAX = 80;

function clipped(words: string): string {
	const line = words.replace(/\s+/g, ' ').trim();
	return line.length <= SUMMARY_MAX ? line : `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}
