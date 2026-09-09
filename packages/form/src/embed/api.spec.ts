import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuote } from './api';

// the write both surfaces spend, asserted where it lives rather than through either of them.
//
// these cases followed `createQuote` out of ./runtime.dom.spec.ts, which keeps the one case that
// is genuinely that file's: the composed port the element is handed, where the answer passes
// through ./stripe.ts's surface on its way back. everything below is this module's own — the url,
// the request, and the four ways a refusal is worded — and none of it touches a document, which is
// why this is a node-pool spec and that one is not.

const DEPLOYMENT = 'https://donate.example';

/** what one press sends, as `QuoteRequest` in ../v1.ts shapes it. */
const SUBMISSION = {
	formId: 'frm_a8x2k9',
	amountMinor: 2500,
	frequency: 'one_time',
	method: 'card',
	coversFee: false,
	email: 'donor@example.org',
	firstName: 'Ada',
	lastName: 'Lovelace',
	consentedToContact: false,
	turnstileToken: 'tok'
} as const;

type Refusal = { readonly message: string; readonly fix?: string };

/**
 * how a call refused, as the flow reads a refusal: a sentence and a fix.
 *
 * a call that resolves is the failure this asserts against, so it is turned into one rather than
 * left to a later expectation that would read as a missing property.
 */
async function refusal(work: Promise<unknown>): Promise<Refusal> {
	try {
		await work;
	} catch (error) {
		return error as Refusal;
	}
	throw new Error('the call answered instead of refusing');
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
	const fetched = vi.fn(async () => response);
	vi.stubGlobal('fetch', fetched);
	return fetched;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('minting a quote', () => {
	it('posts the submission to the deployment, not to the page it is embedded in', async () => {
		const fetched = stubFetch(json({ paymentToken: 'pi_secret', feeMinor: 0, totalMinor: 2500 }));

		await createQuote(DEPLOYMENT)(SUBMISSION);

		expect(fetched.mock.calls[0]?.[0]).toBe(`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/donations`);
		const init = fetched.mock.calls[0]?.[1] as RequestInit;
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('omit');
		expect(JSON.parse(String(init.body))).toMatchObject({
			amountMinor: 2500,
			turnstileToken: 'tok'
		});
	});

	it('sends the content type the endpoint’s preflight grants', async () => {
		const fetched = stubFetch(json({ paymentToken: 'pi_secret', feeMinor: 0, totalMinor: 2500 }));

		await createQuote(DEPLOYMENT)(SUBMISSION);

		const headers = (fetched.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
		expect(headers['content-type']).toBe('application/json');
	});

	it('hands the body back without inspecting it', async () => {
		stubFetch(json({ paymentToken: 'pi_secret', feeMinor: 41, totalMinor: 2541 }));

		// what a quote has to be is `quoteIsUsable`'s in ../fee.ts, checked before the confirm
		// screen states a number from it. a second, weaker check here is a second place to disagree.
		await expect(createQuote(DEPLOYMENT)(SUBMISSION)).resolves.toEqual({
			paymentToken: 'pi_secret',
			feeMinor: 41,
			totalMinor: 2541
		});
	});

	it('carries the endpoint’s own sentence and fix onto the card', async () => {
		stubFetch(
			json(
				{
					error: 'challenge_failed',
					message: 'Cloudflare did not accept this Turnstile token.',
					fix: 'Reset the widget and send the token it produces next.'
				},
				403
			)
		);

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		expect(failure.message).toContain('Turnstile');
		expect(failure.fix).toContain('Reset the widget');
	});

	it('says nothing was charged when the endpoint answers no sentence at all', async () => {
		stubFetch(new Response('<html>502</html>', { status: 502 }));

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		// a donor who is not told this will reasonably assume the card was taken and try elsewhere.
		expect(failure.message).toContain('nothing was charged');
	});

	it('refuses a request the browser would not send at all', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		expect(failure.message).toContain('nothing was charged');
		expect(failure.fix).toContain('Access-Control-Allow-Origin');
	});

	it('refuses a 200 whose body is not JSON', async () => {
		stubFetch(new Response('thanks!', { status: 200 }));

		expect((await refusal(createQuote(DEPLOYMENT)(SUBMISSION))).fix).toContain('not JSON');
	});

	it('refuses when the runtime could not tell which deployment served it', async () => {
		const failure = await refusal(createQuote(null)(SUBMISSION));

		expect(failure.fix).toContain('/embed');
	});
});
