import { and, eq, gt, isNull, ne, notExists, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporter, supporterLink, supporterPage, type SupporterLinkPurpose } from '../db/schema';
import {
	rateLimitWait,
	supporterResendCallerRateLimitKey,
	supporterResendRateLimitKey,
	supporterSignInAddressRateLimitKey,
	supporterSignInCallerRateLimitKey
} from '../api/rate-limit';
import { supporterFundraisersEnabledSql } from '../org/queries';
import type { RateLimiter } from '../runtime/rate-limiter';
import { startSupporterSession } from './session';
import { hashToken, mintToken } from './token';

// the one-time links mailed to a supporter: asking for one, minting one, and opening one. a link is
// stored as its hash, works once, and admits nothing 60 minutes after it was made. a newer link
// spends no older one: asking needs no session, so a spend would let anyone who knows an address
// spend the link its supporter is about to press. opening a `confirm` link takes its pending page
// live and signs the supporter in; a `sign_in` link signs in.

/** how long a link works for, from when it was made. */
export const LINK_LIFETIME_MS = 60 * 60 * 1000;

/**
 * a link to mail: `first` for the confirm link a new page sends, naming the page, and `returning`
 * for a sign-in link. the routes turn `token` into the address the mail carries.
 */
export type LinkMail = {
	readonly to: string;
	readonly token: string;
	readonly arm:
		| { readonly kind: 'first'; readonly pageTitle: string }
		| { readonly kind: 'returning' };
};

/** sends a link; the routes bind it to the mail transport. a throw is logged by the deferred work. */
export type SendLink = (mail: LinkMail) => Promise<void>;

/** a link's row insert for the caller's write, and the token that opens it. */
export function linkInsert(
	db: Db,
	link: {
		/** the id, or a subquery naming it for a batch that inserts the supporter alongside. */
		readonly supporterId: string | SQL;
		readonly purpose: SupporterLinkPurpose;
		readonly pageId: string | null;
	},
	now: Date
) {
	const token = mintToken();
	return {
		token,
		statement: db.insert(supporterLink).values({
			tokenHash: hashToken(token),
			supporterId: link.supporterId,
			purpose: link.purpose,
			supporterPageId: link.pageId,
			createdAt: now,
			expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS)
		})
	};
}

/**
 * the buckets a press that mails a link off the sign-in screen or Check your email is charged, off
 * the platform env: "Email me a link" by the caller and by the address, and Send it again by the
 * caller and by its page. a start is charged its own (./start.ts). none shares a bucket with another.
 */
export type LinkLimiters = {
	readonly signInByCaller: RateLimiter | undefined;
	readonly signInByAddress: RateLimiter | undefined;
	readonly resendByCaller: RateLimiter | undefined;
	readonly resendByPage: RateLimiter | undefined;
};

/** the buckets `env` carries for a press that mails a link. */
export function linkLimiters(env: Env): LinkLimiters {
	return {
		signInByCaller: env.SUPPORTER_SIGN_IN_CALLER_RATE_LIMITER,
		signInByAddress: env.SUPPORTER_SIGN_IN_ADDRESS_RATE_LIMITER,
		resendByCaller: env.SUPPORTER_RESEND_CALLER_RATE_LIMITER,
		resendByPage: env.SUPPORTER_RESEND_RATE_LIMITER
	};
}

/** a link press refused: the seconds until the bucket that refused it admits again. */
export type LinkRefusal = { readonly retryAfterSeconds: number };

const refusal = (wait: number | null): LinkRefusal | null =>
	wait === null ? null : { retryAfterSeconds: wait };

export type SignInRequestDeps = {
	readonly db: Db;
	readonly limiters: LinkLimiters;
	/** the request's `platform.deferred.waitUntil`. */
	readonly defer: (work: Promise<unknown>) => void;
	readonly sendLink: SendLink;
	readonly now: Date;
};

/**
 * "Email me a link". `sent` for every address, known or not, and the lookup, the mint and the mail
 * all run after the answer, in the deferred work, so neither the answer nor its timing says whether
 * the address has started a fundraiser. only an address with a `supporter` row is mailed. a
 * `LinkRefusal` only where the caller is over its own bucket, decided before anything is read; past
 * the address's bucket the answer is `sent` too and nothing is mailed, so no wait on the screen
 * reflects anyone else's presses for that address.
 */
export async function requestSignInLink(
	deps: SignInRequestDeps,
	request: Request,
	email: string
): Promise<'sent' | LinkRefusal> {
	const callerRefused = refusal(
		await rateLimitWait(deps.limiters.signInByCaller, supporterSignInCallerRateLimitKey(request))
	);
	if (callerRefused !== null) return callerRefused;
	const addressWait = await rateLimitWait(
		deps.limiters.signInByAddress,
		supporterSignInAddressRateLimitKey(request, email)
	);
	if (addressWait === null) deps.defer(mailSignInLink(deps, email));
	return 'sent';
}

async function mailSignInLink(deps: SignInRequestDeps, email: string): Promise<void> {
	const [found] = await deps.db
		.select({ id: supporter.id })
		.from(supporter)
		.where(eq(supporter.email, email))
		.limit(1);
	if (!found) return;
	const link = linkInsert(
		deps.db,
		{ supporterId: found.id, purpose: 'sign_in', pageId: null },
		deps.now
	);
	await link.statement;
	await deps.sendLink({ to: email, token: link.token, arm: { kind: 'returning' } });
}

/**
 * Send it again after a start: a fresh confirm link for the pending page `pageId`, which the
 * supporter at `email` started, beside the confirm links already mailed for it. answered
 * as `requestSignInLink` is, `sent` for every address and page, and nothing is mailed where the
 * page is not that supporter's or is no longer pending. charged by the caller, then by the page
 * only where the caller's admitted, before anything is read: the page comes from a ticket a browser
 * can write (./resend-ticket.ts), so the page's bucket alone refuses nobody who names a new one.
 */
export async function resendConfirmLink(
	deps: SignInRequestDeps,
	request: Request,
	asked: { readonly email: string; readonly pageId: string }
): Promise<'sent' | LinkRefusal> {
	const refused = refusal(
		(await rateLimitWait(
			deps.limiters.resendByCaller,
			supporterResendCallerRateLimitKey(request)
		)) ??
			(await rateLimitWait(deps.limiters.resendByPage, supporterResendRateLimitKey(asked.pageId)))
	);
	if (refused !== null) return refused;
	deps.defer(mailConfirmLink(deps, asked));
	return 'sent';
}

async function mailConfirmLink(
	deps: SignInRequestDeps,
	asked: { readonly email: string; readonly pageId: string }
): Promise<void> {
	const [found] = await deps.db
		.select({ supporterId: supporter.id, title: supporterPage.title })
		.from(supporterPage)
		.innerJoin(supporter, eq(supporter.id, supporterPage.supporterId))
		.where(
			and(
				eq(supporterPage.id, asked.pageId),
				eq(supporter.email, asked.email),
				eq(supporterPage.status, 'pending')
			)
		)
		.limit(1);
	if (!found) return;
	const link = linkInsert(
		deps.db,
		{ supporterId: found.supporterId, purpose: 'confirm', pageId: asked.pageId },
		deps.now
	);
	await link.statement;
	await deps.sendLink({
		to: asked.email,
		token: link.token,
		arm: { kind: 'first', pageTitle: found.title }
	});
}

/** a link that still opens: neither used nor expired at `now`. */
function opens(tokenHash: string, now: Date): SQL | undefined {
	return and(
		eq(supporterLink.tokenHash, tokenHash),
		isNull(supporterLink.usedAt),
		gt(supporterLink.expiresAt, now)
	);
}

/**
 * a link that spends: one that `opens`, and is not a `confirm` link whose page is still pending
 * while the organisation has switched fundraisers off. that one stays unspent and its page pending,
 * so the same link publishes once fundraisers are on again.
 */
function spends(db: Db, tokenHash: string, now: Date): SQL | undefined {
	return and(
		opens(tokenHash, now),
		or(
			ne(supporterLink.purpose, 'confirm'),
			notExists(
				db
					.select({ id: supporterPage.id })
					.from(supporterPage)
					.where(
						and(
							eq(supporterPage.id, supporterLink.supporterPageId),
							eq(supporterPage.status, 'pending')
						)
					)
			),
			supporterFundraisersEnabledSql(db)
		)
	);
}

/**
 * what a link is for while it still opens, and for a `confirm` link the page opening it publishes:
 * null where that page is no longer pending, which the opening signs in to and leaves as it is.
 */
export type OpeningLink = {
	readonly purpose: SupporterLinkPurpose;
	readonly page: { readonly title: string; readonly photoId: string | null } | null;
};

/**
 * what the link `token` is for while it still opens, or null for one used, expired or unknown,
 * read without spending it: the screen in front of an opening names the press by it, and a mail
 * scanner fetching that screen spends nothing. a `confirm` link names its page's title and photo,
 * since a start attaches to whoever holds the address (./start.ts) and the press publishes what
 * somebody else may have written.
 */
export async function readOpeningLink(
	db: Db,
	token: string,
	now: Date
): Promise<OpeningLink | null> {
	const [link] = await db
		.select({
			purpose: supporterLink.purpose,
			title: supporterPage.title,
			photoId: supporterPage.photoId,
			status: supporterPage.status
		})
		.from(supporterLink)
		.leftJoin(supporterPage, eq(supporterPage.id, supporterLink.supporterPageId))
		.where(opens(hashToken(token), now))
		.limit(1);
	if (!link) return null;
	return {
		purpose: link.purpose,
		page:
			link.title === null || link.status !== 'pending'
				? null
				: { title: link.title, photoId: link.photoId }
	};
}

/**
 * a link opened: signed in, with the `Set-Cookie` value carrying the session, and for a `confirm`
 * link the page it named, now live unless it had already left `pending`. a used, expired or unknown
 * token is one refusal, `expired`, with nothing in it to tell the three apart; `closed` is a confirm
 * link left unspent because fundraisers are off (`spends`).
 */
export type OpenedLink =
	| {
			readonly ok: true;
			readonly setCookie: string;
			readonly purpose: SupporterLinkPurpose;
			readonly page: { readonly id: string; readonly slug: string } | null;
			/**
			 * whether this opening put the page in front of donors: it took it from `pending` to `live`,
			 * and staff have not hidden it. false for a page ended or hidden before the link was opened.
			 */
			readonly published: boolean;
	  }
	| { readonly ok: false; readonly reason: 'expired' | 'closed' };

export async function signInWithLink(
	db: Db,
	request: Request,
	token: string,
	now: Date
): Promise<OpenedLink> {
	const open = spends(db, hashToken(token), now);
	const unspent = (
		column: typeof supporterLink.supporterId | typeof supporterLink.supporterPageId
	) => db.select({ id: column }).from(supporterLink).where(open);

	// one batch, and the link is spent last: the publish and the stamp are guarded on the link still
	// spending, so they land exactly when the spend does, and a second opening lands none of them.
	const [publish, , spent] = await db.batch([
		db
			.update(supporterPage)
			.set({ status: 'live', publishedAt: now })
			.where(
				and(
					eq(supporterPage.status, 'pending'),
					sql`${supporterPage.id} = (${unspent(supporterLink.supporterPageId)})`
				)
			)
			.returning({ id: supporterPage.id }),
		db
			.update(supporter)
			.set({ lastSignInAt: now })
			.where(sql`${supporter.id} = (${unspent(supporterLink.supporterId)})`),
		db.update(supporterLink).set({ usedAt: now }).where(open).returning({
			supporterId: supporterLink.supporterId,
			purpose: supporterLink.purpose,
			pageId: supporterLink.supporterPageId
		})
	]);
	const [link] = spent;
	if (!link) {
		// read after the write only to word the refusal: a link still opening was held by `spends`.
		const held = await readOpeningLink(db, token, now);
		return { ok: false, reason: held?.page ? 'closed' : 'expired' };
	}

	const page =
		link.pageId === null
			? null
			: ((
					await db
						.select({
							id: supporterPage.id,
							slug: supporterPage.slug,
							hiddenAt: supporterPage.hiddenAt
						})
						.from(supporterPage)
						.where(eq(supporterPage.id, link.pageId))
				)[0] ?? null);
	return {
		ok: true,
		setCookie: await startSupporterSession(db, request, link.supporterId, now),
		purpose: link.purpose,
		page: page === null ? null : { id: page.id, slug: page.slug },
		published: publish.length > 0 && page?.hiddenAt === null
	};
}
