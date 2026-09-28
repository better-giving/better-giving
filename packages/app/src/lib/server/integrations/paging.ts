import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { integrationsRefusal } from './surface';

// how a list on the read API is walked a page at a time: the page size, the cursor, and the
// keyset condition a list's own query splices in. every list under `/integrations/v1` takes these,
// so each one pages the same way and refuses the same inputs with the same words.
//
// **keyset, never offset.** a page starts strictly after the last row of the page before it in
// the list's order — `(time, id)`, the id breaking a tie — so a row written while a caller pages
// shifts no window: it lands ahead of the walk or behind it, and is served once or not by this
// walk, never twice and never in place of another.
//
// **the cursor is opaque to the caller and is not a secret.** it is base64url of the order it was
// issued for and the last row's time and id. the order is in it so a cursor from one order used in
// another is refused rather than answered with a page that belongs to neither: a list names each of
// its orders with a label no other list's order uses (`gifts.newest`). anyone can decode and forge
// one, and a forged cursor is only another place to start the same read.
//
// **a list answers `{ data, next_cursor }`**, and `next_cursor` is null on the last page — a
// page is read one row longer than it serves, so the last page is known without a trailing empty one.
//
// every refusal is a 400 naming the value it refused and what to send instead, through
// ./surface.ts, so an integrator's code switches on the code and whoever reads the body can act on
// the rest.

/** how many rows a page holds when the request names no `limit`. */
export const DEFAULT_PAGE_SIZE = 50;

/** the most a page holds. a larger `limit` is refused naming this, never quietly cut to it. */
export const PAGE_SIZE_CEILING = 100;

/** where a page ends in its order: the last row's sort time in epoch milliseconds, and its id. */
export type Keyset = { readonly at: number; readonly id: string };

/** the rows of one page, and where the next page starts, or null where this is the last. */
export type PageOf<T> = { readonly rows: readonly T[]; readonly next: Keyset | null };

/**
 * one page of `rows`, read `limit + 1` long: the extra row says another page follows, and is
 * served as that page's first.
 */
export function pageOf<T>(rows: readonly T[], limit: number, keyOf: (row: T) => Keyset): PageOf<T> {
	if (rows.length <= limit) return { rows, next: null };
	const served = rows.slice(0, limit);
	const last = served[served.length - 1];
	return { rows: served, next: last === undefined ? null : keyOf(last) };
}

/**
 * the rows strictly past `after` in an order sorted by `at` then `id`, both in `direction`. `at`
 * is bound as the epoch milliseconds a timestamp column stores, and as a row value, which an index
 * on `(at, id)` serves as one range.
 */
export function pastKeyset(
	direction: 'asc' | 'desc',
	at: SQLWrapper,
	id: SQLWrapper,
	after: Keyset
): SQL {
	return sql`(${at}, ${id}) ${sql.raw(direction === 'asc' ? '>' : '<')} (${after.at}, ${after.id})`;
}

/**
 * `column` is one of `ids`, bound as one JSON parameter: a page's ids as an `IN` list would bind
 * one each and a 100-row page would meet D1's bound-parameter limit
 * (https://developers.cloudflare.com/d1/platform/limits/).
 */
export function inPage(column: SQLWrapper, ids: readonly string[]): SQL {
	return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}

export function encodeCursor(order: string, last: Keyset): string {
	return btoa(JSON.stringify([order, last.at, last.id]))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

/**
 * the 400 for a query naming a parameter outside `known`, or null where it names none. a
 * misspelt filter left unread would answer every gift as though it had filtered them.
 */
export function unknownParameters(url: URL, known: readonly string[]): Response | null {
	const unknown = [...new Set(url.searchParams.keys())].filter((name) => !known.includes(name));
	if (unknown.length === 0) return null;
	const names = (list: readonly string[]) => list.map((name) => `\`${name}\``).join(', ');
	return integrationsRefusal(
		400,
		'unknown_parameter',
		`This endpoint reads no parameter named ${names(unknown.map(shown))}.`,
		`Send only ${names(known)}, each as documented, and leave out the rest.`
	);
}

/** the page size `raw` asks for, the default where it is absent, or the 400 refusing it. */
export function readLimit(raw: string | null): number | Response {
	if (raw === null) return DEFAULT_PAGE_SIZE;
	const limit = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : Number.NaN;
	if (limit <= PAGE_SIZE_CEILING) return limit;
	return integrationsRefusal(
		400,
		'invalid_limit',
		`\`limit=${shown(raw)}\` is not a page size this endpoint serves: a page holds a whole number of rows from 1 to ${PAGE_SIZE_CEILING}.`,
		`Send a \`limit\` from 1 to ${PAGE_SIZE_CEILING}, or none for ${DEFAULT_PAGE_SIZE}. To read more rows than one page holds, follow \`next_cursor\` until it is null.`
	);
}

/**
 * where the page `raw` continues from, in the order named `order`: null where the request carries
 * no cursor, and the 400 refusing it where it is not one this order issued.
 */
export function readCursor(raw: string | null, order: string): Keyset | null | Response {
	if (raw === null) return null;
	const decoded = decodeCursor(raw);
	if (decoded !== null && decoded.order === order) return decoded.keyset;
	return integrationsRefusal(
		400,
		'invalid_cursor',
		decoded === null
			? `\`cursor=${shown(raw)}\` is not a cursor this endpoint issued.`
			: `\`cursor=${shown(raw)}\` was issued for a walk in another order than this request's: a cursor continues only the order it came from.`,
		'Send back the `next_cursor` of the previous page exactly as it came, with the same query parameters as the request that returned it; or send no `cursor` to start from the first page.'
	);
}

/**
 * the instant `raw` names as `updated_since`: null where the request names none, and the 400
 * refusing it where it is not an ISO 8601 date and time with its offset. a fraction past the
 * millisecond is cut to it, which only widens a `>=` read by less than one.
 */
export function readUpdatedSince(raw: string | null): Date | null | Response {
	if (raw === null) return null;
	const instant = isoInstant(raw);
	if (instant !== null) return instant;
	return integrationsRefusal(
		400,
		'invalid_updated_since',
		`\`updated_since=${shown(raw)}\` is not an instant: it is read as an ISO 8601 date and time with a UTC offset, like \`2026-09-10T12:00:00Z\`.`,
		'Send the `updated_at` of the last row your system was served, as it came, or any instant in that form. An offset other than `Z` has its `+` sent as `%2B`, or a query string reads it as a space.'
	);
}

const ISO_INSTANT =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

function isoInstant(raw: string): Date | null {
	const match = ISO_INSTANT.exec(raw);
	if (match === null) return null;
	const [, year, month, day, hour, minute, second = '00', fraction = '', offset] = match;
	const fields = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
	const wall = new Date(`${fields}Z`);
	// a field out of range (February 30, hour 24) is rolled over into the next one or refused by
	// the parse, so a wall time that does not read back as written was not a real one.
	if (Number.isNaN(wall.getTime()) || wall.toISOString().slice(0, 19) !== fields) return null;
	const ms = wall.getTime() + Number(fraction.padEnd(3, '0').slice(0, 3));
	if (offset === 'Z' || offset === undefined) return new Date(ms);
	const [hours, minutes] = offset.slice(1).split(':').map(Number);
	if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) return null;
	const sign = offset.startsWith('-') ? -1 : 1;
	return new Date(ms - sign * (hours * 60 + minutes) * 60_000);
}

function decodeCursor(raw: string): { order: string; keyset: Keyset } | null {
	if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(atob(raw.replaceAll('-', '+').replaceAll('_', '/')));
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length !== 3) return null;
	const [order, at, id] = parsed as unknown[];
	if (typeof order !== 'string' || !Number.isSafeInteger(at) || typeof id !== 'string') return null;
	if (id.length === 0) return null;
	return { order, keyset: { at: at as number, id } };
}

/** a refused value as a refusal quotes it: cut short, so a pasted blob does not fill the body. */
function shown(raw: string): string {
	return raw.length > 64 ? `${raw.slice(0, 64)}…` : raw;
}
