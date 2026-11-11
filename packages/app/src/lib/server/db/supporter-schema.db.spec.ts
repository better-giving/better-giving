import type { InStatement } from '@libsql/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';
import { MIGRATIONS, openUnmigrated, rawSql, run, stmt } from './database.testing';
import { applyMigrations } from './migrate';
import { rejectionCode } from './rejection.testing';

// supporter fundraisers: `supporter`, `supporter_page`, `supporter_link`, `supporter_session`,
// `donation.supporter_page_id` and `org_profile.supporter_fundraisers_enabled`, read off the
// applied migrations rather than off ./schema.ts.

const SUPPORTERS_BY = '0037_supporter_fundraisers.sql';
const SUPPORTERS = MIGRATIONS.findIndex((m) => m.name === SUPPORTERS_BY);

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

const CONTACT_ID = '019fb500-0000-7000-8000-000000000001';
const GIFT_ID = '019fb500-0000-7000-8000-000000000002';

describe(`${SUPPORTERS_BY} over a database holding gifts and a profile`, () => {
	it('leaves every gift on no supporter page and the setting on', async () => {
		expect(SUPPORTERS, `${SUPPORTERS_BY} is committed`).toBeGreaterThan(0);
		const bare = await openUnmigrated();
		const before = rawSql(bare);
		await applyMigrations(bare, MIGRATIONS.slice(0, SUPPORTERS));
		await before.run(
			stmt(
				`insert into org_profile (id, legal_name, created_at, updated_at)
				 values ('default', 'Hope Shelter', 0, 0)`
			)
		);
		await before.run(
			stmt(
				`insert into contact (id, kind, display_name, created_at, updated_at)
				 values (?, 'individual', 'Gift Donor', 0, 0)`,
				CONTACT_ID
			)
		);
		await before.run(
			stmt(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values (?, ?, 10000, 'USD', 0, 0)`,
				GIFT_ID,
				CONTACT_ID
			)
		);

		expect(await applyMigrations(bare, MIGRATIONS.slice(SUPPORTERS, SUPPORTERS + 1))).toEqual([
			SUPPORTERS_BY
		]);

		expect(await before.all(stmt('select id, supporter_page_id from donation'))).toEqual([
			{ id: GIFT_ID, supporter_page_id: null }
		]);
		expect(
			await before.all(stmt('select legal_name, supporter_fundraisers_enabled from org_profile'))
		).toEqual([{ legal_name: 'Hope Shelter', supporter_fundraisers_enabled: 1 }]);
	});
});

let next = 0;
const fresh = () => `019fb500-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

const insertSupporter = (id: string, email: string) =>
	stmt(
		`insert into supporter (id, email, name, created_at) values (?, ?, 'Maya Rivera', 0)`,
		id,
		email
	);

/** the code and the constraint's name, so a row refused by a different constraint does not pass. */
const refusedBy = async (code: string, constraint: string, statement: InStatement) => {
	const chain = await rejectionCode(() => run(statement));
	expect(chain).toContain(code);
	expect(chain).toContain(constraint);
};

describe('a supporter', () => {
	it('refuses a second supporter at an address already held', async () => {
		await run(insertSupporter(fresh(), 'maya@example.org'));
		await refusedBy(
			SQLITE_CONSTRAINT_UNIQUE,
			'supporter.email',
			insertSupporter(fresh(), 'maya@example.org')
		);
	});

	it('refuses an address with a capital in it', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'supporter_email_lowercase_check',
			insertSupporter(fresh(), 'Maya@example.org')
		);
	});
});

type PageRow = {
	slug: string;
	status: string;
	goal: number;
	published: number | null;
	ended: number | null;
};

const LIVE: Omit<PageRow, 'slug'> = { status: 'live', goal: 500000, published: 1, ended: null };

let formSequence = 0;

/** a donation-settings row for a page to own; every page owns its own. */
async function settingsRow(): Promise<string> {
	formSequence += 1;
	const id = `frm_supporterpage${String(formSequence).padStart(4, '0')}`;
	await run(
		stmt(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values (?, 'fundraiser settings', ?, 'USD', 0, 0)`,
			id,
			POSTING_ACCOUNTS.donationsDeductible.id
		)
	);
	return id;
}

const insertPage = (id: string, supporterId: string, formId: string, row: PageRow) =>
	stmt(
		`insert into supporter_page (id, supporter_id, slug, title, story, goal_minor, currency, form_id,
		                             status, published_at, ended_at, created_at, updated_at)
		 values (?, ?, ?, 'Run for the shelter', 'I am running 10k.', ?, 'USD', ?, ?, ?, ?, 0, 0)`,
		id,
		supporterId,
		row.slug,
		row.goal,
		formId,
		row.status,
		row.published,
		row.ended
	);

describe('a supporter page', () => {
	const supporterId = fresh();
	let slugs = 0;
	const slug = () => `run-${++slugs}`;

	beforeAll(async () => {
		await run(insertSupporter(supporterId, 'page-owner@example.org'));
	});

	const refusedPage = async (code: string, constraint: string, row: Omit<PageRow, 'slug'>) =>
		refusedBy(
			code,
			constraint,
			insertPage(fresh(), supporterId, await settingsRow(), { slug: slug(), ...row })
		);

	it('refuses a second page at a slug already held', async () => {
		await run(insertPage(fresh(), supporterId, await settingsRow(), { slug: 'taken', ...LIVE }));
		await refusedBy(
			SQLITE_CONSTRAINT_UNIQUE,
			'supporter_page.slug',
			insertPage(fresh(), supporterId, await settingsRow(), { slug: 'taken', ...LIVE })
		);
	});

	it('refuses a second page on a settings row another page owns', async () => {
		const formId = await settingsRow();
		await run(insertPage(fresh(), supporterId, formId, { slug: slug(), ...LIVE }));
		await refusedBy(
			SQLITE_CONSTRAINT_UNIQUE,
			'supporter_page.form_id',
			insertPage(fresh(), supporterId, formId, { slug: slug(), ...LIVE })
		);
	});

	it('refuses a status off the list', async () => {
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_status_check', {
			...LIVE,
			status: 'draft'
		});
	});

	it('refuses a goal of nothing', async () => {
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_goal_minor_positive_check', {
			...LIVE,
			goal: 0
		});
	});

	it('refuses a live page never published, and a pending page that was', async () => {
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_published_check', {
			...LIVE,
			published: null
		});
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_published_check', {
			...LIVE,
			status: 'pending'
		});
	});

	it('refuses an ended page with no end, and a live page with one', async () => {
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_ended_check', {
			...LIVE,
			status: 'ended'
		});
		await refusedPage(SQLITE_CONSTRAINT_CHECK, 'supporter_page_ended_check', { ...LIVE, ended: 2 });
	});

	it('takes a pending page, a live one, and one ended before it went live', async () => {
		for (const row of [
			{ ...LIVE, status: 'pending', published: null },
			LIVE,
			{ ...LIVE, status: 'ended', published: null, ended: 2 }
		]) {
			const done = await run(
				insertPage(fresh(), supporterId, await settingsRow(), { slug: slug(), ...row })
			);
			expect(done.rowsAffected).toBe(1);
		}
	});
});

const HASH = (n: number) => n.toString(16).padStart(64, '0');

const insertLink = (n: number, supporterId: string, purpose: string, pageId: string | null) =>
	stmt(
		`insert into supporter_link (token_hash, supporter_id, purpose, supporter_page_id, expires_at, created_at)
		 values (?, ?, ?, ?, 1, 0)`,
		HASH(n),
		supporterId,
		purpose,
		pageId
	);

describe('a supporter link', () => {
	const supporterId = fresh();
	const pageId = fresh();

	beforeAll(async () => {
		await run(insertSupporter(supporterId, 'linked@example.org'));
		await run(
			insertPage(pageId, supporterId, await settingsRow(), {
				slug: 'linked',
				...LIVE,
				status: 'pending',
				published: null
			})
		);
	});

	it('refuses a purpose off the list', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'supporter_link_purpose_check',
			insertLink(1, supporterId, 'reset', null)
		);
	});

	it('refuses a confirm link naming no page, and a sign-in link naming one', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'supporter_link_page_check',
			insertLink(2, supporterId, 'confirm', null)
		);
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'supporter_link_page_check',
			insertLink(3, supporterId, 'sign_in', pageId)
		);
	});

	it('refuses a token stored as anything but its hash', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'supporter_link_token_hash_check',
			stmt(
				`insert into supporter_link (token_hash, supporter_id, purpose, expires_at, created_at)
				 values ('a-raw-token', ?, 'sign_in', 1, 0)`,
				supporterId
			)
		);
	});

	it('takes a confirm link for a page and a sign-in link', async () => {
		expect((await run(insertLink(4, supporterId, 'confirm', pageId))).rowsAffected).toBe(1);
		expect((await run(insertLink(5, supporterId, 'sign_in', null))).rowsAffected).toBe(1);
	});
});

describe('a gift given through a supporter page', () => {
	const supporterId = fresh();
	const pageId = fresh();

	const insertGift = (supporterPageId: string) =>
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at, supporter_page_id)
			 values (?, ?, 2500, 'USD', 0, 0, ?)`,
			fresh(),
			CONTACT_ID,
			supporterPageId
		);

	beforeAll(async () => {
		await run(
			stmt(
				`insert into contact (id, kind, display_name, created_at, updated_at)
				 values (?, 'individual', 'Gift Donor', 0, 0)`,
				CONTACT_ID
			)
		);
		await run(insertSupporter(supporterId, 'raising@example.org'));
		await run(insertPage(pageId, supporterId, await settingsRow(), { slug: 'raising', ...LIVE }));
	});

	it('refuses a page that does not exist', async () => {
		const chain = await rejectionCode(() => run(insertGift(fresh())));
		expect(chain).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('takes the page it was given through', async () => {
		expect((await run(insertGift(pageId))).rowsAffected).toBe(1);
	});
});
