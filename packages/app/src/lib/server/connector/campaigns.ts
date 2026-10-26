import { readAmount } from '../../forms/amounts';
import { GIFTS_GO_TO } from '../../page/publish-form';
import { HEADING_MAX, type Page as PageDocument } from '../../page/catalog';
import { campaignShape, type Layout } from '../../page/shape';
import type { PageType } from '../../page/keys';
import { endDayOf, endOfDay, isTimeZone } from '../../page/end-date';
import { stateAt } from '../../page/ended';
import { placedImageIds } from '../../page/image-src';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import type { Page as PageRow } from '../db/schema';
import { firstMissingImage } from '../images/queries';
import { createCampaign, readCampaigns } from '../pages/campaign';
import { readDocument } from '../pages/document';
import { type DraftCommand, type DraftWritten, editPageDraft } from '../pages/draft-writer';
import { publishPage } from '../pages/publish';
import { endCampaign, readPage } from '../pages/queries';

// the campaign actions of `/connector/v1`, in the contract's terms: a campaign is `draft`,
// `published` or `ended`, money is a decimal string with its currency, a day is `YYYY-MM-DD`. a
// chat edits a campaign's content — its title, story, photos, tiers and questions — and never how
// it is laid out: the page picks its layout from what the content holds ($lib/page/shape.ts), and
// `campaigns.get` says which it picked. every edit goes through `editPageDraft`
// (../pages/draft-writer.ts), the writer the dashboard's own presses use, so a page the connector
// edits meets the same page rule a hand edit does, and is only ever the draft: donors see nothing of
// it until Publish. Publish and End are the dashboard's own (`publishPage` in ../pages/publish.ts,
// `endCampaign` in ../pages/queries.ts), guarded on the row as read just before.

export type CampaignStatus = 'draft' | 'published' | 'ended';

type Money = { readonly amount: string; readonly currency: string };

/** a campaign as `campaigns.list` answers it. */
export type CampaignSummary = {
	readonly id: string;
	readonly title: string;
	readonly status: CampaignStatus;
	readonly slug: string | null;
	readonly public_url: string | null;
	readonly goal: Money | null;
	readonly end_date: string | null;
	readonly updated_at: string;
};

const CURRENCY = 'USD';

const money = (minor: number | null | undefined): Money | null =>
	minor === null || minor === undefined
		? null
		: { amount: majorText(minor, CURRENCY), currency: CURRENCY };

export function statusOf(state: PageRow['state']): CampaignStatus {
	return state === 'never_published' ? 'draft' : state === 'live' ? 'published' : 'ended';
}

const publicUrl = (origin: string, slug: string | null, status: CampaignStatus) =>
	slug === null || status === 'draft' ? null : `${origin}/${slug}`;

/** every campaign, newest first, narrowed to `status` where one is asked for. */
export async function listCampaigns(
	db: Db,
	origin: string,
	now: Date,
	status: CampaignStatus | null
): Promise<CampaignSummary[]> {
	const listed = await readCampaigns(db, now.getTime());
	return listed
		.map((row): CampaignSummary => {
			const state = statusOf(row.state);
			return {
				id: row.id,
				title: row.name,
				status: state,
				slug: row.slug,
				public_url: publicUrl(origin, row.slug, state),
				goal: money(row.goalMinor),
				end_date: row.end?.day ?? null,
				updated_at: row.updatedAt.toISOString()
			};
		})
		.filter((row) => status === null || row.status === status);
}

/** a page's content as the connector reads and writes it: the draft's own keys, by these names. */
export const CONTENT_KEYS = ['heading', 'lede', 'story', 'hero', 'photos', 'tiers', 'faq'] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];
export type Content = Pick<PageDocument, ContentKey>;

/** the content keys a page of `type` holds: a campaign every one, the donation page its heading. */
export const CONTENT_KEYS_OF: Record<PageType, readonly ContentKey[]> = {
	campaign: CONTENT_KEYS,
	donation_page: ['heading']
};

/** a campaign as `campaigns.get` answers it: the summary, with its draft's content and settings. */
export type CampaignDetail = CampaignSummary & {
	readonly has_unpublished_changes: boolean;
	readonly sharing: { readonly message: string | null };
	readonly time_zone: string | null;
	/** the layout the draft's content draws in, which no edit picks. */
	readonly layout: Layout;
	readonly content: Content;
};

/** the content keys `page` holds, by their names. */
export function contentOf(page: PageDocument, type: PageType): Content {
	return Object.fromEntries(
		CONTENT_KEYS_OF[type].flatMap((key) => (page[key] === undefined ? [] : [[key, page[key]]]))
	) as Content;
}

/** the campaign `id`, or `null` where there is none or it is no campaign. */
export async function readCampaign(
	db: Db,
	origin: string,
	now: Date,
	id: string
): Promise<CampaignDetail | null> {
	const row = await readPage(db, id);
	if (row === null || row.type !== 'campaign') return null;
	return detailOf(row, origin, now);
}

function detailOf(row: PageRow, origin: string, now: Date): CampaignDetail | null {
	const draft = readDocument(row, 'draft', row.draft);
	if (!draft.ok) return null;
	const page = draft.page;
	const state = statusOf(stateAt(row, now.getTime()));
	return {
		id: row.id,
		title: row.name ?? page.name ?? '',
		status: state,
		slug: row.slug,
		public_url: publicUrl(origin, row.slug, state),
		goal: money(page.goalMinor),
		end_date: endDayOf(page),
		updated_at: row.updatedAt.toISOString(),
		has_unpublished_changes: row.published !== null && row.published !== row.draft,
		sharing: { message: page.shareMessage ?? null },
		time_zone: page.endsZone ?? null,
		layout: campaignShape(page, { logoImageId: null }).layout,
		content: contentOf(page, 'campaign')
	};
}

/** a refusal in the contract's validation shape. */
export type Refused = {
	readonly ok: false;
	readonly status: 404 | 409 | 422;
	readonly code: string;
	readonly detail: string;
	readonly errors?: readonly { readonly path: string; readonly message: string }[];
};

type Done = { readonly ok: true; readonly campaign: CampaignDetail };

/** makes a campaign from a title, on the starting page every new campaign opens on. */
export async function createFromTitle(
	db: Db,
	origin: string,
	now: Date,
	body: unknown
): Promise<Done | Refused> {
	const title =
		typeof body === 'object' && body !== null ? (body as { title?: unknown }).title : undefined;
	const trimmed = typeof title === 'string' ? title.trim() : '';
	if (trimmed.length === 0 || trimmed.length > HEADING_MAX) {
		return invalid('title', `title is the campaign's name: 1 to ${HEADING_MAX} characters`);
	}
	const { pageId } = await createCampaign(db, { name: trimmed });
	const made = await readCampaign(db, origin, now, pageId);
	if (made === null) throw new Error(`campaign ${pageId} was made and does not read back`);
	return { ok: true, campaign: made };
}

/** writes the content keys `body` names over a campaign's draft; a key left out is left alone. */
export async function updateContent(
	db: Db,
	origin: string,
	now: Date,
	id: string,
	body: unknown
): Promise<Done | Refused> {
	const edit = contentEdit(db, body, 'campaign');
	if (typeof edit !== 'function') return edit;
	const written = await editPageDraft(db, { type: 'campaign', id }, 'current', edit);
	return answer(db, origin, now, id, written);
}

/** what a key the content holds no place for is answered with: how the page is laid out instead. */
const NOT_CONTENT =
	'the page picks its whole layout from its content — a short story with nothing else is a card, a longer story or one to three tiers, questions and photos a letter, four or more a feature — so no layout, look, colour, block, order or share button is set; send content keys only';

/**
 * an update_content body — any of `CONTENT_KEYS_OF[type]`, each in the page rule's shape, null to
 * clear one — as the draft edit that writes those keys over the draft's; or its refusal. a photo it
 * places is one already stored here, never an id made up.
 */
export function contentEdit(db: Db, body: unknown, type: PageType): DraftCommand | Refused {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return invalid(
			'',
			`the body is a JSON object of content keys: ${CONTENT_KEYS_OF[type].join(', ')}`
		);
	const keys: readonly string[] = CONTENT_KEYS_OF[type];
	const unknown = Object.keys(body).find((key) => !keys.includes(key));
	if (unknown !== undefined) {
		return invalid(
			unknown,
			(CONTENT_KEYS as readonly string[]).includes(unknown)
				? `the donation page holds no ${unknown}; it draws one fixed layout and its content is its heading alone`
				: `${JSON.stringify(unknown)} is not content; ${NOT_CONTENT}`
		);
	}
	const posted = body as Record<string, unknown>;
	if (Object.keys(posted).length === 0)
		return invalid(
			'',
			`send at least one content key: ${CONTENT_KEYS_OF[type].join(', ')}; a key left out is left alone`
		);
	return async (draft) => {
		const next: Record<string, unknown> = { ...draft };
		for (const [key, value] of Object.entries(posted)) {
			if (value === null) {
				if (key === 'heading') next.heading = '';
				else delete next[key];
			} else next[key] = value;
		}
		const before = new Set(placedImageIds(draft));
		for (const key of ['hero', 'photos'] as const) {
			const added = idsNamed(posted[key]).filter((imageId) => !before.has(imageId));
			const missing = await firstMissingImage(db, added);
			if (missing !== null) {
				return {
					ok: false,
					path: [key],
					message: `no photo ${JSON.stringify(missing)} is stored here; add a photo through photos.upload_link instead of naming one`
				};
			}
		}
		return { ok: true, draft: next };
	};
}

/**
 * the image ids a posted `hero` or `photos` value names, from its well-formed `{ imageId }` entries
 * alone: any other entry is the page rule's to refuse.
 */
function idsNamed(value: unknown): string[] {
	return (Array.isArray(value) ? value : [value]).flatMap((entry) =>
		typeof entry === 'object' &&
		entry !== null &&
		typeof (entry as { imageId?: unknown }).imageId === 'string'
			? [(entry as { imageId: string }).imageId]
			: []
	);
}

const SETTINGS_KEYS: readonly string[] = ['goal', 'end_date', 'time_zone', 'sharing'];

/** sets a campaign's goal, end date and sharing on its draft; a key left out is left alone. */
export async function changeSettings(
	db: Db,
	origin: string,
	now: Date,
	id: string,
	body: unknown
): Promise<Done | Refused> {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return invalid('', `the body is a JSON object of ${SETTINGS_KEYS.join(', ')}`);
	const unset = Object.keys(body).find((key) => !SETTINGS_KEYS.includes(key));
	if (unset !== undefined) {
		return invalid(
			unset,
			`${JSON.stringify(unset)} is not a setting; the settings are ${SETTINGS_KEYS.join(', ')}, content goes through campaigns.update_content, and the page picks its layout from its content, so no layout, look, colour or block is set`
		);
	}
	const sharing = (body as { sharing?: unknown }).sharing;
	if (sharing !== undefined) {
		if (typeof sharing !== 'object' || sharing === null || Array.isArray(sharing))
			return invalid(
				'sharing',
				'sharing is { "message": "<what a share says>" }, or { "message": null } for none'
			);
		const other = Object.keys(sharing).find((key) => key !== 'message');
		if (other === 'channels') {
			return invalid(
				'sharing.channels',
				'every page offers the same share buttons, Copy link, Email, Facebook and WhatsApp, and none is chosen; send sharing.message only'
			);
		}
		if (other !== undefined)
			return invalid(`sharing.${other}`, 'sharing holds message alone; send sharing.message only');
	}
	const input = body as {
		goal?: unknown;
		end_date?: unknown;
		time_zone?: unknown;
		sharing?: unknown;
	};
	const written = await editPageDraft(db, { type: 'campaign', id }, 'current', (draft) => {
		const next: Record<string, unknown> = { ...draft };
		if (input.goal !== undefined) {
			if (input.goal === null) delete next.goalMinor;
			else {
				const goal = input.goal as { amount?: unknown; currency?: unknown };
				if (typeof goal.amount !== 'string' || (goal.currency ?? CURRENCY) !== CURRENCY) {
					return refuse(
						'goal',
						`goal is { "amount": "<decimal>", "currency": "${CURRENCY}" }, or null for none`
					);
				}
				const read = readAmount(goal.amount, CURRENCY);
				if (read.minor === null || read.minor <= 0) {
					return refuse(
						'goal.amount',
						`goal.amount ${JSON.stringify(goal.amount)} is not an amount above zero`
					);
				}
				next.goalMinor = read.minor;
			}
		}
		if (input.end_date !== undefined) {
			if (input.end_date === null) {
				delete next.endsAt;
				delete next.endsZone;
			} else {
				const zone = input.time_zone ?? draft.endsZone;
				if (typeof zone !== 'string' || !isTimeZone(zone)) {
					return refuse(
						'time_zone',
						'time_zone is the IANA zone the end day ends in, such as "America/New_York"; ask the operator which one'
					);
				}
				if (typeof input.end_date !== 'string')
					return refuse('end_date', 'end_date is YYYY-MM-DD, or null for none');
				const ends = endOfDay({ day: input.end_date, timeZone: zone, now: now.getTime() });
				if (!ends.ok) return refuse('end_date', ends.reason);
				next.endsAt = ends.endsAt;
				next.endsZone = zone;
			}
		}
		if (input.sharing !== undefined) {
			const { message } = input.sharing as { message?: unknown };
			if (message === null) delete next.shareMessage;
			else if (message !== undefined) next.shareMessage = message;
		}
		return { ok: true, draft: next };
	});
	return answer(db, origin, now, id, written);
}

async function answer(
	db: Db,
	origin: string,
	now: Date,
	id: string,
	written: DraftWritten
): Promise<Done | Refused> {
	switch (written.kind) {
		case 'gone':
			return missing(id);
		case 'stale':
			return changed('while this edit was being made', 'redo the edit on what it holds now');
		case 'refused':
			return invalid(pathText(written.path), written.message);
		case 'written':
			return { ok: true, campaign: await reread(db, origin, now, id) };
	}
}

/**
 * makes a campaign's draft live, through the dashboard's own Publish and its rules, guarded on the
 * row as read just before. `gifts_go_to` is the first Publish's answer to where gifts go, which the
 * chat asks the operator rather than answering itself: a program id to pin, or null to keep the
 * campaign's own donation settings. a later Publish takes none.
 */
export async function publishCampaign(
	db: Db,
	origin: string,
	now: Date,
	id: string,
	body: unknown
): Promise<Done | Refused> {
	if (body !== undefined && (typeof body !== 'object' || body === null))
		return invalid('', 'the body is a JSON object, or left out');
	const giftsGoTo =
		body === undefined ? undefined : (body as { gifts_go_to?: unknown }).gifts_go_to;
	if (giftsGoTo !== undefined && giftsGoTo !== null && typeof giftsGoTo !== 'string')
		return invalid(GIFTS_GO_TO, GIFTS_GO_TO_IS);
	const row = await readPage(db, id);
	if (row === null || row.type !== 'campaign') return missing(id);
	const outcome = await publishPage(db, { type: 'campaign', id }, row.updatedAt, {
		now: now.getTime(),
		giftsGoTo
	});
	switch (outcome.kind) {
		case 'gone':
			return missing(id);
		case 'stale':
			return changed('as it was being published', 'publish it again if it should still go live');
		case 'refused':
			if (outcome.at === GIFTS_GO_TO) return giftsGoToRefused(row.state === 'never_published');
			return { ok: false, status: 422, code: 'invalid', detail: outcome.text };
		case 'published':
			return { ok: true, campaign: await reread(db, origin, now, id) };
	}
}

const GIFTS_GO_TO_IS =
	'gifts_go_to is a program id to pin this campaign’s gifts to, or null to keep its own donation settings';

function giftsGoToRefused(first: boolean): Refused {
	const message = first
		? `a campaign’s first Publish says where its gifts go; ${GIFTS_GO_TO_IS}`
		: 'where gifts go is answered at a campaign’s first Publish only, and this one has been published; leave gifts_go_to out';
	return {
		ok: false,
		status: 422,
		code: 'invalid',
		detail: first
			? 'Nothing was published: ask the operator where this campaign’s gifts go, then publish again with gifts_go_to set to null to keep the campaign’s own donation settings, or to the id of the program to pin its gifts to.'
			: 'Nothing was published: gifts_go_to is taken at a campaign’s first Publish only. Publish again without it; where gifts go is changed in the dashboard, under Settings, Donation settings.',
		errors: [{ path: GIFTS_GO_TO, message }]
	};
}

/** takes a live campaign off the air through the dashboard's End, guarded on the row as just read. */
export async function endLiveCampaign(
	db: Db,
	origin: string,
	now: Date,
	id: string
): Promise<Done | Refused> {
	const row = await readPage(db, id);
	if (row === null || row.type !== 'campaign') return missing(id);
	const status = statusOf(stateAt(row, now.getTime()));
	if (status !== 'published') {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail: `Nothing was ended: only a published campaign can be ended, and this one is ${status}.`
		};
	}
	if (!(await endCampaign(db, id, row.updatedAt)))
		return changed('as it was being ended', 'end it again if it is still published');
	return { ok: true, campaign: await reread(db, origin, now, id) };
}

async function reread(db: Db, origin: string, now: Date, id: string): Promise<CampaignDetail> {
	const campaign = await readCampaign(db, origin, now, id);
	if (campaign === null) throw new Error(`campaign ${id} was written and does not read back`);
	return campaign;
}

function missing(id: string): Refused {
	return {
		ok: false,
		status: 404,
		code: 'not_found',
		detail: `Campaign ${id} does not exist on this deployment.`
	};
}

/** the 409 for a write that lost to another: when it changed, and what to do next. */
function changed(when: string, then: string): Refused {
	return {
		ok: false,
		status: 409,
		code: 'conflict',
		detail: `The campaign changed ${when}, probably in the dashboard. Read it again with campaigns.get and ${then}.`
	};
}

export const pathText = (path: readonly (string | number)[]) => path.join('.');

function refuse(path: string, message: string) {
	return { ok: false as const, path: path.split('.'), message };
}

export function invalid(path: string, message: string): Refused {
	return {
		ok: false,
		status: 422,
		code: 'invalid',
		detail: `The edit was refused: ${message}. Nothing was changed.`,
		errors: [{ path, message }]
	};
}
