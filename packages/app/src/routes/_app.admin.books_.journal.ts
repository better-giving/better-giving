import { JOURNAL_RANGE_FIELDS, journalFileName, readJournalRange } from '$lib/ledger/journal-range';
import { journalFile } from '$lib/server/ledger/journal-file';
import { readEntryGroupsInRange } from '$lib/server/ledger/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.books_.journal';

// the accountant's download: the entries of a range as the file one accounting package imports.
//
// a route of its own and not ./_app.admin.books.tsx's loader, which draws that screen: a loader
// that sometimes answers with a screen's data and sometimes with a file is two jobs behind one
// address, and the screen's own revalidation would fetch the file. this one exports a `loader` and
// no component, which is what makes it a resource route — the answer is the `Response` below,
// verbatim (react-router/docs/how-to/resource-routes.md).
//
// `books_` and not `books`: the trailing underscore keeps the address under /admin/books while
// leaving the screen out of the chain above it, so this is served under the protected layout and
// under nothing else. ../routes.spec.ts is what holds that placement.
//
// **it re-reads and re-shapes rather than trusting what the screen worked out.** the screen states
// the same count off the same three values, but it states it against the books as they were when
// it was drawn — a gift settling between the drawing and the press is a file the screen never
// counted. the two agree because they read the same query string and call the same shaper, never
// because one carried its answer to the other.

/** what the file is served as. the shaping is `$lib/server/ledger/journal-file.ts`'s. */
const CSV = 'text/csv; charset=utf-8';

/** the pair a refusal about the range names, spelled as the query string spells them. */
const RANGE_ENDS = `${JOURNAL_RANGE_FIELDS.from}/${JOURNAL_RANGE_FIELDS.to}`;

/**
 * a refusal, as the plain text a reader of it gets.
 *
 * text and not a screen: nothing reaches this route but the screen's own link and a hand-typed
 * address, and an operator meets every one of these refusals on the screen — worded there, at the
 * control, with the download not offered at all. what lands here is what names the value to fix
 * (CLAUDE.md).
 */
function refused(status: number, reason: string): Response {
	return new Response(reason, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const asked = readJournalRange(new URL(request.url).searchParams);
	// 400: the request itself is unreadable — a missing end, a day the calendar does not have, a
	// target this app does not shape for.
	if (!asked.ok) {
		return refused(
			400,
			asked.problems.map(({ field, problem }) => `${field} ${problem}`).join('\n')
		);
	}

	const groups = await readEntryGroupsInRange(context.get(database), asked.from, asked.to);
	const file = journalFile(asked.target, groups);
	// 422 and not 400: the three values were read and the range is a range — what cannot be done is
	// producing a file the target would import from it, which is a fact about the books rather than
	// about the request.
	if (!file.ok) {
		return refused(
			422,
			file.refusal.reason === 'too_many_rows'
				? `narrow ${RANGE_ENDS}: it holds ${file.refusal.rows} lines and ${asked.target} takes ${file.refusal.cap} in one file.`
				: `narrow ${RANGE_ENDS}: it holds ${file.refusal.currencies.join(', ')} and one file holds one currency.`
		);
	}

	return new Response(file.csv, {
		headers: {
			'content-type': CSV,
			'content-disposition': `attachment; filename="${journalFileName(asked.target, asked.from, asked.to)}"`
		}
	});
}
