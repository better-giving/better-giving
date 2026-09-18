import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TurnstileCheck, TurnstileResult } from '../api/turnstile';
import { createDb, type Db } from '../db/client';
import { contact, donation, entryGroup, lineItem, payment } from '../db/schema';
import type {
	DepositInstructions,
	Intent,
	PaymentFailureReason,
	PaymentProvider,
	PaymentResult,
	RecurringGift
} from '../payments/provider';
import { estimateFee } from '@better-giving/form/fee';
import { PAYPAL_US_FEE_RULES_CHARITY, PAYPAL_US_FEE_RULES_STANDARD } from '../payments/fees';
import { edgeCache } from '../edge-cache.testing';
import { processorsOf, soleProcessor } from '../payments/processors.testing';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { CHARIOT_FEE_RULES, NOWPAYMENTS_FEE_RULE } from '../payments/fees';
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

/** a deployment configured for PayPal and nothing else. its client id is the browser half too. */
const PAYPAL_ENV = {
	PAYPAL_CLIENT_ID: 'notarealclientid',
	PAYPAL_CLIENT_SECRET: 'notarealclientsecret',
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
		processor: 'stripe',

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
				value: {
					chargesEnabled: true,
					rails: { card: 'active', ach: 'active', apple_pay: 'active', google_pay: 'active' }
				}
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
		},
		async listPayableCoins() {
			throw new Error('listPayableCoins is not part of the quote path');
		}
	};
	return { port, requests, gifts };
}

/**
 * the same scripted port under PayPal's name, answering for PayPal's own two rails.
 *
 * built on the port above rather than written out again: what differs between the two processors on
 * this path is which rails the account answers for and the name a `payment` row is written under —
 * everything else a quote asks of a port is the same call. the answers below mirror what
 * ../payments/paypal.ts really gives: both rails offered, because PayPal publishes no per-rail
 * approval and no switchboard to read one off.
 */
function paypalProvider(
	answers: readonly PaymentResult<Intent>[] = [],
	commitments: readonly PaymentResult<RecurringGift>[] = []
) {
	const scripted = provider(answers, commitments);
	const both = { paypal: 'active', venmo: 'active' } as const;
	const port: PaymentProvider = {
		...scripted.port,
		processor: 'paypal',
		async readAccountChargeability() {
			return { ok: true, value: { chargesEnabled: true, rails: both } } as const;
		},
		async readRailSwitchboard() {
			return {
				ok: true,
				value: {
					paypal: { offered: true, switchedOn: true },
					venmo: { offered: true, switchedOn: true }
				}
			} as const;
		}
	};
	return { port, requests: scripted.requests, gifts: scripted.gifts };
}

/** the mail transport, recording what it was handed. */
function mailer() {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return { ok: true };
		}
	};
	return { port, sent };
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

/**
 * one attempt, with the two ports and the env this file's cases share.
 *
 * a case names the port it wants rather than a whole `Processors`, because what every case here
 * drives is one port's answers — `soleProcessor` in ../payments/processors.testing.ts is what turns
 * it into the set `mintQuote` takes, keyed on the port's own processor.
 */
type DepsOver = Partial<Omit<QuoteDeps, 'processors'>> & { readonly provider?: PaymentProvider };

/** what `deps()`'s `defer` was handed, which `mint` waits out so a case reads what it sent. */
const deferred: Promise<unknown>[] = [];

function deps(over: DepsOver = {}): QuoteDeps {
	const { provider: port, ...rest } = over;
	return {
		db,
		env: STRIPE_ENV,
		processors: soleProcessor(port ?? provider().port),
		verifyChallenge: challenge().verify,
		email: mailer().port,
		defer: (task) => {
			deferred.push(task);
		},
		...rest
	};
}

const mint = async (
	d: QuoteDeps = deps(),
	over: Record<string, unknown> = {},
	origin: string | null = ALLOWED
) => {
	const result = await mintQuote(d, {
		formId: FORM_ID,
		body: body(over),
		request: request(origin)
	});
	await Promise.allSettled(deferred.splice(0));
	return result;
};

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

	// the donor's page sent `Origin`, and a callback built from it would notify their site.
	it('tells the processor this deployment’s own origin, never the page’s', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }));

		expect(port.requests[0]?.deploymentOrigin).toBe('https://give.example.workers.dev');
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
	 * the served rail list is read through the zone's own store
	 * (`$lib/server/forms/rail-cache.ts`), so writing the entry is how a case puts this path in
	 * front of an account that offers nothing without inventing a port answer.
	 */
	const edge = edgeCache();
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
		'files the %s commitment’s gift under the donor it committed first',
		async (frequency) => {
			const port = provider();

			await mint(deps({ provider: port.port }), { frequency });

			// the donor is on no commitment and is reached through the gift it names, so this is the
			// whole of the chain a collection walks back: `donation_id` on the commitment, the donor
			// and the form on that row (`attribution` in ./collect.ts).
			const [donor] = await db.select().from(contact);
			const [gift] = await db.select().from(donation);
			expect(gift?.contactId).toBe(donor?.id);
			expect(port.gifts[0]?.metadata?.donation_id).toBe(gift?.id);
		}
	);

	it('carries the keys the settlement path resolves a commitment by', async () => {
		const port = provider();

		await mint(deps({ provider: port.port }), { frequency: 'monthly' });

		// a repeat charge carries none of its own, so what the commitment holds is the only path from
		// money that moved to the gift it belongs to. exactly these four, because PayPal's field holds
		// 127 characters and a fifth is what stops the rail taking a repeating gift at all
		// (`commitmentMetadata` in ../payments/provider.ts).
		const [gift] = await db.select().from(donation);
		expect(port.gifts[0]?.metadata).toEqual({
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

	/**
	 * the cadence a deployment stopped being able to collect, met by a donor who was still offered
	 * it.
	 *
	 * reachable without anything going wrong: a page cached while the account held what a repeating
	 * gift is charged against is served for minutes after it stops holding it
	 * (`cachedCadences` in ../forms/cadence-cache.ts), and the submission off that page is charged
	 * rather than refused up front — CLAUDE.md's repeating-gifts rule keeps the donation path from
	 * gating on the capability. so the processor is the one that says no, and what it says has to
	 * reach the donor as what happened.
	 */
	it.each(['unsupported', 'not_found'] as const)(
		'tells a donor a repeating gift cannot be collected here when the processor answers %s',
		async (reason) => {
			const port = provider([], [{ ok: false, reason, detail: `the processor said ${reason}` }]);

			const result = await mint(deps({ provider: port.port }), { frequency: 'monthly' });

			expect(result.ok || result.reason).toBe('frequency_unsupported');
			// and never as our defect: the catch-all sends a donor to this deployment's logs, which
			// is an errand they cannot run and a diagnosis that is wrong.
			expect(result.ok || result.fix).not.toContain('bug in this app');
		}
	);
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

	/**
	 * the fix names the processor that settles the rail the donor picked.
	 *
	 * this deployment holds Stripe alone and the body names a PayPal rail, which is what a donor on
	 * a cached page sends after the deployment's PayPal pair was cleared — `soleProcessor` in
	 * ../payments/processors.testing.ts answers for the processor it holds no port for exactly as
	 * the factory does. a fix naming Stripe's dashboard would send an operator to re-check a pair
	 * that is set and fine.
	 */
	it('names the rail’s own processor where that processor is the one unset', async () => {
		const result = await mint(deps(), { method: 'paypal' });

		expect(result.ok || result.reason).toBe('payments_not_configured');
		expect(result.ok || result.fix).toContain('PayPal');
		expect(result.ok || result.fix).not.toContain('Stripe');
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

describe('mintQuote() — a gift on PayPal’s rails', () => {
	/**
	 * a PayPal order, which is what an adapter's `Intent` is on this rail: `createIntent` in
	 * ../payments/paypal.ts answers with the order id under both fields, because the id is what the
	 * donor's browser opens PayPal's window on and what a capture is reconciled against.
	 */
	const ORDER_ID = '5O190127TN364715T';
	const order = (): PaymentResult<Intent> => ({
		ok: true,
		value: { providerTxnId: ORDER_ID, paymentToken: ORDER_ID }
	});

	const paypalDeps = (env: Record<string, string> = PAYPAL_ENV, port?: PaymentProvider) =>
		deps({ env, provider: port ?? paypalProvider([order()]).port });

	it.each(['paypal', 'venmo'] as const)(
		'answers a %s gift with what the donor’s window is opened on',
		async (method) => {
			const result = await mint(paypalDeps(), { method });

			expect(result.ok && result.quote.paymentToken).toBe(ORDER_ID);
		}
	);

	// the row is what a settlement is found by, and `payment_provider_txn_idx` is keyed on the pair —
	// so the name it is written under has to be the name of whatever minted the id beside it.
	it('records the payment against PayPal and the order it minted', async () => {
		await mint(paypalDeps(), { method: 'paypal' });

		const [paid] = await db.select().from(payment);
		expect(paid).toMatchObject({ status: 'pending', provider: 'paypal', providerTxnId: ORDER_ID });
	});

	/**
	 * the figure a donor covering the fee is quoted, off PayPal's own table rather than the card one.
	 *
	 * priced against `estimateFee` and the constant rather than against a number written here: what
	 * is under test is which table the served config carried, and a literal would pass just as well
	 * if the gift had been priced off Stripe's card rule.
	 */
	it('prices a PayPal rail off PayPal’s standard table', async () => {
		const result = await mint(paypalDeps(), { method: 'paypal', coversFee: true });

		const expected = estimateFee(10_000, PAYPAL_US_FEE_RULES_STANDARD.paypal);
		expect(result.ok && result.quote).toMatchObject({
			totalMinor: expected?.totalMinor,
			feeMinor: expected?.feeMinor
		});
	});

	/**
	 * the charity rate, which is the one thing about PayPal's pricing this deployment cannot read off
	 * the account — so a deploy-time answer picks the table (`paypalFeeRules` in ../payments/fees.ts)
	 * and a donor covering the fee is quoted 1.99% rather than 3.49%.
	 */
	it('prices it off the charity table where the deployment says the account holds that rate', async () => {
		const result = await mint(paypalDeps({ ...PAYPAL_ENV, PAYPAL_CHARITY_RATE_APPROVED: 'true' }), {
			method: 'paypal',
			coversFee: true
		});

		const expected = estimateFee(10_000, PAYPAL_US_FEE_RULES_CHARITY.paypal);
		expect(result.ok && result.quote).toMatchObject({
			totalMinor: expected?.totalMinor,
			feeMinor: expected?.feeMinor
		});
	});

	/**
	 * a gift that repeats, committed on PayPal's own rail.
	 *
	 * the whole of what a PayPal deployment offering Monthly rests on: the cadence a donor picked
	 * selects the commitment branch, the rail selects PayPal's adapter, and what comes back is what
	 * the donor's window is opened on. a deployment whose account cannot collect never offers the
	 * cadence in the first place (`offeredCadences` in ../forms/offered-cadences.ts).
	 */
	it('commits a repeating gift on PayPal and answers with what approves it', async () => {
		const port = paypalProvider();

		const result = await mint(paypalDeps(PAYPAL_ENV, port.port), {
			method: 'paypal',
			frequency: 'monthly'
		});

		expect(result.ok && result.quote.paymentToken).toBe('sub_secret_1');
		expect(port.gifts[0]).toMatchObject({ interval: 'monthly', method: 'paypal' });
		// and nothing minted through the single-gift arm, which charges once.
		expect(port.requests).toHaveLength(0);
	});

	/**
	 * the cadence a PayPal account stopped being able to collect, met by a donor still offered it.
	 *
	 * the same refusal ../donations/quote.ts maps for either processor, asserted here because the
	 * account it is about is PayPal's: the plan a subscription names is found on the account, so a
	 * product that has gone is the processor saying no rather than this app being wrong.
	 */
	it('tells a donor PayPal cannot collect a repeating gift, naming PayPal', async () => {
		const port = paypalProvider(
			[],
			[{ ok: false, reason: 'not_found', detail: 'PayPal refused the call' }]
		);

		const result = await mint(paypalDeps(PAYPAL_ENV, port.port), {
			method: 'paypal',
			frequency: 'monthly'
		});

		expect(result.ok || result.reason).toBe('frequency_unsupported');
		expect(result.ok || result.message).toContain('PayPal');
		expect(result.ok || result.message).not.toContain('Stripe');
	});

	// a card rail on a deployment holding no Stripe key reaches no adapter at all, which is the
	// whole of what `Processors.forRail` buys: the two processors never compete for a rail, and
	// PayPal can mint nothing for one of Stripe's.
	it('mints nothing for a Stripe rail on a deployment holding only PayPal', async () => {
		const result = await mint(paypalDeps(), { method: 'card' });

		expect(result.ok || result.reason).toBe('payments_not_configured');
		expect(result.ok || result.fix).toContain('Stripe');
	});
});

describe('mintQuote() — a gift from a donor-advised fund', () => {
	/** a deployment holding Chariot and nothing else, so the served config offers the fund rail. */
	const CHARIOT_ENV = {
		CHARIOT_API_KEY: 'notarealchariotkey',
		CHARIOT_CONNECT_ID: 'notarealconnectid',
		TURNSTILE_SECRET_KEY: '0xSECRET'
	};
	const SESSION = 'cfe09e64-6a74-4dab-a565-361185a6f248';
	const GRANT_ID = '1e60800e-849b-43d1-870e-57afc8d75473';
	const grant = (): PaymentResult<Intent> => ({
		ok: true,
		value: { providerTxnId: GRANT_ID, paymentToken: GRANT_ID }
	});

	/**
	 * the scripted port under Chariot's name. `createIntent` is Create Grant (../payments/chariot.ts),
	 * whose HTTP answers ../payments/chariot.spec.ts maps; what this file drives is the failure each
	 * one arrives as.
	 */
	function chariotProvider(
		answers: readonly PaymentResult<Intent>[] = [grant()],
		onCreate: () => Promise<void> = async () => {}
	) {
		const scripted = provider(answers);
		const port: PaymentProvider = {
			...scripted.port,
			processor: 'chariot',
			async createIntent(request) {
				await onCreate();
				return scripted.port.createIntent(request);
			},
			async readAccountChargeability() {
				return { ok: true, value: { chargesEnabled: true, rails: { daf: 'active' } } } as const;
			},
			async readRailSwitchboard() {
				return { ok: true, value: { daf: { offered: true, switchedOn: true } } } as const;
			},
			async readRecurringGiftProvision() {
				return { ok: false, reason: 'unsupported', detail: 'one-time grants only' } as const;
			}
		};
		return { port, requests: scripted.requests };
	}

	const fundGift = (over: Record<string, unknown> = {}) => ({
		method: 'daf',
		authorizationId: SESSION,
		authorizedMinor: 10_300,
		...over
	});

	const chariotDeps = (port: PaymentProvider = chariotProvider().port, over: DepsOver = {}) =>
		deps({ env: CHARIOT_ENV, provider: port, ...over });

	it('creates the grant from the session at the authorized total and answers with the grant', async () => {
		const port = chariotProvider();

		const result = await mint(chariotDeps(port.port), fundGift());

		expect(result.ok && result.quote).toEqual({
			paymentToken: GRANT_ID,
			feeMinor: 0,
			totalMinor: 10_300
		});
		expect(port.requests[0]).toMatchObject({
			amountMinor: 10_300,
			currency: 'USD',
			method: 'daf',
			authorizedSessionId: SESSION,
			deploymentOrigin: 'https://give.example.workers.dev'
		});
	});

	it('records the payment against Chariot and the grant it created', async () => {
		await mint(chariotDeps(), fundGift());

		const [paid] = await db.select().from(payment);
		expect(paid).toMatchObject({
			status: 'pending',
			provider: 'chariot',
			method: 'daf',
			providerTxnId: GRANT_ID,
			amountMinor: 10_300
		});
	});

	/**
	 * the donor chose $100.00 on the form and raised it to $155.00 in the fund's window, covering the
	 * fee: the gift is recorded at what the fund grants, and the covered fee is Chariot's rate on that
	 * total rather than on the figure the form showed.
	 */
	it('records a changed amount at the granted figure, with the covered fee split out of it', async () => {
		const result = await mint(
			chariotDeps(),
			fundGift({ amountMinor: 10_000, coversFee: true, authorizedMinor: 15_500 })
		);

		// 2.9% of $155.00 is $4.495, which a fund grants as the next whole dollar.
		expect(result.ok && result.quote).toMatchObject({ totalMinor: 15_500, feeMinor: 500 });
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({ totalMinor: 15_500, feeMinor: 500 });
	});

	// a total that is exactly a covered gift splits back into that gift, so an unchanged amount
	// records what the donor was shown.
	it('splits an unchanged covered total back into the gift the form priced', async () => {
		const shown = estimateFee(10_000, CHARIOT_FEE_RULES.daf);

		const result = await mint(
			chariotDeps(),
			fundGift({ coversFee: true, authorizedMinor: shown?.totalMinor })
		);

		expect(result.ok && result.quote).toMatchObject({
			totalMinor: shown?.totalMinor,
			feeMinor: shown?.feeMinor
		});
	});

	it('creates no grant for a gift portion outside the form’s range, and says why', async () => {
		const port = chariotProvider();

		// the form takes $5.00 to $10,000.00, and $4.00 is below it.
		const result = await mint(chariotDeps(port.port), fundGift({ authorizedMinor: 400 }));

		expect(result.ok || result.reason).toBe('invalid_request');
		expect(result.ok || result.message).toContain('$5.00');
		expect(port.requests).toHaveLength(0);
		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(0);
	});

	it('tells the donor a fund approval past its window has expired', async () => {
		const port = chariotProvider([
			{ ok: false, reason: 'authorization_expired', detail: 'more than 15 minutes ago' }
		]);

		const result = await mint(chariotDeps(port.port), fundGift());

		expect(result.ok || result.reason).toBe('daf_authorization_expired');
		expect(result.ok || result.fix).toContain('fund');
		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(0);
	});

	// a session Chariot holds nothing for is a posted body naming the wrong approval, and telling the
	// donor theirs expired would send them back to the window for a reason that is not true.
	it('tells the donor an approval Chariot cannot find was not found, and never that it expired', async () => {
		const port = chariotProvider([{ ok: false, reason: 'not_found', detail: 'no such session' }]);

		const result = await mint(chariotDeps(port.port), fundGift());

		expect(result.ok || result.reason).toBe('invalid_request');
		expect(result.ok || result.message).toContain('couldn’t be found');
		expect(result.ok || result.message).not.toContain('expired');
	});

	it('carries the fund’s reason when it will not grant the amount', async () => {
		const port = chariotProvider([
			{
				ok: false,
				reason: 'invalid_request',
				detail:
					'Chariot did not create the grant. Chariot said: Bad Request: amount exceeds the fund balance'
			}
		]);

		const result = await mint(chariotDeps(port.port), fundGift());

		expect(result.ok || result.reason).toBe('daf_grant_declined');
		// the fund's words verbatim, in a fundraiser's sentence: the adapter's own wording names the
		// processor and is written for the log.
		expect(result.ok || result.message).toBe(
			'Your fund didn’t approve this gift: Bad Request: amount exceeds the fund balance'
		);
		expect(result.ok || result.fix).not.toContain('Chariot');
	});

	it('reports a Chariot that did not answer as an outage the donor may retry', async () => {
		const port = chariotProvider([{ ok: false, reason: 'unreachable', detail: 'no answer' }]);

		const result = await mint(chariotDeps(port.port), fundGift());

		expect(result.ok || result.reason).toBe('payments_unavailable');
		// the grant may exist, so the answer never says nothing was given.
		expect(result.ok || result.fix).toContain('may already');
		expect(result.ok || result.fix).not.toContain('Nothing was charged');
	});

	/**
	 * a Create Grant nobody answered may have created the grant, and a donor who leaves instead of
	 * trying again leaves a pledge the settlement path will read as a grant it does not know.
	 */
	it('tells an operator the session and amount when whether the grant was created is unknown', async () => {
		await env.DB.prepare(`update org_profile set notification_email = 'ops@hope.example'`).run();
		const mail = mailer();
		const port = chariotProvider([{ ok: false, reason: 'unreachable', detail: 'no answer' }]);

		await mint(chariotDeps(port.port, { email: mail.port }), fundGift());

		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain(SESSION);
		expect(mail.sent[0]?.text).toContain('103.00');
	});

	it('tells no operator anything when Chariot answered that it created no grant', async () => {
		await env.DB.prepare(`update org_profile set notification_email = 'ops@hope.example'`).run();
		const mail = mailer();
		const port = chariotProvider([{ ok: false, reason: 'provider_error', detail: 'a 500' }]);

		await mint(chariotDeps(port.port, { email: mail.port }), fundGift());

		expect(mail.sent).toHaveLength(0);
	});

	/**
	 * a grant that exists with no gift recorded against it is visible nowhere else: the settlement path
	 * answers an unknown grant quietly, so this press is the one place the loss can be reported.
	 */
	it('tells an operator the grant id when the gift cannot be recorded against a created grant', async () => {
		await env.DB.prepare(`update org_profile set notification_email = 'ops@hope.example'`).run();
		const mail = mailer();
		// the form goes between the read at the top of the request and the write at the bottom.
		const port = chariotProvider([grant()], async () => {
			await env.DB.prepare('delete from form').run();
		});

		const result = await mint(chariotDeps(port.port, { email: mail.port }), fundGift());

		expect(result.ok || result.reason).toBe('internal_error');
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain(GRANT_ID);
	});

	/**
	 * the same session posted twice — a donor pressing again, or a client retrying a lost answer. Chariot
	 * answers the grant it already holds, and the payment the first call recorded against it refuses a
	 * second one: one gift, and both calls answer with the grant.
	 */
	it('records one gift for a session submitted twice', async () => {
		const port = chariotProvider([grant(), grant()]);

		const first = await mint(chariotDeps(port.port), fundGift());
		const second = await mint(chariotDeps(port.port), fundGift());

		expect(first.ok && first.quote.paymentToken).toBe(GRANT_ID);
		expect(second.ok && second.quote.paymentToken).toBe(GRANT_ID);
		const [gifts] = await db.select({ n: sql<number>`count(*)` }).from(donation);
		expect(gifts?.n).toBe(1);
	});

	// the gift the first submission recorded is the gift; a resend carrying another split is not.
	it('answers a session submitted twice with the gift the first submission recorded', async () => {
		const port = chariotProvider([grant(), grant()]);
		await mint(chariotDeps(port.port), fundGift({ coversFee: true, authorizedMinor: 15_500 }));

		const second = await mint(
			chariotDeps(port.port),
			fundGift({ coversFee: false, authorizedMinor: 15_500 })
		);

		expect(second.ok && second.quote).toEqual({
			paymentToken: GRANT_ID,
			feeMinor: 500,
			totalMinor: 15_500
		});
	});

	it('tells the donor their grant request is on its way, at the gift and not the covered total', async () => {
		const mail = mailer();

		await mint(
			chariotDeps(chariotProvider().port, { email: mail.port }),
			fundGift({ amountMinor: 10_000, coversFee: true, authorizedMinor: 15_500 })
		);

		expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
			['ada@example.org', 'Your grant request to Hope Foundation is on its way']
		]);
		// $155.00 granted, $5.00 of it the covered fee.
		expect(mail.sent[0]?.text).toContain('150.00');
		expect(mail.sent[0]?.text).not.toContain('155.00');
	});

	it('sends no second grant request notice for a session submitted twice', async () => {
		const port = chariotProvider([grant(), grant()]);
		await mint(chariotDeps(port.port), fundGift());
		const mail = mailer();

		await mint(chariotDeps(port.port, { email: mail.port }), fundGift());

		expect(mail.sent).toHaveLength(0);
	});

	// slow mail is not the donor's wait: the form gives up at 30 seconds on a gift already recorded.
	it('answers with the grant without waiting on the donor’s notice', async () => {
		const handed: Promise<unknown>[] = [];
		const stalled: EmailProvider = { send: () => new Promise(() => {}) };

		const result = await mintQuote(
			chariotDeps(chariotProvider().port, {
				email: stalled,
				defer: (task) => {
					handed.push(task);
				}
			}),
			{ formId: FORM_ID, body: body(fundGift()), request: request() }
		);

		expect(result.ok && result.quote.paymentToken).toBe(GRANT_ID);
		expect(handed).toHaveLength(1);
	});

	it('answers with the grant when the donor’s notice cannot be sent', async () => {
		const broken: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		const result = await mint(chariotDeps(chariotProvider().port, { email: broken }), fundGift());

		expect(result.ok && result.quote.paymentToken).toBe(GRANT_ID);
	});
});

describe('mintQuote() — a gift sent in crypto', () => {
	/** a deployment holding NOWPayments and nothing else. */
	const NOWPAYMENTS_ENV = {
		NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
		NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
		TURNSTILE_SECRET_KEY: '0xSECRET'
	};
	const PAYMENT_ID = '5745459419';
	const ADDRESS = 'rNoTaReAlAdDrEsSfOrThIsSpEcXxXxXx';
	const XRP = {
		coin: 'xrp',
		name: 'Ripple',
		network: 'xrp',
		ticker: 'xrp',
		memoRequired: true
	} as const;
	const VALID_UNTIL = new Date('2026-09-24T12:00:00.000Z');

	const minted = (deposit: Partial<DepositInstructions> = {}): PaymentResult<Intent> => ({
		ok: true,
		value: {
			providerTxnId: PAYMENT_ID,
			// the adapter's token is the donation id it was told; the port below hands it back.
			paymentToken: '',
			deposit: {
				address: ADDRESS,
				memo: '2718281828',
				coin: 'xrp',
				network: 'xrp',
				coinAmount: '41.923071',
				validUntil: VALID_UNTIL,
				...deposit
			}
		}
	});

	/** the scripted port under NOWPayments' name, answering crypto on the account's own coins. */
	function nowpaymentsProvider(answers: readonly PaymentResult<Intent>[] = [minted()]) {
		const scripted = provider(answers);
		const port: PaymentProvider = {
			...scripted.port,
			processor: 'nowpayments',
			async createIntent(request) {
				const answer = await scripted.port.createIntent(request);
				if (!answer.ok) return answer;
				return {
					ok: true,
					value: { ...answer.value, paymentToken: request.metadata?.donation_id ?? '' }
				};
			},
			async readAccountChargeability() {
				return { ok: true, value: { chargesEnabled: true, rails: { crypto: 'active' } } } as const;
			},
			async readRailSwitchboard() {
				return { ok: true, value: { crypto: { offered: true, switchedOn: true } } } as const;
			},
			async readRecurringGiftProvision() {
				return { ok: false, reason: 'unsupported', detail: 'one deposit per payment' } as const;
			},
			async listPayableCoins() {
				return { ok: true, value: [XRP] } as const;
			}
		};
		return { port, requests: scripted.requests };
	}

	const cryptoDeps = (port: PaymentProvider = nowpaymentsProvider().port, over: DepsOver = {}) =>
		deps({ env: NOWPAYMENTS_ENV, provider: port, ...over });

	const cryptoGift = (over: Record<string, unknown> = {}) => ({
		method: 'crypto',
		coin: 'xrp',
		...over
	});

	/** the two entries a crypto quote's config read writes into the zone's own store. */
	const edge = edgeCache();
	const coinKey = new Request('https://give.example.workers.dev/__payable-coins');
	const railKey = new Request('https://give.example.workers.dev/__offered-rails');

	afterEach(async () => {
		await Promise.all([edge.delete(coinKey), edge.delete(railKey)]);
	});

	it('answers with where to send the coin, how much, the memo, the expiry and the address’s QR', async () => {
		const result = await mint(cryptoDeps(), cryptoGift());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.quote).toMatchObject({
			feeMinor: 0,
			totalMinor: 10_000,
			deposit: {
				address: ADDRESS,
				memo: '2718281828',
				coin: 'xrp',
				network: 'xrp',
				coinAmount: '41.923071',
				validUntil: '2026-09-24T12:00:00.000Z'
			}
		});
		expect(result.quote.deposit?.qr.rows[0]).toMatch(/^1111111[01]*1111111$/);
	});

	// the fee the screen states is the difference between the two figures, so a gift dropped on the
	// way to the wire is a fee stated against nothing.
	it('carries the gift figure the adapter stated beside the total', async () => {
		const port = nowpaymentsProvider([minted({ giftCoinAmount: '40.923071' })]);

		const result = await mint(cryptoDeps(port.port), cryptoGift({ coversFee: true }));

		expect(result.ok && result.quote.deposit?.giftCoinAmount).toBe('40.923071');
	});

	it('records a pending gift under NOWPayments’ payment id, with the coin and when the address closes', async () => {
		const result = await mint(cryptoDeps(), cryptoGift());

		const [paid] = await db.select().from(payment);
		expect(paid).toMatchObject({
			status: 'pending',
			provider: 'nowpayments',
			method: 'crypto',
			providerTxnId: PAYMENT_ID,
			amountMinor: 10_000,
			coin: 'xrp',
			coinNetwork: 'xrp',
			validUntil: VALID_UNTIL,
			// what arrived is the settlement's to write; nothing has.
			coinAmount: null
		});
		expect(result.ok && result.quote.paymentToken).toBe(paid?.donationId);
	});

	/**
	 * every figure and the coin are the server's: the price is the form-bounded gift grossed up at
	 * NOWPayments' own rate, the coin is the body's pick normalised and checked by the adapter against
	 * the account, and anything else the body names about the payment is read by nothing.
	 */
	it('mints the payment the server priced, whatever else the body says about it', async () => {
		const port = nowpaymentsProvider();

		await mint(
			cryptoDeps(port.port),
			cryptoGift({
				coin: ' XRP ',
				coversFee: true,
				totalMinor: 1,
				feeMinor: 0,
				price_amount: 0.01,
				pay_currency: 'btc',
				currency: 'EUR'
			})
		);

		expect(port.requests).toHaveLength(1);
		expect(port.requests[0]).toMatchObject({
			amountMinor: estimateFee(10_000, NOWPAYMENTS_FEE_RULE)?.totalMinor,
			currency: 'USD',
			method: 'crypto',
			coin: 'xrp',
			deploymentOrigin: 'https://give.example.workers.dev'
		});
	});

	/**
	 * the adapter's three refusals about the donor's choice, each under its own wire code. the
	 * sentences are the adapter's (../payments/nowpayments.ts), carried whole: each names the coin and
	 * the figure, and `below_minimum`'s names the minimum in dollars.
	 */
	it.each([
		{
			reason: 'coin_not_accepted',
			detail:
				'This organisation’s NOWPayments account takes no payment in `doge` today. No address was created.',
			figure: '`doge`'
		},
		{
			reason: 'below_minimum',
			detail:
				'A gift of $100.00 converts to 0.0009 BTC, under the 0.0003 BTC NOWPayments accepts in that coin (about $33.12). No address was created.',
			figure: '$33.12'
		},
		{
			reason: 'above_maximum',
			detail:
				'A gift of $100.00 is over what NOWPayments accepts in XRP. No address was created. NOWPayments said: maximum exceeded',
			figure: '$100.00'
		}
	] as const)(
		'refuses $reason under its own code, naming the figure, and records nothing',
		async ({ reason, detail, figure }) => {
			const port = nowpaymentsProvider([{ ok: false, reason, detail }]);

			const result = await mint(cryptoDeps(port.port), cryptoGift());

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe(reason);
			expect(refusalCode(result.reason)).toBe(reason);
			expect(result.message).toContain(figure);
			expect(result.fix).toContain('coins');
			expect(await db.select().from(payment)).toHaveLength(0);
		}
	);

	it('states the minimum as the gift the donor would type', async () => {
		const port = nowpaymentsProvider([
			{ ok: false, reason: 'below_minimum', detail: 'under the floor.', minimumMinor: 1194 }
		]);

		const result = await mint(cryptoDeps(port.port), cryptoGift());

		expect(result.ok === false && result.minAmountMinor).toBe(1194);
	});

	// the floor is on the charge, and a covered 1% is inside it: $11.82 grosses up to $11.94, $11.81 to
	// $11.93.
	it('states the minimum without the fee, where the donor covers it', async () => {
		const port = nowpaymentsProvider([
			{ ok: false, reason: 'below_minimum', detail: 'under the floor.', minimumMinor: 1194 }
		]);

		const result = await mint(cryptoDeps(port.port), cryptoGift({ coversFee: true }));

		expect(result.ok === false && result.minAmountMinor).toBe(1182);
	});

	it('tells the donor where to send the coin, once the gift is recorded', async () => {
		const mail = mailer();

		await mint(cryptoDeps(nowpaymentsProvider().port, { email: mail.port }), cryptoGift());

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		const text = mail.sent[0]?.text ?? '';
		for (const fact of ['Ripple', '41.923071', ADDRESS, '2718281828']) {
			expect(text).toContain(fact);
		}
	});

	/** a coin enabled after the served list was cached: the adapter took it, and the list has no name. */
	it('names a coin the cached list does not carry by its code', async () => {
		await edge.put(
			coinKey,
			new Response('[]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);
		const mail = mailer();

		await mint(cryptoDeps(nowpaymentsProvider().port, { email: mail.port }), cryptoGift());

		expect(mail.sent[0]?.text).toContain('XRP');
		expect(mail.sent[0]?.text).not.toContain('Ripple');
	});

	it('sends no notice for a payment NOWPayments did not create', async () => {
		const mail = mailer();
		const refused = nowpaymentsProvider([
			{ ok: false, reason: 'coin_not_accepted', detail: 'no `xrp` today.' }
		]);

		await mint(cryptoDeps(refused.port, { email: mail.port }), cryptoGift());

		expect(mail.sent).toHaveLength(0);
	});

	it('answers with the address when the donor’s notice cannot be sent', async () => {
		const broken: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		const result = await mint(
			cryptoDeps(nowpaymentsProvider().port, { email: broken }),
			cryptoGift()
		);

		expect(result.ok && result.quote.deposit?.address).toBe(ADDRESS);
		expect(await db.select().from(payment)).toHaveLength(1);
	});

	/** a slow NOWPayments is no card donor's wait: only a crypto quote reads the coin list. */
	it('reads no coin list for a gift on another rail, on a deployment holding NOWPayments too', async () => {
		let coinReads = 0;
		const nowpayments: PaymentProvider = {
			...nowpaymentsProvider().port,
			async listPayableCoins() {
				coinReads += 1;
				return { ok: true, value: [XRP] } as const;
			}
		};
		const card = provider();

		const result = await mint({
			...deps({ env: { ...STRIPE_ENV, ...NOWPAYMENTS_ENV } }),
			processors: processorsOf(card.port, nowpayments)
		});

		expect(result.ok).toBe(true);
		expect(card.requests).toHaveLength(1);
		expect(coinReads).toBe(0);
	});

	it('mints nothing for an amount outside the form’s bounds', async () => {
		const port = nowpaymentsProvider();

		const result = await mint(cryptoDeps(port.port), cryptoGift({ amountMinor: 1 }));

		expect(result.ok).toBe(false);
		expect(port.requests).toHaveLength(0);
	});
});
