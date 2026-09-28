// the keys of a stored page document that the database reads, the page types, and the look's
// closed sets, in the one place both the schema's checks and the page catalog import from.
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
	/** a campaign's goal, minor units of its owned settings row's currency. */
	goalMinor: 'goalMinor',
	/** a campaign's end: the end of the chosen day, unix ms, in the setting browser's time zone. */
	endsAt: 'endsAt',
	/** the page's own look; absent or null means the organisation's. */
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
