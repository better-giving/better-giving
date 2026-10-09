import { and, eq, like, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '$lib/server/db/client';
import { authVerification } from '$lib/server/db/auth-schema';

// the one module that deletes a member's mailed reset links.
//
// better-auth writes a row per request and consumes only the row it was handed, so ending the
// others is this app's job, at the four moments a link stops being the member's way in: a newer
// one is minted, a reset lands, the member changes the password while signed in, or the member is
// removed. ./index.ts calls it for the first two and ./members.ts for the last two.

/** the prefix better-auth writes before every reset token in `auth_verification.identifier`. */
export const RESET_IDENTIFIER_PREFIX = 'reset-password:';

/** the row just minted, read beside the rows being deleted from the same table. */
const minted = alias(authVerification, 'minted');

/**
 * end every reset link a member holds, or, given the link just minted, every one minted before it.
 *
 * better-auth 1.6.25 writes a row per request and consumes only the row it was handed
 * (`better-auth/dist/api/routes/password.mjs`), so without this each press adds a live link and a
 * completed reset leaves the others able to overwrite the password just chosen. an invitation keeps
 * the same one-live-token rule for an address (./invitations.ts).
 *
 * "before" is `(created_at, id)` against the new row's, rather than every row but the new one: two
 * requests whose deletes interleave would each delete the other's link and leave the member none.
 * the pair is a total order every request agrees on, so the row greatest under it is deleted by
 * nobody and at least one link survives. that row is the newest only by the clocks of the isolates
 * that minted the rows — `created_at` is each one's own millisecond and the id breaks a tie — so it
 * is not always the link whose mail went last. a new row a later request has already deleted
 * matches nothing, so nothing is deleted on its behalf.
 */
export async function deleteResetLinks(
	db: Db,
	userId: string,
	options: { readonly olderThan?: string } = {}
): Promise<void> {
	await resetLinksDeletion(db, userId, options);
}

/**
 * `deleteResetLinks`'s statement, unexecuted, for a caller that has to run it inside a `batch()` of
 * its own — `removeMember` in ./members.ts, beside the delete of the user the links point at.
 */
export function resetLinksDeletion(
	db: Db,
	userId: string,
	{ olderThan }: { readonly olderThan?: string } = {}
) {
	return db.delete(authVerification).where(
		and(
			eq(authVerification.value, userId),
			like(authVerification.identifier, `${RESET_IDENTIFIER_PREFIX}%`),
			olderThan === undefined
				? undefined
				: sql`(${authVerification.createdAt}, ${authVerification.id}) < ${db
						.select({ createdAt: minted.createdAt, id: minted.id })
						.from(minted)
						.where(eq(minted.identifier, `${RESET_IDENTIFIER_PREFIX}${olderThan}`))}`
		)
	);
}
