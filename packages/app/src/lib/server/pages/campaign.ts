import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { NEW_FORM } from '../../forms/new-form';
import type { Page as PageDocument } from '../../page/catalog';
import { defaultCampaign } from '../../page/defaults';
import { endDayOf } from '../../page/end-date';
import { stateAt } from '../../page/ended';
import { MAX_FORM_NAME } from '../../forms/input-schema';
import { freeSlug } from '../../page/slug';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { page, type Page } from '../db/schema';
import { formInputValuesFrom, type ParsedForm, parseFormInput } from '../forms/form-input';
import { ownedFormInsert, readForm } from '../forms/queries';
import { readDocument } from './document';
import { ensureDonationPage } from './donation-page';
import { draftTurn } from './draft';
import { SLUG_ATTEMPTS } from './queries';

// a campaign's reads and its making. New campaign makes one page and the settings row it owns in
// one `batch()`:
// - the settings are the Donation page's live row copied (made first where there is none yet,
//   ./donation-page.ts), with the program left for the campaign to choose — by the chat from what
//   it is for, by hand, or at the first publish — and the row not live, so it takes no gift before
//   that publish and `deleteNeverPublishedCampaign` (./queries.ts) can still take it away. the
//   draft carries the same settings, since publish is what copies a draft's onto the row.
// - the page is the clean default campaign (`defaultCampaign` in ../../page/defaults.ts) under
//   the title, never published, at the address its name suggests or the first free `-2`, `-3`.
// - with a line saying what it is for, the title and that line are the chat's first turn.

/** a campaign that answers at its address: `page_name_check` holds every campaign to a name. */
export type ServedCampaign = Page & {
	readonly name: string;
	readonly state: 'live' | 'ended';
};

/**
 * the campaign at `slug` — live, drawn from its published page, or ended, drawn as having ended —
 * or `null` where none answers there. a never-published campaign's slug is held but answers nothing.
 * `state` is as of `now`: `ended` too for a live campaign past its published end (`isEnded`).
 */
export async function readServedCampaign(
	db: Db,
	slug: string,
	now: number
): Promise<ServedCampaign | null> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			and(eq(page.type, 'campaign'), eq(page.slug, slug), inArray(page.state, ['live', 'ended']))
		);
	if (!row) return null;
	return { ...row, state: stateAt(row, now) } as ServedCampaign;
}

/** a campaign as the Campaigns list reads it: its row, and its draft's goal and end. */
export type CampaignListing = Pick<Page, 'id' | 'slug' | 'state' | 'updatedAt'> & {
	name: string;
	goalMinor: number | null;
	/**
	 * the draft's end — or, for a campaign ended by its end date, the published end it ended on —
	 * and the day it closes on in the zone it was chosen in; null for no end.
	 */
	end: { readonly at: number; readonly day: string } | null;
};

/**
 * every campaign, newest first. the Donation page is no campaign and is not among them. a draft
 * the read rule refuses is listed without its goal and end, and logged, so one broken draft leaves
 * every other campaign on the list and its own editor reachable. `state` is as of `now`: `ended`
 * too for a live campaign past its published end (`isEnded`).
 */
export async function readCampaigns(db: Db, now: number): Promise<CampaignListing[]> {
	const rows = await db
		.select({
			id: page.id,
			name: page.name,
			slug: page.slug,
			state: page.state,
			updatedAt: page.updatedAt,
			draft: page.draft,
			published: page.published
		})
		.from(page)
		.where(eq(page.type, 'campaign'))
		.orderBy(desc(page.createdAt), desc(page.id));
	return rows.map(({ draft, published, name, ...stored }) => {
		const row = {
			...stored,
			state: stateAt({ ...stored, published }, now)
		};
		const endedOn =
			stored.state === 'live' && row.state === 'ended' ? publishedEnd(row.id, published) : null;
		// unreachable: `page_name_check` refuses a campaign without a name.
		if (name === null) throw new Error(`campaign ${row.id} has no name`);
		const parsed = readDocument({ id: row.id, type: 'campaign' }, 'draft', draft);
		if (!parsed.ok) return { ...row, name, goalMinor: null, end: endedOn };
		return {
			...row,
			name,
			goalMinor: parsed.page.goalMinor ?? null,
			end: endedOn ?? endOf(parsed.page)
		};
	});
}

/** a page document's end and the day it closes on, in the zone it was chosen in; null for none. */
function endOf(document: PageDocument): CampaignListing['end'] {
	const day = endDayOf(document);
	return document.endsAt === undefined || day === null ? null : { at: document.endsAt, day };
}

/** the published document's end, where the document passes the read rule; null otherwise. */
function publishedEnd(id: string, published: string | null): CampaignListing['end'] {
	if (published === null) return null;
	const parsed = readDocument({ id, type: 'campaign' }, 'published', published);
	return parsed.ok ? endOf(parsed.page) : null;
}

export type NewCampaign = {
	title: string;
	/** what the campaign is for; blank sends no turn. */
	line: string;
	/** the IANA zone of the browser that asked, which a date in the line is a day in. */
	timeZone: string;
	now: number;
};

/** makes a campaign from New campaign's title and line, and names its page. */
export async function createCampaign(
	db: Db,
	env: unknown,
	request: NewCampaign
): Promise<{ pageId: string }> {
	const donationPage = await ensureDonationPage(db);
	const copied = await readForm(db, donationPage.formId);
	if (copied === null) {
		throw new Error(`the Donation page's settings row ${donationPage.formId} is gone`);
	}
	const settings = parseFormInput({
		...formInputValuesFrom(copied),
		name: request.title.slice(0, MAX_FORM_NAME),
		status: NEW_FORM.status,
		program_mode: NEW_FORM.program_mode,
		program_id: NEW_FORM.program_id
	});
	if (!settings.ok) {
		throw new Error(
			`the Donation page's settings fail the form rule: ${JSON.stringify(settings.errors)}`
		);
	}
	const draft: PageDocument = {
		...defaultCampaign(),
		name: request.title,
		settings: {
			revenueAccountId: copied.revenueAccountId,
			minMinor: copied.minMinor,
			maxMinor: copied.maxMinor,
			currency: copied.currency,
			programMode: settings.value.programMode,
			programId: settings.value.programId,
			suggestedAmounts: copied.suggestedAmounts,
			allowedOrigins: copied.allowedOrigins
		}
	};
	const pageId = await insertCampaign(db, {
		name: request.title,
		settings: settings.value,
		draft: JSON.stringify(draft)
	});
	const line = request.line.trim();
	if (line === '') return { pageId };
	// the campaign is made whatever the turn does: a model that did not answer is a turn saying so,
	// and a turn that threw leaves the editor opening on the clean default rather than a second
	// campaign made by pressing Create again.
	try {
		await draftTurn(db, env, {
			pageId,
			message: `${request.title}\n${line}`,
			imageIds: [],
			timeZone: request.timeZone,
			now: request.now
		});
	} catch (e) {
		console.error(`the first chat turn on campaign ${pageId} failed:`, e);
	}
	return { pageId };
}

/**
 * the page and its owned settings row in one `batch()`, at the first address free when read. a
 * second create taking that address between the read and the batch fails it whole on
 * `page_slug_idx`, and the next attempt reads the addresses again.
 */
async function insertCampaign(
	db: Db,
	campaign: { name: string; settings: ParsedForm; draft: string }
): Promise<string> {
	for (let attempt = 1; ; attempt += 1) {
		const held = await db.select({ slug: page.slug }).from(page).where(isNotNull(page.slug));
		const owned = ownedFormInsert(db, campaign.settings);
		try {
			const [, [made]] = await db.batch([
				owned.statement,
				db
					.insert(page)
					.values({
						type: 'campaign',
						name: campaign.name,
						slug: freeSlug(campaign.name, new Set(held.map((row) => row.slug))),
						state: 'never_published',
						formId: owned.id,
						draft: campaign.draft
					})
					.returning({ id: page.id })
			]);
			if (!made) throw new Error('inserting the campaign returned no row');
			return made.id;
		} catch (error) {
			if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
				throw error;
			}
		}
	}
}
