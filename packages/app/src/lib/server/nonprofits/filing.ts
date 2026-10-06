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
// without it. nothing is remembered between lookups and nothing is stored.
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

/** the latest filing of the organisation `taxId` names, or null where none answers. */
export async function lookUpFiling(
	taxId: string | null,
	api: string = API
): Promise<Filing | null> {
	const ein = taxId === null ? null : einOf(taxId);
	if (ein === null) return null;
	try {
		const body = await answerOf(`${api}/v1/orgs/${ein}`);
		if (body === null) return null;
		const read = upstreamOrganisation.safeParse(JSON.parse(body));
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
	} catch {
		return null;
	}
}

/** a 200's body, read whole within `WITHIN_MS` and `ANSWER_BYTES`; null for anything else. */
async function answerOf(url: string): Promise<string | null> {
	const signal = AbortSignal.timeout(WITHIN_MS);
	const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
	if (response.status !== 200 || response.body === null) {
		await response.body?.cancel();
		return null;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > ANSWER_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const whole = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		whole.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(whole);
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
