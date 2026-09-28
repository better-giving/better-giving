import type { FormConfig } from '@better-giving/form/v1';
import { data } from 'react-router';
import type { OrgInfo } from '../../donate/blocks/types';
import type { PageWithCardProps } from '../../donate/page-with-card';
import { type PageLook, titleHeading } from '../../donate/page-view';
import { type Page, parsePage } from '../../page/catalog';
import type { PageType } from '../../page/keys';
import type { ShareChannel } from '../../page/share';
import type { Db } from '../db/client';
import type { OrgProfile } from '../db/schema';
import { cachedCadences } from '../forms/cadence-cache';
import { cachedCoins } from '../forms/coin-cache';
import type { FormRecord } from '../forms/form-input';
import { readPublishedConfig, renderableConfig } from '../forms/published-config';
import { cachedRails } from '../forms/rail-cache';
import type { OrgSharing } from '../org/presentation';
import { readOrgLook, readOrgProfile, readOrgSharing, readOrgStory } from '../org/queries';
import { present } from '../org/receipt-fields';
import { createPaymentProviders } from '../payments/factory';

// everything a donor page draws beyond its own stored document, read for one page: the donation
// page at /donate, a campaign at its address, and either one in the editor's preview.
//
// the card's configuration is the owned settings row's served config, read exactly as
// ../../../routes/api.v1.forms.$id.config.ts reads it, so the page and the embed refuse on the same
// ladder: an account approved for no rail refuses here for the same reason the endpoint does. the
// preview reads that row as publishing the draft would leave it (`asPublished` below). the
// gift itself goes through `/api/v1/forms/:id/donations` like any form's, same-origin, and this
// deployment's own origin is accepted off that request (`corsHeaders` in ../api/cors.ts,
// `acceptableHostnames` in ../donations/quote.ts) — a donor page is on no `site` row and on no
// form's `allowed_origins`, so unticking a site never takes one down.
//
// the stored document passes the read rule (`parsePage`) here. one that is missing, or that the rule
// now refuses, draws the plain page — the donation box alone — and is logged, so a page broken by a
// narrowed rule still takes gifts while somebody repairs it.
//
// the organisation's story, look and sharing are read live on every draw, so a save on the
// dashboard's organisation page reaches every page at once.

/** a page as its loader holds it: its row's facts, the document to draw, and its public address. */
export type PageSource = {
	readonly id: string;
	readonly type: PageType;
	/** the settings row the page owns, whose served config the card takes the gift against. */
	readonly formId: string;
	/** a campaign's name; null on the donation page. */
	readonly name: string | null;
	/** the stored document's text — `published` for a donor, the draft for the preview. */
	readonly document: string | null;
	/** the path the page is public at, `/donate` or a campaign's, which the share buttons send. */
	readonly address: string;
};

/** what a donor page's component is handed: `PageWithCard`'s props, every one serializable. */
export type PageViewData = Omit<PageWithCardProps, 'seams'>;

export type LoadedPage =
	| { readonly kind: 'page'; readonly view: PageViewData }
	/** the stored document is missing or fails the rule: the card alone, in the page's look. */
	| { readonly kind: 'plain'; readonly config: FormConfig; readonly look: PageLook }
	/** the served config refuses the owned row: no card can be drawn. */
	| { readonly kind: 'refused' };

/** the channels a page offers where the organisation has chosen none. */
const SHARE_CHANNELS_DEFAULT: readonly ShareChannel[] = ['facebook', 'email', 'copy-link'];

export async function loadPageView(
	db: Db,
	env: unknown,
	source: PageSource,
	request: Request,
	{ preview = false }: { readonly preview?: boolean } = {}
): Promise<LoadedPage> {
	const origin = new URL(request.url).origin;
	const processors = createPaymentProviders(env);
	const parsed = parsePage(source.type, storedDocument(source.document));
	const [served, story, orgLook, sharing, profile] = await Promise.all([
		readPublishedConfig(
			db,
			source.formId,
			env,
			() => cachedCadences(processors, origin),
			() => cachedRails(processors, origin),
			() => cachedCoins(processors, origin),
			preview
				? (form) => asPublished(form, parsed.ok ? parsed.page.settings : undefined)
				: undefined
		),
		readOrgStory(db),
		readOrgLook(db),
		readOrgSharing(db),
		readOrgProfile(db)
	]);
	const result = renderableConfig(served);
	// the served config alone reaches the page: `result.form` carries `allowed_origins`, the sites
	// this organisation's forms may be used on, which a document served to anyone is no place for.
	if (!result.ok) return { kind: 'refused' };
	const { config } = result;

	if (!parsed.ok) {
		console.error(
			`page ${source.id} (${source.type}) fails the read rule at \`${parsed.path.join('.')}\`, so it draws its donation box alone:`,
			parsed.message
		);
		return { kind: 'plain', config, look: orgLook.look };
	}
	const { page } = parsed;
	const orgName = config.orgLegalName;
	const firstTitle = page.blocks.find((block) => block.type === 'title');

	return {
		kind: 'page',
		view: {
			type: source.type,
			page,
			pageName: source.name,
			org: {
				name: orgName,
				mission: story.story.mission,
				vision: story.story.vision,
				info: orgInfo(config, profile, sharing)
			},
			look: page.look ?? orgLook.look,
			sharing: {
				channels: sharing.channels ?? SHARE_CHANNELS_DEFAULT,
				message:
					page.shareMessage ??
					sharing.message ??
					titleHeading(firstTitle?.heading ?? '', {
						type: source.type,
						pageName: source.name,
						org: { name: orgName }
					}),
				url: `${origin}${source.address}`
			},
			goal: null,
			money: { locale: config.locale, currency: config.currency },
			config,
			preview
		}
	};
}

/**
 * the owned settings row as publishing the draft would leave it: the draft's donation settings
 * where it holds them, and live — a campaign's row stays a draft until its first Publish, and the
 * preview draws the box that Publish would put in front of donors. a retired row stays retired. the
 * fund and the sites stay the row's, since the box draws neither.
 */
function asPublished(form: FormRecord, settings: Page['settings']): FormRecord {
	const status = form.status === 'draft' ? 'live' : form.status;
	if (settings === undefined) return { ...form, status };
	const { minMinor, maxMinor, currency, programMode, programId, suggestedAmounts } = settings;
	return {
		...form,
		status,
		minMinor,
		maxMinor,
		currency,
		programMode,
		programId,
		suggestedAmounts
	};
}

/** the stored text as the rule reads it: `null` and text that is not JSON are nothing to read. */
function storedDocument(text: string | null): unknown {
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * the identity the org-info block states, and the social links the organisation's sharing lists.
 * the EIN is the served config's, which the ladder has already refused without. `org_profile`
 * holds no donor-facing email — its `notification_email` is operational — so none is drawn.
 */
function orgInfo(config: FormConfig, profile: OrgProfile | null, sharing: OrgSharing): OrgInfo {
	return {
		legalName: config.orgLegalName,
		ein: config.ein,
		addressLines: profile === null ? [] : addressLines(profile),
		email: null,
		links: sharing.links
	};
}

/** the postal address a line each — street, second line, "City, Region Postcode", country. */
function addressLines(profile: OrgProfile): string[] {
	const regionLine = [profile.region, profile.postalCode].filter(present).join(' ');
	const cityLine = [profile.city, regionLine].filter(present).join(', ');
	return [profile.addressLine1, profile.addressLine2, cityLine, profile.country].filter(present);
}

/**
 * the answer where the served config refuses: one sentence for a donor, whichever refusal it was.
 *
 * a donor cannot act on which of the six refusals `readPublishedConfig` reached, so the page states
 * none of them; the statuses belong to the endpoint an integrator reads
 * (../../../routes/api.v1.forms.$id.config.ts). `no-store` because the amounts are in a donor page's
 * document, and a cached refusal would outlive the fix.
 */
export function refusedPage() {
	return data({ kind: 'refused' } as const, {
		status: 404,
		headers: { 'cache-control': 'no-store' }
	});
}
