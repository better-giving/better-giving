import type { FormConfig } from '@better-giving/form/v1';
import { data } from 'react-router';
import type { OrgInfo } from '../../donate/blocks/types';
import type { PageWithCardProps } from '../../donate/page-with-card';
import { type PageLook, titleHeading } from '../../donate/page-view';
import type { Page } from '../../page/catalog';
import { type MarkedPage, markIllustrations, placedImageIds } from '../../page/illustration';
import { DEFAULT_CORNER, DEFAULT_SHADE, type PageType } from '../../page/keys';
import { SHARE_CHANNELS_DEFAULT } from '../../page/share';
import type { Db } from '../db/client';
import type { OrgProfile } from '../db/schema';
import { cachedCadences } from '../forms/cadence-cache';
import { cachedCoins } from '../forms/coin-cache';
import type { FormRecord } from '../forms/form-input';
import { readPublishedConfig, renderableConfig } from '../forms/published-config';
import { cachedRails } from '../forms/rail-cache';
import { illustrationsAmong } from '../images/queries';
import type { OrgSharing } from '../org/presentation';
import {
	readOrgLogo,
	readOrgLook,
	readOrgProfile,
	readOrgSharing,
	readOrgStory
} from '../org/queries';
import { present } from '../org/receipt-fields';
import { createPaymentProviders } from '../payments/factory';
import { readActiveProgramPhotos } from '../programs/queries';
import { readDocument } from './document';
import { pageGoal } from './goal';

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
// the box opens where the drawn document's switches say — the published one for a donor, the draft
// in the preview — so a switch saved in the editor reaches donors at Publish, with the rest of the
// document. whether monthly is offered at all stays the served config's: "Open on monthly" on a
// deployment offering none opens as today.
//
// the stored document is read under ./document.ts's policy. one that is missing, or that the rule
// now refuses, draws the plain page — the donation box alone — so a page broken by a narrowed rule
// still takes gifts while somebody repairs it.
//
// a page draws its own shade, corners and share message, the defaults where it holds none
// (`donorLook`, and its title for the message), and so moves them only at Publish with the rest of
// its document. the organisation's story, brand colour, social links and logo are read live on
// every draw, so a save on the dashboard's organisation page reaches every page at once, the
// preview included. so are the programs' photos, handed beside the served config for the programs
// its chooser offers and never on its `v1` options, and so is a campaign's raised figure
// (./goal.ts), a sum over the books that is never cached. which of its pictures an AI drew is read
// on every draw too, by their kinds (`illustrationsAmong` in ../images/queries.ts), so a photo put
// in one's place clears the mark on the next.

/** a page as its loader holds it: its row's facts, the document to draw, and its public address. */
export type PageSource = {
	readonly id: string;
	readonly type: PageType;
	/** the settings row the page owns, whose served config the card takes the gift against. */
	readonly formId: string;
	/** a campaign's name on the dashboard, drawn where the document holds none; null on the donation page. */
	readonly name: string | null;
	/** the stored document's text — `published` for a donor, the draft for the preview. */
	readonly document: string | null;
	/** the path the page is public at, `/donate` or a campaign's, which the share buttons send. */
	readonly address: string;
};

/**
 * what a donor page's component is handed: `PageWithCard`'s props, every one serializable, its page
 * with each hero and image block marked where an AI drew its picture.
 */
export type PageViewData = Omit<PageWithCardProps, 'seams' | 'page'> & {
	readonly page: MarkedPage;
};

export type LoadedPage =
	| { readonly kind: 'page'; readonly view: PageViewData }
	/** the stored document is missing or fails the rule: the card alone, in the page's look. */
	| { readonly kind: 'plain'; readonly config: FormConfig; readonly look: PageLook }
	/** the served config refuses the owned row: no card can be drawn. */
	| { readonly kind: 'refused' };

export async function loadPageView(
	db: Db,
	env: unknown,
	source: PageSource,
	request: Request,
	{
		now,
		preview = false
	}: {
		/** the request's one clock, which the loader read the page's state against too. */
		readonly now: number;
		readonly preview?: boolean;
	}
): Promise<LoadedPage> {
	const origin = new URL(request.url).origin;
	const processors = createPaymentProviders(env);
	const parsed = readDocument(source, preview ? 'draft' : 'published', source.document);
	const [served, story, orgLook, orgSharing, profile, illustrations, orgLogo, photos] =
		await Promise.all([
			readPublishedConfig(
				db,
				source.formId,
				env,
				() => cachedCadences(processors, origin),
				() => cachedRails(processors, origin),
				() => cachedCoins(processors, origin),
				preview
					? {
							now,
							drafted: (form) => asPublished(form, parsed.ok ? parsed.page.settings : undefined)
						}
					: { now }
			),
			readOrgStory(db),
			readOrgLook(db),
			readOrgSharing(db),
			readOrgProfile(db),
			illustrationsAmong(db, parsed.ok ? placedImageIds(parsed.page) : []),
			readOrgLogo(db),
			readActiveProgramPhotos(db)
		]);
	const result = renderableConfig(served);
	// the served config alone reaches the page: `result.form` carries `allowed_origins`, the sites
	// this organisation's forms may be used on, which a document served to anyone is no place for.
	if (!result.ok) return { kind: 'refused' };
	const { config } = result;

	const { brandColour } = orgLook.look;
	if (!parsed.ok) return { kind: 'plain', config, look: donorLook(undefined, brandColour) };
	const { page } = parsed;
	// the name the document was drafted with, so a rename reaches donors at Publish.
	const pageName = page.name ?? source.name;
	const { sharing } = orgSharing;
	const orgName = config.orgLegalName;
	const firstTitle = page.blocks.find((block) => block.type === 'title');
	const goal = await pageGoal(db, source.formId, page, config.locale);

	return {
		kind: 'page',
		view: {
			type: source.type,
			page: markIllustrations(page, illustrations),
			pageName,
			org: {
				name: orgName,
				mission: story.story.mission,
				vision: story.story.vision,
				info: orgInfo(config, profile, sharing)
			},
			logo: orgLogo.logo,
			programPhotos: chooserPhotos(config, photos),
			look: donorLook(page.look, brandColour),
			sharing: {
				channels: page.shareChannels ?? SHARE_CHANNELS_DEFAULT,
				message:
					page.shareMessage ??
					titleHeading(firstTitle?.heading ?? '', {
						type: source.type,
						pageName,
						org: { name: orgName }
					}),
				url: `${origin}${source.address}`
			},
			goal,
			money: { locale: config.locale, currency: config.currency },
			config,
			preview,
			...openingOf(page.switches)
		}
	};
}

/**
 * what a donor page is drawn in: its own shade and corners, `DEFAULT_SHADE` and `DEFAULT_CORNER`
 * where it holds none, and the organisation's brand colour.
 */
export function donorLook(own: Page['look'], brandColour: string | null): PageLook {
	return {
		shade: own?.shade ?? DEFAULT_SHADE,
		corner: own?.corner ?? DEFAULT_CORNER,
		brandColour
	};
}

/** where the page's switches open the box: only the flags that are on, and nothing when neither is. */
function openingOf({ openOnMonthly, dedicationOn }: Page['switches']): {
	opening?: NonNullable<PageViewData['opening']>;
} {
	if (!openOnMonthly && !dedicationOn) return {};
	return {
		opening: {
			...(openOnMonthly ? { monthly: true } : {}),
			...(dedicationOn ? { dedication: true } : {})
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

/** the photos of the programs the served config offers on its chooser, by program id. */
function chooserPhotos(
	config: FormConfig,
	photos: ReadonlyMap<string, string>
): Record<string, string> {
	const offered = config.program?.mode === 'choice' ? config.program.options : [];
	return Object.fromEntries(
		offered.flatMap(({ id }) => {
			const photo = photos.get(id);
			return photo === undefined ? [] : [[id, photo]];
		})
	);
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
