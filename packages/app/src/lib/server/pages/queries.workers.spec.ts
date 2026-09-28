import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { chatTurn, form, page, type PageState } from '../db/schema';
import type { PageType } from '../../page/keys';
import { deleteNeverPublishedCampaign } from './queries';

// the one delete of a page: a campaign that has never been live, with its owned settings row and
// its chat, in one `batch()`. everything that has been live is refused, and so is the Donation page.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

let sequence = 0;

/** a page of the given type and state, owning a fresh settings row, with one chat turn. */
async function pageWithChat(type: PageType, state: PageState) {
	sequence += 1;
	const [owned] = await db
		.insert(form)
		.values({
			name: `settings ${sequence}`,
			revenueAccountId: postableId('donationsDeductible'),
			currency: 'USD'
		})
		.returning({ id: form.id });
	if (!owned) throw new Error('inserting the fixture form returned no row');
	const campaign = type === 'campaign';
	const [row] = await db
		.insert(page)
		.values({
			type,
			name: campaign ? `Campaign ${sequence}` : null,
			slug: campaign ? `campaign-${sequence}` : null,
			state,
			formId: owned.id,
			draft: '{}',
			published: state === 'never_published' ? null : '{}'
		})
		.returning({ id: page.id });
	if (!row) throw new Error('inserting the fixture page returned no row');
	await db.insert(chatTurn).values({ pageId: row.id, seq: 1, author: 'operator', text: 'hello' });
	return { pageId: row.id, formId: owned.id };
}

async function remaining({ pageId, formId }: { pageId: string; formId: string }) {
	const pages = await db.select({ id: page.id }).from(page).where(eq(page.id, pageId));
	const forms = await db.select({ id: form.id }).from(form).where(eq(form.id, formId));
	const turns = await db
		.select({ id: chatTurn.id })
		.from(chatTurn)
		.where(eq(chatTurn.pageId, pageId));
	return { pages: pages.length, forms: forms.length, turns: turns.length };
}

describe('deleteNeverPublishedCampaign()', () => {
	it('removes a never-published campaign with its owned settings row and its chat', async () => {
		const made = await pageWithChat('campaign', 'never_published');
		expect(await deleteNeverPublishedCampaign(db, made.pageId)).toBe(true);
		expect(await remaining(made)).toEqual({ pages: 0, forms: 0, turns: 0 });
	});

	it.each([['live'], ['ended']] as const)('refuses a campaign that is %s', async (state) => {
		const made = await pageWithChat('campaign', state);
		expect(await deleteNeverPublishedCampaign(db, made.pageId)).toBe(false);
		expect(await remaining(made)).toEqual({ pages: 1, forms: 1, turns: 1 });
	});

	it('refuses the Donation page', async () => {
		const made = await pageWithChat('donation_page', 'live');
		expect(await deleteNeverPublishedCampaign(db, made.pageId)).toBe(false);
		expect(await remaining(made)).toEqual({ pages: 1, forms: 1, turns: 1 });
	});

	it('refuses a page that does not exist', async () => {
		expect(await deleteNeverPublishedCampaign(db, '019fc800-0000-7000-8000-000000000000')).toBe(
			false
		);
	});
});
