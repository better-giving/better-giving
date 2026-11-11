import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { slugFromTitle } from '../../page/slug';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { form, page, supporter, supporterPage } from '$lib/server/db/schema';
import { readForms } from '$lib/server/forms/queries';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { setSupporterFundraisersEnabled } from '$lib/server/org/queries';
import { insertPage } from '$lib/server/pages/page-row.testing';
import { createRateLimiter } from '$lib/server/runtime/rate-limiter';
import {
	emptySupporterTables,
	fromCaller,
	pendingPage,
	STARTED_AT,
	startDeps,
	startInput
} from './fundraiser.testing';
import { resendConfirmLink, signInWithLink } from './links';
import { startFundraiser } from './start';

// Start a fundraiser, against the real tables: the supporter, the pending page and the settings row
// it owns, the confirm link, and every refusal ahead of them.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

const pageRow = async (id: string) => {
	const [row] = await db.select().from(supporterPage).where(eq(supporterPage.id, id));
	if (!row) throw new Error(`page ${id} was not written`);
	return row;
};

describe('starting a fundraiser', () => {
	it('makes a pending page owning a settings row of its own, in the nonprofit currency', async () => {
		const { deps, mailed, settled } = startDeps(db);
		const started = await startFundraiser(deps, fromCaller(), startInput());
		if (!started.ok) throw new Error(started.reason);
		await settled();

		const row = await pageRow(started.pageId);
		expect(row).toMatchObject({
			title: 'Run for the shelter',
			story: 'I am running 10k.',
			goalMinor: 50_000,
			currency: 'USD',
			status: 'pending',
			publishedAt: null,
			slug: 'run-for-the-shelter'
		});
		const [owned] = await db.select().from(form).where(eq(form.id, row.formId));
		expect(owned?.status).toBe('live');
		expect(mailed).toEqual([
			{
				to: 'maya@example.org',
				token: expect.any(String),
				arm: { kind: 'first', pageTitle: 'Run for the shelter' }
			}
		]);
	});

	it('takes the page live once its confirm link is opened', async () => {
		const { pageId, token } = await pendingPage(db);
		const opened = await signInWithLink(
			db,
			new Request('https://give.example/f/link'),
			token,
			new Date(STARTED_AT.getTime() + 60_000)
		);
		expect(opened).toMatchObject({ ok: true, purpose: 'confirm', page: { id: pageId } });
		expect(await pageRow(pageId)).toMatchObject({
			status: 'live',
			publishedAt: new Date(STARTED_AT.getTime() + 60_000)
		});
	});

	it('keeps one supporter per address and does not rename them', async () => {
		await pendingPage(db);
		await pendingPage(db, { name: 'Somebody Else', title: 'A second run' });
		expect(await db.select({ name: supporter.name }).from(supporter)).toEqual([
			{ name: 'Maya Rivera' }
		]);
		expect(await db.select().from(supporterPage)).toHaveLength(2);
	});

	it('leaves its settings row off the Forms list', async () => {
		const { pageId } = await pendingPage(db);
		const owned = (await pageRow(pageId)).formId;
		expect((await readForms(db)).map((row) => row.id)).not.toContain(owned);
	});

	it('takes an address no campaign, route or other fundraiser holds', async () => {
		const taken = slugFromTitle('Run for the shelter');
		const campaign = await insertPage(db, 'campaign');
		await db.update(page).set({ slug: taken }).where(eq(page.id, campaign));

		const first = await pendingPage(db);
		const second = await pendingPage(db);
		expect([first.slug, second.slug]).toEqual([`${taken}-2`, `${taken}-3`]);
	});

	it('never takes an address a route answers', async () => {
		expect((await pendingPage(db, { title: 'Admin' })).slug).toBe('admin-2');
	});
});

describe('a start refused', () => {
	it('when the organisation has switched fundraisers off', async () => {
		expect(await setSupporterFundraisersEnabled(db, false)).toBe('saved');
		const { deps, mailed, settled } = startDeps(db);
		expect(await startFundraiser(deps, fromCaller(), startInput())).toEqual({
			ok: false,
			reason: 'closed'
		});
		await settled();
		expect(mailed).toEqual([]);
		expect(await db.select().from(supporterPage)).toEqual([]);
	});

	it('when the spam check does not clear', async () => {
		const { deps } = startDeps(db, {
			checkChallenge: async () => ({
				ok: false,
				reason: 'rejected',
				detail: 'the token was used',
				operatorFix: null
			})
		});
		expect(await startFundraiser(deps, fromCaller(), startInput())).toEqual({
			ok: false,
			reason: 'challenge_failed'
		});
		expect(await db.select().from(supporterPage)).toEqual([]);
	});

	it('when the spam check cannot be made', async () => {
		const { deps } = startDeps(db, {
			checkChallenge: async () => ({
				ok: false,
				reason: 'unavailable',
				detail: 'no answer',
				operatorFix: null
			})
		});
		expect(await startFundraiser(deps, fromCaller(), startInput())).toEqual({
			ok: false,
			reason: 'challenge_unavailable'
		});
	});

	it('past the bucket for one client address, before the spam check runs', async () => {
		let checks = 0;
		const { deps } = startDeps(db, {
			limiter: createRateLimiter({ limit: 1, period: 60 }),
			checkChallenge: async () => {
				checks += 1;
				return { ok: true };
			}
		});
		const request = () =>
			new Request('https://give.example/f/start', {
				method: 'POST',
				headers: { 'x-better-giving-client-ip': '198.51.100.9' }
			});
		expect((await startFundraiser(deps, request(), startInput())).ok).toBe(true);
		expect(
			await startFundraiser(deps, request(), startInput({ email: 'other@example.org' }))
		).toEqual({ ok: false, reason: 'too_many' });
		expect(checks).toBe(1);
	});
});

describe('the setting', () => {
	it('reads on for a deployment with no profile, and cannot be switched off without one', async () => {
		await run(stmt('delete from org_profile'));
		expect(await setSupporterFundraisersEnabled(db, false)).toBe('no-profile');
		expect(await setSupporterFundraisersEnabled(db, true)).toBe('saved');
		const { deps } = startDeps(db);
		expect((await startFundraiser(deps, fromCaller(), startInput())).ok).toBe(true);
	});
});

describe('Send it again after a start', () => {
	const LATER = new Date(STARTED_AT.getTime() + 5 * 60_000);

	/** a resend for `page` at `email`, and every mail it sent once its work ran. */
	async function resend(
		page: { pageId: string },
		email = 'maya@example.org',
		over: { limiter?: ReturnType<typeof createRateLimiter>; request?: Request } = {}
	) {
		const { deps, mailed, settled } = startDeps(db, { now: LATER });
		const answer = await resendConfirmLink(
			{ ...deps, ...(over.limiter ? { limiter: over.limiter } : {}) },
			over.request ?? fromCaller(),
			{ email, pageId: page.pageId }
		);
		await settled();
		return { answer, mailed };
	}

	const open = (token: string) =>
		signInWithLink(
			db,
			new Request('https://give.example/f/link'),
			token,
			new Date(LATER.getTime() + 60_000)
		);

	it('mails a fresh confirm link that publishes the page, and the first one stops working', async () => {
		const first = await pendingPage(db);
		const { answer, mailed } = await resend(first);
		expect(answer).toBe('sent');
		expect(mailed).toEqual([
			{
				to: 'maya@example.org',
				token: expect.any(String),
				arm: { kind: 'first', pageTitle: 'Run for the shelter' }
			}
		]);
		expect(await open(first.token)).toEqual({ ok: false });
		expect(await open(mailed[0]?.token ?? '')).toMatchObject({
			ok: true,
			purpose: 'confirm',
			page: { id: first.pageId }
		});
		expect(await pageRow(first.pageId)).toMatchObject({ status: 'live' });
	});

	it('leaves the confirm link of the supporter’s other pending page working', async () => {
		const other = await pendingPage(db, { title: 'A second run' });
		const resent = await pendingPage(db);
		await resend(resent);
		expect(await open(other.token)).toMatchObject({ ok: true, page: { id: other.pageId } });
	});

	it('answers an unknown address the same way and mails nobody', async () => {
		const first = await pendingPage(db);
		expect(await resend(first, 'nobody@example.org')).toEqual({ answer: 'sent', mailed: [] });
		expect((await open(first.token)).ok).toBe(true);
	});

	it('mails nothing for a page already live', async () => {
		const first = await pendingPage(db);
		expect((await open(first.token)).ok).toBe(true);
		expect(await resend(first)).toEqual({ answer: 'sent', mailed: [] });
	});

	it('answers too many tries past the address’s bucket, mailing nothing more', async () => {
		const first = await pendingPage(db);
		const limiter = createRateLimiter({ limit: 2, period: 60 });
		const answers: string[] = [];
		let sent = 0;
		for (let n = 0; n < 3; n += 1) {
			const { answer, mailed } = await resend(first, 'maya@example.org', { limiter });
			answers.push(answer);
			sent += mailed.length;
		}
		expect(answers).toEqual(['sent', 'sent', 'too_many']);
		expect(sent).toBe(2);
	});
});
