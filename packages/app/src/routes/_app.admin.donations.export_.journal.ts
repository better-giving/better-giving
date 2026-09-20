import { href, redirect } from 'react-router';
import {
	isJournalPressToken,
	JOURNAL_PRESS_COOKIE,
	JOURNAL_PRESS_FIELD,
	JOURNAL_PROBLEM_FIELD,
	JOURNAL_RANGE_FIELDS,
	JOURNAL_REFUSAL_FIELD,
	type JournalProblem,
	journalFileName,
	journalRangeQuery,
	readJournalRange,
	REFUSAL_ON_SCREEN
} from '$lib/ledger/journal-range';
import { journalFile, journalRowCap, type JournalTarget } from '$lib/server/ledger/journal-file';
import { readEntryGroupsInRange } from '$lib/server/ledger/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donations.export_.journal';

// the accountant's download: the entries of a range as the file one accounting package imports.
//
// a route of its own and not ./_app.admin.donations.export.tsx's loader, which draws that screen: a loader
// that sometimes answers with a screen's data and sometimes with a file is two jobs behind one
// address, and the screen's own revalidation would fetch the file. this one exports a `loader` and
// no component, which is what makes it a resource route — the answer is the `Response` below,
// verbatim (react-router/docs/how-to/resource-routes.md).
//
// `export_` and not `export`: the trailing underscore keeps the address under
// /admin/donations/export while leaving the screen out of the chain above it, so this is served
// under the protected layout and under nothing else. ../routes.spec.ts is what holds that
// placement, and the address is under Gifts because that is where the operator asking for it comes
// from — the gifts are what fills these books. **what the file holds is every entry the range
// covers**: the income, the processor's cut and the money received per gift, and the corrections
// posted on ./_app.admin.books.tsx beside them. the read names no source type
// (`$lib/server/ledger/queries.ts`) and neither does the shaping.
//
// **this is where a press on the export screen lands, and it is the first thing to read the books
// for that range.** the screen checks nothing before the press: it holds the two refusals its own
// boxes can know and hands everything else straight here, so the answer an operator gets is read
// off the books at the moment they asked rather than off the books as some earlier render found
// them.
//
// **so it answers two readers, and they differ only in where the refusal is drawn.** a press made
// on that screen carries `JOURNAL_REFUSAL_FIELD`, and a refusal to one of those is sent back there
// as a code for the screen to word beside the press — an operator standing on a screen is not
// handed a page of text. every other caller is a hand-typed address and gets that text, naming the
// value to fix. what is refused is the same for both.

/** what the file is served as. the shaping is `$lib/server/ledger/journal-file.ts`'s. */
const CSV = 'text/csv; charset=utf-8';

/** the pair a refusal about the range names, spelled as the query string spells them. */
const RANGE_ENDS = `${JOURNAL_RANGE_FIELDS.from}/${JOURNAL_RANGE_FIELDS.to}`;

/**
 * a refusal, as the plain text whoever asked this address directly gets.
 *
 * text and not a screen: what reaches this route without the export screen's own box on it is a
 * hand-typed address, and what lands there is what names the value to fix (CLAUDE.md). a press made
 * on the screen is the other reader and is answered by `sendBack` below.
 */
function refused(status: number, reason: string): Response {
	return new Response(reason, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/**
 * how long the press's own token stands in the browser. a download is one round trip, and the
 * screen drops the cookie itself the moment it reads it — what this bounds is the one that was
 * never read.
 */
const PRESS_COOKIE_SECONDS = 60;

/**
 * the press this request names, where it names one: its token, and the `set-cookie` that tells the
 * browser which made it that this answer is its own.
 *
 * **one cookie and two readings, because it is one fact.** on the file it releases the press, which
 * a download leaves nothing else on the page to do; on a refusal it says a press caused the
 * document that came back, which is what puts the reader on the press rather than at the top of a
 * page they did not ask for. the token is on the address either way and says nothing on its own —
 * an address is pasted as easily as pressed — so what carries the fact is the cookie, which only
 * the browser that pressed receives and which the screen spends as it reads.
 *
 * `$lib/ledger/journal-range.ts` argues the pair; what is decided here is the attributes: no
 * `HttpOnly`, because the screen reads this in script and that is the whole of what it is for; the
 * screen's own path; and `Secure` only where the request arrived over one, which is the reading
 * `isSecure` in `$lib/server/flash.ts` takes of the same question.
 */
function answeringPress(
	params: URLSearchParams,
	request: Request
): { readonly token: string; readonly cookie: string } | null {
	const token = params.get(JOURNAL_PRESS_FIELD) ?? '';
	if (!isJournalPressToken(token)) return null;
	const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
	return {
		token,
		cookie: `${JOURNAL_PRESS_COOKIE}=${token}; Path=${href('/admin/donations/export')}; Max-Age=${PRESS_COOKIE_SECONDS}; SameSite=Lax${secure}`
	};
}

/**
 * the operator put back on the screen they pressed on, with the reason beside the press.
 *
 * the range goes back with it, written out of what was *read* rather than out of what arrived — so
 * the boxes land holding the range that produced the refusal. the reason is a code and never the
 * sentence: what an operator reads is worded on the screen, and an address is something they can be
 * handed.
 *
 * `$lib/ledger/journal-range.ts` is where both halves of that are stated.
 */
function sendBack(
	problem: JournalProblem,
	asked: { target: JournalTarget; from: Date; to: Date },
	pressed: { readonly token: string; readonly cookie: string } | null
): Response {
	const query = new URLSearchParams(journalRangeQuery(asked.target, asked.from, asked.to));
	query.set(JOURNAL_PROBLEM_FIELD, problem);
	// the press goes back with the range, both halves of it: the token on the address for the screen
	// to read, and the cookie for it to read the token against.
	if (pressed !== null) query.set(JOURNAL_PRESS_FIELD, pressed.token);
	return redirect(
		`${href('/admin/donations/export')}?${query}`,
		pressed === null ? undefined : { headers: { 'set-cookie': pressed.cookie } }
	);
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const params = new URL(request.url).searchParams;
	// whether the press that asked was made on the export screen, which is the whole of what decides
	// where a refusal is answered — never what is refused.
	const onScreen = params.get(JOURNAL_REFUSAL_FIELD) === REFUSAL_ON_SCREEN;
	const pressed = answeringPress(params, request);

	const asked = readJournalRange(params);
	// 400: the request itself is unreadable — a missing end, a day the calendar does not have, a
	// target this app does not shape for.
	//
	// text even for a press claiming a screen, because the screen's form cannot produce one: both
	// ends are date boxes checked before the press is let through, and the target is the pressed
	// button's own value. so there is no sentence over there for this, and the value and its
	// predicate are the useful answer.
	if (!asked.ok) {
		return refused(
			400,
			asked.problems.map(({ field, problem }) => `${field} ${problem}`).join('\n')
		);
	}

	const range = await readEntryGroupsInRange(
		context.get(database),
		asked.from,
		asked.to,
		journalRowCap(asked.target)
	);
	const file = journalFile(asked.target, range);
	// **before the empty-range refusal below, because a range past the cap is both.** the read is
	// bounded at the target's cap and drops the entry the bound cut (`$lib/server/ledger/queries.ts`),
	// so a range wide enough comes back holding nothing at all — answered in the other order, the
	// operator is told the books are empty over a period they are not.
	//
	// 422 and not 400: the three values were read and the range is a range — what cannot be done is
	// producing a file the target would import from it, which is a fact about the books rather than
	// about the request.
	if (!file.ok) {
		if (onScreen) return sendBack(file.refusal.reason, asked, pressed);
		return refused(
			422,
			file.refusal.reason === 'too_many_rows'
				? `narrow ${RANGE_ENDS}: ${asked.target} takes ${file.refusal.cap} lines in one file and this range holds more.`
				: `narrow ${RANGE_ENDS}: it holds ${file.refusal.currencies.join(', ')} and one file holds one currency.`
		);
	}

	// a range holding no entry is refused rather than shaped. `$lib/server/ledger/journal-file.ts`
	// builds a file with a header row and nothing under it, which is a valid file that imports as
	// zero and is not changed by this — but it is not an answer to the question that was asked, and
	// an operator handed it has been told nothing about the range they picked.
	if (range.groups.length === 0) {
		return onScreen
			? sendBack('nothing_posted', asked, pressed)
			: refused(422, `nothing was posted to the books between ${RANGE_ENDS}.`);
	}

	const headers = new Headers({
		'content-type': CSV,
		'content-disposition': `attachment; filename="${journalFileName(asked.target, asked.from, asked.to)}"`
	});
	if (pressed !== null) headers.set('set-cookie', pressed.cookie);
	return new Response(file.csv, { headers });
}
