import {
	groupedEntry,
	readAmount,
	readSuggestedAmounts,
	suggestedEntries
} from '../../forms/amounts';
import { FORM_TEXT_FIELDS, type FormInputFieldErrors } from '../../forms/fields';
import { defineForm, type FormRejection } from '../../forms/definition';
import { type Page, type Photo, photo as photoRule } from '../../page/catalog';
import {
	CAMPAIGN_GENERAL_INPUT,
	CAMPAIGN_GOAL_INPUT,
	CAMPAIGN_MEDIA_INPUT,
	CAMPAIGN_SETTINGS_INPUT,
	DONATION_PAGE_GENERAL_INPUT,
	DONATION_PAGE_GIVING_INPUT,
	DONATION_PAGE_SETTINGS_INPUT,
	EDIT_BOXES,
	EDIT_FORMS,
	type CampaignEditFormId,
	type DonationPageEditFormId,
	type EditFormId,
	type SectionSaved
} from '../../page/edit-forms';
import { checkSlug, type SlugCheck } from '../../page/slug';
import { isEmptyDocument, parseRichText } from '../../rich-text/document';
import { invalid, parseForm, type RejectionReasons, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import type { Page as PageRow } from '../db/schema';
import { type DraftAlongside, editPageDraft } from './draft-writer';
import { formInputValues, parseFormGiving, parseFormProgram } from '../forms/form-input';
import { firstMissingImage } from '../images/queries';
import { readEndDay } from './page-settings';
import { sqliteResultCode } from '../db/rejection';
import {
	draftSettingsAfter,
	draftSettingsOf,
	planSlugMove,
	readTarget,
	renamedColumns,
	renamingOwned,
	SLUG_ATTEMPTS,
	type SettingsTarget,
	slugRace
} from './queries';

// each section card's Save on a page's edit screen ($lib/page/edit-forms.ts): the box values parsed
// under the card's schema, then checked against the page as stored and written to its draft alone
// through `editPageDraft` (./draft-writer.ts), against the version the screen was drawn at. a press
// drawn before another write — another card's Save, a Publish — is refused at 409 rather than
// putting back what that write moved, and a photo the draft lets go of is freed in the same write.
//
// nothing here reaches donors before Publish (./publish.ts), but the General card's name and link,
// which are not page content and move at once.

type CampaignTarget = Extract<SettingsTarget, { type: 'campaign' }>;
type DonationPageTarget = Extract<SettingsTarget, { type: 'donation_page' }>;

type Submission = { readonly reject: (reasons?: RejectionReasons) => FormRejection };

/** what a card's edit makes of the draft, or the refusal it is answered with. */
type SectionEdit =
	| { readonly ok: true; readonly draft: Page; readonly alongside?: DraftAlongside }
	| { readonly ok: false; readonly refusal: RejectionReasons };

/** the question General's save asks before it moves a link, and the link it would move to. */
export type GeneralQuestion =
	/** the campaign has been published, and donors may hold the link it would stop answering at. */
	| { readonly kind: 'move'; readonly from: string; readonly to: string }
	/** an ended campaign holds the link, and would be left with none. */
	| { readonly kind: 'takeover'; readonly holder: string; readonly to: string };

type SectionWrite =
	| { readonly kind: 'written' }
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' }
	| { readonly kind: 'refused'; readonly refusal: RejectionReasons }
	| { readonly kind: 'ask'; readonly ask: GeneralQuestion }
	/** another campaign holds the link and keeps it. */
	| { readonly kind: 'taken'; readonly by: string };

const STALE =
	'Nothing was saved: this page has been saved since the editor was opened. Reload it, then make this change again.';
const FAILED = 'Saving failed and nothing was changed. Try again.';

/** the box a refusal by `parsePage` at a top-level key goes under, on whichever card posts it. */
const PAGE_BOXES: Readonly<Record<string, string>> = {
	heading: EDIT_BOXES.heading,
	name: EDIT_BOXES.name,
	story: EDIT_BOXES.story,
	hero: EDIT_BOXES.heroImageId,
	logo: EDIT_BOXES.logoImageId,
	goalMinor: EDIT_BOXES.goalAmount,
	amountLabels: EDIT_BOXES.amountLabel,
	shareMessage: EDIT_BOXES.shareMessage,
	endsAt: EDIT_BOXES.endDate,
	endsZone: EDIT_BOXES.timeZone
};

const refusedUnder = (box: string, sentence: string): SectionEdit => ({
	ok: false,
	refusal: { fieldErrors: { [box]: [sentence] } }
});

/**
 * the draft of the page `target` names, replaced by what `edit` makes of it while the page is still
 * `version`; a refusal by the page rule lands under the box `PAGE_BOXES` names, or the card's own.
 */
async function writeSection(
	db: Db,
	target: SettingsTarget,
	version: Date,
	edit: (draft: Page, row: PageRow) => Promise<SectionEdit>
): Promise<SectionWrite> {
	const own: { refusal?: RejectionReasons } = {};
	const written = await editPageDraft(db, target, version, async (draft, row) => {
		const edited = await edit(draft, row);
		if (edited.ok) return edited;
		own.refusal = edited.refusal;
		return { ok: false, path: [], message: '' };
	});
	if (written.kind !== 'refused') return { kind: written.kind };
	if (own.refusal !== undefined) return { kind: 'refused', refusal: own.refusal };
	const [key] = written.path;
	const box = typeof key === 'string' ? PAGE_BOXES[key] : undefined;
	return {
		kind: 'refused',
		refusal:
			box === undefined
				? { formErrors: [written.message] }
				: { fieldErrors: { [box]: [written.message] } }
	};
}

/** a card's answer from what its write did. */
async function answer(
	form: EditFormId,
	submission: Submission,
	gone: string,
	write: () => Promise<SectionWrite>
) {
	let written: SectionWrite;
	try {
		written = await write();
	} catch (e) {
		console.error(`saving ${form} failed:`, e);
		return invalid(500, submission.reject({ formErrors: [FAILED] }));
	}
	switch (written.kind) {
		case 'written':
			return { saved: form } satisfies SectionSaved;
		case 'refused':
			return invalid(400, submission.reject(written.refusal));
		case 'ask':
			return { ask: written.ask };
		case 'taken':
			return invalid(
				409,
				submission.reject({ fieldErrors: { [EDIT_BOXES.slug]: [`taken by ${written.by}`] } })
			);
		case 'stale':
			return invalid(409, submission.reject({ formErrors: [STALE] }));
		case 'gone':
			return invalid(404, submission.reject({ formErrors: [gone] }));
	}
}

const CAMPAIGN_GENERAL = defineForm({
	id: EDIT_FORMS.campaignGeneral,
	schema: CAMPAIGN_GENERAL_INPUT
});

const DONATION_PAGE_PATH = '/donate';

/** the address rule's refusal as the predicate under the link's box. */
function slugPredicate(refused: Exclude<SlugCheck, { ok: true }>): string {
	switch (refused.reason) {
		case 'empty':
			return 'required';
		case 'length':
			return `at most ${refused.max} characters`;
		case 'character':
			return `lowercase letters, numbers and single hyphens between words, not “${refused.character}”`;
		case 'reserved':
			return refused.clashesWith === DONATION_PAGE_PATH
				? 'taken by the Donation page'
				: `clashes with ${refused.clashesWith}`;
	}
}

/**
 * General: the name, the link and the description, in one `batch()` guarded on the version drawn.
 * the description is the draft's; the name and the link are not page content and move at once —
 * the name everywhere a rename reaches (`renaming` in ./queries.ts), the draft's name reaching
 * donors at Publish, and the link as `updateCampaignSlug` moves it. a link that would stop a
 * published campaign's address working, or take an ended campaign's, is answered with the question
 * and nothing is written; the resubmission ticks `move` or `takeover`.
 */
export async function saveCampaignGeneral(
	db: Db,
	target: CampaignTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, CAMPAIGN_GENERAL);
	if (!submission.ok) return invalid(400, submission.reject());
	const { name, slug: posted, story, move, takeover } = submission.value;
	const checked = checkSlug(posted);
	if (!checked.ok) {
		return invalid(
			400,
			submission.reject({ fieldErrors: { [EDIT_BOXES.slug]: [slugPredicate(checked)] } })
		);
	}
	let json: unknown;
	try {
		json = JSON.parse(story);
	} catch {
		return invalid(
			400,
			submission.reject({
				fieldErrors: {
					[EDIT_BOXES.story]: ['couldn’t be read. Reload the page and enter the description again.']
				}
			})
		);
	}
	const read = parseRichText(json);
	const description = (read.ok && isEmptyDocument(read.doc) ? undefined : json) as Page['story'];
	const seen = submittedVersion(body);
	const confirmed = { move: move === true, takeover: takeover === true };
	const to = `/${checked.slug}`;

	return answer(EDIT_FORMS.campaignGeneral, submission, gone, async (): Promise<SectionWrite> => {
		const now = Date.now();
		for (let attempt = 1; ; attempt += 1) {
			const row = await readTarget(db, target);
			if (row === null) return { kind: 'gone' };
			if (row.updatedAt.getTime() !== seen.getTime()) return { kind: 'stale' };
			const plan = await planSlugMove(db, row, checked.slug, confirmed, now);
			if (plan.kind === 'taken') return plan;
			if (plan.kind === 'ask') {
				return {
					kind: 'ask',
					ask:
						plan.ask === 'move'
							? { kind: 'move', from: `/${plan.from}`, to }
							: { kind: 'takeover', holder: plan.holder, to }
				};
			}
			const renamed = name === row.name ? null : await renamedColumns(db, row, name);
			const moving = plan.kind === 'move' ? plan : null;
			try {
				return await writeSection(db, target, seen, async (draft) => ({
					ok: true,
					draft: { ...draft, name, story: description },
					alongside: {
						columns: { ...renamed, ...(moving === null ? {} : { slug: checked.slug }) },
						// the link's release first, for `page_slug_idx`; the owned row's rename before the
						// page's update, which moves what `drawn` reads.
						before: (drawn) => [
							...(moving === null ? [] : moving.before(drawn)),
							...(renamed === null ? [] : [renamingOwned(db, row.formId, name, drawn)])
						]
					}
				}));
			} catch (error) {
				if (moving !== null)
					return { kind: 'taken', by: await slugRace(db, checked.slug, now, error) };
				// the address the name led to was taken between the read and the write.
				if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
					throw error;
				}
			}
		}
	});
}

const CAMPAIGN_GOAL = defineForm({ id: EDIT_FORMS.campaignGoal, schema: CAMPAIGN_GOAL_INPUT });

/**
 * Goal and amounts: the goal, the suggested amounts into the draft settings' `suggestedAmounts`,
 * and a label beside each into `amountLabels`, in one write. each amount is held to the smallest and
 * largest gift the draft holds, by the rule a form's amounts are (`readSuggestedAmounts`); a label
 * beside a blank amount, or a repeat of one, is dropped.
 */
export async function saveCampaignGoal(
	db: Db,
	target: CampaignTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, CAMPAIGN_GOAL);
	if (!submission.ok) return invalid(400, submission.reject());
	const { goal_mode, goal_amount, amount: rows, amount_label: labels } = submission.value;
	return answer(EDIT_FORMS.campaignGoal, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft, row) => {
			const settings = await draftSettingsOf(db, row);
			const read = readSuggestedAmounts(rows, settings.minMinor, settings.maxMinor);
			if (read.problems.length > 0) {
				return {
					ok: false,
					refusal: {
						fieldErrors: Object.fromEntries(
							read.problems.map(({ row: at, problem }) => [
								`${EDIT_BOXES.amount}[${at}]`,
								[problem]
							])
						)
					}
				};
			}
			// `readSuggestedAmounts` keeps each entry `suggestedEntries` counts, in its order.
			const amountLabels = suggestedEntries(rows).flatMap(({ row: at }, kept) => {
				const label = labels[at]?.trim() ?? '';
				const amountMinor = read.amounts[kept];
				return label === '' || amountMinor === undefined ? [] : [{ amountMinor, label }];
			});
			let goalMinor: number | undefined;
			if (goal_mode === 'fixed') {
				const goal = readAmount(goal_amount ?? '', settings.currency);
				if (goal.minor === null) return refusedUnder(EDIT_BOXES.goalAmount, goal.problem);
				goalMinor = goal.minor;
			}
			return {
				ok: true,
				draft: {
					...draft,
					goalMinor,
					settings: { ...settings, suggestedAmounts: read.amounts },
					amountLabels: amountLabels.length === 0 ? undefined : amountLabels
				}
			};
		})
	);
}

const CAMPAIGN_SETTINGS = defineForm({
	id: EDIT_FORMS.campaignSettings,
	schema: CAMPAIGN_SETTINGS_INPUT
});

/** the form screen's sentence for a program no longer offered. */
const NO_SUCH_PROGRAM = 'Choose an active program.';

/** a form's program and giving parsers' sentences under the boxes this card carries. */
function boxErrors(errors: FormInputFieldErrors): Record<string, string[]> {
	const keyed: Record<string, string[]> = {};
	for (const [box, sentence] of Object.entries(errors)) {
		if ((FORM_TEXT_FIELDS as readonly string[]).includes(box)) keyed[box] = [sentence];
	}
	return keyed;
}

/**
 * Settings: where gifts go, the smallest and largest gift, the switches, the share message and the
 * end date, as one write to the draft. the program and the bounds are held to a form's program and
 * giving rules (`parseFormProgram`, `parseFormGiving`) with the amounts the draft suggests, which
 * Goal and amounts sets, so bounds that would leave one of them outside are refused naming that
 * card; the end date is held to `readEndDay`'s rule, as the Settings sheet's own press is.
 */
export async function saveCampaignSettings(
	db: Db,
	target: CampaignTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, CAMPAIGN_SETTINGS);
	if (!submission.ok) return invalid(400, submission.reject());
	const { open_on_monthly, dedication_on, share_message, end_date, time_zone } = submission.value;
	const values = formInputValues(body);
	return answer(EDIT_FORMS.campaignSettings, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft, row) => {
			const held = await draftSettingsOf(db, row);
			const program = parseFormProgram(values);
			const giving = parseFormGiving({
				...values,
				suggested_amounts: held.suggestedAmounts.map((minor) => groupedEntry(minor, held.currency))
			});
			if (!program.ok || !giving.ok) {
				const errors = {
					...(program.ok ? {} : program.errors),
					...(giving.ok ? {} : giving.errors)
				};
				const amounts = errors.suggested_amounts;
				return {
					ok: false,
					refusal: {
						fieldErrors: boxErrors(errors),
						...(amounts === undefined
							? {}
							: {
									formErrors: [
										`Nothing was saved: under Goal and amounts, ${amounts}. Change those amounts, or the smallest or largest gift here, then save.`
									]
								})
					}
				};
			}
			const ends = readEndDay(end_date, time_zone, Date.now());
			if (!ends.ok) {
				return {
					ok: false,
					refusal: {
						fieldErrors: Object.fromEntries(
							Object.entries(ends.boxes).map(([box, sentence]) => [box, [sentence]])
						)
					}
				};
			}
			const settings = await draftSettingsAfter(db, row, {
				program: program.value,
				bounds: giving.value,
				suggestedAmounts: held.suggestedAmounts
			});
			if (settings === 'unknown_program') {
				return refusedUnder(EDIT_BOXES.programId, NO_SUCH_PROGRAM);
			}
			const said = share_message ?? '';
			return {
				ok: true,
				draft: {
					...draft,
					settings,
					switches: { openOnMonthly: open_on_monthly, dedicationOn: dedication_on },
					shareMessage: said === '' ? undefined : said,
					...ends.keys
				}
			};
		})
	);
}

const CAMPAIGN_MEDIA = defineForm({ id: EDIT_FORMS.campaignMedia, schema: CAMPAIGN_MEDIA_INPUT });

/**
 * Media: the banner (the cover photo, `hero`) and the campaign's logo, each by the id the images
 * route (src/routes/_app.admin.images.ts) answered its upload with; a blank box takes its photo off,
 * and an id no stored photo has is refused under its box. a photo kept keeps its description, and
 * one newly placed is decorative. a photo let go of is freed in the draft's write.
 */
export async function saveCampaignMedia(
	db: Db,
	target: CampaignTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, CAMPAIGN_MEDIA);
	if (!submission.ok) return invalid(400, submission.reject());
	const posted = {
		hero: { box: EDIT_BOXES.heroImageId, id: submission.value.hero_image_id ?? '' },
		logo: { box: EDIT_BOXES.logoImageId, id: submission.value.logo_image_id ?? '' }
	} as const;
	return answer(EDIT_FORMS.campaignMedia, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft) => {
			const placed: { hero?: Photo; logo?: Photo } = {};
			for (const key of ['hero', 'logo'] as const) {
				const { box, id } = posted[key];
				if (id === '') continue;
				const held = draft[key];
				const checked = photoRule.safeParse({
					imageId: id,
					alt: held?.imageId === id ? held.alt : null
				});
				if (!checked.success) return refusedUnder(box, checked.error.issues[0]?.message ?? id);
				if ((await firstMissingImage(db, [id])) !== null) {
					return refusedUnder(box, `no stored photo has the id "${id}"`);
				}
				placed[key] = checked.data;
			}
			return { ok: true, draft: { ...draft, hero: placed.hero, logo: placed.logo } };
		})
	);
}

const DONATION_PAGE_GENERAL = defineForm({
	id: EDIT_FORMS.donationPageGeneral,
	schema: DONATION_PAGE_GENERAL_INPUT
});
const DONATION_PAGE_GIVING = defineForm({
	id: EDIT_FORMS.donationPageGiving,
	schema: DONATION_PAGE_GIVING_INPUT
});
const DONATION_PAGE_SETTINGS = defineForm({
	id: EDIT_FORMS.donationPageSettings,
	schema: DONATION_PAGE_SETTINGS_INPUT
});

/** the Donation page's General: its title; blank draws "Donate to" and the organisation's name. */
export async function saveDonationPageGeneral(
	db: Db,
	target: DonationPageTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, DONATION_PAGE_GENERAL);
	if (!submission.ok) return invalid(400, submission.reject());
	const heading = submission.value.heading ?? '';
	return answer(EDIT_FORMS.donationPageGeneral, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft) => ({
			ok: true,
			draft: { ...draft, heading }
		}))
	);
}

/**
 * the Donation page's Donation settings: where gifts go, the smallest and largest gift and its
 * suggested amounts, under a form's program and giving rules, to the draft settings; the switches
 * are its Settings card's and stay as the draft holds them.
 */
export async function saveDonationPageGiving(
	db: Db,
	target: DonationPageTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, DONATION_PAGE_GIVING);
	const values = formInputValues(body);
	const program = parseFormProgram(values);
	const giving = parseFormGiving(values);
	if (!submission.ok || !program.ok || !giving.ok) {
		const errors = { ...(program.ok ? {} : program.errors), ...(giving.ok ? {} : giving.errors) };
		return invalid(400, submission.reject({ fieldErrors: boxErrors(errors) }));
	}
	return answer(EDIT_FORMS.donationPageGiving, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft, row) => {
			const settings = await draftSettingsAfter(db, row, {
				program: program.value,
				bounds: giving.value,
				suggestedAmounts: giving.value.suggestedAmounts
			});
			if (settings === 'unknown_program') {
				return refusedUnder(EDIT_BOXES.programId, NO_SUCH_PROGRAM);
			}
			return { ok: true, draft: { ...draft, settings } };
		})
	);
}

/** the Donation page's Settings: where its box opens, and the share message. */
export async function saveDonationPageSettings(
	db: Db,
	target: DonationPageTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, DONATION_PAGE_SETTINGS);
	if (!submission.ok) return invalid(400, submission.reject());
	const { open_on_monthly, dedication_on, share_message } = submission.value;
	const said = share_message ?? '';
	return answer(EDIT_FORMS.donationPageSettings, submission, gone, () =>
		writeSection(db, target, submittedVersion(body), async (draft) => ({
			ok: true,
			draft: {
				...draft,
				switches: { openOnMonthly: open_on_monthly, dedicationOn: dedication_on },
				shareMessage: said === '' ? undefined : said
			}
		}))
	);
}

/** a card's Save on a campaign's edit screen, by the form its body names. */
export async function saveCampaignSection(
	db: Db,
	target: CampaignTarget,
	form: CampaignEditFormId,
	body: FormData,
	gone: string
) {
	switch (form) {
		case EDIT_FORMS.campaignGeneral:
			return saveCampaignGeneral(db, target, body, gone);
		case EDIT_FORMS.campaignMedia:
			return saveCampaignMedia(db, target, body, gone);
		case EDIT_FORMS.campaignGoal:
			return saveCampaignGoal(db, target, body, gone);
		case EDIT_FORMS.campaignSettings:
			return saveCampaignSettings(db, target, body, gone);
	}
}

/** a card's Save on the Donation page's edit screen, by the form its body names. */
export async function saveDonationPageSection(
	db: Db,
	target: DonationPageTarget,
	form: DonationPageEditFormId,
	body: FormData,
	gone: string
) {
	switch (form) {
		case EDIT_FORMS.donationPageGeneral:
			return saveDonationPageGeneral(db, target, body, gone);
		case EDIT_FORMS.donationPageGiving:
			return saveDonationPageGiving(db, target, body, gone);
		case EDIT_FORMS.donationPageSettings:
			return saveDonationPageSettings(db, target, body, gone);
	}
}
