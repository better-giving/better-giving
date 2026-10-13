import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '../../forms/definition';
import { defaultDonationPage } from '../../page/defaults';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { form, page, program } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from './donation-page';
import { publishPage } from './publish';
import { saveDraftSettings } from './editor';

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

async function ownedProgram(formId: string) {
	const { programMode, programId } = await ownedForm(formId);
	return { programMode, programId };
}

async function versionNow(): Promise<Date> {
	const [row] = await donationPages();
	if (!row) throw new Error('there is no Donation page');
	return row.updatedAt;
}

async function publishAsItStands(): Promise<void> {
	const outcome = await publishPage(db, { type: 'donation_page' }, await versionNow(), {
		now: Date.now()
	});
	expect(outcome).toMatchObject({ kind: 'published' });
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

	it('pins the one program where only one is active', async () => {
		await activePrograms('Food bank');
		const made = await ensureDonationPage(db);
		const [food] = await db.select({ id: program.id }).from(program);
		expect(await ownedProgram(made.formId)).toEqual({
			programMode: 'pinned',
			programId: food?.id
		});
	});
});

describe('the Donation page’s program, while the operator has chosen none', () => {
	it('follows the active programs as they come and go, a Publish between them included', async () => {
		const made = await ensureDonationPage(db);
		expect(await ownedProgram(made.formId)).toEqual({ programMode: 'none', programId: null });
		await publishAsItStands();

		await activePrograms('Food bank', 'Shelter');
		expect(await ownedProgram((await ensureDonationPage(db)).formId)).toEqual({
			programMode: 'choice',
			programId: null
		});

		await db
			.update(program)
			.set({ status: 'archived', archivedAt: new Date() })
			.where(eq(program.name, 'Shelter'));
		const [food] = await db
			.select({ id: program.id })
			.from(program)
			.where(eq(program.name, 'Food bank'));
		expect(await ownedProgram((await ensureDonationPage(db)).formId)).toEqual({
			programMode: 'pinned',
			programId: food?.id
		});
	});

	it('stops following once the operator’s saved choice is published', async () => {
		const made = await ensureDonationPage(db);
		const body = new FormData();
		body.set(WHICH_FORM, 'page-settings');
		body.set(RECORD_VERSION, String((await versionNow()).getTime()));
		body.set('program_mode', 'none');
		body.set('program_id', '');
		body.set('min_minor', '1');
		body.set('max_minor', '10000');
		body.set('suggested_amounts[0]', '25');
		expect(await saveDraftSettings(db, { type: 'donation_page' }, body, 'gone')).toEqual({
			saved: 'settings'
		});
		await publishAsItStands();

		await activePrograms('Food bank', 'Shelter');

		expect(await ownedProgram((await ensureDonationPage(db)).formId)).toEqual({
			programMode: 'none',
			programId: null
		});
		expect((await ownedForm(made.formId)).suggestedAmounts).toBe('[2500]');
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
