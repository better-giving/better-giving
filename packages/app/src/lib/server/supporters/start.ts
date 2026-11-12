import { isNotNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { MAX_FORM_NAME } from '../../forms/input-schema';
import { freeSlug, SUPPORTER_RESERVED_SEGMENTS } from '../../page/slug';
import { PHOTO_FILE_FIELD } from '../../supporter/area/forms';
import type { SupporterStart } from '../../supporters/input';
import type { ChallengeResult } from '../api/challenge';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { page, supporter, supporterPage } from '../db/schema';
import type { PostedPhoto } from '../images/intake';
import { formInputValuesFrom, type ParsedForm, parseFormInput } from '../forms/form-input';
import { ownedFormInsert, readForm } from '../forms/queries';
import { supporterFundraisersEnabled } from '../org/queries';
import { ensureDonationPage } from '../pages/donation-page';
import { SLUG_ATTEMPTS } from '../pages/queries';
import type { supporterLinkOrigin } from './area';
import {
	addressOverLinkLimit,
	callerOverLinkLimit,
	type LinkLimiters,
	linkInsert,
	type SendLink
} from './links';
import { checkSupporterPhoto } from './photo';

// starting a fundraiser: a member of the public makes a page of their own for this organisation. one
// `batch()` writes the supporter (or finds the one at that address), the page `pending`, its photo
// where one was posted with the start, the settings row it owns, and the confirm link; the link is
// mailed after the answer. the page goes live when that link is opened (`signInWithLink` in
// ./links.ts), so an address typed by somebody else puts nothing in public.
//
// the settings row is the Donation page's live row copied, as a campaign's is
// (`createCampaign` in ../pages/campaign.ts), and made live: whether the page takes a gift is the
// page's own state, read by the donation path (./gifts.ts), never the row's status. a gift through
// it is a gift to the organisation like one on /donate, the Donation page's cause included.

export type StartDeps = {
	readonly db: Db;
	/** a start mails a link, so it is charged as every press that mails one is. */
	readonly limiters: LinkLimiters;
	readonly defer: (work: Promise<unknown>) => void;
	readonly sendLink: SendLink;
	/**
	 * the origin a mailed link is built on (`supporterLinkOrigin` in ./area.ts): where there is none,
	 * the confirm link could never arrive, so a page started would stay pending with nothing to tell
	 * the starter why.
	 */
	readonly linkOrigin: ReturnType<typeof supporterLinkOrigin>;
	/**
	 * the spam check the donation submission runs — `verifyChallenge` in ../api/challenge.ts,
	 * Turnstile where both its keys are set and ALTCHA otherwise — bound by the route to this
	 * submission's token or payload.
	 */
	readonly checkChallenge: () => Promise<ChallengeResult>;
	readonly now: Date;
};

/** what the start screen says to `unmailable`: the fix is the operator's, never the starter's. */
export const UNMAILABLE_START =
	'We can’t send email just now, so your fundraiser wasn’t started. Try again later, or let the organisation know.';

/**
 * the page made, or why not: `too_many` over the caller's or the address's bucket, `closed` where
 * the organisation has switched fundraisers off, `unmailable` where no link can be mailed
 * (`linkOrigin`, logged for whoever runs the server), `challenge_failed` for a token or payload
 * that did not clear (a fresh challenge is the answer), `challenge_unavailable` where the check
 * could not be made, and `photo_missing` for a posted photo the photo rule refuses (./photo.ts).
 */
export type StartResult =
	| { readonly ok: true; readonly pageId: string; readonly slug: string }
	| {
			readonly ok: false;
			readonly reason:
				| 'too_many'
				| 'closed'
				| 'unmailable'
				| 'challenge_failed'
				| 'challenge_unavailable'
				| 'photo_missing';
	  };

/**
 * `photo` is the start's own posted photo part, or null where none came: one is read only once the
 * caller is under the limit and the spam check has cleared, and is stored in the same `batch()` as
 * the page, so a refused start stores no photo. it is the only way a start gets a photo: the start
 * schema states no photo id ($lib/supporters/input.ts).
 */
export async function startFundraiser(
	deps: StartDeps,
	request: Request,
	input: SupporterStart,
	photo: FormDataEntryValue | null = null
): Promise<StartResult> {
	if (await callerOverLinkLimit(deps.limiters, request)) return { ok: false, reason: 'too_many' };
	if (!(await supporterFundraisersEnabled(deps.db))) return { ok: false, reason: 'closed' };
	if (!deps.linkOrigin.ok) {
		console.error('a fundraiser start was refused:', deps.linkOrigin.why);
		return { ok: false, reason: 'unmailable' };
	}

	const challenge = await deps.checkChallenge();
	if (!challenge.ok) {
		if (challenge.operatorFix !== null) {
			console.error(
				'a fundraiser start was refused by the challenge check:',
				challenge.operatorFix
			);
		}
		return {
			ok: false,
			reason: challenge.reason === 'rejected' ? 'challenge_failed' : 'challenge_unavailable'
		};
	}
	// after the challenge, so a start that never clears it spends nothing of the address's bucket.
	if (await addressOverLinkLimit(deps.limiters, input.email)) {
		return { ok: false, reason: 'too_many' };
	}

	const posted = isPosted(photo)
		? await checkSupporterPhoto(deps.db, photo, PHOTO_FILE_FIELD)
		: null;
	if (posted !== null && !posted.ok) return { ok: false, reason: 'photo_missing' };

	const settings = await copiedSettings(deps.db, input.title);
	const made = await insertFundraiser(deps, input, settings, posted);
	deps.defer(
		deps.sendLink({
			to: input.email,
			token: made.token,
			arm: { kind: 'first', pageTitle: input.title }
		})
	);
	return { ok: true, pageId: made.pageId, slug: made.slug };
}

/** whether a photo part came: a file input left empty posts a nameless file of no bytes. */
function isPosted(photo: FormDataEntryValue | null): photo is FormDataEntryValue {
	return photo !== null && photo !== '' && !(photo instanceof Blob && photo.size === 0);
}

/** the Donation page's live settings, named for the fundraiser and live. */
async function copiedSettings(
	db: Db,
	title: string
): Promise<{ settings: ParsedForm; currency: string }> {
	const donationPage = await ensureDonationPage(db);
	const copied = await readForm(db, donationPage.formId);
	if (copied === null) {
		throw new Error(`the Donation page's settings row ${donationPage.formId} is gone`);
	}
	const settings = parseFormInput({
		...formInputValuesFrom(copied),
		name: `Fundraiser: ${title}`.slice(0, MAX_FORM_NAME),
		status: 'live'
	});
	if (!settings.ok) {
		throw new Error(
			`the Donation page's settings fail the form rule: ${JSON.stringify(settings.errors)}`
		);
	}
	return { settings: settings.value, currency: copied.currency };
}

/**
 * the supporter, the page, its posted photo, its settings row and the confirm link in one `batch()`,
 * at the first address free when read: one no campaign and no other fundraiser holds, that no route
 * answers at the top level (`checkSlug`) or under `/f/`. a second start taking that address between
 * the read and the batch fails it whole on `supporter_page_slug_idx`, and the next attempt reads
 * again.
 *
 * the supporter is named by its address in every statement after its own, because the row may be
 * the one this batch inserts or one already there, and nothing in a batch reads a returned id. an
 * existing supporter keeps the name they first gave.
 */
async function insertFundraiser(
	deps: StartDeps,
	input: SupporterStart,
	{ settings, currency }: { settings: ParsedForm; currency: string },
	photo: Extract<PostedPhoto, { ok: true }> | null
): Promise<{ pageId: string; slug: string; token: string }> {
	const { db, now } = deps;
	const supporterId = sql`(select ${supporter.id} from ${supporter} where ${supporter.email} = ${input.email})`;
	for (let attempt = 1; ; attempt += 1) {
		const [campaigns, fundraisers] = await Promise.all([
			db.select({ slug: page.slug }).from(page).where(isNotNull(page.slug)),
			db.select({ slug: supporterPage.slug }).from(supporterPage)
		]);
		const held = new Set<string | null>([
			...SUPPORTER_RESERVED_SEGMENTS,
			...campaigns.map((row) => row.slug),
			...fundraisers.map((row) => row.slug)
		]);
		const slug = freeSlug(input.title, held);
		const pageId = uuidv7();
		const owned = ownedFormInsert(db, settings);
		const link = linkInsert(db, { supporterId, purpose: 'confirm', pageId }, now);
		try {
			await db.batch([
				...(photo?.statements ?? []),
				db
					.insert(supporter)
					.values({ email: input.email, name: input.name, createdAt: now })
					.onConflictDoNothing({ target: supporter.email }),
				owned.statement,
				db.insert(supporterPage).values({
					id: pageId,
					supporterId,
					slug,
					title: input.title,
					story: input.story,
					goalMinor: input.goal,
					currency,
					photoId: photo?.id ?? null,
					formId: owned.id,
					status: 'pending',
					createdAt: now,
					updatedAt: now
				}),
				link.statement
			]);
			return { pageId, slug, token: link.token };
		} catch (error) {
			if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
				throw error;
			}
		}
	}
}
