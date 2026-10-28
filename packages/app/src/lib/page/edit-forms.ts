// the section cards a page's edit screen draws, the campaign's and the Donation page's: each card's
// form id, the name each of its boxes posts under, its input schema, and the seed its loader hands
// it. the cards post these ($lib/admin/), the saves parse them ($lib/server/pages/section-saves.ts),
// and the loaders seed them ($lib/server/pages/section-seeds.ts), each from here.
//
// every card's Save writes the draft alone, but the campaign's name and its link, which move at
// once (`saveCampaignGeneral`). Publish, Publish changes and Unpublish are ./publish-form.ts's.
//
// each schema is flat (AGENTS.md → Forms). a row editor posts two lists side by side — `amount[i]`
// beside `amount_label[i]` — and an emptied one posts no key. what a schema can say without the
// page in hand it says here, so the browser says it before a round trip: a box's shape, its length,
// how many rows. what needs the stored page — an amount inside the draft's bounds, a photo that was
// stored, a link nobody else holds — is the save's.
//
// pure and not under `$lib/server/**`: a component imports every name here.
import { z } from 'zod';
import { FORM_CURRENCY, readAmount, suggestedEntries } from '../forms/amounts';
import {
	amountBound,
	boundsRule,
	FORM_GIVING_FIELDS,
	FORM_PROGRAM_FIELDS,
	PAGE_SWITCH_FIELDS,
	pinnedProgramRule,
	REQUIRED,
	suggestedAmountsRule
} from '../forms/input-schema';
import type { ProgramMode } from '../forms/program-modes';
import { plainText, type RichTextDocument, richTextDocument } from '../rich-text/document';
import {
	AMOUNT_LABEL_MAX,
	CAMPAIGN_AMOUNTS_MAX,
	GOAL_MINOR_MAX,
	HEADING_MAX,
	SHARE_MESSAGE_MAX
} from './catalog';

export { AMOUNT_LABEL_MAX, CAMPAIGN_AMOUNTS_MAX };

/** a campaign's description, in characters of its plain text: General's rule, never `parsePage`'s. */
export const STORY_MAX = 3000;

/** each card's form id, which its body names under `WHICH_FORM` and its rejection travels back on. */
export const EDIT_FORMS = {
	campaignGeneral: 'campaign-general',
	campaignMedia: 'campaign-media',
	campaignGoal: 'campaign-goal',
	campaignSettings: 'campaign-settings',
	donationPageGeneral: 'donation-page-general',
	donationPageGiving: 'donation-page-giving',
	donationPageSettings: 'donation-page-settings'
} as const;

export const CAMPAIGN_EDIT_FORM_IDS = [
	EDIT_FORMS.campaignGeneral,
	EDIT_FORMS.campaignMedia,
	EDIT_FORMS.campaignGoal,
	EDIT_FORMS.campaignSettings
] as const;
export type CampaignEditFormId = (typeof CAMPAIGN_EDIT_FORM_IDS)[number];

export const DONATION_PAGE_EDIT_FORM_IDS = [
	EDIT_FORMS.donationPageGeneral,
	EDIT_FORMS.donationPageGiving,
	EDIT_FORMS.donationPageSettings
] as const;
export type DonationPageEditFormId = (typeof DONATION_PAGE_EDIT_FORM_IDS)[number];

export type EditFormId = CampaignEditFormId | DonationPageEditFormId;

/**
 * the name each box posts under and each schema reads it by. a row's box adds its place —
 * `amount[1]`.
 */
export const EDIT_BOXES = {
	name: 'name',
	slug: 'slug',
	/** yes to moving a published campaign's link, which donors may hold. */
	move: 'move',
	/** yes to taking the link an ended campaign holds. */
	takeover: 'takeover',
	/** the description: the rich-text box's document as JSON. */
	story: 'story',
	heroImageId: 'hero_image_id',
	logoImageId: 'logo_image_id',
	goalMode: 'goal_mode',
	/** the goal in major units of the page's currency, as an amount box reads one. */
	goalAmount: 'goal_amount',
	amount: 'amount',
	amountLabel: 'amount_label',
	programMode: 'program_mode',
	programId: 'program_id',
	minMinor: 'min_minor',
	maxMinor: 'max_minor',
	suggestedAmounts: 'suggested_amounts',
	openOnMonthly: 'open_on_monthly',
	dedicationOn: 'dedication_on',
	shareMessage: 'share_message',
	endDate: 'end_date',
	timeZone: 'time_zone',
	heading: 'heading'
} as const;

export const GOAL_MODES = ['none', 'fixed'] as const;
export type GoalMode = (typeof GOAL_MODES)[number];

const atMost = (max: number) => `at most ${max.toLocaleString('en-US')} characters`;

/** a share message as its box posts it: blank says the page's title instead. */
const shareMessageBox = z
	.string()
	.trim()
	.max(SHARE_MESSAGE_MAX, atMost(SHARE_MESSAGE_MAX))
	.optional();

/**
 * the description's plain text held to `STORY_MAX`. a post that is not a document is left to the
 * save, which refuses it under the same box by the rich-text rule.
 */
function storyLength(posted: string): string | null {
	let json: unknown;
	try {
		json = JSON.parse(posted);
	} catch {
		return null;
	}
	const doc = richTextDocument.safeParse(json);
	if (!doc.success) return null;
	return plainText(doc.data).length > STORY_MAX ? atMost(STORY_MAX) : null;
}

/**
 * General: the name, the link and the description. `move` and `takeover` are absent until the save
 * has asked its question, and the resubmission ticks the one answered yes. the link's case is
 * repaired rather than refused: the router matches an address in any case.
 */
export const CAMPAIGN_GENERAL_INPUT = z.object({
	[EDIT_BOXES.name]: z
		.string(REQUIRED)
		.trim()
		.min(1, REQUIRED)
		.max(HEADING_MAX, atMost(HEADING_MAX)),
	[EDIT_BOXES.slug]: z.string(REQUIRED).trim().toLowerCase(),
	[EDIT_BOXES.story]: z.string(REQUIRED).check((ctx) => {
		const said = storyLength(ctx.value);
		if (said !== null) ctx.issues.push({ code: 'custom', input: ctx.value, message: said });
	}),
	[EDIT_BOXES.move]: z.boolean().optional(),
	[EDIT_BOXES.takeover]: z.boolean().optional()
});

/** Media: the banner (the cover photo) and the campaign's logo, each by its upload's id; blank is none. */
export const CAMPAIGN_MEDIA_INPUT = z.object({
	[EDIT_BOXES.heroImageId]: z.string().trim().optional(),
	[EDIT_BOXES.logoImageId]: z.string().trim().optional()
});

/** an amount box's text read in the form currency: its problem, or null where it reads. */
const amountProblem = (text: string) => readAmount(text.trim(), FORM_CURRENCY).problem;

/**
 * Goal and amounts: no goal or a fixed one, and up to `CAMPAIGN_AMOUNTS_MAX` suggested amounts,
 * each with a label beside it. a row with no amount drops its label; whether an amount sits inside
 * the smallest and largest gift is the save's, since those are Settings'.
 */
export const CAMPAIGN_GOAL_INPUT = z
	.object({
		[EDIT_BOXES.goalMode]: z.enum(GOAL_MODES, { error: REQUIRED }),
		[EDIT_BOXES.goalAmount]: z.string().trim().optional(),
		[EDIT_BOXES.amount]: z.array(z.string().default('')).prefault([]),
		[EDIT_BOXES.amountLabel]: z
			.array(z.string().trim().max(AMOUNT_LABEL_MAX, atMost(AMOUNT_LABEL_MAX)).default(''))
			.prefault([])
	})
	.check((ctx) => {
		const { goal_mode, goal_amount, amount } = ctx.value;
		if (goal_mode === 'fixed') {
			const said =
				goal_amount === undefined || goal_amount === ''
					? REQUIRED
					: (amountProblem(goal_amount) ??
						((readAmount(goal_amount, FORM_CURRENCY).minor ?? 0) > GOAL_MINOR_MAX
							? 'must be a smaller amount'
							: null));
			if (said !== null) {
				ctx.issues.push({
					code: 'custom',
					input: goal_amount,
					path: [EDIT_BOXES.goalAmount],
					message: said,
					continue: true
				});
			}
		}
		if (suggestedEntries(amount).length > CAMPAIGN_AMOUNTS_MAX) {
			ctx.issues.push({
				code: 'custom',
				input: amount,
				path: [EDIT_BOXES.amount],
				message: `at most ${CAMPAIGN_AMOUNTS_MAX}`,
				continue: true
			});
			return;
		}
		amount.forEach((text, at) => {
			const said = text.trim() === '' ? null : amountProblem(text);
			if (said !== null) {
				ctx.issues.push({
					code: 'custom',
					input: text,
					path: [EDIT_BOXES.amount, at],
					message: said,
					continue: true
				});
			}
		});
	});

/**
 * Settings: where gifts go, the smallest and largest gift, the two switches, the share message and
 * the end date. the end date posts the day and the IANA zone of the browser that chose it, both
 * blank for none, as $lib/server/pages/page-settings.ts reads them.
 */
export const CAMPAIGN_SETTINGS_INPUT = z
	.object({
		...FORM_PROGRAM_FIELDS,
		[EDIT_BOXES.minMinor]: amountBound(),
		[EDIT_BOXES.maxMinor]: amountBound(),
		...PAGE_SWITCH_FIELDS,
		[EDIT_BOXES.shareMessage]: shareMessageBox,
		[EDIT_BOXES.endDate]: z.string().trim().optional(),
		[EDIT_BOXES.timeZone]: z.string().trim().optional()
	})
	.check(pinnedProgramRule)
	.check(boundsRule);

/** the Donation page's General: its title, blank for "Donate to" and the organisation's name. */
export const DONATION_PAGE_GENERAL_INPUT = z.object({
	[EDIT_BOXES.heading]: z.string().trim().max(HEADING_MAX, atMost(HEADING_MAX)).optional()
});

/**
 * the Donation page's Donation settings: a form's program and giving groups under both groups'
 * rules, its suggested amounts up to `MAX_SUGGESTED_AMOUNTS` and with no labels.
 */
export const DONATION_PAGE_GIVING_INPUT = z
	.object({ ...FORM_PROGRAM_FIELDS, ...FORM_GIVING_FIELDS })
	.check(pinnedProgramRule)
	.check(boundsRule)
	.check(suggestedAmountsRule);

/** the Donation page's Settings: the two switches and the share message. */
export const DONATION_PAGE_SETTINGS_INPUT = z.object({
	...PAGE_SWITCH_FIELDS,
	[EDIT_BOXES.shareMessage]: shareMessageBox
});

/** what a card's Save answers once its write lands: the card it was. */
export type SectionSaved = { readonly saved: EditFormId };

type ProgramOption = { readonly value: string; readonly label: string };

/** the program select's choices, as Settings and the Donation page's Donation settings draw them. */
export type ProgramChoices = {
	/** every active program. */
	readonly programs: readonly ProgramOption[];
	/** the archived program the draft is still pinned to, which the select carries until changed. */
	readonly retired: ProgramOption | null;
};

/** a placed photo as a card draws it. */
export type PlacedPhoto = { readonly imageId: string; readonly src: string };

export type CampaignGeneralSeed = {
	readonly boxes: { readonly name: string; readonly slug: string };
	/** the description's document, for the rich-text box; it posts the JSON of what it holds. */
	readonly story: RichTextDocument;
};

export type CampaignMediaSeed = {
	readonly boxes: { readonly hero_image_id: string; readonly logo_image_id: string };
	readonly hero: PlacedPhoto | null;
	readonly logo: PlacedPhoto | null;
};

export type CampaignGoalSeed = {
	readonly boxes: {
		readonly goal_mode: GoalMode;
		readonly goal_amount: string;
		readonly amount: readonly string[];
		readonly amount_label: readonly string[];
	};
	/** the three-letter code every amount on the card is in. */
	readonly currency: string;
};

export type CampaignSettingsSeed = ProgramChoices & {
	readonly boxes: {
		readonly program_mode: ProgramMode;
		readonly program_id: string;
		readonly min_minor: string;
		readonly max_minor: string;
		readonly open_on_monthly: boolean;
		readonly dedication_on: boolean;
		readonly share_message: string;
		/** `YYYY-MM-DD` in the zone it was chosen in, or `''` for none. */
		readonly end_date: string;
	};
	readonly currency: string;
	/** whether this deployment offers monthly gifts now; Open on monthly is saved either way. */
	readonly monthlyOffered: boolean;
};

export type DonationPageGeneralSeed = { readonly boxes: { readonly heading: string } };

export type DonationPageGivingSeed = ProgramChoices & {
	readonly boxes: {
		readonly program_mode: ProgramMode;
		readonly program_id: string;
		readonly min_minor: string;
		readonly max_minor: string;
		readonly suggested_amounts: readonly string[];
	};
	readonly currency: string;
};

export type DonationPageSettingsSeed = {
	readonly boxes: {
		readonly open_on_monthly: boolean;
		readonly dedication_on: boolean;
		readonly share_message: string;
	};
	readonly monthlyOffered: boolean;
};

/**
 * where a page stands against what donors see, as the banner draws it: not public (never
 * published, or unpublished), ended, public as drafted, or public with draft changes.
 */
export type BannerState = 'not_public' | 'ended' | 'public' | 'changed';

export type EditBanner = {
	readonly state: BannerState;
	/** where donors reach the page — `/winter-coats`, `/donate` — or null where it holds no address. */
	readonly address: string | null;
	/** the preview route framing the draft. */
	readonly preview: string;
	/** Unpublish is offered: a campaign public now. */
	readonly unpublishable: boolean;
	/** End campaign is offered: a campaign live or unpublished. */
	readonly endable: boolean;
	/** Undo publish is offered: the page is public and a Publish replaced an earlier live page. */
	readonly undoable: boolean;
};
