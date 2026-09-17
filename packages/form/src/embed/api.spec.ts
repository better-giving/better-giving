import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuote, createStatusRead } from './api';

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

	// the code is what a flow switches on where the words cannot say which screen: an expired fund
	// approval is answered by opening the fund's window again rather than by the endpoint's sentence.
	it('carries the endpoint’s own code with the refusal', async () => {
		stubFetch(
			json(
				{
					error: 'daf_authorization_expired',
					message: 'Grant session wfs_1 is past its window.',
					fix: 'Open the fund window again.'
				},
				409
			)
		);

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		expect((failure as { code?: string }).code).toBe('daf_authorization_expired');
	});

	// the floor is what a crypto screen offers the donor instead of the amount they typed.
	it('carries the floor the processor named with a below-minimum refusal', async () => {
		stubFetch(
			json(
				{
					error: 'below_minimum',
					message: 'Bitcoin takes gifts of at least $12.34.',
					fix: 'Raise amountMinor to 1234 or pick another coin.',
					minAmountMinor: 1234
				},
				422
			)
		);

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		expect((failure as { minAmountMinor?: number }).minAmountMinor).toBe(1234);
	});

	it.each([
		['a fraction', 12.5],
		['negative', -1],
		['text', '1234'],
		['null', null]
	])('leaves out a floor that is %s', async (_, minAmountMinor) => {
		stubFetch(
			json(
				{
					error: 'below_minimum',
					message: 'Bitcoin takes larger gifts.',
					fix: 'Raise amountMinor or pick another coin.',
					minAmountMinor
				},
				422
			)
		);

		const failure = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));

		expect((failure as { minAmountMinor?: number }).minAmountMinor).toBeUndefined();
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

	// a fund's approval is sent again only where the endpoint may have acted without its answer
	// arriving, and an answer that arrived — however garbled — is not that.
	it('marks a request that heard nothing back, and only that one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		const unreached = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));
		expect((unreached as { unanswered?: boolean }).unanswered).toBe(true);

		stubFetch(new Response('<html>502</html>', { status: 502 }));
		const answered = await refusal(createQuote(DEPLOYMENT)(SUBMISSION));
		expect((answered as { unanswered?: boolean }).unanswered).toBeUndefined();
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

describe('the read the address screen makes', () => {
	const read = { formId: 'frm_a8x2k9', paymentToken: 'don_01J8Z' };

	it('reads the gift off the deployment by its donation id, with no credential', async () => {
		const fetched = stubFetch(json({ state: 'waiting' }));

		expect(await createStatusRead(DEPLOYMENT)(read)).toEqual({ state: 'waiting' });
		expect(fetched).toHaveBeenCalledWith(
			'https://donate.example/api/v1/forms/frm_a8x2k9/donations/don_01J8Z',
			expect.objectContaining({ credentials: 'omit' })
		);
	});

	// every way the read fails is a reading nobody has, which the flow answers by reading again.
	it.each([
		['an answer that is not a success', () => json({ message: 'not found' }, 404)],
		['a body that is not JSON', () => new Response('<html>', { status: 200 })]
	])('refuses %s', async (_case, response) => {
		stubFetch(response());
		await expect(createStatusRead(DEPLOYMENT)(read)).rejects.toBeDefined();
	});

	it('refuses where the runtime could not tell which deployment served it', async () => {
		await expect(createStatusRead(null)(read)).rejects.toBeDefined();
	});
});
