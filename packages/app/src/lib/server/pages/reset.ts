import { isDeepStrictEqual } from 'node:util';
import { and, eq, exists } from 'drizzle-orm';
import { z } from 'zod';
import { defineForm, type RejectionStatus } from '../../forms/definition';
import type { Page as PageDocument } from '../../page/catalog';
import { defaultDonationPage } from '../../page/defaults';
import { RESET_FORM_ID } from '../../page/publish-form';
import { invalid, parseForm, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import { chatTurn, type Page, page } from '../db/schema';
import { readDocument, type StoredDocument } from './document';
import { STALE } from './publish';
import { readOwnedRow, readTarget, settingsOfRow } from './queries';

// the Donation page's Reset to default, and the action arm its editor answers the press with.
// a campaign has none: nothing here takes a page to name, and a campaign's editor names no such form.
//
// a Reset puts the current default Donation page (`defaultDonationPage` in ../../page/defaults.ts)
// in the draft and the live page alike, so both take the Organisation's look and share message
// and the default share buttons;
// clears `last_published`, so Undo has nothing to put back; and empties the page's chat — in one
// `batch()` guarded on the version the editor was drawn at, as ./publish.ts's presses are.
// - the live donation settings stay: the owned settings row is not written, and the document
//   carries the live page's two switches and, where the live page carries settings of its own, that
//   row's, so a settings or switch change not yet published goes with the draft. a live page with
//   none keeps its program following the active programs (./donation-page.ts). a live page the read
//   rule refuses (./document.ts) takes the default's switches and keeps the row's settings, since
//   Reset is how that page is repaired and what the operator chose there cannot be read.
// - the page's id and its owned row stay, so a gift already made on the page still names both.
// - a page with no edits (`hasEditsToReset`) is refused: a Reset there would only move its version.

/** what a Reset to default did. */
export type ResetOutcome =
	| { readonly kind: 'reset' }
	/** the page has no edits: it is the default already, with no chat. */
	| { readonly kind: 'nothing' }
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' };

/** the Donation page reset to the default, keeping its live donation settings and switches. */
export async function resetDonationPage(db: Db, version: Date): Promise<ResetOutcome> {
	const row = await readTarget(db, { type: 'donation_page' });
	if (row === null) return { kind: 'gone' };
	// unreachable: the Donation page is live from the start, and only a Publish writes `published`.
	if (row.published === null) throw new Error(`page ${row.id} has no live page`);
	if (!(await hasEditsToReset(db, row))) return { kind: 'nothing' };
	const live = readDocument(row, 'published', row.published);
	const fresh = defaultDonationPage();
	const chosen = !live.ok || live.page.settings !== undefined;
	const document = JSON.stringify({
		...fresh,
		switches: live.ok ? live.page.switches : fresh.switches,
		...(chosen ? { settings: settingsOfRow(await readOwnedRow(db, row)) } : {})
	});

	const drawn = and(
		eq(page.id, row.id),
		eq(page.updatedAt, version),
		eq(page.draft, row.draft),
		eq(page.published, row.published)
	);
	const [, reset] = await db.batch([
		db
			.delete(chatTurn)
			.where(
				and(eq(chatTurn.pageId, row.id), exists(db.select({ id: page.id }).from(page).where(drawn)))
			),
		db
			.update(page)
			.set({ draft: document, published: document, lastPublished: null })
			.where(drawn)
			.returning({ id: page.id })
	]);
	return reset.length === 1 ? { kind: 'reset' } : { kind: 'stale' };
}

/** the parts of a Donation page's document Reset puts back. */
function face(document: PageDocument) {
	const { layout, palette, blocks } = document;
	return {
		layout,
		palette,
		blocks,
		look: document.look ?? null,
		share: document.shareMessage ?? null,
		channels: document.shareChannels ?? null
	};
}

const DEFAULT_FACE = face(defaultDonationPage());

function isDefault(stored: StoredDocument): boolean {
	return stored.ok && isDeepStrictEqual(face(stored.page), DEFAULT_FACE);
}

/**
 * whether the Donation page has anything Reset would put back: a draft or a live page other than
 * the default, one the read rule refuses among them, or a chat.
 */
export async function hasEditsToReset(db: Db, row: Page): Promise<boolean> {
	const draft = readDocument(row, 'draft', row.draft);
	if (!isDefault(draft)) return true;
	if (row.published !== null && !isDefault(readDocument(row, 'published', row.published))) {
		return true;
	}
	const [turn] = await db
		.select({ id: chatTurn.id })
		.from(chatTurn)
		.where(eq(chatTurn.pageId, row.id))
		.limit(1);
	return turn !== undefined;
}

const RESET = defineForm({ id: RESET_FORM_ID, schema: z.object({}) });

const NOTHING_TO_RESET =
	'Nothing was reset: the Donation page is already the default, with no chat.';
const FAILED = 'Resetting failed and nothing was changed. Try again.';

/**
 * the Donation page editor's Reset to default, run against the version the editor was drawn at and
 * answered at the confirm's button. `gone` is what a press on no Donation page is told.
 */
export async function answerResetPress(db: Db, body: FormData, gone: string) {
	const submission = parseForm(body, RESET);
	if (!submission.ok) return invalid(400, submission.reject());
	const seen = submittedVersion(body);
	const refuse = (status: RejectionStatus, text: string) =>
		invalid(status, submission.reject({ formErrors: [text] }));
	let outcome: ResetOutcome;
	try {
		outcome = await resetDonationPage(db, seen);
	} catch (e) {
		console.error('resetting the Donation page failed:', e);
		return refuse(500, FAILED);
	}
	switch (outcome.kind) {
		case 'reset':
			return { reset: true as const };
		case 'nothing':
			return refuse(422, NOTHING_TO_RESET);
		case 'stale':
			return refuse(409, STALE);
		case 'gone':
			return refuse(404, gone);
	}
}
