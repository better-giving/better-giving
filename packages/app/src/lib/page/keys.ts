// the keys of a stored page document that the database reads and the page types, in the one place
// both the schema's checks and the page catalog import from.
//
// `$lib/server/db/schema.ts` builds `page`'s checks out of these names with `json_extract`, and a
// check reading a key the document no longer carries reads null, which it accepts. naming each key
// once is what keeps the check and the parser reading the same key.
//
// pure and not under `$lib/server/**`, for the reason `$lib/forms/statuses.ts` gives: ./catalog.ts
// reads a page by its type, and cannot import from there. the dependency runs server -> shared and
// never back: schema.ts imports this, this imports nothing.

/** top-level keys of a page document (`page.draft`, `published`, `last_published`). */
export const PAGE_KEYS = {
	/**
	 * a campaign's name as its page draws it; absent, the page draws `page.name`, the dashboard's
	 * current name for it.
	 */
	name: 'name',
	/**
	 * a campaign's link as its draft would move it, present only while that move waits on Publish,
	 * which takes it onto `page.slug` and drops it from the document. absent, the link is `page.slug`.
	 */
	slug: 'slug',
	/** a campaign's goal, minor units of its owned settings row's currency. */
	goalMinor: 'goalMinor',
	/** a campaign's end: the end of the chosen day, unix ms, in the setting browser's time zone. */
	endsAt: 'endsAt',
	/** the IANA name of that time zone, which the page words the day in. present exactly when `endsAt` is. */
	endsZone: 'endsZone'
} as const;

/** a donor page's kind: the one donation page at `/donate`, or a campaign at its own address. */
export const PAGE_TYPES = ['donation_page', 'campaign'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/**
 * a page's stored state: `never_published` until a campaign's first publish; `live` while it
 * answers at its address; `unpublished` once Unpublish has taken it down, keeping its published
 * page and its address while nothing answers there; `ended` once End has taken it down. a `live`
 * campaign past its published end date reads as ended without this changing (./ended.ts). a
 * campaign goes back from `unpublished` or `ended` to `live` by publishing again, and never back to
 * `never_published`. the Donation page is always `live`.
 */
export const PAGE_STATES = ['never_published', 'live', 'unpublished', 'ended'] as const;
export type PageState = (typeof PAGE_STATES)[number];
