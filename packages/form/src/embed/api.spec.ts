import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createEmployerWrite,
	createEstimateRead,
	createPledgeTold,
	createQuote,
	createStatusRead,
	createTickerRead
} from './api';

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

describe('the employer write the thank-you makes', () => {
	const write = {
		formId: 'frm_a8x2k9',
		giftToken: '7Qk3-mVx9Lr2NpA4',
		employer: 'Northwind Logistics'
	};
	const open = new AbortController().signal;

	it('posts the employer to the gift on the deployment, as json and with no credential', async () => {
		const fetched = stubFetch(json({ ok: true }));

		await expect(createEmployerWrite(DEPLOYMENT)(write, open)).resolves.toBeUndefined();
		expect(fetched).toHaveBeenCalledWith(
			'https://donate.example/api/v1/forms/frm_a8x2k9/gifts/7Qk3-mVx9Lr2NpA4/employer',
			expect.objectContaining({
				method: 'POST',
				credentials: 'omit',
				headers: expect.objectContaining({ 'content-type': 'application/json' }),
				body: JSON.stringify({ employer: 'Northwind Logistics' })
			})
		);
	});

	it('sends the write on the signal it is handed, so the flow can call it off', async () => {
		// a Skip or a timeout aborts it (`CheckoutPorts.employer` in ../ports.ts): the endpoint saves
		// and mails on arrival, so a request left running does both behind the card.
		const fetched = stubFetch(json({ ok: true }));
		const leaving = new AbortController();
		await createEmployerWrite(DEPLOYMENT)(write, leaving.signal);
		expect(fetched).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ signal: leaving.signal })
		);
	});

	// the donor's text is theirs: a refusal names the address and the status and never what was sent.
	it.each([
		['a refusal', () => json({ error: 'gift_not_found', message: 'No such gift.' }, 404)],
		['a success that is not ours', () => json({ ok: false })],
		['a body that is not JSON', () => new Response('<html>', { status: 200 })]
	])('refuses %s without repeating the employer', async (_case, response) => {
		stubFetch(response());
		const refused = await refusal(createEmployerWrite(DEPLOYMENT)(write, open));
		expect(refused.message).not.toContain('Northwind');
	});

	it('refuses a request the browser would not send', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
		);
		await expect(createEmployerWrite(DEPLOYMENT)(write, open)).rejects.toThrow('Failed to fetch');
	});

	it('refuses where the runtime could not tell which deployment served it, and sends nothing', async () => {
		const fetched = stubFetch(json({ ok: true }));
		await expect(createEmployerWrite(null)(write, open)).rejects.toThrow(
			'could not tell which deployment it was served from'
		);
		expect(fetched).not.toHaveBeenCalled();
	});
});

describe('a pledge’s save and its told press', () => {
	// the box the endpoint refused is what puts the donor back on it rather than on the failure screen.
	it('carries the box a pledge’s refusal names', async () => {
		stubFetch(
			json(
				{
					error: 'pledge_detail_invalid',
					message: 'Enter the custodian holding your IRA.',
					field: 'custodian'
				},
				422
			)
		);

		const failure = await refusal(
			createQuote(DEPLOYMENT)({ ...SUBMISSION, method: 'ira_qcd', pledgeId: 'p1', custodian: '' })
		);

		expect(failure).toMatchObject({ code: 'pledge_detail_invalid', field: 'custodian' });
	});

	it('posts the told press to the pledge on the deployment, with no body and no credential', async () => {
		const fetched = stubFetch(json({ ok: true }));

		await expect(
			createPledgeTold(DEPLOYMENT)({ formId: 'frm_a8x2k9', pledgeId: 'p 1' })
		).resolves.toBeUndefined();
		expect(fetched).toHaveBeenCalledWith(
			'https://donate.example/api/v1/forms/frm_a8x2k9/donations/p%201/told',
			expect.objectContaining({ method: 'POST', credentials: 'omit' })
		);
		const init = fetched.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init).toBeDefined();
		expect(init?.body).toBeUndefined();
	});

	it.each([
		['a refusal', () => json({ error: 'pledge_not_found', message: 'No such pledge.' }, 404)],
		['a success that is not ours', () => json({ ok: false })],
		['a body that is not JSON', () => new Response('<html>', { status: 200 })]
	])('refuses %s', async (_case, response) => {
		stubFetch(response());
		await expect(
			createPledgeTold(DEPLOYMENT)({ formId: 'frm_a8x2k9', pledgeId: 'p1' })
		).rejects.toThrow('/told');
	});

	// the code is what makes the next press save the pledge again before it tells (`pledgeIsLost` in
	// ../checkout.machine.ts).
	it('carries the endpoint’s own code with a told refusal', async () => {
		stubFetch(json({ error: 'pledge_not_found', message: 'No such pledge.' }, 404));

		const failure = await refusal(
			createPledgeTold(DEPLOYMENT)({ formId: 'frm_a8x2k9', pledgeId: 'p1' })
		);

		expect((failure as { code?: string }).code).toBe('pledge_not_found');
	});

	it('refuses a told refusal whose body is not JSON, with no code', async () => {
		stubFetch(new Response('<html>', { status: 502 }));

		const failure = await refusal(
			createPledgeTold(DEPLOYMENT)({ formId: 'frm_a8x2k9', pledgeId: 'p1' })
		);

		expect(failure.message).toContain('502');
		expect((failure as { code?: string }).code).toBeUndefined();
	});
});

describe('the estimate a coin amount is priced at', () => {
	const read = () =>
		createEstimateRead(DEPLOYMENT)(
			{ formId: 'frm a', coin: 'usdttrc20', amount: '0.005' },
			new AbortController().signal
		);

	it('asks for the coin and the amount, credentials left out, and answers the minor units', async () => {
		const fetched = stubFetch(json({ estimateMinor: 48_210 }));

		expect(await read()).toBe(48_210);
		expect(fetched).toHaveBeenCalledWith(
			'https://donate.example/api/v1/forms/frm%20a/estimate?coin=usdttrc20&amount=0.005',
			expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) })
		);
	});

	it('answers null where the deployment cannot price it, or answers something else', async () => {
		stubFetch(json({ estimateMinor: null }));
		expect(await read()).toBeNull();
		stubFetch(json({ estimateMinor: 12.5 }));
		expect(await read()).toBeNull();
	});

	it('refuses an answer that is not a 200', async () => {
		stubFetch(json({ error: 'not_found' }, 404));
		await expect(read()).rejects.toThrow('404');
	});
});

describe('the ticker search the stock group makes', () => {
	const read = (query: string) =>
		createTickerRead(DEPLOYMENT, 'frm a')(query, new AbortController().signal);

	it('asks for the typed text and answers the listed rows', async () => {
		const fetched = stubFetch(
			json([
				{ symbol: 'AAPL', name: 'Apple Inc.' },
				{ symbol: 'VFIAX', name: null }
			])
		);

		expect(await read('a&b')).toEqual([
			{ symbol: 'AAPL', name: 'Apple Inc.' },
			{ symbol: 'VFIAX', name: null }
		]);
		expect(fetched).toHaveBeenCalledWith(
			'https://donate.example/api/v1/forms/frm%20a/tickers?q=a%26b',
			expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) })
		);
	});

	it('drops a row that is not one, and refuses an answer that is not a list', async () => {
		stubFetch(json([{ symbol: 'AAPL', name: 'Apple Inc.' }, { symbol: 7 }, null]));
		expect(await read('aa')).toEqual([{ symbol: 'AAPL', name: 'Apple Inc.' }]);

		stubFetch(json({ rows: [] }));
		await expect(read('aa')).rejects.toThrow();
	});
});
