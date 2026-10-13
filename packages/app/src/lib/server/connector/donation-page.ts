import type { Page as PageDocument } from '../../page/catalog';
import { stateAt } from '../../page/ended';
import type { Db } from '../db/client';
import type { Page as PageRow } from '../db/schema';
import { readDocument } from '../pages/document';
import { editPageDraft } from '../pages/draft-writer';
import { readTarget } from '../pages/queries';
import { resetDonationPage } from '../pages/reset';
import {
	blocksEdit,
	type CampaignStatus,
	invalid,
	pathText,
	type Refused,
	statusOf
} from './campaigns';

// the donation page's actions of `/connector/v1`: its read, its blocks and its Reset to default.
// the connector never makes the donation page: the dashboard's loaders are the ones that do
// ($lib/server/pages/donation-page.ts), so a deployment whose dashboard has never opened it answers
// every action here `not_found`, telling the operator to open it once.
//
// a blocks edit is the draft only, as a campaign's is. Reset writes the draft and the live page
// together (../pages/reset.ts), so donors see the default at once; on a page already the default
// it writes nothing and answers the page as it stands.

/** the donation page as `donation_page.get` answers it. */
export type DonationPage = {
	readonly status: CampaignStatus;
	readonly public_url: string | null;
	readonly has_unpublished_changes: boolean;
	readonly sharing: {
		readonly message: string | null;
		readonly channels: readonly string[] | null;
	};
	readonly blocks: PageDocument['blocks'];
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
		sharing: {
			message: draft.page.shareMessage ?? null,
			channels: draft.page.shareChannels ?? null
		},
		blocks: draft.page.blocks,
		updated_at: row.updatedAt.toISOString()
	};
}

/** replaces the donation page's draft blocks with `blocks`, in the catalog's shape. */
export async function replaceDonationBlocks(
	db: Db,
	origin: string,
	now: Date,
	body: unknown
): Promise<Done | Refused> {
	const edit = blocksEdit(db, body);
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

/** the donation page back to the default, draft and live page alike; its donation settings stay. */
export async function resetToDefault(db: Db, origin: string, now: Date): Promise<Done | Refused> {
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
