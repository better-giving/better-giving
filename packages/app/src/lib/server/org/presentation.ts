import { z } from 'zod';
import { SHARE_MESSAGE_MAX } from '$lib/page/catalog';
import { CORNERS, type Corner, SHADES, type Shade } from '$lib/page/keys';
import { SHARE_CHANNELS, type ShareChannel, SOCIAL_LINKS_MAX } from '$lib/page/share';
import { isEmptyDocument, parseRichText, type RichTextDocument } from '$lib/rich-text/document';

// the organisation's story, its look and its sharing as `org_presentation` holds them, the one rule
// each passes on the way in, and the version a save of each is written against.
//
// the story — its mission and its vision:
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

// ---------------------------------------------------------------------------
// the look — a shade and a corner from their closed sets, and a brand colour or none.
//
// a look is saved whole, every key stated, so what a page reads is what the operator saw picked.
// `{}`, the column default, and any key missing from an older row read as `DEFAULT_LOOK`'s, which
// is the donation form's own look: light, soft, and its grey where no brand colour is set.
// `org_presentation_look_check` holds the stored keys to the same sets and the colour to a
// lowercase `#rrggbb` or null, so a stored look is not parsed again on the way out.
// ---------------------------------------------------------------------------

export type OrgLook = {
	readonly shade: Shade;
	readonly corner: Corner;
	/** lowercase `#rrggbb`, or `null` for the form's own grey. */
	readonly brandColour: string | null;
};

/** the boxes a look is posted in; a blank brand colour is none, and arrives as `undefined`. */
type LookValues = {
	readonly shade?: string | undefined;
	readonly corner?: string | undefined;
	readonly brandColour?: string | undefined;
};

/** what the look column holds for a deployment that has never saved one — the column default. */
export const NO_LOOK = '{}';

const DEFAULT_LOOK: OrgLook = { shade: 'light', corner: 'soft', brandColour: null };

const BRAND_COLOUR = /^#[0-9a-f]{6}$/;

/**
 * the look a screen posted, or the sentence each refused box is answered with, naming what it
 * held and what it may hold — the body behind the 400 is read by an agent (CLAUDE.md).
 */
export function lookInput(
	values: LookValues
): { ok: true; look: OrgLook } | { ok: false; errors: Partial<Record<keyof OrgLook, string>> } {
	const { shade, corner, brandColour } = values;
	const colourIsOne = brandColour === undefined || BRAND_COLOUR.test(brandColour);
	if (isOneOf(SHADES, shade) && isOneOf(CORNERS, corner) && colourIsOne) {
		return { ok: true, look: { shade, corner, brandColour: brandColour ?? null } };
	}
	const errors: Partial<Record<keyof OrgLook, string>> = {};
	if (!isOneOf(SHADES, shade)) {
		errors.shade = `${shown(shade)} is not a shade; a shade is ${listed(SHADES)}`;
	}
	if (!isOneOf(CORNERS, corner)) {
		errors.corner = `${shown(corner)} is not a corner; a corner is ${listed(CORNERS)}`;
	}
	if (!colourIsOne) {
		errors.brandColour = `${shown(brandColour)} is not a brand colour; a brand colour is a lowercase #rrggbb, or blank for none`;
	}
	return { ok: false, errors };
}

function isOneOf<const T extends readonly string[]>(names: T, value: unknown): value is T[number] {
	return typeof value === 'string' && names.includes(value);
}

function listed(names: readonly string[]): string {
	return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function shown(value: string | undefined): string {
	return value === undefined ? 'nothing' : JSON.stringify(value);
}

/** the column's text for a look, which is what a save writes and what its digest is taken over. */
export function storedLook(look: OrgLook): string {
	return JSON.stringify({
		shade: look.shade,
		corner: look.corner,
		brandColour: look.brandColour
	});
}

/** the look a stored column holds, a key it lacks read as the default's. */
export function lookFromStored(stored: string): OrgLook {
	let json: unknown;
	try {
		json = JSON.parse(stored);
	} catch {
		// `org_presentation_look_check` holds the column to a JSON object.
		throw new Error('`org_presentation.look` holds text that is not JSON');
	}
	const held = json as { shade?: Shade; corner?: Corner; brandColour?: string | null };
	return {
		shade: held.shade ?? DEFAULT_LOOK.shade,
		corner: held.corner ?? DEFAULT_LOOK.corner,
		brandColour: held.brandColour ?? DEFAULT_LOOK.brandColour
	};
}

/**
 * the version a save of one part is written against: SHA-256 over that part's column text,
 * lowercase hex.
 *
 * the column's own text rather than the row's `updated_at`, because a save of any other part
 * moves that too, and a story typed while the look was saved is not stale for it, nor the other
 * way about. `submittedDigest` in `$lib/server/conform.ts` reads it back off a body.
 */
export async function partVersion(stored: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// the sharing — the share channels a page offers and their order, the organisation's default
// share message, and its social links.
//
// one rule both ways: the pieces below refuse a save and filter a read alike.
//
// read key by key, each through its own rule: a key absent, and `{}` (the column default), reads
// as `null` or none, and the page falls back to its own defaults. a key the rule refuses is logged
// and read the same way, so a row an older rule wrote cannot take a donor page down. the column is
// only held to a JSON object (`org_presentation_sharing_object_check`), so this is the whole rule
// on the way out. a social link is typed by a person and drawn as an `href`, so an address that is
// not http(s) is dropped rather than drawn.
//
// a save states every key: the chosen channels in order, `[]` being a page with no share buttons;
// the message, or `null` for none; and the links, a row left wholly blank being no link.
// ---------------------------------------------------------------------------

/** what the sharing column holds for a deployment that has never saved one — the column default. */
export const NO_SHARING = '{}';

export type OrgSharing = {
	/** the channels in the organisation's order, or `null` where none are chosen. */
	readonly channels: readonly ShareChannel[] | null;
	/** the default share message, or `null` where none is written. */
	readonly message: string | null;
	readonly links: readonly { readonly label: string; readonly href: string }[];
};

const sharingChannels = z
	.array(z.enum(SHARE_CHANNELS))
	.refine((channels) => new Set(channels).size === channels.length);
const sharingMessage = z.string().trim().min(1).max(SHARE_MESSAGE_MAX);
const sharingLink = z.object({
	label: z.string().trim().min(1),
	href: z.url({ protocol: /^https?$/ })
});

/** the sharing a stored column holds, a key it lacks or the rule refuses read as none. */
export function sharingFromStored(stored: string): OrgSharing {
	let json: unknown;
	try {
		json = JSON.parse(stored);
	} catch {
		throw new Error('`org_presentation.sharing` holds text that is not JSON');
	}
	const held = json as { channels?: unknown; message?: unknown; links?: unknown };
	const links = Array.isArray(held.links) ? held.links : [];
	return {
		channels: storedSharingPart(held.channels, sharingChannels, 'channels'),
		message: storedSharingPart(held.message, sharingMessage, 'message'),
		links: links
			.flatMap((link) => storedSharingPart(link, sharingLink, 'social link') ?? [])
			.slice(0, SOCIAL_LINKS_MAX)
	};
}

function storedSharingPart<T>(held: unknown, rule: z.ZodType<T>, part: string): T | null {
	if (held === undefined || held === null) return null;
	const parsed = rule.safeParse(held);
	if (parsed.success) return parsed.data;
	console.error(`the stored sharing ${part} is refused and reads as none:`, parsed.error.issues);
	return null;
}

/**
 * the boxes a sharing save posts: the ticked channels in the order they are drawn, the message, and
 * each link as a row of two boxes, one list per box. a blank box arrives as `undefined`.
 */
export type SharingValues = {
	readonly channels: readonly string[];
	readonly message?: string | undefined;
	readonly linkLabel: readonly (string | undefined)[];
	readonly linkUrl: readonly (string | undefined)[];
};

/** a scheme at the head of an address; one typed without is taken as https. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * the sharing a screen posted, or the sentence each refused box is answered with — keyed by the
 * box's own name, a link's by its row (`linkUrl[2]`), and naming what it held, because the body
 * behind the 400 is read by an agent (CLAUDE.md).
 */
export function sharingInput(
	values: SharingValues
): { ok: true; sharing: OrgSharing } | { ok: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};

	const channels = sharingChannels.safeParse(values.channels);
	if (!channels.success) {
		const off = values.channels.find((channel) => !isOneOf(SHARE_CHANNELS, channel));
		const twice = values.channels.find((channel, at) => values.channels.indexOf(channel) !== at);
		errors.channels =
			off === undefined
				? `${shown(twice)} is ticked twice; each channel is offered once`
				: `${shown(off)} is not a share channel; a channel is ${listed(SHARE_CHANNELS)}`;
	}

	const typed = values.message?.trim() ?? '';
	const message =
		typed === '' ? { success: true as const, data: null } : sharingMessage.safeParse(typed);
	if (!message.success) {
		errors.message = `holds ${typed.length} characters; a share message holds at most ${SHARE_MESSAGE_MAX}`;
	}

	const links: { label: string; href: string }[] = [];
	const rows = Math.max(values.linkLabel.length, values.linkUrl.length);
	for (let row = 0; row < rows; row++) {
		const label = values.linkLabel[row]?.trim() ?? '';
		const typedUrl = values.linkUrl[row]?.trim() ?? '';
		if (label === '' && typedUrl === '') continue;
		const href = SCHEME.test(typedUrl) || typedUrl === '' ? typedUrl : `https://${typedUrl}`;
		const link = sharingLink.safeParse({ label, href });
		if (link.success) {
			links.push(link.data);
			continue;
		}
		if (label === '') {
			errors[`linkLabel[${row}]`] = 'required';
		}
		if (href === '') errors[`linkUrl[${row}]`] = 'required';
		else if (!sharingLink.shape.href.safeParse(href).success) {
			errors[`linkUrl[${row}]`] =
				`${shown(typedUrl)} is not a web address; a social link starts with https:// or http://`;
		}
	}
	if (links.length > SOCIAL_LINKS_MAX) {
		errors.linkUrl = `holds ${links.length} social links; the organisation lists at most ${SOCIAL_LINKS_MAX}`;
	}

	if (!channels.success || !message.success || Object.keys(errors).length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, sharing: { channels: channels.data, message: message.data, links } };
}

/** the column's text for a sharing, which is what a save writes and what its digest is taken over. */
export function storedSharing(sharing: OrgSharing): string {
	return JSON.stringify({
		channels: sharing.channels,
		message: sharing.message,
		links: sharing.links.map(({ label, href }) => ({ label, href }))
	});
}
