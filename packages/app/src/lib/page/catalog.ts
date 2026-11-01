// the one rule for a donor page as it is stored: what `page.draft`, `published` and
// `last_published` hold. parsed on the way into the database and again on the way out, the way
// ../rich-text/document.ts is, and `parsePage` is the only parser of that document there is.
//
// the document is flat, ours, and content only: the words, the photos, the tiers and the questions
// a page holds, and nothing that says how they are drawn. there is no layout, no colour, no block
// list and no order — ./shape.ts picks a whole layout from what the content holds, and the brand
// colour is the organisation's. no markup and no address but a link inside rich text, since every
// value is a plain string, a number, a photo's stored id or a rich-text document.
//
// a campaign holds every key; the Donation page draws one fixed layout and holds only its heading,
// its share message, its switches and its settings, so a campaign-only key on it is refused. a
// section with nothing in it — no tiers, a blank story, no goal — is accepted and leaves itself out
// at render. top-level keys the database reads are ./keys.ts's; `$lib/server/db/schema.ts` checks
// the same names. `settings` is the draft donation settings publish copies onto the page's owned
// form row, read by ./settings.ts's rule.
//
// the rule reads shape only and never the page's data: nothing here looks up a program, a goal's
// progress or the organisation.
//
// pure and not under `$lib/server/**`: a component renders what this returns.
import { z } from 'zod';
import { richTextDocument } from '../rich-text/document';
import { isTimeZone } from './end-date';
import { PAGE_KEYS, type PageType } from './keys';
import { draftSettings } from './settings';

/** holds "Donate to " and the longest legal name, so the default Donation page always fits. */
export const HEADING_MAX = 250;
export const LEDE_MAX = 400;
export const TIERS_MAX = 6;
export const BUYS_MAX = 140;
export const FAQ_MAX = 10;
export const QUESTION_MAX = 200;
/** the photos a campaign holds beside its cover photo. */
export const PHOTOS_MAX = 8;
export const SHARE_MESSAGE_MAX = 280;
export const ALT_MAX = 250;
/** what a label beside a campaign's suggested amount holds. */
export const AMOUNT_LABEL_MAX = 40;
/** the suggested amounts a campaign offers, and so the labels it holds at most. */
export const CAMPAIGN_AMOUNTS_MAX = 4;

const TIER_AMOUNT = 'a tier’s amount is a whole number of minor units above zero';

/**
 * a photo by the id the deployment gave it on upload, and never an address: the only place a
 * page's photo is served from is `imageSrc` in ./image-src.ts.
 */
export const photo = z.strictObject({
	imageId: z.uuid({
		error: 'an image id is the id a stored photo was given on upload, never an address'
	}),
	/** null is a decorative photo. */
	alt: z
		.string()
		.max(ALT_MAX, { error: `a photo’s description holds at most ${ALT_MAX} characters` })
		.nullable()
});

export type Photo = z.infer<typeof photo>;

/** each content section's rule, which a section's save checks its boxes against before the page. */
export const SECTION_DATA = {
	/**
	 * empty draws the campaign's name on a campaign, which is not in this document, and "Donate to"
	 * the organisation's name on the Donation page.
	 */
	heading: z
		.string()
		.max(HEADING_MAX, { error: `a heading holds at most ${HEADING_MAX} characters` }),
	lede: z
		.string()
		.max(LEDE_MAX, { error: `a lede holds at most ${LEDE_MAX} characters` })
		.optional(),
	story: richTextDocument.optional(),
	/** absent draws the organisation's logo in its place, and nothing where it has none. */
	hero: photo.optional(),
	photos: z
		.array(photo)
		.max(PHOTOS_MAX, { error: `a campaign holds at most ${PHOTOS_MAX} photos beside its cover` })
		.optional(),
	tiers: z
		.array(
			z.strictObject({
				amountMinor: z.int({ error: TIER_AMOUNT }).positive({ error: TIER_AMOUNT }),
				buys: z
					.string()
					.min(1, { error: 'a tier says what its amount buys' })
					.max(BUYS_MAX, { error: `what a tier buys is at most ${BUYS_MAX} characters` })
			})
		)
		.max(TIERS_MAX, { error: `a campaign holds at most ${TIERS_MAX} impact tiers` })
		.optional(),
	faq: z
		.array(
			z.strictObject({
				question: z
					.string()
					.min(1, { error: 'a question is not blank' })
					.max(QUESTION_MAX, { error: `a question holds at most ${QUESTION_MAX} characters` }),
				answer: richTextDocument
			})
		)
		.max(FAQ_MAX, { error: `a campaign holds at most ${FAQ_MAX} questions` })
		.optional()
} as const;

/** each page type as a refusal names it. */
export const PAGE_NAMES: Record<PageType, string> = {
	donation_page: 'the Donation page',
	campaign: 'a campaign'
};

const GOAL = 'a goal is a whole number of minor units above zero';
/** the largest goal a campaign is set to: fifteen digits of minor units, short of 2^53. */
export const GOAL_MINOR_MAX = 999_999_999_999_999;
const END = 'an end date is a whole number of milliseconds since 1970';

/** the keys only a campaign holds, as a refusal names each. */
const CAMPAIGN_ONLY = [
	['lede', 'lede'],
	['story', 'story'],
	['hero', 'cover photo'],
	['photos', 'photos'],
	['tiers', 'impact tiers'],
	['faq', 'questions'],
	[PAGE_KEYS.name, 'name'],
	[PAGE_KEYS.slug, 'link'],
	[PAGE_KEYS.goalMinor, 'goal'],
	[PAGE_KEYS.endsAt, 'end date'],
	[PAGE_KEYS.endsZone, 'end date'],
	['amountLabels', 'suggested amount labels']
] as const;

const LABEL_AMOUNT = 'a labelled amount is a whole number of minor units above zero';

/**
 * a label beside each of a campaign's suggested amounts, by the amount it stands beside. one whose
 * amount the draft settings' `suggestedAmounts` no longer holds is dropped on save and drawn
 * nowhere; the rule here reads shape only.
 */
const amountLabels = z
	.array(
		z.strictObject({
			amountMinor: z.int({ error: LABEL_AMOUNT }).positive({ error: LABEL_AMOUNT }),
			label: z
				.string()
				.min(1, { error: 'a label holds words' })
				.max(AMOUNT_LABEL_MAX, {
					error: `an amount’s label holds at most ${AMOUNT_LABEL_MAX} characters`
				})
		})
	)
	.max(CAMPAIGN_AMOUNTS_MAX, {
		error: `a campaign labels at most ${CAMPAIGN_AMOUNTS_MAX} suggested amounts`
	});

const pageDocument = (type: PageType) =>
	z
		.strictObject({
			...SECTION_DATA,
			shareMessage: z
				.string()
				.max(SHARE_MESSAGE_MAX, {
					error: `a share message holds at most ${SHARE_MESSAGE_MAX} characters`
				})
				.optional(),
			amountLabels: amountLabels.optional(),
			switches: z.strictObject({ openOnMonthly: z.boolean(), dedicationOn: z.boolean() }),
			[PAGE_KEYS.name]: z
				.string()
				.trim()
				.min(1, { error: 'a campaign name holds words' })
				.max(HEADING_MAX, { error: `a campaign name holds at most ${HEADING_MAX} characters` })
				.optional(),
			// the shape alone: whether the link clashes with a route or another campaign is the save's
			// and Publish's ($lib/page/slug.ts's `checkSlug`, which reads the route tree).
			[PAGE_KEYS.slug]: z
				.string()
				.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
					error: 'a link holds lowercase letters, numbers and single hyphens between words'
				})
				.max(60, { error: 'a link holds at most 60 characters' })
				.optional(),
			[PAGE_KEYS.goalMinor]: z.int({ error: GOAL }).positive({ error: GOAL }).optional(),
			[PAGE_KEYS.endsAt]: z.int({ error: END }).positive({ error: END }).optional(),
			[PAGE_KEYS.endsZone]: z
				.string()
				.refine(isTimeZone, {
					error: (issue) => `${JSON.stringify(issue.input)} is not a time zone`
				})
				.optional(),
			settings: draftSettings.optional()
		})
		.check((ctx) => {
			if (type !== 'campaign') {
				for (const [key, what] of CAMPAIGN_ONLY) {
					if (ctx.value[key] === undefined) continue;
					ctx.issues.push({
						code: 'custom',
						input: ctx.value[key],
						path: [key],
						message: `${PAGE_NAMES[type]} has no ${what}; only a campaign does`
					});
				}
			} else if (ctx.value.endsAt !== undefined && ctx.value.endsZone === undefined) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value,
					path: [PAGE_KEYS.endsZone],
					message: 'an end date names the time zone its day ends in'
				});
			} else if (ctx.value.endsAt === undefined && ctx.value.endsZone !== undefined) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value,
					path: [PAGE_KEYS.endsAt],
					message: 'a time zone belongs to an end date, and there is none'
				});
			}
		});

const PAGE_RULES = {
	donation_page: pageDocument('donation_page'),
	campaign: pageDocument('campaign')
};

export type Page = z.infer<ReturnType<typeof pageDocument>>;
type Path = (string | number)[];

export type PageRefusal = {
	ok: false;
	/** where in the input the refusal lands, as keys and indexes from the document's root */
	path: Path;
	message: string;
};

/** the rule on write and on read alike. */
export function parsePage(type: PageType, input: unknown): { ok: true; page: Page } | PageRefusal {
	const result = PAGE_RULES[type].safeParse(input);
	if (result.success) return { ok: true, page: result.data };
	const issue = result.error.issues[0];
	if (issue === undefined) throw result.error;
	const path = issue.path.filter((key): key is string | number => typeof key !== 'symbol');
	return { ok: false, path, message: issue.message };
}
