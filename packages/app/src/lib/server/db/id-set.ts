import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

// a set of ids as one bound parameter, for any read that fetches rows by a list of ids it already
// holds: a page's rows, a delivery run's subjects.

/**
 * `column` is one of `ids`, bound as one JSON parameter: `ids` as an `IN` list would bind one each,
 * and a 100-row page would meet D1's bound-parameter limit
 * (https://developers.cloudflare.com/d1/platform/limits/).
 */
export function inPage(column: SQLWrapper, ids: readonly string[]): SQL {
	return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}
