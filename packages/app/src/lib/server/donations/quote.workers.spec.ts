import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TurnstileCheck, TurnstileResult } from '../api/turnstile';
import { createDb, type Db } from '../db/client';
import { contact, donation, entryGroup, lineItem, payment } from '../db/schema';
import type {
	Intent,
	PaymentFailureReason,
	PaymentProvider,
	PaymentResult,
	RecurringGift
} from '../payments/provider';
import { mintQuote, refusalCode, type QuoteDeps } from './quote';

// the whole quote path, against a real D1 and against every arm of the two ports it reaches
// through.
//
// the database is real because the answer is decided from rows — the form's bounds, its rails, its
// allowed origins, the fund a line posts to — and a case that stood in for them would be proving
// the stand-in (CLAUDE.md). the payment port and the challenge check are injected, which is the
// seam ../payments/stripe.spec.ts takes one level lower: both are outbound HTTP, and a spec that
// reached either would pass or fail on somebody else's uptime.
//
// what is deliberately not here: which status each refusal answers with, and who may read it.
// those are the route's own two decisions and they are asserted in
// src/routes/api.v1.forms.$id.donations.workers.spec.ts.

const FORM_ID = 'frm_quotepath000001';
const ALLOWED = 'https://acme.org';

const STRIPE_ENV = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc',
	TURNSTILE_SECRET_KEY: '0xSECRET'
};

let db: Db;
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from line_item').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from contact').run();
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from org_profile').run();
	await seedForm();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.', 0, 0)`
	).run();
});

async function seedForm(over: { status?: string } = {}): Promise<void> {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', ?, ?, 'USD', 500, 1000000, '[2500,5000]', ?, 0, 0)`
	)
		.bind(FORM_ID, over.status ?? 'live', revenueAccountId, JSON.stringify([ALLOWED]))
		.run();
}

/** a payment port that answers from a script and remembers what it was asked. */
function provider(
	answers: readonly PaymentResult<Intent>[] = [],
	commitments: readonly PaymentResult<RecurringGift>[] = []
) {
	const remaining = [...answers];
	const remainingCommitments = [...commitments];
	const requests: Parameters<PaymentProvider['createIntent']>[0][] = [];
	const gifts: Parameters<PaymentProvider['createRecurringGift']>[0][] = [];
	const port: PaymentProvider = {
		async createIntent(request) {
			requests.push(request);
			return (
				remaining.shift() ?? {
					ok: true,
					value: {
						providerTxnId: `pi_${requests.length}`,
						paymentToken: `pi_secret_${requests.length}`
					}
				}
			);
		},
		async verifyEvent() {
			throw new Error('verifyEvent is not part of the quote path');
		},
		async readSettlement() {
			throw new Error('readSettlement is not part of the quote path');
		},
		async readRecurringGift() {
			throw new Error('readRecurringGift is not part of the quote path');
		},
		async readAccountChargeability() {
			// on the quote path for the reason `readRecurringGiftProvision` below is: which rails a
			// donor may pick is read off the account rather than off the row
			// (`$lib/server/forms/offered-rails.ts`), so a port that refused this would widen the
			// served list to the deployment's own and prove nothing about either.
			return {
				ok: true,
				value: { chargesEnabled: true, cardPayments: 'active', achPayments: 'active' }
			} as const;
		},
		async prepareRecurringGifts() {
			throw new Error('prepareRecurringGifts is not part of the quote path');
		},
		async readRecurringGiftProvision() {
			// the read arm is on the quote path: what a donor is offered is read off the account rather
			// than off the row (`$lib/server/forms/offered-cadences.ts`), so it answers on every mint
			// and a stub that threw would take the recurring cases below down. `ready` so the served
			// config offers every cadence, which is what those cases are written against — a refusal
			// would narrow the served list without refusing any of them, since `parseQuoteRequest` in
			// ./quote-input.ts reads the cadence vocabulary whole. the write arm above still throws,
			// which is what pins that nothing here provisions an account.
			return { ok: true, value: 'ready' } as const;
		},
		async createRecurringGift(request) {
			gifts.push(request);
			return (
				remainingCommitments.shift() ?? {
					ok: true,
					value: {
						providerGiftId: `sub_${gifts.length}`,
						providerCustomerId: `cus_${gifts.length}`,
						state: 'pending',
						paymentToken: `sub_secret_${gifts.length}`,
						startedAt: new Date(1_700_000_000_000)
					}
				}
			);
		},
		async cancelRecurringGift() {
			throw new Error('cancelRecurringGift is not part of the quote path');
		},
		async readRailSwitchboard() {
			// the operator's own switches, read alongside the approvals above: `readRailChargeability`
			// in `$lib/server/payments/rail-chargeability.ts` issues both and reports a rail as
			// chargeable only where they agree.
			return {
				ok: true,
				value: {
					card: { offered: true, switchedOn: true },
					ach: { offered: true, switchedOn: true },
					apple_pay: { offered: false, switchedOn: false },
					google_pay: { offered: false, switchedOn: false }
				}
			} as const;
		},
		async listWebhookEndpoints() {
			throw new Error('listWebhookEndpoints is not part of the quote path');
		},
		async registerWebhookEndpoint() {
			throw new Error('registerWebhookEndpoint is not part of the quote path');
		},
		async resubscribeWebhookEndpoint() {
			throw new Error('resubscribeWebhookEndpoint is not part of the quote path');
		},
		async replaceWebhookEndpoint() {
			throw new Error('replaceWebhookEndpoint is not part of the quote path');
		},
		async listWalletDomains() {
			throw new Error('listWalletDomains is not part of the quote path');
		},
		async registerWalletDomain() {
			throw new Error('registerWalletDomain is not part of the quote path');
		}
	};
	return { port, requests, gifts };
}

/** a challenge check that answers as scripted, and records what it was handed. */
function challenge(result: TurnstileResult = { ok: true }) {
	const checks: TurnstileCheck[] = [];
	const verify = async (check: TurnstileCheck): Promise<TurnstileResult> => {
		checks.push(check);
		return result;
	};
	return { verify, checks };
}

const request = (origin: string | null = ALLOWED): Request =>
	new Request(`https://give.example.workers.dev/api/v1/forms/${FORM_ID}/donations`, {
		method: 'POST',
		...(origin === null ? {} : { headers: { origin } })
	});

/** a body a donor's browser would send. */
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	formId: FORM_ID,
	amountMinor: 10_000,
	frequency: 'one_time',
	method: 'card',
	coversFee: false,
	email: 'ada@example.org',
	firstName: 'Ada',
	lastName: 'Okafor',
	consentedToContact: false,
	turnstileToken: 'tok',
	...over
});

/** one attempt, with the two ports and the env this file's cases share. */
function deps(over: Partial<QuoteDeps> = {}): QuoteDeps {
	return {
		db,
		env: STRIPE_ENV,
		provider: provider().port,
		verifyChallenge: challenge().verify,
		...over
	};
}

const mint = (
	d: QuoteDeps = deps(),
	over: Record<string, unknown> = {},
	origin: string | null = ALLOWED
) => mintQuote(d, { formId: FORM_ID, body: body(over), request: request(origin) });

describe('mintQuote() — a gift that goes through', () => {
	it('answers with the token and the server’s own numbers', async () => {
		const result = await mint();

		expect(result.ok).toBe(true);
		expect(result.ok && result.quote).toEqual({
			paymentToken: 'pi_secret_1',
			feeMinor: 0,
			totalMinor: 10_000
		});
	});

	it('writes the gift, its line and its pending payment', async () => {
		await mint();

		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			formId: FORM_ID,
			origin: ALLOWED,
			currency: 'USD',
			totalMinor: 10_000,
			feeMinor: 0
		});

		const lines = await db
			.select()
			.from(lineItem)
			.where(eq(lineItem.donationId, gift?.id ?? ''));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ revenueAccountId, lineTotalMinor: 10_000 });

		const [paid] = await db.select().from(payment);
		expect(paid).toMatchObject({ status: 'pending', provider: 'stripe', providerTxnId: 'pi_1' });
	});

	it('puts nothing in the books, because nothing has been collected', async () => {
		await mint();

		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
	});

	it('tells the processor which gift the intent is for', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }));

		const [gift] = await db.select().from(donation);
		// the metadata key is a constant precisely so this and the settlement half cannot disagree
		// about how it is spelled.
		expect(port.requests[0]?.metadata).toMatchObject({ donation_id: gift?.id });
		expect(port.requests[0]?.idempotencyKey).toBe(gift?.id);
	});

	/**
	 * the charge says what the gift was, without a lookup into this deployment's database.
	 *
	 * `gift_minor` is the figure with no column of its own: the line item is written at the
	 * grossed-up total, so the donor's chosen amount is `total_minor - fee_minor` and lives nowhere
	 * as itself (../db/schema.ts). asserted against a covered-fee gift for that reason — 10000 while
	 * 10330 is charged is what makes this the gift rather than the total, and a case where the two
	 * agreed would pass with either one written.
	 */
	it('describes the gift on the processor’s own copy of the charge', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { coversFee: true, method: 'ach' });

		const [gift] = await db.select().from(donation);
		expect(port.requests[0]?.amountMinor).toBe(10_081);
		expect(port.requests[0]?.metadata).toEqual({
			donation_id: gift?.id,
			gift_minor: '10000',
			fee_covered: 'true',
			fee_rail: 'ach'
		});
	});

	/**
	 * a gift the organisation absorbs the fee on says so, rather than saying nothing.
	 *
	 * `false` and absent are different answers and only one of them is this one: a charge written
	 * before these keys shipped carries neither (`FEE_COVERED_METADATA_KEY` in
	 * ../payments/provider.ts), so a reader that took absence for "not covered" would report every
	 * gift made before then as one the donor declined to cover.
	 */
	it('says the organisation absorbed the fee rather than leaving it unsaid', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { coversFee: false });

		expect(port.requests[0]?.metadata).toMatchObject({
			gift_minor: '10000',
			fee_covered: 'false',
			fee_rail: 'card'
		});
	});

	it('charges the currency and rail the form and the donor decided, never the body’s', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { method: 'ach', currency: 'ZAR' });

		expect(port.requests[0]).toMatchObject({ currency: 'USD', method: 'ach' });
	});

	it('files a donor nobody asked with no consent answer at all', async () => {
		const result = await mint(deps(), { consentedToContact: null });

		// the widened field, end to end: the public body carries `null` (packages/form/src/v1.ts), the parse
		// takes it, and what lands in the column is SQL NULL rather than a `false` nobody said. the
		// distinction only exists because the column is nullable (../db/schema.ts).
		expect(result.ok).toBe(true);
		const [gift] = await db.select().from(donation);
		const stored = await env.DB.prepare(
			'select consented_to_contact is null as unanswered from contact where id = ?'
		)
			.bind(gift?.contactId ?? '')
			.first<{ unanswered: number }>();
		expect(stored?.unanswered).toBe(1);
	});

	it('stores no origin for a caller the form does not name', async () => {
		await mint(deps(), {}, 'https://somewhere-else.test');

		// `donation.origin` is the validated header, so a site the form never named is attributed to
		// nothing rather than to itself.
		const [gift] = await db.select().from(donation);
		expect(gift?.origin).toBeNull();
	});
});

describe('mintQuote() — a gift given in honor or memory of someone', () => {
	// the whole path, because the middle of it is where the value can be lost: a body reaches
	// `parseQuoteRequest`, the parsed `Tribute` reaches `recordDonation`, and four nullable columns
	// on `donation` take it. `NewDonation` makes all four optional, so a writer that simply omits
	// them compiles — see `tributeColumns` in ./record.ts, which is what makes the omission a type
	// error, and these three cases, which are what say the mapping is right.

	const TRIBUTE = {
		tributeKind: 'memory',
		tributeHonoree: 'Grace Hopper',
		tributeNotifyName: 'Mary Hopper',
		tributeNotifyEmail: 'mary@example.org'
	};

	it('lands all four columns for a gift with somebody to tell', async () => {
		const result = await mint(deps(), TRIBUTE);

		expect(result.ok).toBe(true);
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			tributeKind: 'memory',
			tributeHonoree: 'Grace Hopper',
			tributeNotifyName: 'Mary Hopper',
			tributeNotifyEmail: 'mary@example.org'
		});
	});

	it('lands two and leaves two null where the donor asked for nobody to be told', async () => {
		const result = await mint(deps(), {
			tributeKind: 'honor',
			tributeHonoree: 'Ada Lovelace'
		});

		expect(result.ok).toBe(true);
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			tributeKind: 'honor',
			tributeHonoree: 'Ada Lovelace',
			tributeNotifyName: null,
			tributeNotifyEmail: null
		});
	});

	it('leaves all four null for a gift carrying no tribute', async () => {
		const result = await mint();

		expect(result.ok).toBe(true);
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			tributeKind: null,
			tributeHonoree: null,
			tributeNotifyName: null,
			tributeNotifyEmail: null
		});
	});

	it('never stamps `tribute_notified_at` at quote time', async () => {
		// the stamp is the settlement path's, claimed by a guarded update on a gift whose money has
		// moved (../db/schema.ts). a value written here would mark a family as told about a gift the
		// donor's bank may still refuse.
		await mint(deps(), TRIBUTE);

		const [gift] = await db.select().from(donation);
		expect(gift?.tributeNotifiedAt).toBeNull();
	});
});

describe('mintQuote() — the fee is the server’s', () => {
	it('grosses the charge up when the donor covers the fee', async () => {
		const result = await mint(deps(), { coversFee: true, amountMinor: 10_000 });

		// the same fixed-point arithmetic `estimateFee` does for the element, reused rather than
		// re-derived — a second implementation is how the confirm screen and the charge end up a
		// minor unit apart.
		expect(result.ok && result.quote.totalMinor).toBe(10_330);
		expect(result.ok && result.quote.feeMinor).toBe(330);
	});

	it('charges the gift and records no fee when the organisation absorbs it', async () => {
		const result = await mint(deps(), { coversFee: false, amountMinor: 10_000 });

		// zero is not a claim the processor takes nothing — it is that the donor agreed to no fee,
		// which is what `donation.fee_minor` holds.
		expect(result.ok && result.quote).toMatchObject({ totalMinor: 10_000, feeMinor: 0 });
	});

	it('charges the grossed-up total rather than the amount the donor picked', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { coversFee: true });

		expect(port.requests[0]?.amountMinor).toBe(10_330);
	});
});

describe('mintQuote() — a rail the account has stopped offering', () => {
	/**
	 * the zone's own store, which the ambient `CacheStorage` type has no name for. the served rail
	 * list is read through it (`$lib/server/forms/rail-cache.ts`), so writing the entry is how a case
	 * puts this path in front of an account that offers nothing without inventing a port answer.
	 */
	const edge = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
	const railKey = new Request('https://give.example.workers.dev/__offered-rails');

	/**
	 * a deployment whose processor is approved for no rail still charges the gift in front of it.
	 *
	 * this is the rule CLAUDE.md states for the recurring capability, and it holds for the rails for
	 * the same reason: the served config is cached and reaches pages this deployment cannot recall,
	 * so what the rail read decides is what a *later* form is offered and never what an already-open
	 * page is allowed to do. the live way in is a capability the processor flips to `pending` while
	 * it re-verifies an account — the read succeeds and answers no, `offeredRails` does not widen it
	 * because nothing was unreadable, and every donor holding a page from the last five minutes is
	 * mid-checkout.
	 *
	 * the refusal that would otherwise fire here is `renderableConfig`'s in
	 * `$lib/server/forms/published-config.ts`, and it is composed by the config route alone. this
	 * case is what fails if it is ever wired into `readPublishedConfig`, which is the reader both
	 * paths share — and it would fail as a refused donation, which is the failure it is here to
	 * prevent.
	 */
	it('charges rather than refusing when the account is approved for no rail', async () => {
		await edge.put(
			railKey,
			new Response('[]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		try {
			const port = provider();
			const result = await mint(deps({ provider: port.port }));

			expect(result.ok).toBe(true);
			// the token the provider minted, and not the intent id beside it: the client confirms
			// with this string, and `providerTxnId` in its place is a quote nothing can pay.
			expect(result.ok && result.quote.paymentToken).toBe('pi_secret_1');
			expect(port.requests).toHaveLength(1);
		} finally {
			// the entry is the zone's and outlives this case, so a list nothing else expects would
			// decide what every case after this one is served.
			await edge.delete(railKey);
		}
	});
});

describe('mintQuote() — the form record decides', () => {
	it('refuses an id nothing matches, with no row to build CORS from', async () => {
		const result = await mintQuote(deps(), {
			formId: 'frm_nosuchform00001',
			body: body(),
			request: request()
		});

		expect(result.ok).toBe(false);
		expect(result.ok || result.reason).toBe('form_not_found');
		expect(result.ok || result.form).toBeNull();
	});

	it('refuses a draft form under the same code the config endpoint uses', async () => {
		await seedForm({ status: 'draft' });

		const result = await mint();

		// one ladder for both endpoints: a form this deployment will not serve a config for cannot
		// take a gift either.
		expect(result.ok || result.reason).toBe('form_not_published');
	});

	it('refuses an amount outside the form’s own bounds', async () => {
		const result = await mint(deps(), { amountMinor: 100 });

		expect(result.ok || result.reason).toBe('invalid_request');
		expect(result.ok || result.message).toContain('amountMinor');
	});

	it('mints no intent for a body it refuses', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { amountMinor: 100 });

		expect(port.requests).toHaveLength(0);
	});
});

describe('mintQuote() — a repeating gift', () => {
	it('answers with the token the browser confirms and the server’s own numbers', async () => {
		const result = await mint(deps(), { frequency: 'monthly' });

		// the same shape the one-off branch answers with, carrying the same kind of value: a donation
		// form confirms a repeating gift with exactly the code that confirms a single one
		// (`RecurringGift.paymentToken` in ../payments/provider.ts).
		expect(result.ok).toBe(true);
		expect(result.ok && result.quote).toEqual({
			paymentToken: 'sub_secret_1',
			feeMinor: 0,
			totalMinor: 10_000
		});
	});

	it.each(['monthly', 'yearly'] as const)(
		'commits the donor before it creates the %s commitment',
		async (frequency) => {
			const port = provider();

			await mint(deps({ provider: port.port }), { frequency });

			// `recurring_plan.contact_id` is a foreign key with no existence check in front of it, and
			// it is the pointer every later charge is attributed by — so the row is here before the
			// commitment naming it is.
			const [donor] = await db.select().from(contact);
			expect(donor?.id).toBeTypeOf('string');
			expect(port.gifts[0]?.metadata?.contact_id).toBe(donor?.id);
		}
	);

	it('carries the keys the settlement path resolves a commitment by', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// a repeat charge carries none of its own, so what the commitment holds is the only path from
		// money that moved to the donor it came from. the keys are constants precisely so this and
		// `attribution` in ./collect.ts cannot disagree about how they are spelled.
		const [donor] = await db.select().from(contact);
		const [gift] = await db.select().from(donation);
		expect(port.gifts[0]?.metadata).toEqual({
			contact_id: donor?.id,
			form_id: FORM_ID,
			interval: 'monthly',
			gift_minor: '10000',
			fee_covered: 'false',
			donation_id: gift?.id
		});
	});

	it('names the gift it just wrote, which the first settled charge claims', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// the same pointer the single branch puts on an intent, on the object this branch creates:
		// the first collection reads it back and claims that row rather than opening a second gift
		// for money the donor has already been recorded as giving (./collect.ts).
		const [gift] = await db.select().from(donation);
		expect(port.gifts[0]?.metadata?.donation_id).toBe(gift?.id);
		expect(port.gifts[0]?.idempotencyKey).toBe(gift?.id);
	});

	/**
	 * the split a commitment collects, which is what makes charge fifty's receipt say what the donor
	 * agreed to.
	 *
	 * the charge is grossed up every interval, and a collection can read the total and nothing else:
	 * `readSettlement` reports what moved, and no row here records what the donor chose. so the two
	 * keys ride the commitment beside the three above and `coveredFeeOf` in ./collect.ts is what
	 * spends them — without them a fee-covering donor is charged the fee monthly and told about it on
	 * no receipt.
	 */
	it('carries the split a fee-covering commitment collects every interval', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly', coversFee: true });

		expect(port.gifts[0]?.amountMinor).toBe(10_330);
		expect(port.gifts[0]?.metadata).toMatchObject({
			gift_minor: '10000',
			fee_covered: 'true'
		});
	});

	/**
	 * the dedication, which is written on the gift this branch records and is exported nowhere.
	 *
	 * this browser is the only thing that ever says it, and every collection after this call arrives
	 * from the rail with nothing on it — so the row written here is what holds it, and a later
	 * collection reads it off the gift that opened the series (./collect.ts).
	 */
	const dedicated = {
		frequency: 'monthly',
		tributeKind: 'memory',
		tributeHonoree: 'Grace Hopper',
		tributeNotifyName: 'Mary Hopper',
		tributeNotifyEmail: 'mary@example.org'
	};

	it('records the dedication on the gift, with the person to tell', async () => {
		await mint(deps(), dedicated);

		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			tributeKind: 'memory',
			tributeHonoree: 'Grace Hopper',
			tributeNotifyName: 'Mary Hopper',
			tributeNotifyEmail: 'mary@example.org',
			tributeNotifiedAt: null
		});
	});

	it('sends the processor no name a donor typed', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), {
			...dedicated,
			firstName: 'Ada',
			lastName: 'Okafor',
			email: 'ada@example.org'
		});

		// every value on a commitment is a pointer or a figure of this app's own. the honoree and the
		// person to tell are on the gift's row and reach the processor not at all.
		const carried = Object.values(port.gifts[0]?.metadata ?? {});
		expect(carried).not.toContain('Grace Hopper');
		expect(carried).not.toContain('Mary Hopper');
		expect(carried).not.toContain('mary@example.org');
		expect(carried).not.toContain('ada@example.org');
		expect(carried).not.toContain('Ada');
		expect(carried).not.toContain('Okafor');
	});

	it('sends the amount, currency and cadence the server decided, never the body’s', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), {
			frequency: 'monthly',
			coversFee: true,
			currency: 'ZAR',
			interval: 'yearly',
			amountMinor: 10_000
		});

		// a wrong amount here is not one charge but every charge, for as long as nobody cancels it
		// (`RecurringGiftRequest` in ../payments/provider.ts).
		expect(port.gifts[0]).toMatchObject({
			amountMinor: 10_330,
			currency: 'USD',
			interval: 'monthly'
		});
	});

	it('sends the rail the donor picked, so no dashboard decides what it collects on', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly', method: 'ach' });

		// the rail is on the request for the reason the amount is: it is the server's, and this branch
		// charges it every interval rather than once. a commitment created without it is one the
		// processor may collect on whatever an operator's own dashboard has switched on
		// (`RecurringGiftRequest.method` in ../payments/provider.ts), which is the deployment's
		// configuration no longer deciding — and the fee behind `amountMinor` was priced for one rail.
		expect(port.gifts[0]?.method).toBe('ach');
	});

	it('gives every attempt its own key, so a donor who commits twice has two commitments', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });
		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// the one-off branch's scheme, applied to the one thing this branch mints: one key per
		// attempt, because one press is one attempt. a key derived from the donor instead would
		// resolve the second gift to the first and quietly hand back a commitment they already had.
		const [first, second] = port.gifts;
		expect(first?.idempotencyKey).toBeTruthy();
		expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
	});

	it('records the gift and its line, and no payment and nothing in the books', async () => {
		await mint(deps(), { frequency: 'monthly', amountMinor: 10_000 });

		// an authorization is not a collection: the gift is recorded so the organisation can see an
		// unfinished one, and no money is claimed for it anywhere. the `recurring_plan` row and the
		// `payment` row are both the webhook's, from the first charge that settles (./collect.ts).
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({ totalMinor: 10_000, formId: FORM_ID, recurringId: null });
		const [lines] = await db.select({ n: sql<number>`count(*)` }).from(lineItem);
		const [paid] = await db.select({ n: sql<number>`count(*)` }).from(payment);
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(lines?.n).toBe(1);
		expect(paid?.n).toBe(0);
		expect(groups?.n).toBe(0);
	});

	it('leaves exactly one pending gift behind when the donor abandons the checkout', async () => {
		await mint(deps(), { frequency: 'monthly' });

		// nothing else happens to a commitment the donor never confirms: the processor abandons it
		// within 23 hours, no collection ever arrives, and what is left is one gift with no attempt
		// against it — which is what the gifts list reads as `Pending` and what makes contacting an
		// unfinished repeating gift possible at all.
		const gifts = await db.select().from(donation);
		expect(gifts).toHaveLength(1);
		const [paid] = await db.select({ n: sql<number>`count(*)` }).from(payment);
		expect(paid?.n).toBe(0);
	});

	it('records no gift for a commitment the processor refused', async () => {
		const port = provider(
			[],
			[{ ok: false, reason: 'provider_error', detail: 'the processor said no' }]
		);

		const result = await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// the write runs last, for the reason the single branch's does: a gift recorded against a
		// commitment that was never created is a row nothing can ever collect against.
		expect(result.ok).toBe(false);
		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(0);
	});

	it('files a returning donor under the row their single gift already made', async () => {
		await mint(deps(), { frequency: 'one_time' });
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// one donor file across both paths, which is what sharing `resolveDonor` buys.
		const [rows] = await db.select({ n: sql<number>`count(*)` }).from(contact);
		expect(rows?.n).toBe(1);
	});

	it('creates no commitment for a challenge it refused', async () => {
		const port = provider();
		const refused = challenge({
			ok: false,
			reason: 'rejected',
			detail: 'spent',
			operatorFix: null
		});

		await mint(deps({ provider: port.port, verifyChallenge: refused.verify }), {
			frequency: 'monthly'
		});

		// a refusal after `createRecurringGift` would leave a live commitment nobody can reach.
		expect(port.gifts).toHaveLength(0);
		const [rows] = await db.select({ n: sql<number>`count(*)` }).from(contact);
		expect(rows?.n).toBe(0);
	});

	it('creates no commitment for an amount outside the form’s bounds', async () => {
		const port = provider();

		const result = await mint(deps({ provider: port.port }), {
			frequency: 'monthly',
			amountMinor: 100
		});

		expect(result.ok || result.reason).toBe('invalid_request');
		expect(port.gifts).toHaveLength(0);
	});

	it('reports a processor that could not commit as an outage the donor may retry', async () => {
		const port = provider(
			[],
			[{ ok: false, reason: 'rate_limited', detail: 'the processor said rate_limited' }]
		);

		const result = await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		expect(result.ok || result.reason).toBe('payments_unavailable');
	});

	it('mints no single payment for one', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// `createIntent` charges once; a repeating gift is a commitment and nothing else.
		expect(port.requests).toHaveLength(0);
	});
});

describe('mintQuote() — the challenge', () => {
	it('hands the check the form’s sites and this deployment’s own host', async () => {
		const checked = challenge();

		await mint(deps({ verifyChallenge: checked.verify }));

		// `allowed_origins` are whole origins and Cloudflare reports a bare host. the deployment's
		// own host is on every form: every form served here loads on the donation page this
		// deployment answers on its own address, and that page is on no `site` row.
		expect(checked.checks[0]?.allowedHostnames).toEqual(['acme.org', 'give.example.workers.dev']);
		expect(checked.checks[0]?.token).toBe('tok');
		expect(checked.checks[0]?.secretKey).toBe('0xSECRET');
	});

	it('accepts this deployment’s own host for a form ticked onto no site at all', async () => {
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('[]', FORM_ID)
			.run();
		const checked = challenge();

		// an organisation with no website of its own has exactly one acceptable host, and it is the
		// deployment's own — so the list is never empty and such a form can still be given to.
		await mint(deps({ verifyChallenge: checked.verify }), {}, null);

		expect(checked.checks[0]?.allowedHostnames).toEqual(['give.example.workers.dev']);
	});

	it('takes the deployment’s own host off the request url and not off `Origin`', async () => {
		const checked = challenge();

		// the header is the caller's to write and is an attribution signal only (CLAUDE.md); the url
		// is the host this worker answered on, which is the whole reason nothing is stored.
		await mint(deps({ verifyChallenge: checked.verify }), {}, 'https://spoofed.test');

		expect(checked.checks[0]?.allowedHostnames).toEqual(['acme.org', 'give.example.workers.dev']);
	});

	it('refuses a rejected token with the code a donation form can act on', async () => {
		const refused = challenge({
			ok: false,
			reason: 'rejected',
			detail: 'that token is spent',
			operatorFix: null
		});

		const result = await mint(deps({ verifyChallenge: refused.verify }));

		expect(result.ok || result.reason).toBe('challenge_failed');
		expect(refusalCode('challenge_failed')).toBe('challenge_failed');
	});

	it.each(['misconfigured', 'unavailable'] as const)(
		'refuses a %s challenge as an outage rather than as the donor’s fault',
		async (reason) => {
			const refused = challenge({
				ok: false,
				reason,
				detail: 'no challenge could be made',
				operatorFix: reason === 'misconfigured' ? 'set TURNSTILE_SECRET_KEY' : null
			});

			const result = await mint(deps({ verifyChallenge: refused.verify }));

			// a fresh token fixes neither, so telling a donor to solve another one would be a loop.
			expect(result.ok || result.reason).toBe('challenge_unavailable');
			expect(refusalCode('challenge_unavailable')).toBeNull();
		}
	);

	it('keeps the operator’s sentence out of the body', async () => {
		const refused = challenge({
			ok: false,
			reason: 'misconfigured',
			detail: 'This deployment cannot verify a challenge.',
			operatorFix: 'TURNSTILE_SECRET_KEY is not set. Run `pnpm run deploy --var …`.'
		});

		const result = await mint(deps({ verifyChallenge: refused.verify }));

		expect(result.ok || result.message).not.toContain('TURNSTILE_SECRET_KEY');
		expect(result.ok || result.fix).not.toContain('TURNSTILE_SECRET_KEY');
	});

	it('mints no intent for a token it refused', async () => {
		const port = provider();
		const refused = challenge({
			ok: false,
			reason: 'rejected',
			detail: 'spent',
			operatorFix: null
		});

		await mint(deps({ provider: port.port, verifyChallenge: refused.verify }));

		// a refusal after `createIntent` would leave a live intent behind for every rejected
		// submission.
		expect(port.requests).toHaveLength(0);
	});
});

describe('mintQuote() — the processor', () => {
	const failure = (reason: PaymentFailureReason): PaymentResult<Intent> => ({
		ok: false,
		reason,
		detail: `the processor said ${reason}`
	});

	it.each(['rate_limited', 'unreachable', 'provider_error'] as const)(
		'reports %s as an outage the donor may retry',
		async (reason) => {
			const result = await mint(deps({ provider: provider([failure(reason)]).port }));

			expect(result.ok || result.reason).toBe('payments_unavailable');
		}
	);

	it('reports unset credentials under the deployment’s own code', async () => {
		const result = await mint(deps({ provider: provider([failure('not_configured')]).port }));

		expect(result.ok || result.reason).toBe('payments_not_configured');
	});

	it.each(['invalid_request', 'internal_error', 'bad_signature', 'not_found'] as const)(
		'reports %s as a defect of ours, with no code for a form to render',
		async (reason) => {
			const result = await mint(deps({ provider: provider([failure(reason)]).port }));

			expect(result.ok || result.reason).toBe('internal_error');
			expect(refusalCode('internal_error')).toBeNull();
		}
	);

	it('writes no gift when no intent was minted', async () => {
		await mint(deps({ provider: provider([failure('unreachable')]).port }));

		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(0);
	});
});

describe('mintQuote() — an intent that already has a gift against it', () => {
	it('answers the existing intent’s token rather than failing a donation that succeeded', async () => {
		// the same transaction id twice, which is what an earlier call resolving to the same intent
		// produces. the second attempt writes nothing and the gift the first wrote is the one that
		// settles; `Quote` carries no donation id, so this answer is complete.
		const twice = provider([
			{ ok: true, value: { providerTxnId: 'pi_same', paymentToken: 'pi_secret_same' } },
			{ ok: true, value: { providerTxnId: 'pi_same', paymentToken: 'pi_secret_same' } }
		]);

		const first = await mint(deps({ provider: twice.port }));
		const second = await mint(deps({ provider: twice.port }));

		expect(first.ok && first.quote.paymentToken).toBe('pi_secret_same');
		expect(second.ok).toBe(true);
		expect(second.ok && second.quote.paymentToken).toBe('pi_secret_same');

		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(1);
	});
});

/**
 * which cause the gift is recorded against, on both cadences and on all three modes.
 *
 * the decision is the form's rather than the body's, and the two directions it can be got wrong are
 * opposite: a pinned form that read the body would let a donor overwrite a pin they were only told
 * about, and a choosing form that read the row would credit every gift to nothing.
 */
describe('mintQuote() — the cause the gift is credited to', () => {
	const CLEAN = '019fb600-0000-7000-8000-000000000001';
	const MEALS = '019fb600-0000-7000-8000-000000000002';

	beforeEach(async () => {
		await env.DB.prepare('delete from program').run();
		await env.DB.prepare(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Clean water', 'active', 0, 0), (?, 'School meals', 'active', 0, 0)`
		)
			.bind(CLEAN, MEALS)
			.run();
	});

	const asks = (mode: 'pinned' | 'choice', programId: string | null = null) =>
		env.DB.prepare(`update form set program_mode = ?, program_id = ? where id = ?`)
			.bind(mode, programId, FORM_ID)
			.run();

	/** the one gift this file's cases wrote. */
	async function onlyGift() {
		const [gift] = await db.select().from(donation);
		if (!gift) throw new Error('expected a gift to have been written');
		return gift;
	}

	it('writes the form’s own pin, from a body that sent nothing', async () => {
		await asks('pinned', CLEAN);

		expect((await mint()).ok).toBe(true);
		expect((await onlyGift()).programId).toBe(CLEAN);
	});

	it('writes the cause the donor picked on a form that offered the choice', async () => {
		await asks('choice');

		expect((await mint(deps(), { programId: MEALS })).ok).toBe(true);
		expect((await onlyGift()).programId).toBe(MEALS);
	});

	it('writes no cause where a form offered the choice and the donor made none', async () => {
		await asks('choice');

		expect((await mint()).ok).toBe(true);
		expect((await onlyGift()).programId).toBeNull();
	});

	it('writes no cause for a form that asks about none', async () => {
		expect((await mint()).ok).toBe(true);
		expect((await onlyGift()).programId).toBeNull();
	});

	it('writes the pin onto the gift a repeating commitment was authorized for', async () => {
		await asks('pinned', CLEAN);

		expect((await mint(deps(), { frequency: 'monthly' })).ok).toBe(true);
		expect((await onlyGift()).programId).toBe(CLEAN);
	});

	it('writes the donor’s pick onto the gift a repeating commitment was authorized for', async () => {
		await asks('choice');

		expect((await mint(deps(), { frequency: 'monthly', programId: MEALS })).ok).toBe(true);
		expect((await onlyGift()).programId).toBe(MEALS);
	});

	/**
	 * a pinned form refuses a body carrying an id, and the refusal is the parser's.
	 *
	 * the served config carries the pin's name and no id (`Program` in packages/form/src/v1.ts), so
	 * a request with one was not built from what this deployment served.
	 */
	it('refuses a cause sent to a form pinned to one', async () => {
		await asks('pinned', CLEAN);

		const result = await mint(deps(), { programId: MEALS });

		expect(result.ok).toBe(false);
		expect(result.ok || result.reason).toBe('invalid_request');
		expect(result.ok || result.message).toContain('programId');
	});

	// no cause reaches the processor. a commitment carries pointers and figures only, and which of
	// the org's causes a gift went to is a fact this database keeps.
	it('sends nothing about the cause to the processor', async () => {
		await asks('pinned', CLEAN);
		const port = provider();

		await mint(deps({ provider: port.port }));

		expect(JSON.stringify(port.requests[0]?.metadata)).not.toContain(CLEAN);
	});
});
