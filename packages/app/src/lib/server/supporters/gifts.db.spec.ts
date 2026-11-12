import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { donation, supporterPage } from '$lib/server/db/schema';
import { mintQuote } from '$lib/server/donations/quote';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { setSupporterFundraisersEnabled } from '$lib/server/org/queries';
import { readRaisedByFormWithin } from '$lib/server/ledger/queries';
import { gift, refund } from '$lib/server/pages/settled-gifts.testing';
import { soleProcessor } from '$lib/server/payments/processors.testing';
import { refusing } from '$lib/server/payments/provider';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { signInWithLink } from './links';
import { fundraiserRaised } from './pages';

// a gift given on a supporter's page: refused by the donation submission unless the page is live and
// shown, tagged with the page when it is, and counted in the page's total and the organisation's.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, {
		tax_id: '12-3456789',
		deductibility_statement: 'No goods or services were provided.'
	});
});

const LIVE_AT = new Date(STARTED_AT.getTime() + 60_000);

/** a page as its state names it, and the settings row a gift through it names. */
async function fundraiser(state: 'pending' | 'live' | 'hidden' | 'ended') {
	const { pageId, token } = await pendingPage(db);
	if (state !== 'pending') {
		await signInWithLink(db, new Request('https://give.example/f/link'), token, LIVE_AT);
	}
	if (state === 'hidden') {
		await db.update(supporterPage).set({ hiddenAt: LIVE_AT }).where(eq(supporterPage.id, pageId));
	}
	if (state === 'ended') {
		await db
			.update(supporterPage)
			.set({ status: 'ended', endedAt: LIVE_AT })
			.where(eq(supporterPage.id, pageId));
	}
	const [row] = await db
		.select({ formId: supporterPage.formId })
		.from(supporterPage)
		.where(eq(supporterPage.id, pageId));
	if (!row) throw new Error(`page ${pageId} was not written`);
	return { pageId, formId: row.formId };
}

let intents = 0;

/** a card gift submitted to the donation endpoint through `formId`. */
function submit(formId: string) {
	return mintQuote(
		{
			db,
			env: {
				STRIPE_SECRET_KEY: 'sk_test_abc',
				STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
				STRIPE_WEBHOOK_SECRET: 'whsec_abc',
				TURNSTILE_SECRET_KEY: '0xSECRET'
			},
			processors: soleProcessor({
				...refusing('stripe', 'unsupported', 'not part of a single gift'),
				createIntent: async () => {
					intents += 1;
					return {
						ok: true,
						value: { providerTxnId: `pi_fundraiser_${intents}`, paymentToken: 'secret' }
					};
				}
			}),
			verifyChallenge: async () => ({ ok: true }),
			email: { send: async () => ({ ok: true }) },
			defer: () => {}
		},
		{
			formId,
			body: {
				formId,
				amountMinor: 10_000,
				frequency: 'one_time',
				method: 'card',
				coversFee: false,
				email: 'ada@example.org',
				firstName: 'Ada',
				lastName: 'Okafor',
				consentedToContact: false,
				turnstileToken: 'tok'
			},
			request: new Request(`https://give.example/api/v1/forms/${formId}/donations`, {
				method: 'POST'
			})
		}
	);
}

describe('a gift submitted through a fundraiser', () => {
	it('is taken on a live page and names the page', async () => {
		const { pageId, formId } = await fundraiser('live');
		const quoted = await submit(formId);
		expect(quoted.ok).toBe(true);
		expect(await db.select({ page: donation.supporterPageId }).from(donation)).toEqual([
			{ page: pageId }
		]);
	});

	it('is still taken on a live page once the organisation has switched fundraisers off', async () => {
		const { pageId, formId } = await fundraiser('live');
		expect(await setSupporterFundraisersEnabled(db, false)).toBe('saved');
		expect((await submit(formId)).ok).toBe(true);
		expect(await db.select({ page: donation.supporterPageId }).from(donation)).toEqual([
			{ page: pageId }
		]);
	});

	for (const state of ['pending', 'hidden', 'ended'] as const) {
		it(`is refused on a ${state} page, with nothing written`, async () => {
			const { formId } = await fundraiser(state);
			const before = intents;
			const quoted = await submit(formId);
			expect(quoted).toMatchObject({ ok: false, reason: 'form_not_published' });
			expect(intents).toBe(before);
			expect(await db.select().from(donation)).toEqual([]);
		});
	}
});

describe('what a fundraiser has raised', () => {
	it('is its settled gifts, net of refunds, and counts in the organisation total', async () => {
		const { pageId, formId } = await fundraiser('live');
		await gift(db, formId, 10_000);
		const refunded = await gift(db, formId, 4_000);
		await gift(db, formId, 2_500, false);
		await refund(db, refunded, 4_000);

		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 10_000, gifts: 1 });
		const byForm = await readRaisedByFormWithin(db, { from: null, before: null });
		expect(byForm.reduce((sum, row) => sum + row.raisedMinor, 0)).toBe(10_000);
	});

	it('is nothing for a page with no gifts', async () => {
		const { pageId } = await fundraiser('live');
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 0, gifts: 0 });
	});

	it('keeps counting a gift after the page has ended', async () => {
		const { pageId, formId } = await fundraiser('live');
		await gift(db, formId, 10_000);
		await db
			.update(supporterPage)
			.set({ status: 'ended', endedAt: LIVE_AT })
			.where(eq(supporterPage.id, pageId));
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 10_000, gifts: 1 });
	});
});
