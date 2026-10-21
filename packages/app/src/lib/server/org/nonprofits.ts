import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import { z } from 'zod';
import type {
	NonprofitFields,
	NonprofitLookupAnswer,
	NonprofitSearchAnswer,
	NonprofitsRateLimited,
	NonprofitsUnavailable
} from '$lib/org/nonprofit-answers';

// Better Giving's nonprofit lookup over the IRS files, asked from the server for Settings' finder:
// the routes are ../../../routes/_app.admin.settings_.nonprofits.ts and its `nonprofits_.$ein`
// sibling, and what each answers is $lib/org/nonprofit-answers.ts. the service's endpoints,
// fields, errors and limits are its README, at https://nonprofits.better.giving.
//
// **the browser never calls the service.** the key is the deployment's `NONPROFITS_API_KEY`, sent
// as `Authorization: Bearer` and never logged or answered. unset or blank, a call goes keyless, on
// the allowance of this server's own address: a request a minute and 25 a UTC day, against 10 and
// 50 with a key. each read here is one call, made only when the deployer asked for it.
//
// **nothing here throws.** the finder never holds the organisation form, so a service that is down,
// a refusal and a body this module cannot read each leave as an outcome: `rate_limited` with the
// service's `Retry-After`, `not_found` for an EIN the IRS files do not hold, and `unavailable` for
// anything else, which is logged by status and the service's `code` for the operator.

/** the service's origin. */
export const NONPROFITS_API_URL = 'https://nonprofits.better.giving';

/** the Country box for every organisation found: the IRS files list US organisations alone. */
const US_COUNTRY = 'United States';

const STANDING = {
	deductible: z.boolean().nullable(),
	revoked: z.boolean().nullable(),
	// a date `Date` cannot read is no date: Settings formats this one (`standingNote` in
	// $lib/admin/settings/nonprofit-finder.ts), and an invalid date throws while it renders.
	revocationDate: z
		.string()
		.nullable()
		.transform((on) => (on === null || Number.isNaN(Date.parse(on)) ? null : on))
};

/** the part of `GET /v1/orgs/{ein}`'s answer the details boxes take. */
const ORGANISATION = z.object({
	ein: z.string(),
	name: z.string().nullable(),
	address: z.object({
		street: z.string().nullable(),
		city: z.string().nullable(),
		state: z.string().nullable(),
		zip: z.string().nullable()
	}),
	...STANDING
});

/** the part of `GET /v1/search`'s answer a match is listed with. */
const SEARCH = z.object({
	results: z.array(
		z.object({
			ein: z.string(),
			name: z.string(),
			city: z.string().nullable(),
			state: z.string().nullable(),
			...STANDING
		})
	)
});

/** a refusal's body, RFC 9457 problem details with the service's `code`. */
const PROBLEM = z.object({ code: z.string() });

const UNAVAILABLE: NonprofitsUnavailable = { outcome: 'unavailable' };

type Asked =
	| { readonly ok: true; readonly body: unknown }
	| { readonly ok: false; readonly failure: Failure };

type Failure = NonprofitsRateLimited | NonprofitsUnavailable | { readonly outcome: 'not_found' };

/** words a title leaves lowercase, except as the first or last word. */
const TITLE_SMALL = new Set(['a', 'an', 'and', 'of', 'the', 'for', 'in', 'on', 'at', 'to']);

/** acronyms that stay in capitals. */
const TITLE_ACRONYMS = new Set(['YMCA', 'YWCA', 'USA', 'NAACP', 'PTA', 'UNICEF']);

/**
 * postal abbreviations of the states and the territories. a token keeps one in capitals only when
 * the previous word ends in a comma.
 */
const STATE_CODES = new Set([
	...'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO'.split(' '),
	...'MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP'.split(
		' '
	)
]);

/** whole words that match the Mac pattern and take ordinary title case. */
const MAC_ORDINARY = new Set(['MACHINE', 'MACE', 'MACRO']);

/** one letter-run with any punctuation only before or after it. */
const WRAPPED_LETTERS = /^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/;

/** a straight apostrophe or a curly one (U+2019). */
const APOSTROPHE = /['\u2019]/;

/**
 * an IRS name or place, which the files store in capitals, as a title.
 *
 * trim, split on whitespace. a code in `STATE_CODES` stays in capitals when the previous word
 * ends in a comma, even when that code is also in `TITLE_SMALL`. any other word in `TITLE_SMALL`
 * that is neither first nor last stays lowercase. a word stays in capitals when its letters are
 * in `TITLE_ACRONYMS`. an all-caps token whose letters are `MC` plus one or more letters
 * becomes `Mc` plus the remainder title-cased, and punctuation around those letters stays. an
 * all-caps token whose letters are `MAC` plus three or more letters becomes `Mac` plus the
 * remainder title-cased, except a word in `MAC_ORDINARY`. a token that contains `'` or `’` is
 * title-cased on each side of the apostrophe. an ampersand stays `&`. every other word is
 * lowercased and its first character capitalized.
 */
function titleCaseName(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => word !== '');
	return words
		.map((word, index) => {
			if (word === '&') return '&';
			const state = stateCode(word, words[index - 1]);
			if (state !== null) return state;
			const lower = word.toLowerCase();
			const edge = index === 0 || index === words.length - 1;
			if (!edge && TITLE_SMALL.has(lower)) return lower;
			const kept = acronym(word);
			if (kept !== null) return kept;
			const named = apostropheName(word) ?? mcName(word) ?? macName(word);
			if (named !== null) return named;
			return titleCaseWord(word);
		})
		.join(' ');
}

function titleCaseWord(token: string): string {
	const lower = token.toLowerCase();
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function wrappedLetters(token: string): [string, string, string] | null {
	const match = WRAPPED_LETTERS.exec(token);
	if (match === null) return null;
	return [match[1] ?? '', match[2] ?? '', match[3] ?? ''];
}

function capitalsWhenListed(token: string, list: ReadonlySet<string>): string | null {
	const wrapped = wrappedLetters(token);
	if (wrapped === null) return null;
	const [prefix, letters, suffix] = wrapped;
	const upper = letters.toUpperCase();
	if (!list.has(upper)) return null;
	return `${prefix}${upper}${suffix}`;
}

function stateCode(token: string, previous: string | undefined): string | null {
	if (previous === undefined || !previous.endsWith(',')) return null;
	return capitalsWhenListed(token, STATE_CODES);
}

function acronym(token: string): string | null {
	return capitalsWhenListed(token, TITLE_ACRONYMS);
}

function apostropheName(token: string): string | null {
	if (!APOSTROPHE.test(token)) return null;
	return token
		.split(/(['\u2019])/)
		.map((part) => (part === "'" || part === '\u2019' ? part : titleCaseWord(part)))
		.join('');
}

function mcName(token: string): string | null {
	const wrapped = wrappedLetters(token);
	if (wrapped === null) return null;
	const [prefix, letters, suffix] = wrapped;
	const rest = /^MC([A-Z]+)$/.exec(letters);
	if (rest === null) return null;
	return `${prefix}Mc${titleCaseWord(rest[1] ?? '')}${suffix}`;
}

function macName(token: string): string | null {
	const wrapped = wrappedLetters(token);
	if (wrapped === null) return null;
	const [prefix, letters, suffix] = wrapped;
	if (MAC_ORDINARY.has(letters)) return null;
	const rest = /^MAC([A-Z]{3,})$/.exec(letters);
	if (rest === null) return null;
	return `${prefix}Mac${titleCaseWord(rest[1] ?? '')}${suffix}`;
}

/** whole seconds, the form the service writes `Retry-After` in. */
const SECONDS = /^\d+$/;

/** how long a read waits on the service before it is `unavailable`. */
const TIMEOUT_MS = 10_000;

/** `path` asked of the service, with the deployment's `key` where it holds one. */
async function ask(path: string, key: string | undefined): Promise<Asked> {
	const bearer = key?.trim() ?? '';
	let response: Response;
	try {
		response = await fetch(`${NONPROFITS_API_URL}${path}`, {
			headers: {
				accept: 'application/json',
				...(bearer === '' ? {} : { authorization: `Bearer ${bearer}` })
			},
			// a `TimeoutError` out of `fetch` rather than a Settings fetcher left waiting.
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		console.warn(`the nonprofit lookup could not be reached: ${String(error)}`);
		return { ok: false, failure: UNAVAILABLE };
	}
	// an unreadable body is `undefined`, which no schema below takes.
	const body: unknown = await response.json().catch(() => undefined);
	if (response.ok) return { ok: true, body };

	const retryAfter = response.headers.get('retry-after')?.trim() ?? '';
	if (response.status === 429 && SECONDS.test(retryAfter)) {
		return { ok: false, failure: { outcome: 'rate_limited', retryAfter: Number(retryAfter) } };
	}
	const code = PROBLEM.safeParse(body).data?.code;
	if (response.status === 404 && code === 'not_found') {
		return { ok: false, failure: { outcome: 'not_found' } };
	}
	console.warn(`the nonprofit lookup answered HTTP ${response.status} (${code ?? 'no code'})`);
	return { ok: false, failure: UNAVAILABLE };
}

/** a 2xx body that is not the shape the service documents. */
function unreadable(path: string): NonprofitsUnavailable {
	console.warn(`the nonprofit lookup answered ${path} with a body this deployment cannot read`);
	return UNAVAILABLE;
}

/** one organisation by its EIN, nine digits with or without the dash. */
export async function lookUpNonprofit(
	ein: string,
	key: string | undefined
): Promise<NonprofitLookupAnswer> {
	const path = `/v1/orgs/${ein.replace('-', '')}`;
	const asked = await ask(path, key);
	if (!asked.ok) return { kind: 'lookup', ...asked.failure };
	const read = ORGANISATION.safeParse(asked.body);
	if (!read.success) return { kind: 'lookup', ...unreadable(path) };
	const org = read.data;
	const fields: NonprofitFields = {
		legal_name: titleCaseName(org.name ?? ''),
		tax_id: einAsPrinted(org.ein),
		address_line1: titleCaseName(org.address.street ?? ''),
		city: titleCaseName(org.address.city ?? ''),
		region: org.address.state ?? '',
		postal_code: org.address.zip ?? '',
		country: US_COUNTRY
	};
	return {
		kind: 'lookup',
		outcome: 'found',
		fields,
		deductible: org.deductible,
		revoked: org.revoked,
		revocationDate: org.revocationDate
	};
}

/** organisations whose names hold every word of `q`, best match first. */
export async function searchNonprofits(
	q: string,
	key: string | undefined
): Promise<NonprofitSearchAnswer> {
	const path = `/v1/search?${new URLSearchParams({ q })}`;
	const asked = await ask(path, key);
	// a search names no organisation to be missing, so its 404 is the service failing like any other.
	if (!asked.ok) {
		return {
			kind: 'search',
			...(asked.failure.outcome === 'not_found' ? UNAVAILABLE : asked.failure)
		};
	}
	const read = SEARCH.safeParse(asked.body);
	if (!read.success) return { kind: 'search', ...unreadable(path) };
	return {
		kind: 'search',
		outcome: 'found',
		matches: read.data.results.map((match) => ({
			ein: einAsPrinted(match.ein),
			name: titleCaseName(match.name),
			city: titleCaseName(match.city ?? ''),
			state: match.state ?? '',
			deductible: match.deductible,
			revoked: match.revoked,
			revocationDate: match.revocationDate
		}))
	};
}
