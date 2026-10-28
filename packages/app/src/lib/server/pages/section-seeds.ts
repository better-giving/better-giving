import { groupedEntry } from '../../forms/amounts';
import type { Page as PageDocument } from '../../page/catalog';
import type {
	BannerState,
	CampaignGeneralSeed,
	CampaignGoalSeed,
	CampaignMediaSeed,
	CampaignSettingsSeed,
	DonationPageGeneralSeed,
	DonationPageGivingSeed,
	DonationPageSettingsSeed,
	EditBanner,
	PlacedPhoto
} from '../../page/edit-forms';
import { endDayOf } from '../../page/end-date';
import { stateAt } from '../../page/ended';
import { imageSrc } from '../../page/image-src';
import type { RichTextDocument } from '../../rich-text/document';
import type { Db } from '../db/client';
import type { Page } from '../db/schema';
import { readableDraft } from './document';
import { readEditorSettings } from './editor';

// what a page's edit screen is drawn with: each section card's seed ($lib/page/edit-forms.ts) and
// the banner over them, read from the page row as it stands. the cards' seeds read the draft, which
// is what every card writes; the banner reads where the page stands against what donors see.
//
// the seeds read a draft the read rule passes, so a loader asks `unreadableEditor` in ./editor.ts
// first and draws its notice in their place where the rule refuses it.

const BLANK_STORY: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

const DONATION_PAGE_ADDRESS = '/donate';

const placed = (photo: PageDocument['hero']): PlacedPhoto | null =>
	photo === undefined ? null : { imageId: photo.imageId, src: imageSrc(photo.imageId) };

/**
 * a campaign's four cards' seeds. whether monthly is offered is read as the box's served config
 * reads it, off `origin`, the origin the request arrived on (`readEditorSettings`).
 */
export async function readCampaignEditSeeds(
	db: Db,
	env: unknown,
	row: Page,
	origin: string
): Promise<{
	general: CampaignGeneralSeed;
	media: CampaignMediaSeed;
	goal: CampaignGoalSeed;
	settings: CampaignSettingsSeed;
}> {
	const draft = readableDraft(row);
	const read = await readEditorSettings(db, env, row, origin);
	const amounts = draft.settings?.suggestedAmounts ?? [];
	const labelOf = new Map((draft.amountLabels ?? []).map((each) => [each.amountMinor, each.label]));
	return {
		general: {
			// what General last saved, which Publish takes live: the draft's, else the row's.
			boxes: { name: draft.name ?? row.name ?? '', slug: draft.slug ?? row.slug ?? '' },
			story: draft.story ?? BLANK_STORY
		},
		media: {
			boxes: {
				hero_image_id: draft.hero?.imageId ?? '',
				logo_image_id: draft.logo?.imageId ?? ''
			},
			hero: placed(draft.hero),
			logo: placed(draft.logo)
		},
		goal: {
			boxes: {
				goal_mode: draft.goalMinor === undefined ? 'none' : 'fixed',
				goal_amount:
					draft.goalMinor === undefined ? '' : groupedEntry(draft.goalMinor, read.currency),
				amount: amounts.map((minor) => groupedEntry(minor, read.currency)),
				amount_label: amounts.map((minor) => labelOf.get(minor) ?? '')
			},
			currency: read.currency
		},
		settings: {
			boxes: {
				program_mode: read.boxes.program_mode,
				program_id: read.boxes.program_id,
				min_minor: read.boxes.min_minor,
				max_minor: read.boxes.max_minor,
				...read.switches,
				share_message: draft.shareMessage ?? '',
				end_date: endDayOf(draft) ?? ''
			},
			currency: read.currency,
			programs: read.programs,
			retired: read.retired,
			monthlyOffered: read.monthlyOffered
		}
	};
}

/** the Donation page's three cards' seeds, `origin` read as `readCampaignEditSeeds` reads it. */
export async function readDonationPageEditSeeds(
	db: Db,
	env: unknown,
	row: Page,
	origin: string
): Promise<{
	general: DonationPageGeneralSeed;
	giving: DonationPageGivingSeed;
	settings: DonationPageSettingsSeed;
}> {
	const draft = readableDraft(row);
	const read = await readEditorSettings(db, env, row, origin);
	return {
		general: { boxes: { heading: draft.heading } },
		giving: {
			boxes: read.boxes,
			currency: read.currency,
			programs: read.programs,
			retired: read.retired
		},
		settings: {
			boxes: { ...read.switches, share_message: draft.shareMessage ?? '' },
			monthlyOffered: read.monthlyOffered
		}
	};
}

/**
 * the banner over a page's edit screen as of `now`: a campaign past its published end reads ended
 * (../../page/ended.ts). Unpublish is offered on a public campaign; End on one live or unpublished.
 */
export function editBanner(row: Page, now: number): EditBanner {
	const state = stateAt(row, now);
	const campaign = row.type === 'campaign';
	return {
		state: bannerState(state, row),
		address: campaign ? (row.slug === null ? null : `/${row.slug}`) : DONATION_PAGE_ADDRESS,
		preview: `/preview/${row.id}`,
		unpublishable: campaign && state === 'live',
		endable: campaign && (state === 'live' || state === 'unpublished'),
		undoable: state === 'live' && row.lastPublished !== null
	};
}

function bannerState(state: Page['state'], row: Page): BannerState {
	switch (state) {
		case 'never_published':
		case 'unpublished':
			return 'not_public';
		case 'ended':
			return 'ended';
		case 'live':
			return row.draft === row.published ? 'public' : 'changed';
	}
}
