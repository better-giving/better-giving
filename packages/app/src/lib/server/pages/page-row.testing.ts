import { env } from 'cloudflare:test';
import { vi } from 'vitest';
import type { Page } from '../../page/catalog';
import { defaultCampaign } from '../../page/defaults';
import type { PageType } from '../../page/keys';
import { postableId } from '../db/accounts';
import type { Db } from '../db/client';
import { form, page } from '../db/schema';
import { endCampaign, readPage } from './queries';

// a page and its owned settings row, put in for a spec that needs one. not a spec itself — no
// pool's `include` matches this name — and nothing in the app imports it.

export const SETTINGS = {
	revenueAccountId: postableId('donationsDeductible'),
	minMinor: 500,
	maxMinor: 100_000,
	currency: 'USD',
	programMode: 'none',
	programId: null,
	suggestedAmounts: [2500, 5000],
	allowedOrigins: []
} as const satisfies Page['settings'];

export const CAMPAIGN_NAME = 'Winter coat drive';

let sequence = 0;

/**
 * a page of `type` whose draft is `draft`, published as `live` where that is given. the Donation
 * page is always live, and there is one, so it replaces any other and its chat.
 */
export async function insertPage(
	db: Db,
	type: PageType,
	draft: Page = { ...defaultCampaign(), settings: SETTINGS },
	live: Page | null = type === 'donation_page' ? draft : null
): Promise<string> {
	if (type === 'donation_page') {
		await env.DB.batch([
			env.DB.prepare(
				"delete from chat_turn where page_id in (select id from page where type = 'donation_page')"
			),
			env.DB.prepare("delete from page where type = 'donation_page'")
		]);
	}
	sequence += 1;
	const [owned] = await db
		.insert(form)
		.values({
			name: `settings ${sequence}`,
			revenueAccountId: SETTINGS.revenueAccountId,
			currency: 'USD'
		})
		.returning({ id: form.id });
	if (!owned) throw new Error('inserting the fixture form returned no row');
	const campaign = type === 'campaign';
	const [row] = await db
		.insert(page)
		.values({
			type,
			name: campaign ? CAMPAIGN_NAME : null,
			slug: campaign ? `winter-coats-${sequence}` : null,
			state: live === null ? 'never_published' : 'live',
			formId: owned.id,
			draft: JSON.stringify(draft),
			published: live === null ? null : JSON.stringify(live)
		})
		.returning({ id: page.id });
	if (!row) throw new Error('inserting the fixture page returned no row');
	return row.id;
}

/**
 * a campaign in `state` put over the existing settings row `formId`, for a spec whose row is already
 * written and which needs a page to own it.
 */
export async function campaignOwning(
	formId: string,
	state: 'never_published' | 'ended'
): Promise<void> {
	await env.DB.prepare(
		`insert into page (id, type, name, slug, state, form_id, draft, published, created_at, updated_at)
		 values (?, 'campaign', ?, ?, ?, ?, '{}', ?, 0, 0)`
	)
		.bind(
			crypto.randomUUID(),
			CAMPAIGN_NAME,
			`winter-coats-${(sequence += 1)}`,
			state,
			formId,
			state === 'ended' ? '{}' : null
		)
		.run();
}

/** ends the live campaign `pageId` as End does, at the version it stands at; throws where it did not. */
export async function endAsItStands(db: Db, pageId: string): Promise<void> {
	const row = await readPage(db, pageId);
	if (row === null || !(await endCampaign(db, pageId, row.updatedAt))) {
		throw new Error(`the fixture campaign ${pageId} did not end`);
	}
}

/** a Workers AI binding answering each call with the next of `replies`, in the free model's format. */
export function answering(...replies: unknown[]) {
	const run = vi.fn();
	for (const reply of replies) {
		run.mockImplementationOnce(async () => {
			if (reply instanceof Error) throw reply;
			return { response: typeof reply === 'string' ? reply : JSON.stringify(reply) };
		});
	}
	return { run };
}
