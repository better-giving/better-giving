import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDonationPage } from '../../page/defaults';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { form, page, program } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from './donation-page';

// the donation page made on first need: no migration seeds it, and whichever reader asks first makes
// it, against the real D1 whose one-Donation-page index settles two asking at once.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from program'),
		env.DB.prepare('delete from org_profile')
	]);
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
});

async function activePrograms(...names: string[]) {
	for (const name of names) await db.insert(program).values({ name });
}

async function donationPages() {
	return db.select().from(page).where(eq(page.type, 'donation_page'));
}

async function ownedForm(id: string) {
	const [row] = await db.select().from(form).where(eq(form.id, id));
	if (!row) throw new Error(`no form row ${id}`);
	return row;
}

describe('ensureDonationPage on a deployment that has none', () => {
	it('makes one live page from the default, greeting the organisation by name', async () => {
		const made = await ensureDonationPage(db);
		const [row, ...more] = await donationPages();
		expect(more).toEqual([]);
		expect(row?.id).toBe(made.id);
		expect(row?.state).toBe('live');
		const expected = defaultDonationPage();
		expect(JSON.parse(row?.published ?? 'null')).toEqual(expected);
		expect(JSON.parse(row?.draft ?? 'null')).toEqual(expected);
	});
});

describe('the settings row the Donation page owns', () => {
	it('is live at once, so the page takes gifts before anyone edits it', async () => {
		const made = await ensureDonationPage(db);
		expect((await ownedForm(made.formId)).status).toBe('live');
	});

	it('lets the donor choose where two programs are active', async () => {
		await activePrograms('Food bank', 'Shelter');
		const made = await ensureDonationPage(db);
		expect((await ownedForm(made.formId)).programMode).toBe('choice');
	});

	it('asks about no program where only one is active', async () => {
		await activePrograms('Food bank');
		const made = await ensureDonationPage(db);
		expect((await ownedForm(made.formId)).programMode).toBe('none');
	});
});

describe('ensureDonationPage once the page exists', () => {
	it('hands back the same row and makes no second one', async () => {
		const first = await ensureDonationPage(db);
		const again = await ensureDonationPage(db);
		expect(again.id).toBe(first.id);
		expect(await donationPages()).toHaveLength(1);
	});

	it('makes one page when two first needs arrive at once, and leaves no settings row unowned', async () => {
		const batch = vi.spyOn(db, 'batch');
		const [one, two] = await Promise.all([ensureDonationPage(db), ensureDonationPage(db)]);

		// both got past the read and wrote, so the index is what settled it rather than the order
		const rejected = batch.mock.settledResults.flatMap((settled) =>
			settled.type === 'rejected' ? [rejectionCode(() => Promise.reject(settled.value))] : []
		);
		expect(await Promise.all(rejected)).toEqual([
			expect.stringMatching(/page\.type.*\bSQLITE_CONSTRAINT_UNIQUE\b/)
		]);
		expect(batch).toHaveBeenCalledTimes(2);
		expect(one.id).toBe(two.id);
		expect(await donationPages()).toHaveLength(1);
		expect(await db.select({ id: form.id }).from(form)).toEqual([{ id: one.formId }]);
	});
});
