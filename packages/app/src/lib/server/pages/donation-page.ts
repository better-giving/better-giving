import { and, eq, exists, isNull, ne, or, sql } from 'drizzle-orm';
import { NEW_FORM } from '../../forms/new-form';
import { defaultDonationPage } from '../../page/defaults';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { form, page, type Page } from '../db/schema';
import { type ParsedForm, parseFormInput } from '../forms/form-input';
import { ownedFormInsert, type StoredForm } from '../forms/queries';
import { type ProgramOption, readActivePrograms } from '../programs/queries';
import { readDocument } from './document';
import { type DraftSettings, settingsOfRow } from './queries';

// the donation page, made the first time anything needs it: /donate, its editor, or a new campaign
// copying its donation settings. no migration seeds it, so a fresh deployment answers /donate before
// anyone has opened the editor.
//
// the race between two first needs is settled by the table, not by a read: the page and its owned
// settings row go in one `batch()`, `page_one_donation_page_idx` in ../db/schema.ts refuses the
// second batch whole, and the loser reads the winner's row. an `ON CONFLICT DO NOTHING` on the page
// insert would let the losing batch commit its settings row with no page naming it.
//
// **the program follows the active programs until the operator chooses.** the page is made on a
// fresh deployment's first /donate, before any program exists, so a mode fixed then would ask
// nothing for good. while the live page carries no donation settings of its own, its settings row
// asks donors to choose with two programs or more active, pins the one with exactly one, and asks
// nothing with none (`followedProgram`), brought up to date by every read through
// `ensureDonationPage`. a page carries settings once the operator saves Donation settings and
// publishes them (./publish.ts), and from then on their choice stands; Reset keeps it (./reset.ts).

/** the page's staff-facing settings label; a donor never reads a form's name. */
const SETTINGS_NAME = 'Donation page';

/**
 * the donation page's row, made from the default if there is none yet, its settings row's program
 * brought up to the active programs while the operator has chosen none (`followActivePrograms`).
 */
export async function ensureDonationPage(db: Db): Promise<Page> {
	const found = await readDonationPage(db);
	if (found === null) return makeDonationPage(db);
	await followActivePrograms(db, found);
	return found;
}

/** the program settings the Donation page takes while the operator has chosen none. */
export function followedProgram(
	active: readonly ProgramOption[]
): Pick<ParsedForm, 'programMode' | 'programId'> {
	const [only, second] = active;
	if (only === undefined) return { programMode: 'none', programId: null };
	if (second === undefined) return { programMode: 'pinned', programId: only.id };
	return { programMode: 'choice', programId: null };
}

/**
 * the settings row's program moved to `followedProgram`'s where it differs, while the live page
 * carries no donation settings of its own. the guard is the statement's, so a Publish landing
 * between the read and the write keeps what it wrote.
 */
async function followActivePrograms(db: Db, row: Page): Promise<void> {
	const live = readDocument(row, 'published', row.published);
	if (live.ok && live.page.settings !== undefined) return;
	const { programMode, programId } = followedProgram(await readActivePrograms(db));
	await db
		.update(form)
		.set({ programMode, programId })
		.where(
			and(
				eq(form.id, row.formId),
				or(ne(form.programMode, programMode), sql`${form.programId} is not ${programId}`),
				exists(
					db
						.select({ id: page.id })
						.from(page)
						.where(
							and(eq(page.id, row.id), sql`json_type(${page.published}, '$.settings') is null`)
						)
				)
			)
		);
}

async function readDonationPage(db: Db): Promise<Page | null> {
	const [row] = await db.select().from(page).where(eq(page.type, 'donation_page'));
	return row ?? null;
}

/** the settings row the Donation page opens on, its program following `active`. */
function openingSettings(active: readonly ProgramOption[]): ParsedForm {
	const { programMode, programId } = followedProgram(active);
	const settings = parseFormInput({
		...NEW_FORM,
		name: SETTINGS_NAME,
		// live at once, unlike a new form: the page is live from the start and takes gifts through
		// this row.
		status: 'live',
		program_mode: programMode,
		program_id: programId ?? ''
	});
	if (!settings.ok) {
		throw new Error(
			`the Donation page's opening settings fail the form rule: ${JSON.stringify(settings.errors)}`
		);
	}
	return settings.value;
}

/**
 * the donation settings the Donation page's row holds while the operator has chosen none: what it
 * opened on, its program following the programs active now. the fund, currency and sites stay
 * `owned`'s.
 */
export async function unchosenSettings(db: Db, owned: StoredForm): Promise<DraftSettings> {
	const opening = openingSettings(await readActivePrograms(db));
	return {
		...settingsOfRow(owned),
		minMinor: opening.minMinor,
		maxMinor: opening.maxMinor,
		programMode: opening.programMode,
		programId: opening.programId,
		suggestedAmounts: [...opening.suggestedAmounts]
	};
}

async function makeDonationPage(db: Db): Promise<Page> {
	const document = JSON.stringify(defaultDonationPage());
	const owned = ownedFormInsert(db, openingSettings(await readActivePrograms(db)));
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

/**
 * records that the Donation page's editor has asked for the mission and been answered — saved or
 * skipped — so it is never asked again. the first answer's moment stands.
 */
export async function markDonationEditorVisited(db: Db): Promise<void> {
	await db
		.update(page)
		.set({ editorVisitedAt: new Date() })
		.where(and(eq(page.type, 'donation_page'), isNull(page.editorVisitedAt)));
}
