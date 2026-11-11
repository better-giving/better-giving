import { and, eq, gt, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporter, supporterLink, supporterPage, type SupporterLinkPurpose } from '../db/schema';
import {
	isRateLimited,
	supporterLinkRateLimitKey,
	supporterMailRateLimitKey
} from '../api/rate-limit';
import type { RateLimiter } from '../runtime/rate-limiter';
import { startSupporterSession } from './session';
import { hashToken, mintToken } from './token';

// the one-time links mailed to a supporter: asking for one, minting one, and opening one. a link is
// stored as its hash, works once, and admits nothing 60 minutes after it was made. opening a
// `confirm` link takes its pending page live and signs the supporter in; a `sign_in` link signs in.

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
 * a link's row insert, as `linkInsert` makes it, behind a spend of every older unused link of the
 * same purpose for the same supporter (and the same page, for `confirm`), for the caller's
 * `batch()`: the newest link mailed is the one that works.
 */
export function replacingLinkInsert(
	db: Db,
	link: {
		readonly supporterId: string;
		readonly purpose: SupporterLinkPurpose;
		readonly pageId: string | null;
	},
	now: Date
) {
	const fresh = linkInsert(db, link, now);
	const spend = db
		.update(supporterLink)
		.set({ usedAt: now })
		.where(
			and(
				eq(supporterLink.supporterId, link.supporterId),
				eq(supporterLink.purpose, link.purpose),
				link.pageId === null ? undefined : eq(supporterLink.supporterPageId, link.pageId),
				isNull(supporterLink.usedAt)
			)
		);
	return { token: fresh.token, statements: [spend, fresh.statement] as const };
}

/**
 * charges a press that mails a link against the caller's bucket and the address's, both on
 * `SIGN_IN_RATE_LIMITER`; `true` where either has nothing left. both are charged whichever refuses,
 * so a caller cannot spend one bucket while the other holds.
 */
export async function overLinkLimit(
	limiter: RateLimiter | undefined,
	request: Request,
	email: string
): Promise<boolean> {
	const [byCaller, byAddress] = await Promise.all([
		isRateLimited(limiter, supporterLinkRateLimitKey(request)),
		isRateLimited(limiter, supporterMailRateLimitKey(email))
	]);
	return byCaller || byAddress;
}

export type SignInRequestDeps = {
	readonly db: Db;
	/** `SIGN_IN_RATE_LIMITER` off the platform env. */
	readonly limiter: RateLimiter | undefined;
	/** the request's `platform.deferred.waitUntil`. */
	readonly defer: (work: Promise<unknown>) => void;
	readonly sendLink: SendLink;
	readonly now: Date;
};

/**
 * "Email me a link". `sent` for every address, known or not, and the lookup, the mint and the mail
 * all run after the answer, in the deferred work, so neither the answer nor its timing says whether
 * the address has started a fundraiser. only an address with a `supporter` row is mailed.
 * `too_many` where the caller or the address is over its bucket, decided before anything is read.
 */
export async function requestSignInLink(
	deps: SignInRequestDeps,
	request: Request,
	email: string
): Promise<'sent' | 'too_many'> {
	if (await overLinkLimit(deps.limiter, request, email)) return 'too_many';
	deps.defer(mailSignInLink(deps, email));
	return 'sent';
}

async function mailSignInLink(deps: SignInRequestDeps, email: string): Promise<void> {
	const [found] = await deps.db
		.select({ id: supporter.id })
		.from(supporter)
		.where(eq(supporter.email, email))
		.limit(1);
	if (!found) return;
	const link = replacingLinkInsert(
		deps.db,
		{ supporterId: found.id, purpose: 'sign_in', pageId: null },
		deps.now
	);
	await deps.db.batch(link.statements);
	await deps.sendLink({ to: email, token: link.token, arm: { kind: 'returning' } });
}

/**
 * Send it again after a start: a fresh confirm link for the pending page `pageId`, which the
 * supporter at `email` started, with every older unused confirm link for that page spent. answered
 * and limited as `requestSignInLink` is, `sent` for every address and page, and nothing is mailed
 * where the page is not that supporter's or is no longer pending.
 */
export async function resendConfirmLink(
	deps: SignInRequestDeps,
	request: Request,
	asked: { readonly email: string; readonly pageId: string }
): Promise<'sent' | 'too_many'> {
	if (await overLinkLimit(deps.limiter, request, asked.email)) return 'too_many';
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
	const link = replacingLinkInsert(
		deps.db,
		{ supporterId: found.supporterId, purpose: 'confirm', pageId: asked.pageId },
		deps.now
	);
	await deps.db.batch(link.statements);
	await deps.sendLink({
		to: asked.email,
		token: link.token,
		arm: { kind: 'first', pageTitle: found.title }
	});
}

/**
 * a link opened: signed in, with the `Set-Cookie` value carrying the session, and for a `confirm`
 * link the page it named, now live unless it had already left `pending`. a used, expired or unknown
 * token is one refusal with nothing in it to tell the three apart.
 */
export type OpenedLink =
	| {
			readonly ok: true;
			readonly setCookie: string;
			readonly purpose: SupporterLinkPurpose;
			readonly page: { readonly id: string; readonly slug: string } | null;
	  }
	| { readonly ok: false };

export async function signInWithLink(
	db: Db,
	request: Request,
	token: string,
	now: Date
): Promise<OpenedLink> {
	const tokenHash = hashToken(token);
	const open = and(
		eq(supporterLink.tokenHash, tokenHash),
		isNull(supporterLink.usedAt),
		gt(supporterLink.expiresAt, now)
	);
	const unspent = (
		column: typeof supporterLink.supporterId | typeof supporterLink.supporterPageId
	) => db.select({ id: column }).from(supporterLink).where(open);

	// one batch, and the link is spent last: the publish and the stamp are guarded on the link still
	// being open, so they land exactly when the spend does, and a second opening lands none of them.
	const [, , spent] = await db.batch([
		db
			.update(supporterPage)
			.set({ status: 'live', publishedAt: now })
			.where(
				and(
					eq(supporterPage.status, 'pending'),
					sql`${supporterPage.id} = (${unspent(supporterLink.supporterPageId)})`
				)
			),
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
	if (!link) return { ok: false };

	const page =
		link.pageId === null
			? null
			: ((
					await db
						.select({ id: supporterPage.id, slug: supporterPage.slug })
						.from(supporterPage)
						.where(eq(supporterPage.id, link.pageId))
				)[0] ?? null);
	return {
		ok: true,
		setCookie: await startSupporterSession(db, request, link.supporterId, now),
		purpose: link.purpose,
		page
	};
}
