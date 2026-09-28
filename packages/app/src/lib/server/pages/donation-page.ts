import { eq } from 'drizzle-orm';
import { NEW_FORM } from '../../forms/new-form';
import { defaultDonationPage } from '../../page/defaults';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { page, type Page } from '../db/schema';
import { parseFormInput } from '../forms/form-input';
import { ownedFormInsert } from '../forms/queries';
import { readActivePrograms } from '../programs/queries';

// the donation page, made the first time anything needs it: /donate, its editor, or a new campaign
// copying its donation settings. no migration seeds it, so a fresh deployment answers /donate before
// anyone has opened the editor.
//
// the race between two first needs is settled by the table, not by a read: the page and its owned
// settings row go in one `batch()`, `page_one_donation_page_idx` in ../db/schema.ts refuses the
// second batch whole, and the loser reads the winner's row. an `ON CONFLICT DO NOTHING` on the page
// insert would let the losing batch commit its settings row with no page naming it.

/** the page's staff-facing settings label; a donor never reads a form's name. */
const SETTINGS_NAME = 'Donation page';

/** the donation page's row, made from the default if there is none yet. */
export async function ensureDonationPage(db: Db): Promise<Page> {
	return (await readDonationPage(db)) ?? (await makeDonationPage(db));
}

async function readDonationPage(db: Db): Promise<Page | null> {
	const [row] = await db.select().from(page).where(eq(page.type, 'donation_page'));
	return row ?? null;
}

async function makeDonationPage(db: Db): Promise<Page> {
	const programs = await readActivePrograms(db);
	// "donor chooses" once there is a choice to make; with one program or none, as a new form opens.
	const programMode = programs.length >= 2 ? 'choice' : NEW_FORM.program_mode;
	const settings = parseFormInput({
		...NEW_FORM,
		name: SETTINGS_NAME,
		// live at once, unlike a new form: the page is live from the start and takes gifts through
		// this row.
		status: 'live',
		program_mode: programMode
	});
	if (!settings.ok) {
		throw new Error(
			`the Donation page's opening settings fail the form rule: ${JSON.stringify(settings.errors)}`
		);
	}
	const document = JSON.stringify(defaultDonationPage());
	const owned = ownedFormInsert(db, settings.value);
	try {
		const [, [made]] = await db.batch([
			owned.statement,
			db
				.insert(page)
				.values({
					type: 'donation_page',
					state: 'live',
					formId: owned.id,
					draft: document,
					published: document
				})
				.returning()
		]);
		if (!made) throw new Error('inserting the Donation page returned no row');
		return made;
	} catch (error) {
		if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		const winner = await readDonationPage(db);
		if (winner === null) throw error;
		return winner;
	}
}
