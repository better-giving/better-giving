import { isEmptyDocument, parseRichText, type RichTextDocument } from '$lib/rich-text/document';

// the organisation's story — its mission and its vision — as `org_presentation.story` holds it,
// and the one rule a story passes on the way in and again on the way out.
//
// each part is a rich-text document under `$lib/rich-text/document.ts`'s rule, or `null` where
// nothing is written: a document holding no words is stored as `null`, so every reader asks one
// question — `null` or not — rather than two. a blank vision is a story; a blank mission is refused
// at the save, because every page's About us reads it.
//
// a stored part is parsed again when it is read, since the rule may have narrowed since it was
// written. a part the rule now refuses reads as `null` rather than failing the read: the one screen
// that can repair it is the Organisation page, and it has to open for that.

export type Story = {
	readonly mission: RichTextDocument | null;
	readonly vision: RichTextDocument | null;
};

/** the boxes a story is posted in, each the document's JSON as the editor writes it. */
export type StoryValues = { readonly mission: string; readonly vision: string };

type Part = keyof Story;

/** what the story column holds for a deployment that has never saved one — the column default. */
export const NO_STORY = '{}';

/**
 * the story a screen posted, or the sentence each refused part is answered with.
 *
 * a refusal combines the rule's message with where in the document it landed, because the body
 * behind a 4xx here is read by an agent (CLAUDE.md) and a path is what it can act on.
 */
export function storyInput(
	values: StoryValues
): { ok: true; story: Story } | { ok: false; errors: Partial<Record<Part, string>> } {
	const mission = partInput(values.mission);
	const vision = partInput(values.vision);
	if (!mission.ok || mission.doc === null || !vision.ok) {
		const errors: Partial<Record<Part, string>> = {};
		if (!mission.ok) errors.mission = mission.refusal;
		else if (mission.doc === null) errors.mission = 'required';
		if (!vision.ok) errors.vision = vision.refusal;
		return { ok: false, errors };
	}
	return { ok: true, story: { mission: mission.doc, vision: vision.doc } };
}

/** one posted part: the document, `null` for one holding no words, or the refusal's sentence. */
function partInput(
	posted: string
): { ok: true; doc: RichTextDocument | null } | { ok: false; refusal: string } {
	let json: unknown;
	try {
		json = JSON.parse(posted);
	} catch {
		return {
			ok: false,
			refusal: 'is not a document: the box posts Tiptap JSON, and this is not JSON'
		};
	}
	const parsed = parseRichText(json);
	if (!parsed.ok) {
		const at = parsed.path.length === 0 ? '' : `, at \`${pathText(parsed.path)}\``;
		return { ok: false, refusal: `${parsed.message}${at}` };
	}
	return { ok: true, doc: isEmptyDocument(parsed.doc) ? null : parsed.doc };
}

/** `['content', 1, 'marks', 0]` as `content[1].marks[0]`. */
function pathText(path: readonly (string | number)[]): string {
	return path
		.map((key, at) => (typeof key === 'number' ? `[${key}]` : at === 0 ? key : `.${key}`))
		.join('');
}

/** the column's text for a story, which is what a save writes and what its digest is taken over. */
export function storedStory(story: Story): string {
	return JSON.stringify({ mission: story.mission, vision: story.vision });
}

/** the story a stored column holds, each part through the rule again. */
export function storyFromStored(stored: string): Story {
	let json: unknown;
	try {
		json = JSON.parse(stored);
	} catch {
		// `org_presentation_story_object_check` holds the column to a JSON object.
		throw new Error('`org_presentation.story` holds text that is not JSON');
	}
	const held = json as Partial<Record<Part, unknown>>;
	return {
		mission: storedPart(held.mission, 'mission'),
		vision: storedPart(held.vision, 'vision')
	};
}

function storedPart(held: unknown, part: Part): RichTextDocument | null {
	if (held === undefined || held === null) return null;
	const parsed = parseRichText(held);
	if (parsed.ok) return parsed.doc;
	console.error(`the stored ${part} is refused by the rich-text rule and reads as blank:`, parsed);
	return null;
}

/**
 * the version a story save is written against: SHA-256 over the column's text, lowercase hex.
 *
 * the column's own text rather than the row's `updated_at`, because a save of the look or the
 * sharing moves that too, and a story typed while either was saved is not stale for it.
 * `submittedDigest` in `$lib/server/conform.ts` reads it back off a body.
 */
export async function storyVersion(stored: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
