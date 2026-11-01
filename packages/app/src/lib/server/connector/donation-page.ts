import { stateAt } from '../../page/ended';
import type { Db } from '../db/client';
import type { Page as PageRow } from '../db/schema';
import { readDocument } from '../pages/document';
import { editPageDraft } from '../pages/draft-writer';
import { readTarget } from '../pages/queries';
import { resetDonationPage } from '../pages/reset';
import {
	type CampaignStatus,
	type Content,
	contentEdit,
	contentOf,
	invalid,
	pathText,
	type Refused,
	statusOf
} from './campaigns';

// the donation page's actions of `/connector/v1`: its read, its content and its Reset to default.
// the connector never makes the donation page: the dashboard's loaders are the ones that do
// ($lib/server/pages/donation-page.ts), so a deployment whose dashboard has never opened it answers
// every action here `not_found`, telling the operator to open it once.
//
// the donation page draws one fixed layout — its title, the program chooser, the donation box, About
// us, the share buttons and the footer — so its content is its heading alone. a content edit is the
// draft only, as a campaign's is. Reset writes the draft and the live page
// together (../pages/reset.ts), so donors see the default at once; on a page already the default
// it writes nothing and answers the page as it stands. with no Publish step between it and donors,
// Reset takes `confirm: true` in its body, the JSON boolean and nothing else, which the chat sends
// only once the operator has said yes; without it Reset is refused and writes nothing.

/** the donation page as `donation_page.get` answers it. */
export type DonationPage = {
	readonly status: CampaignStatus;
	readonly public_url: string | null;
	readonly has_unpublished_changes: boolean;
	readonly sharing: { readonly message: string | null };
	readonly content: Content;
	readonly updated_at: string;
};

type Done = { readonly ok: true; readonly page: DonationPage };

const TARGET = { type: 'donation_page' } as const;

const NOT_OPENED: Refused = {
	ok: false,
	status: 404,
	code: 'not_found',
	detail:
		'The donation page does not exist on this deployment yet. Ask the operator to open Donation page in the dashboard once, which makes it, then try again.'
};

const CHANGED: Refused = {
	ok: false,
	status: 409,
	code: 'conflict',
	detail:
		'The donation page changed while this was being done, probably in the dashboard. Read it again with donation_page.get and redo the change on what it holds now.'
};

/** the donation page, or the refusal where the dashboard has not made it yet. */
export async function readDonationPage(db: Db, origin: string, now: Date): Promise<Done | Refused> {
	const row = await readTarget(db, TARGET);
	return row === null ? NOT_OPENED : { ok: true, page: pageOf(row, origin, now) };
}

function pageOf(row: PageRow, origin: string, now: Date): DonationPage {
	const draft = readDocument(row, 'draft', row.draft);
	// a draft no longer passing the rule is repaired by Reset, in the dashboard or here.
	if (!draft.ok) throw new Error(`the donation page's draft fails its rule: ${draft.message}`);
	const status = statusOf(stateAt(row, now.getTime()));
	return {
		status,
		public_url: status === 'published' ? `${origin}/donate` : null,
		has_unpublished_changes: row.published !== null && row.published !== row.draft,
		sharing: { message: draft.page.shareMessage ?? null },
		content: contentOf(draft.page, 'donation_page'),
		updated_at: row.updatedAt.toISOString()
	};
}

/** writes the donation page's heading, as `body` names it, over its draft. */
export async function updateDonationContent(
	db: Db,
	origin: string,
	now: Date,
	body: unknown
): Promise<Done | Refused> {
	const edit = contentEdit(db, body, 'donation_page');
	if (typeof edit !== 'function') return edit;
	const written = await editPageDraft(db, TARGET, 'current', edit);
	switch (written.kind) {
		case 'gone':
			return NOT_OPENED;
		case 'stale':
			return CHANGED;
		case 'refused':
			return invalid(pathText(written.path), written.message);
		case 'written':
			return readDonationPage(db, origin, now);
	}
}

const RESET_UNCONFIRMED: Refused = {
	ok: false,
	status: 422,
	code: 'invalid',
	detail:
		'Nothing was reset: Reset replaces the live donation page donors see with the default, at once, with no Publish step. First ask the operator, saying so, and reset again with confirm set to true only once they agree.',
	errors: [
		{
			path: 'confirm',
			message:
				'is true, sent once the operator has agreed to replace the live donation page with the default'
		}
	]
};

/**
 * the donation page back to the default, draft and live page alike; its donation settings stay.
 * `body` is a JSON object holding `confirm: true`, or Reset is refused.
 */
export async function resetToDefault(
	db: Db,
	origin: string,
	now: Date,
	body: unknown
): Promise<Done | Refused> {
	if (body !== undefined && (typeof body !== 'object' || body === null))
		return invalid('', 'the body is a JSON object holding confirm');
	if (body === undefined || (body as { confirm?: unknown }).confirm !== true)
		return RESET_UNCONFIRMED;
	const row = await readTarget(db, TARGET);
	if (row === null) return NOT_OPENED;
	const outcome = await resetDonationPage(db, row.updatedAt);
	switch (outcome.kind) {
		case 'gone':
			return NOT_OPENED;
		case 'stale':
			return CHANGED;
		case 'nothing':
		case 'reset':
			return readDonationPage(db, origin, now);
	}
}
