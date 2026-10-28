import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';
import { run, first, stmt } from '../db/database.testing';
import { rejectionCode } from './rejection.testing';

// the constraints `page` carries, each a table rebuild to change once shipped — the reason
// ./donation-schema.db.spec.ts opens with.
//
// `STRICT` on the table and `NO ACTION` on its foreign key are read off sqlite's catalogue by
// ./strict.db.spec.ts and not repeated here.
//
// the pool gives per-file storage, not per-test: every case starts with one Donation page, and a
// case probing a Donation page row takes that slot through `refusedAsDonationPage` and puts it back.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

let formSequence = 0;

/** a donation-settings row for a page to own; every page owns its own. */
async function settingsRow(): Promise<string> {
	formSequence += 1;
	const id = `frm_pageschema${String(formSequence).padStart(4, '0')}`;
	await run(
		stmt(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
		 values (?, 'page settings', ?, 'USD', 0, 0)`,
			id,
			POSTING_ACCOUNTS.donationsDeductible.id
		)
	);
	return id;
}

type PageRow = {
	type: string;
	name: string | null;
	slug: string | null;
	state: string;
	draft: string;
	published: string | null;
	last_published: string | null;
	campaign_type: string | null;
};

const DONATION_PAGE: PageRow = {
	type: 'donation_page',
	name: null,
	slug: null,
	state: 'live',
	draft: '{"blocks":[]}',
	published: '{"blocks":[]}',
	last_published: null,
	campaign_type: null
};

let pageSequence = 0;

async function insertPage(row: PageRow): Promise<string> {
	pageSequence += 1;
	const id = `019fc400-0000-7000-8000-${String(pageSequence).padStart(12, '0')}`;
	await run(
		stmt(
			`insert into page (id, type, name, slug, state, form_id, draft, published, last_published,
		                   campaign_type, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
			id,
			row.type,
			row.name,
			row.slug,
			row.state,
			await settingsRow(),
			row.draft,
			row.published,
			row.last_published,
			row.campaign_type
		)
	);
	return id;
}

beforeAll(async () => {
	await insertPage(DONATION_PAGE);
});

/** the database's refusal of `row` as the Donation page, tried with that slot emptied and refilled after. */
async function refusedAsDonationPage(row: PageRow): Promise<string> {
	await run(stmt(`delete from page where type = 'donation_page'`));
	try {
		return await rejectionCode(() => insertPage(row));
	} finally {
		await insertPage(DONATION_PAGE);
	}
}

describe('one Donation page, held by the table', () => {
	it('refuses a second Donation page', async () => {
		const message = await rejectionCode(() => insertPage(DONATION_PAGE));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.type');
	});
});

const CAMPAIGN: PageRow = {
	type: 'campaign',
	name: 'Winter coat drive',
	slug: 'winter-coat-drive',
	state: 'never_published',
	draft: '{"blocks":[],"goalMinor":1500000}',
	published: null,
	last_published: null,
	campaign_type: null
};

describe('a page is the Donation page or a campaign, and no other kind', () => {
	it.each([['event'], ['Campaign'], ['']])('refuses the type %j', async (type) => {
		const message = await rejectionCode(() => insertPage({ ...CAMPAIGN, slug: null, type }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_type_check');
	});
});

describe('a campaign slug is unique; the Donation page has none', () => {
	it('refuses a second campaign at a slug another holds', async () => {
		await insertPage({ ...CAMPAIGN, slug: 'spring-appeal' });
		const message = await rejectionCode(() => insertPage({ ...CAMPAIGN, slug: 'spring-appeal' }));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.slug');
	});

	it('refuses a slug on the Donation page, which is served at /donate', async () => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, slug: 'donate' });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_slug_check');
	});

	it.each([['never_published'], ['live'], ['unpublished']])(
		'refuses a %s campaign with no slug',
		async (state) => {
			const published = state === 'never_published' ? null : CAMPAIGN.draft;
			const message = await rejectionCode(() =>
				insertPage({ ...CAMPAIGN, slug: null, state, published })
			);
			expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message).toContain('page_slug_check');
		}
	);

	it('accepts an ended campaign whose slug another campaign has taken', async () => {
		const id = await insertPage({
			...CAMPAIGN,
			slug: null,
			state: 'ended',
			published: CAMPAIGN.draft
		});
		const row = await first(stmt(`select slug, state from page where id = ?`, id));
		expect(row).toEqual({ slug: null, state: 'ended' });
	});
});

describe('a campaign is named; the Donation page has no name of its own', () => {
	it.each([
		['a blank name', ''],
		['a lone NBSP', '\u00a0'],
		['no name', null]
	])('refuses a campaign with %s', async (_, name) => {
		const message = await rejectionCode(() =>
			insertPage({ ...CAMPAIGN, slug: 'name-probe', name })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_name_check');
	});

	it('refuses a name on the Donation page', async () => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, name: 'Donate' });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_name_check');
	});
});

describe('a page is never published, live, unpublished or ended', () => {
	it('accepts an unpublished campaign, which keeps its published page and its slug', async () => {
		const id = await insertPage({
			...CAMPAIGN,
			slug: 'unpublished-probe',
			state: 'unpublished',
			published: CAMPAIGN.draft
		});
		const row = await first(stmt(`select slug, state, published from page where id = ?`, id));
		expect(row).toEqual({
			slug: 'unpublished-probe',
			state: 'unpublished',
			published: CAMPAIGN.draft
		});
	});

	it.each([['draft'], ['published'], ['']])('refuses the state %j', async (state) => {
		const message = await rejectionCode(() =>
			insertPage({ ...CAMPAIGN, slug: 'state-probe', state })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_state_check');
	});

	it.each([['never_published'], ['unpublished'], ['ended']])(
		'refuses a Donation page that is %s',
		async (state) => {
			const message = await refusedAsDonationPage({ ...DONATION_PAGE, state });
			expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message).toContain('page_donation_page_live_check');
		}
	);
});

describe('a published page exists exactly when the page has been live', () => {
	it('refuses a never-published campaign holding a published page', async () => {
		const message = await rejectionCode(() =>
			insertPage({ ...CAMPAIGN, slug: 'published-probe', published: CAMPAIGN.draft })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_published_check');
	});

	it.each([['live'], ['unpublished'], ['ended']])(
		'refuses a %s campaign with no published page',
		async (state) => {
			const message = await rejectionCode(() =>
				insertPage({ ...CAMPAIGN, slug: 'published-probe', state, published: null })
			);
			expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message).toContain('page_published_check');
		}
	);

	it('refuses a last published page with no published page after it', async () => {
		const message = await rejectionCode(() =>
			insertPage({ ...CAMPAIGN, slug: 'published-probe', last_published: CAMPAIGN.draft })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_last_published_check');
	});
});

describe('each page document is a JSON object', () => {
	const LIVE = { ...CAMPAIGN, slug: 'json-probe', state: 'live', published: CAMPAIGN.draft };

	it.each([
		['draft', 'not json'],
		['draft', '[]'],
		['draft', 'null'],
		['published', '"a string"'],
		['last_published', '{"blocks":'],
		['last_published', '42']
	] as const)('refuses %s holding %j', async (column, value) => {
		const message = await rejectionCode(() => insertPage({ ...LIVE, [column]: value }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`page_${column}_object_check`);
	});
});

describe('a goal or an end date belongs to a campaign, never to the Donation page', () => {
	const GOAL = '{"blocks":[],"goalMinor":1500000}';
	const END = '{"blocks":[],"endsAt":1798761599999}';

	it.each([
		['draft', 'a goal', GOAL],
		['draft', 'an end date', END],
		['published', 'a goal', GOAL],
		['published', 'an end date', END],
		['last_published', 'a goal', GOAL],
		['last_published', 'an end date', END]
	] as const)('refuses a Donation page whose %s carries %s', async (column, _, value) => {
		const row = { ...DONATION_PAGE, last_published: DONATION_PAGE.published, [column]: value };
		const message = await refusedAsDonationPage(row);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_campaign_only_settings_check');
	});

	it('accepts both on a campaign, in each of its documents', async () => {
		const both = '{"blocks":[],"goalMinor":1500000,"endsAt":1798761599999}';
		const id = await insertPage({
			...CAMPAIGN,
			slug: 'goal-probe',
			state: 'live',
			draft: both,
			published: both,
			last_published: both
		});
		const row = await first(
			stmt(`select json_extract(published, '$.goalMinor') as goal from page where id = ?`, id)
		);
		expect(row).toEqual({ goal: 1500000 });
	});
});

describe("a campaign's type is one of the list, and the Donation page has none", () => {
	it('refuses a type on the Donation page', async () => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, campaign_type: 'year_end' });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_campaign_type_check');
	});

	it.each([['year-end'], ['Year_end'], ['gala'], ['']])('refuses the type %j', async (type) => {
		const message = await rejectionCode(() =>
			insertPage({ ...CAMPAIGN, slug: 'type-probe', campaign_type: type })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_campaign_type_check');
	});

	it.each([
		['tribute', 'type-tribute'],
		['other', 'type-other'],
		[null, 'type-none']
	])('accepts a campaign of the type %j', async (type, slug) => {
		const id = await insertPage({ ...CAMPAIGN, slug, campaign_type: type });
		const row = await first(stmt(`select campaign_type from page where id = ?`, id));
		expect(row).toEqual({ campaign_type: type });
	});
});

describe('every page owns its own donation-settings row', () => {
	it('refuses a second page naming a settings row another page owns', async () => {
		const owned = await first<{ form_id: string }>(
			stmt(`select form_id from page where type = 'donation_page'`)
		).then((row) => row?.form_id ?? null);
		const message = await rejectionCode(() =>
			run(
				stmt(
					`insert into page (id, type, name, slug, state, form_id, draft, created_at, updated_at)
				 values ('019fc400-0000-7000-8000-00000000ffff', 'campaign', 'Borrowed', 'borrowed',
				         'never_published', ?, '{}', 0, 0)`,
					owned
				)
			)
		);
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.form_id');
	});
});
