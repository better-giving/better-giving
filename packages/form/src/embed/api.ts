// the deployment's own write, and the sentences a refused one puts on a card.
//
// `POST /api/v1/forms/:id/donations` is the one call a press spends, and the two surfaces that
// render this flow both spend it: the embedded element through ./runtime.ts, and the deployment's
// own donation page, which renders the same machine in react. this module is what those two share
// rather than each holding a copy — the words below are what a donor reads when their gift did not
// start, and two copies of them are two wordings of one money-path refusal, drifting apart with
// nothing failing.
//
// the config read is not here. `GET /api/v1/forms/:id/config` is ./runtime.ts's, because only the
// embed makes it: the deployment's own page has the config server-side before it renders anything.
// the read of a gift paid to an address is here, because both surfaces make it from the donor's
// browser while the address screen stands.
//
// nor is this reachable through ./runtime.ts, which is why the split is a module and not an
// export. that file imports `defineDonateForm` and reads its own script tag, so importing it from a
// page that renders no custom element would register the tag and install the embed's boot. this
// module imports no element, no payment SDK and no DOM global — `fetch`, `Response` and the four
// helpers below are the whole of it.
//
// `../../package.json` exports it as `./embed/api` for that second surface, and for nothing else:
// a host page pasting the snippet reaches this through ./runtime.ts and never by name.

import type { CheckoutPorts } from '../ports';
import type { DonationStatus } from '../v1';
import { LOADER_PATH } from './loader';

/** the write one press makes. `v1` is permanent, so this path is too. */
export function quoteUrl(origin: string, formId: string): string {
	return `${origin}/api/v1/forms/${encodeURIComponent(formId)}/donations`;
}

/**
 * a stop a card can render.
 *
 * `message` is the sentence and `fix` names what to change. both are read by `describe` in
 * ../element.ts and by `toFailure` in ../checkout.machine.ts, which duck-type exactly this shape —
 * a rejection carrying neither becomes "This donation form could not be loaded." and strands
 * whoever is looking at it.
 */
export class EmbedFailure extends Error {
	readonly fix: string;
	/**
	 * the `error` an api refusal carried (`API_ERROR_CODES` in ../v1.ts), where it carried one.
	 *
	 * read by `errorCode` in ../checkout.machine.ts for the refusal whose screen the words cannot
	 * pick, and by nothing else.
	 */
	readonly code?: string;
	/**
	 * the request left and no answer came back, so the endpoint may have acted on it.
	 *
	 * read by `wentUnanswered` in ../checkout.machine.ts, which keeps a fund's approval for a resend
	 * where this is set, since the grant may already exist.
	 */
	readonly unanswered?: true;
	/** the least gift the coin takes, where a `below_minimum` refusal named it (`ApiError` in ../v1.ts). */
	readonly minAmountMinor?: number;

	constructor(
		message: string,
		fix: string,
		code?: string,
		unanswered?: true,
		minAmountMinor?: number
	) {
		super(message);
		this.name = 'EmbedFailure';
		this.fix = fix;
		if (code !== undefined) this.code = code;
		if (unanswered !== undefined) this.unanswered = unanswered;
		if (minAmountMinor !== undefined) this.minAmountMinor = minAmountMinor;
	}
}

/**
 * how much of an api's own sentence is carried onto the card.
 *
 * the api is this deployment and its words are trusted to be words — ../views.ts builds every one
 * of these with `createTextNode`, so there is no markup path — but a misconfigured deployment can
 * still answer with a body of arbitrary length, and the card has a donor in front of it.
 */
const MAX_API_SENTENCE = 400;

export function clamp(sentence: string): string {
	return sentence.length <= MAX_API_SENTENCE
		? sentence
		: `${sentence.slice(0, MAX_API_SENTENCE - 1)}…`;
}

/** the `error` code an api error carries, where it carries one. */
function apiCode(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const { error } = body as { error?: unknown };
	return typeof error === 'string' && error.length > 0 ? error : undefined;
}

/** the floor a `below_minimum` refusal named, where it is a whole count of minor units. */
function apiMinAmountMinor(body: unknown): number | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const { minAmountMinor } = body as { minAmountMinor?: unknown };
	return Number.isSafeInteger(minAmountMinor) && (minAmountMinor as number) >= 0
		? (minAmountMinor as number)
		: undefined;
}

/** the sentence and the fix an api error carries, where it carries them. */
export function apiWords(body: unknown): { message: string; fix?: string } | null {
	if (typeof body !== 'object' || body === null) return null;
	const named = body as { message?: unknown; fix?: unknown };
	if (typeof named.message !== 'string' || named.message.length === 0) return null;
	return typeof named.fix === 'string' && named.fix.length > 0
		? { message: clamp(named.message), fix: clamp(named.fix) }
		: { message: clamp(named.message) };
}

/**
 * a body that parsed, distinguished from one that did not.
 *
 * `null` is a valid json document, so a bare `unknown` cannot tell "the deployment answered null"
 * from "the deployment answered html" — and those two want different sentences on the card.
 */
export type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export async function readJson(response: Response): Promise<Parsed> {
	try {
		return { ok: true, value: await response.json() };
	} catch {
		return { ok: false };
	}
}

/**
 * what a donor is told when a press did not become a quote.
 *
 * it states that nothing was charged, and that is the sentence rather than a tidier one because
 * this port runs before anything is confirmed: every failure here is an attempt that never reached
 * a card, and a donor who is not told so will reasonably assume it did and try again somewhere else.
 */
const UNCHARGED = 'This donation could not be started, and nothing was charged.';

/**
 * the port one press spends: `POST /api/v1/forms/:id/donations`.
 *
 * it returns the parsed body and nothing more, exactly as `createLoadConfig` in ./runtime.ts
 * does. what is required of a quote is checked by `quoteIsUsable` in ../fee.ts before any screen
 * states a number from it, because this response is untrusted JSON reaching code that runs on a
 * stranger's page — and a second, weaker check here would be a second place for the two to
 * disagree.
 *
 * not aborted by a signal, unlike the config read. this call mints a payment intent at the
 * processor, so a caller that walked away from the answer would leave one behind with nothing
 * holding the token it returned; the machine owns the timeout for it instead
 * (`CheckoutPorts.quote` in ../ports.ts).
 *
 * `credentials: 'omit'` for the reason the read has it: this surface is unauthenticated by design,
 * so sending a cookie would be sending a credential to an endpoint with nothing to do with one.
 */
export function createQuote(origin: string | null): CheckoutPorts['quote'] {
	return async (request) => {
		if (origin === null) {
			throw new EmbedFailure(
				UNCHARGED,
				`The embedded runtime could not tell which deployment it was served from, so it has nowhere to send this gift. Load it through ${LOADER_PATH} on the deployment that hosts the form.`
			);
		}
		const url = quoteUrl(origin, request.formId);

		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				credentials: 'omit',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(request)
			});
		} catch {
			throw new EmbedFailure(
				UNCHARGED,
				`POST ${url} could not be reached from this page. The form is embedded on another origin, so check that this deployment serves that route and answers this page's origin with an Access-Control-Allow-Origin header — a request refused by the browser reports no status here.`,
				undefined,
				true
			);
		}

		if (!response.ok) {
			const parsed = await readJson(response);
			const words = parsed.ok ? apiWords(parsed.value) : null;
			throw new EmbedFailure(
				words?.message ?? UNCHARGED,
				words?.fix ?? `POST ${url} answered ${response.status}.`,
				parsed.ok ? apiCode(parsed.value) : undefined,
				undefined,
				parsed.ok ? apiMinAmountMinor(parsed.value) : undefined
			);
		}

		const parsed = await readJson(response);
		if (!parsed.ok) {
			throw new EmbedFailure(
				UNCHARGED,
				`POST ${url} answered ${response.status} with a body that is not JSON.`
			);
		}
		return parsed.value as Awaited<ReturnType<CheckoutPorts['quote']>>;
	};
}

/** where a gift paid to an address stands. `v1` is permanent, so this path is too. */
export function statusUrl(origin: string, formId: string, donationId: string): string {
	return `${origin}/api/v1/forms/${encodeURIComponent(formId)}/donations/${encodeURIComponent(donationId)}`;
}

/**
 * the port the address screen reads on a timer: `GET /api/v1/forms/:id/donations/:donationId`.
 *
 * every way it can fail is a rejection and none of them is worded, because none reaches a donor:
 * the flow answers a rejection by reading again (`awaitingDeposit` in ../checkout.machine.ts), and a
 * sentence here would be a refusal nobody is shown. the body is handed back unread for `createQuote`'s
 * reason — the machine is what decides whether it names a state.
 *
 * `credentials: 'omit'` for `createQuote`'s reason.
 */
export function createStatusRead(origin: string | null): CheckoutPorts['status'] {
	return async ({ formId, paymentToken }) => {
		if (origin === null) {
			throw new Error('the embedded runtime could not tell which deployment it was served from');
		}
		const url = statusUrl(origin, formId, paymentToken);
		const response = await fetch(url, {
			credentials: 'omit',
			headers: { accept: 'application/json' }
		});
		if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
		const parsed = await readJson(response);
		if (!parsed.ok) throw new Error(`GET ${url} answered a body that is not JSON`);
		return parsed.value as DonationStatus;
	};
}
