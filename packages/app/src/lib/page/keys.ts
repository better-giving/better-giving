// the keys of a stored page document that the database reads, the page types, the look's closed
// sets and a chat turn's notes, in the one place both the schema's checks and the page catalog
// import from.
//
// `$lib/server/db/schema.ts` builds `page` and `org_presentation` checks out of these names with
// `json_extract`, and a check reading a key the document no longer carries reads null, which it
// accepts. naming each key once is what keeps the check and the parser reading the same key.
//
// pure and not under `$lib/server/**`, for the reason `$lib/forms/statuses.ts` gives: a component
// renders the shades and corners, and ./catalog.ts reads a page by its type, and neither can
// import from there. the dependency runs server -> shared and never back: schema.ts imports this,
// this imports nothing.

/** top-level keys of a page document (`page.draft`, `published`, `last_published`). */
export const PAGE_KEYS = {
	/**
	 * a campaign's name as its page draws it; absent, the page draws `page.name`, the dashboard's
	 * current name for it.
	 */
	name: 'name',
	/** a campaign's goal, minor units of its owned settings row's currency. */
	goalMinor: 'goalMinor',
	/** a campaign's end: the end of the chosen day, unix ms, in the setting browser's time zone. */
	endsAt: 'endsAt',
	/** the IANA name of that time zone, which the page words the day in. present exactly when `endsAt` is. */
	endsZone: 'endsZone',
	/**
	 * the page's own look; absent or null means the organisation's. the database checks a look's keys
	 * one by one, each where present, and ./catalog.ts's parse refuses a look missing any of them.
	 */
	look: 'look'
} as const;

/** keys of a look — the organisation's (`org_presentation.look`) and a page's own alike. */
export const LOOK_KEYS = {
	/** lowercase `#rrggbb`. */
	brandColour: 'brandColour',
	shade: 'shade',
	corner: 'corner'
} as const;

/** a donor page's kind: the one donation page at `/donate`, or a campaign at its own address. */
export const PAGE_TYPES = ['donation_page', 'campaign'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const SHADES = ['light', 'warm', 'cool'] as const;
export type Shade = (typeof SHADES)[number];

export const CORNERS = ['square', 'soft', 'round'] as const;
export type Corner = (typeof CORNERS)[number];

/** a page's mood: how its section grounds relate to the brand colour. */
export const PALETTES = ['plain', 'tint', 'duo', 'bright', 'bold'] as const;
export type Palette = (typeof PALETTES)[number];

/** where the donation box stands among a page's blocks. */
export const LAYOUTS = ['box-right', 'banner', 'column', 'cover'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** the ground a block's section stands on; `strong` carries one ink and no quiet text. */
export const BACKGROUNDS = ['none', 'soft', 'tint', 'strong'] as const;
export type Background = (typeof BACKGROUNDS)[number];

/**
 * what an assistant turn in a page's chat says about itself beside its words: `refused` when the
 * reply did not fit the page and nothing changed, `fell-back` when the chosen model did not answer
 * and the free model wrote the turn, `unanswered` when no model answered. a column of its own,
 * `chat_turn.note`, since the model writes the turn's text and could write a marker into it.
 */
export const CHAT_NOTES = ['refused', 'fell-back', 'unanswered'] as const;
export type ChatNote = (typeof CHAT_NOTES)[number];
