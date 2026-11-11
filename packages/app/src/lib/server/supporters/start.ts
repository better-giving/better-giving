import { isNotNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { MAX_FORM_NAME } from '../../forms/input-schema';
import { freeSlug, SUPPORTER_RESERVED_SEGMENTS } from '../../page/slug';
import type { SupporterStart } from '../../supporters/input';
import type { ChallengeResult } from '../api/challenge';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { page, supporter, supporterPage } from '../db/schema';
import { formInputValuesFrom, type ParsedForm, parseFormInput } from '../forms/form-input';
import { ownedFormInsert, readForm } from '../forms/queries';
import { supporterFundraisersEnabled } from '../org/queries';
import { ensureDonationPage } from '../pages/donation-page';
import { SLUG_ATTEMPTS } from '../pages/queries';
import type { RateLimiter } from '../runtime/rate-limiter';
import { linkInsert, overLinkLimit, type SendLink } from './links';

// Start a fundraiser: a member of the public makes a page of their own for this organisation. one
// `batch()` writes the supporter (or finds the one at that address), the page `pending`, the
// settings row it owns, and the confirm link; the link is mailed after the answer. the page goes
// live when that link is opened (`signInWithLink` in ./links.ts), so an address typed by somebody
// else puts nothing in public.
//
// the settings row is the Donation page's live row copied, as a campaign's is
// (`createCampaign` in ../pages/campaign.ts), and made live: whether the page takes a gift is the
// page's own state, read by the donation path (./gifts.ts), never the row's status. a gift through
// it is a gift to the organisation like one on /donate, the Donation page's cause included.

export type StartDeps = {
	readonly db: Db;
	/** `SIGN_IN_RATE_LIMITER` off the platform env: a start mails a link. */
	readonly limiter: RateLimiter | undefined;
	readonly defer: (work: Promise<unknown>) => void;
	readonly sendLink: SendLink;
	/**
	 * the spam check the donation submission runs — `verifyChallenge` in ../api/challenge.ts,
	 * Turnstile where both its keys are set and ALTCHA otherwise — bound by the route to this
	 * submission's token or payload.
	 */
	readonly checkChallenge: () => Promise<ChallengeResult>;
	readonly now: Date;
};

/**
 * the page made, or why not: `too_many` over the caller's or the address's bucket, `closed` where
 * the organisation has switched fundraisers off, `challenge_failed` for a token or payload that did
 * not clear (a fresh challenge is the answer), `challenge_unavailable` where the check could not be
 * made, and `photo_missing` for a photo id no stored image carries.
 */
export type StartResult =
	| { readonly ok: true; readonly pageId: string; readonly slug: string }
	| {
			readonly ok: false;
			readonly reason:
				| 'too_many'
				| 'closed'
				| 'challenge_failed'
				| 'challenge_unavailable'
				| 'photo_missing';
	  };

export async function startFundraiser(
	deps: StartDeps,
	request: Request,
	input: SupporterStart
): Promise<StartResult> {
	if (await overLinkLimit(deps.limiter, request, input.email)) {
		return { ok: false, reason: 'too_many' };
	}
	if (!(await supporterFundraisersEnabled(deps.db))) return { ok: false, reason: 'closed' };

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

	const settings = await copiedSettings(deps.db, input.title);
	try {
		const made = await insertFundraiser(deps, input, settings);
		deps.defer(
			deps.sendLink({
				to: input.email,
				token: made.token,
				arm: { kind: 'first', pageTitle: input.title }
			})
		);
		return { ok: true, pageId: made.pageId, slug: made.slug };
	} catch (error) {
		// the photo is the one key a caller names: every other id in the batch is minted here.
		if (sqliteResultCode(error) === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
			return { ok: false, reason: 'photo_missing' };
		}
		throw error;
	}
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
 * the supporter, the page, its settings row and the confirm link in one `batch()`, at the first
 * address free when read: one no campaign and no other fundraiser holds, that no route answers at
 * the top level (`checkSlug`) or under `/f/`. a second start taking that address between the read
 * and the batch fails it whole on `supporter_page_slug_idx`, and the next attempt reads again.
 *
 * the supporter is named by its address in every statement after its own, because the row may be
 * the one this batch inserts or one already there, and nothing in a batch reads a returned id. an
 * existing supporter keeps the name they first gave.
 */
async function insertFundraiser(
	deps: StartDeps,
	input: SupporterStart,
	{ settings, currency }: { settings: ParsedForm; currency: string }
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
					photoId: input.photo_id,
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
