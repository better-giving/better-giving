// what a site allowed to embed a donation form may look like, and the host name inside one — the
// whole of both, in the one module every surface reads them from.
//
// **the rules are here because two surfaces apply them to the same list.** the deployment parses
// what it is sent (`packages/app/src/lib/forms/input-schema.ts`,
// `packages/app/src/lib/server/sites/site-input.ts`) and the console applies them in front of the
// person typing, under the box holding each offending row, through the schema its fold validates
// against (`packages/console-ui/src/lib/sites.ts`). a copy in the console would be the cheaper
// answer and is exactly how the two come to disagree: one end reading `acme.org` as the site the
// operator meant and storing `https://acme.org`, and the other refusing the list, is a setup run
// that dies after doing work nobody can take back. one module is what makes both ends agree.
//
// **the deployment's parse stays the authority.** the console reading the list first is a courtesy
// to the operator and never a replacement for the boundary: `/console/sites` is reachable by
// anything holding a session, so the worker parses every list it is sent whatever asked it to.
//
// this package is a leaf and imports nothing of the app's, which is what makes it the only place
// both can reach: everything below reads a string with the platform's own `URL` and reaches for
// nothing else.
//
// **a row is repaired where it can be and refused where it cannot.** a browser's address bar hands
// out `https://acme.org/donate?x=1` and a fundraiser types `acme.org`, and neither is a mistake to
// be taught out of. the scheme is added where there is none, and the path, the query, the fragment
// and the trailing slash come off; what is left is the origin — scheme, host and any port — which
// is the shape a browser puts in the `Origin` header that `/api/v1` compares against
// (`packages/app/src/lib/server/api/cors.ts`). so a near miss becomes the entry it was trying to
// be, rather than an entry that matches nothing on earth and an operator watching their form refuse
// to load on their own site with no message attached.
//
// **what is stored is what the row normalised to, never the line that was typed.** the whole point
// of the repair is that the stored entry is the one the browser will send, so a caller taking
// `origins` is taking origins and a caller storing the raw rows would be undoing this file.
//
// **what is left is refused, and a message says what is wrong rather than what to write.**
// `invalid url` where nothing about the line can be read as an origin, `https only` where the
// scheme is one the browser will not let a form load under. no message repeats the value it is
// about: the box the sentence stands under is already showing the operator what they typed, and a
// sentence that echoes it is read twice and trusted less. no message invents a correction either —
// a scheme concatenated in front of a line that was never an address makes another line that is not
// one, and a suggestion that is itself unusable costs more than saying nothing. several rows
// therefore come back saying the same words, which is the point: the words are about the row, and
// the row is on the screen beside them.
//
// **what is deliberately not validated here.** that the host resolves, that it serves anything,
// that the org owns it: none of the three is knowable from a string, and refusing a site that is
// not built yet is a worse failure than storing one that never gets used. the origin is a shape,
// and this file checks the shape.
//
// **two rows are one site when their host names match.** `x.example`, `https://x.example`,
// `http://x.example` and `https://x.example:8443` are four lines and one site to the fundraiser
// typing them, so the second and every one after it is named as a repeat and the first is stored as
// whatever it normalised to. the trade is deliberate and the cost of the other way round is what
// decides it: everything downstream keys on the host ({@link hostsOf} feeds the Turnstile widget
// and Stripe's wallet domains), so a list keyed on the whole origin takes both, collapses them to
// one host on the save, and the operator watches an entry they typed evaporate with nothing said
// about it.
//
// all of it is plain typescript rather than zod, and each block below says why it has to be. a
// schema runs its checks in whatever order it likes and reports all of them at once, which is the
// opposite of what these are — and it would put a schema library between this leaf and the two
// surfaces that read it.

/**
 * generous, and here to stop a pathological row rather than to model a real deployment.
 *
 * `allowed_origins` is read and JSON-parsed on every `/api/v1` request to build the CORS
 * answer, so the cost of a silly list is paid by donors rather than by whoever pasted it.
 * 253 is the DNS maximum for a hostname; the rest is headroom for a scheme and a port.
 *
 * exported so the spec asserts the boundary rather than a number copied out of this file,
 * which is how a cap silently stops being tested when it is raised.
 */
export const MAX_ALLOWED_ORIGINS = 50;
export const MAX_ORIGIN_LENGTH = 270;

/**
 * the whole message vocabulary, which is four sentences of two or three words each.
 *
 * they are constants rather than literals at the check because two of them are said by both
 * readings below, and a sentence spelled twice is how the box and the list come to word the same
 * refusal differently.
 */
const INVALID = 'invalid url';
const HTTPS_ONLY = 'https only';
const DUPLICATE = 'duplicate site';
const TOO_LONG = `cannot exceed ${MAX_ORIGIN_LENGTH} characters`;
const TOO_MANY = `cannot exceed ${MAX_ALLOWED_ORIGINS} sites`;

/**
 * the site list as the repeating row editor submits it, and the one message about it.
 *
 * one row per origin, so what arrives is one form entry per box rather than one box holding
 * newlines. the trim and the blank-row skip are what a row an operator added and never typed into
 * needs: it is a blank entry rather than a value, so it is dropped. one site written into two boxes
 * is not that: it is an edit the operator made and meant, and it is named rather than dropped.
 *
 * plain typescript rather than a schema, and the count cap is why: it is an early return that
 * deliberately says nothing about any individual line, where an array schema with a `.max()` on
 * it would report the cap *and* one issue per bad element. the cap firing is the moment an
 * operator most needs one sentence rather than two hundred.
 *
 * **every sentence the list earns, and each of them once.** the messages carry no addresses in
 * them, so a list of thirty rows that are all the same mistake has one thing to say about itself
 * and says it once; a list with a repeat and an unreadable row says both, because they are two
 * different edits. the message is bounded by the vocabulary above rather than by the list.
 */
export function readOriginList(rows: readonly string[]): {
	origins: string[];
	problem: string | null;
} {
	// a repeat is named, and the list still comes back deduped. the two are for different callers:
	// one that gates on the sentence refuses the whole list, and one reading only `origins` is
	// asking what would be stored rather than whether to store it — `unlistedSites` in
	// `packages/app/src/lib/forms/input-schema.ts` is the second and takes a set difference. a row
	// that disappears on save is an edit the form ate with nothing said about it, which is worse
	// than a row an operator is told to delete.
	//
	// first-seen order is kept, because the order is the operator's and a list that comes back
	// re-sorted reads as the form having eaten an edit of a different kind.
	//
	// the repeats come out before the count is taken, the same way `readSuggestedAmounts` in
	// `packages/app/src/lib/forms/amounts.ts` takes its own: the cap counts what would be stored, so
	// a list that would store fifty sites is never refused for holding fifty-one rows — it is
	// refused for the repeat instead. this pass is the whole dedupe: the rows it keeps are read for
	// their origin below, and two rows that normalise to one host never both reach it.
	const seen = new Set<string>();
	const lines: string[] = [];
	let repeated = false;
	for (const row of rows) {
		const line = row.trim();
		if (line.length === 0) continue;
		const key = siteKey(line);
		if (seen.has(key)) {
			repeated = true;
			continue;
		}
		seen.add(key);
		lines.push(line);
	}

	if (lines.length > MAX_ALLOWED_ORIGINS) {
		// checked instead of the lines, not alongside them: a paste of two hundred rows would
		// otherwise come back as two hundred sentences about individual lines, none of which
		// is the problem.
		return { origins: [], problem: TOO_MANY };
	}

	const origins: string[] = [];
	// a set, so the same words are said once however many rows earned them. the group's own sentence
	// leads, because it is about the list rather than about any one row: a row that is both repeated
	// and unusable is owed both, since deleting the extra box and writing an address that can be
	// read are two different edits.
	const problems = new Set<string>();
	if (repeated) problems.add(DUPLICATE);
	for (const line of lines) {
		const read = readRow(line);
		if (read.origin === null) {
			problems.add(read.problem);
			continue;
		}
		origins.push(read.origin);
	}

	return { origins, problem: problems.size > 0 ? [...problems].join(', ') : null };
}

/**
 * the same list read one row at a time: what is true of the list, and what is wrong with each row.
 *
 * the reading a surface that draws one box per site takes, where {@link readOriginList} is the
 * reading a surface that stores the list takes. both are the same rules over the same rows, which
 * is the whole reason they are one module: a console marking a row its own deployment would accept
 * is the same disagreement a copy causes, arrived at from the other side.
 *
 * **`rows` comes back at the length it was handed**, at the same positions, so a caller keys a
 * sentence to the box it is about by index alone. a row with nothing wrong with it is `null`, and
 * so is a blank one: a box an operator added and has not typed into yet is not a mistake, and
 * marking it would refuse a form nobody has filled in.
 *
 * **{@link problem} and a row's sentence never both stand.** the count cap deliberately says
 * nothing about any individual line ({@link readOriginList}), so when it fires every row comes back
 * `null` — an operator meeting it has one list to shorten rather than two hundred boxes to read.
 *
 * **a repeat is the row's own sentence and the first occurrence carries none.** the repeat is
 * checked ahead of the shape, so of two boxes holding one site the second is told it is a repeat
 * whatever else is wrong with it: the box has to go either way, and the first box is where the
 * address is read.
 */
export function readOriginRows(rows: readonly string[]): {
	problem: string | null;
	rows: (string | null)[];
} {
	const lines = rows.map((row) => row.trim());
	// what would be stored, which is what the cap counts: a list that would store fifty sites is
	// never refused for holding fifty-one rows, the same reading `readOriginList` takes.
	const stored = new Set(lines.filter((line) => line.length > 0).map(siteKey));
	if (stored.size > MAX_ALLOWED_ORIGINS) {
		return { problem: TOO_MANY, rows: lines.map(() => null) };
	}

	const seen = new Set<string>();
	return {
		problem: null,
		rows: lines.map((line) => {
			if (line.length === 0) return null;
			const key = siteKey(line);
			if (seen.has(key)) return DUPLICATE;
			seen.add(key);
			return readRow(line).problem;
		})
	};
}

/**
 * what two rows have to share to be the same site, which is the host name and not the line.
 *
 * the one statement of the rule this file's header argues, read by both readings above so that a
 * box the console marks as a repeat is a box the deployment would have refused.
 *
 * it is taken off the normalised row rather than off the text, which is what makes `acme.org` and
 * `https://acme.org` the one site they are to the person typing them. a row nothing can be read out
 * of is keyed on its own text instead, so two unreadable rows are two boxes to fix rather than one
 * box and a repeat.
 */
function siteKey(line: string): string {
	const url = parse(line);
	return url === null ? `line:${line}` : `host:${url.hostname}`;
}

/** what a row came to: the origin it normalised into, or the one thing wrong with it. */
type RowRead = { origin: string; problem: null } | { origin: null; problem: string };

/**
 * the one sentence about a row that is not the site the line was trying to be, or the origin it is.
 *
 * plain typescript, and the sequence is the rule: each check answers a question the next one
 * depends on, and the first that fails is the only message worth showing. a schema reports every
 * check that failed and in no guaranteed order, which here would mean an operator meeting three
 * sentences about one row — and the `*` check ahead of `parse` would stop being ahead of anything,
 * which is the whole reason it is where it is.
 */
function readRow(line: string): RowRead {
	if (line.length > MAX_ORIGIN_LENGTH) return { origin: null, problem: TOO_LONG };

	// before `parse`, because `new URL` does not object. `*` is not a forbidden host code point, so
	// `https://*.acme.org` parses and normalises to itself — and `/api/v1` compares origins
	// literally, so it would then be a list entry that matches nothing on earth. there is no repair
	// for it either: which sites a wildcard stands for is not knowable from the line.
	if (line.includes('*')) return { origin: null, problem: INVALID };

	const url = parse(line);
	// past the scheme repair and still not an address. `https:`, `mailto:someone` and anything with
	// a space in it have no host to read; `https://.acme.org`, `https://acme..org`,
	// `https://-acme.org` and `https://acme.org:0` have one that no browser resolves and no `Origin`
	// header carries. that is the silent-dead-entry failure this whole file exists to catch, so it
	// is caught rather than stored.
	//
	// the trailing dot falls out of the empty-label rule and belongs there: `https://acme.org.`
	// is legal and sendable, but only from a page loaded at the dotted name — it does not match
	// what an ordinary visit sends, which makes it the same near-miss as a trailing slash, and
	// unlike that slash there is no repair that keeps the operator's meaning.
	if (url === null || !isSendableHost(url)) return { origin: null, problem: INVALID };

	// the one thing about a row that is not repaired and not a spelling: a form loaded over plain
	// `http` is a form a browser will not let take a card, so writing `https://` over the top of it
	// would be storing a site that answers nothing.
	if (url.protocol !== 'https:' && !isLoopbackHttp(url))
		return { origin: null, problem: HTTPS_ONLY };

	return { origin: url.origin, problem: null };
}

/**
 * a row as the browser would send it, or `null` where there is no address in it.
 *
 * `url.origin` is the whole of the repair: it is scheme, host and port and nothing else, so the
 * path, the query, the fragment and the trailing slash come off by being left out rather than by
 * being stripped, a default port comes off with them, and the host is lowercased on the way.
 *
 * **the scheme is added only where the line does not already carry one**, and a colon followed by
 * digits is a port rather than a scheme (`localhost:5173`). prefixing unconditionally is what turns
 * `https:` into `https://https:`, which parses, holds the host `https`, and would be stored as a
 * site — a repair that invents an address is worse than the refusal it replaced.
 */
function parse(line: string): URL | null {
	try {
		const url = new URL(SCHEME.test(line) ? line : `https://${line}`);
		// a scheme with no authority after it parses and has no host: `mailto:someone` is a value
		// with nothing in it to serve a form from rather than an address written wrong.
		return url.hostname === '' ? null : url;
	} catch {
		return null;
	}
}

/** a scheme at the front of a line, which is a name and a colon that no port could be. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![0-9])/;

/**
 * the one exception to https, and it is the machine a developer is sitting at.
 *
 * matched on the hostname rather than the whole origin so that any port qualifies — the sites
 * that embed this form are developed on whatever port their own dev server takes, and a list
 * that accepted only one of them would be re-edited on a port collision.
 *
 * all three spellings, because which one a browser sends is not the operator's choice: a dev
 * server that binds v6-first is reached at `http://[::1]:5173` and sends exactly that as its
 * `Origin`.
 *
 * `[::1]` carries its brackets. `url.hostname` returns an IPv6 literal bracketed, so a bare
 * `'::1'` here would match nothing.
 */
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * whether the host could be the one a browser puts in an `Origin` header.
 *
 * not a hostname validator and not trying to be — `new URL` has already refused the forbidden
 * code points, and the DNS rules about length and digits are not what goes wrong here. these
 * are the three shapes that survive a parse while being unreachable.
 *
 * an IPv6 literal passes on the label rule by construction: `url.hostname` hands it back
 * bracketed and undotted, so it is one non-empty label with no hyphen at either edge.
 */
function isSendableHost(url: URL): boolean {
	if (url.port === '0') return false;
	return url.hostname
		.split('.')
		.every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'));
}

function isLoopbackHttp(url: URL): boolean {
	return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(url.hostname);
}

/**
 * the host name inside one origin, or `null` where there is no host to read.
 *
 * the reader every surface that draws a site list uses. the console's binary takes the same host
 * out of the same origin for the domains a Turnstile widget is created and levelled with, in go
 * (`Hosts` in `packages/console/internal/widget`); this is beside the rules above because the host
 * it takes is only ever taken out of a line those rules accepted, and the two must keep agreeing —
 * a host read one way here and another there is a widget covering a site the deployment serves
 * under a different name.
 *
 * `hostname` and not `host`, so the port comes off with the scheme. an origin may carry one —
 * `https://give.example.org:8443` is stored with it — and nothing that takes a host name takes a
 * port on the end of it.
 *
 * it reads a stored origin rather than a typed row, so nothing is repaired on the way: `null`
 * rather than a throw, because a value with no host in it is not an error to this reader — it is a
 * row a list may still be carrying, and a list is what {@link hostsOf} is handed.
 */
export function hostOf(origin: string): string | null {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return null;
	}
	return url.hostname === '' ? null : url.hostname;
}

/**
 * the host names a list of stored origins covers, in the list's own order and without repeats.
 *
 * a row with no host in it is dropped rather than passed through: it is called on the boxes as they
 * were typed, and a row an operator added and never filled in is a value with no host in it.
 *
 * the repeats come out even though {@link siteKey} is what makes a list holding two of them
 * refusable: this takes whatever list it is handed — a stored one, a form's ticked subset — and a
 * widget carrying one host twice is a list Cloudflare and this repository would describe
 * differently.
 */
export function hostsOf(origins: readonly string[]): string[] {
	const hosts = origins.map((origin) => hostOf(origin)).filter((host) => host !== null);
	return [...new Set(hosts)];
}
