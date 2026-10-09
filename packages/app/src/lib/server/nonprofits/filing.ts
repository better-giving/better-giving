// the deployment's door to the IRS nonprofit API: its own stored EIN looked up for the latest
// filing's words, which a page's opening questions are built from (../pages/draft.ts). the console
// asks the same API for the legal identity, and packages/console/internal/nonprofits/nonprofits.go
// holds the other copy of `API`, the EIN rule and the upstream shape — the two change together.
//
// one fixed address, and nothing reads another: no env var, binding or record points a deployment
// elsewhere. a spec passes its own upstream as `api`.
//
// keyless: no key is sent and none is configured, so a lookup spends the small keyless allowance
// the API keeps per calling address (https://nonprofits.better.giving). a refusal of any code, a
// 429 included, is answered like any other failure below: no retry and no wait on `Retry-After`,
// because an opening waits on this lookup.
//
// only words are decoded — the mission, the activity, each program's description and the notes —
// and never a figure: a program's expense, grants or revenue and the filing's finances are left in
// the body unread, so none can reach a prompt and from there a page. each is one line of plain
// text, cut at its cap, the mission at the answer cap of the question it prefills.
//
// every failure answers null and none throws: no EIN or not one, no answer within `WITHIN_MS`, a
// status other than 200, a body past `ANSWER_BYTES`, one in a shape not decoded below, or one about
// another number or naming nobody. a lookup is context for an opening, and the opening goes on
// without it. `WITHIN_MS` runs from the request to the body's last byte. each failed lookup logs
// one warning saying why — the status and the problem body's `code`, or `timeout`, `network` or
// `shape` — and never the EIN; no EIN, no lookup and no warning.
//
// a found filing is held in the edge cache (`caches.default`) for `HELD_SECONDS`, an hour, under
// the EIN on the origin that asked, and a lookup reads it there before it asks the API: an opening
// and the answers to it share one lookup against a keyless allowance of one a minute. what is held
// is the `Filing` above and nothing more — public IRS words, no figure and no money — so this is
// the capability carve-out CLAUDE.md (Bans, Storage) makes for the served form config, and not the
// number cache it bans. nothing that found no filing is held, so the next lookup asks again. a
// filing is never written to the database. the store is per data centre and a miss is not a claim,
// so two openings that race share a lookup only where the first has put its filing, in the same
// data centre, before the second reads.
//
// the request goes out on the runtime's global `fetch`, and nothing here is built from a binding.
import { z } from 'zod';

/** where the IRS nonprofit API answers. */
export const API = 'https://nonprofits.better.giving';

/** the latest filing's words, each one line of plain text; an empty list where none were found. */
export type Filing = {
	mission: string | null;
	activity: string | null;
	programs: string[];
	notes: string[];
};

const text = z.string().nullable();

/**
 * `GET {API}/v1/orgs/{ein}`, as this deployment reads it; no other member is read. a fact the IRS
 * files do not hold is null, and a filing not on record is a null mission and activity and no
 * programs, with `notes` saying why.
 */
const upstreamOrganisation = z.object({
	ein: z.string(),
	name: text,
	mission: text,
	activitySummary: text,
	programs: z.array(z.object({ description: text })),
	notes: z.array(z.string())
});

/** the answer cap on "Your mission, in a sentence" in ../../page/questions.ts, which it prefills. */
const MISSION_MAX = 400;
const ACTIVITY_MAX = 1000;
const PROGRAM_MAX = 500;
const PROGRAMS_MAX = 3;
const NOTE_MAX = 200;
const NOTES_MAX = 5;

/** how long the API may take before it counts as not answering: an opening waits on it. */
const WITHIN_MS = 3000;

/** the most of one answer read, past which it is no answer: a lookup is one organisation. */
const ANSWER_BYTES = 256 * 1024;

/** how long a found filing is held at the edge, in seconds. */
const HELD_SECONDS = 3600;

/**
 * the address a filing is held under, on the request's own origin, with the EIN after it. a path
 * no route serves, for the reason ../forms/cadence-cache.ts's `CACHE_PATH` states.
 */
const CACHE_PATH = '/__irs-filing/';

/**
 * the latest filing of the organisation `taxId` names, or null where none answers. `origin` is the
 * origin the request arrived on, so a held filing sits in the zone that asked for it.
 */
export async function lookUpFiling(
	taxId: string | null,
	origin: string,
	api: string = API
): Promise<Filing | null> {
	const ein = taxId === null ? null : einOf(taxId);
	if (ein === null) return null;
	const cache = edgeCache();
	const key = new Request(new URL(CACHE_PATH + ein, origin));
	const held = cache === null ? null : await heldFiling(cache, key);
	if (held !== null) return held;
	const answer = await answerOf(`${api}/v1/orgs/${ein}`);
	const filing = answer.ok ? filingOf(answer.body, ein) : null;
	if (filing === null) {
		console.warn('the IRS nonprofit lookup answered nothing:', answer.ok ? 'shape' : answer.why);
		return null;
	}
	// a put that fails costs the next turn a second lookup, and nothing more.
	await cache
		?.put(
			key,
			new Response(JSON.stringify(filing), {
				headers: { 'content-type': 'application/json', 'cache-control': `max-age=${HELD_SECONDS}` }
			})
		)
		.catch(() => {});
	return filing;
}

/**
 * the platform's cache, or `null` where the runtime has none: the node spec pool runs on node,
 * which has no `caches`, and every lookup there asks the API.
 */
function edgeCache(): Cache | null {
	const store = (globalThis as { caches?: { default?: Cache } }).caches;
	return store?.default ?? null;
}

const heldShape = z.strictObject({
	mission: z.string().nullable(),
	activity: z.string().nullable(),
	programs: z.array(z.string()),
	notes: z.array(z.string())
});

/**
 * a held filing, or null for anything that is not one: the store is the zone's, so what comes back
 * under an address is whatever is there, and a body not in `Filing`'s shape is read past.
 */
async function heldFiling(cache: Cache, key: Request): Promise<Filing | null> {
	try {
		const hit = await cache.match(key);
		if (hit === undefined) return null;
		const read = heldShape.safeParse(await hit.json());
		return read.success ? read.data : null;
	} catch {
		return null;
	}
}

/** a 200's body as a filing about `ein`; null where it is not one. */
function filingOf(body: string, ein: string): Filing | null {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return null;
	}
	const read = upstreamOrganisation.safeParse(json);
	if (!read.success) return null;
	const { name, mission, activitySummary, programs, notes } = read.data;
	// an answer about another number, or about nobody, fills nothing.
	if (einOf(read.data.ein) !== ein || name === null || name.trim() === '') return null;
	return {
		mission: words(mission, MISSION_MAX),
		activity: words(activitySummary, ACTIVITY_MAX),
		programs: programs
			.flatMap(({ description }) => words(description, PROGRAM_MAX) ?? [])
			.slice(0, PROGRAMS_MAX),
		notes: notes.flatMap((note) => words(note, NOTE_MAX) ?? []).slice(0, NOTES_MAX)
	};
}

/**
 * a 200's body, read whole; otherwise why there is none: the status and the problem body's `code`
 * where it has one, `timeout` past `WITHIN_MS`, `network` where no answer came, and `shape` for a
 * 200 with no body or one past `ANSWER_BYTES`.
 */
async function answerOf(
	url: string
): Promise<{ ok: true; body: string } | { ok: false; why: string }> {
	const signal = AbortSignal.timeout(WITHIN_MS);
	try {
		const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
		const body = await bodyOf(response, signal);
		if (response.status !== 200) {
			const code = body === null ? null : problemCode(body);
			return {
				ok: false,
				why: code === null ? `${response.status}` : `${response.status} ${code}`
			};
		}
		return body === null ? { ok: false, why: 'shape' } : { ok: true, body };
	} catch {
		return { ok: false, why: signal.aborted ? 'timeout' : 'network' };
	}
}

/** `response`'s body within `ANSWER_BYTES`, cancelled when `signal` aborts; null past it or for none. */
async function bodyOf(response: Response, signal: AbortSignal): Promise<string | null> {
	if (response.body === null) return null;
	const reader = response.body.getReader();
	// the runtime's `fetch` decides whether its signal reaches a body already streaming; this does.
	const cancel = () => void reader.cancel(signal.reason).catch(() => {});
	signal.addEventListener('abort', cancel, { once: true });
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > ANSWER_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		signal.removeEventListener('abort', cancel);
	}
	const whole = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		whole.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(whole);
}

const problem = z.object({ code: z.string().regex(/^[a-z0-9_]{1,64}$/) });

/** an RFC 9457 refusal's `code`, the API's stable name for why; null where the body holds none. */
function problemCode(body: string): string | null {
	try {
		const read = problem.safeParse(JSON.parse(body));
		return read.success ? read.data.code : null;
	} catch {
		return null;
	}
}

/**
 * `said` as one line of text: a control character that is space is a space and any other is
 * dropped, every run of space is one, and it is cut at `max`. null where no words are left.
 */
function words(said: string | null, max: number): string | null {
	if (said === null) return null;
	const line = said
		.replace(/\p{Cc}/gu, (control) => (/\s/.test(control) ? ' ' : ''))
		.replace(/\s+/g, ' ')
		.trim();
	// a cut through a surrogate pair would leave half a character.
	const cut = line.slice(0, /[\uD800-\uDBFF]/.test(line[max - 1] ?? '') ? max - 1 : max).trim();
	return cut === '' ? null : cut;
}

function einOf(typed: string): string | null {
	let ein = typed.trim();
	if (ein.length === 10 && ein[2] === '-') ein = ein.slice(0, 2) + ein.slice(3);
	return /^\d{9}$/.test(ein) ? ein : null;
}
