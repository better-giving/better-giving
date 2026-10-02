import { and, eq, like, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '$lib/server/db/client';
import { authVerification } from '$lib/server/db/auth-schema';

// the one module that deletes a member's mailed reset links.
//
// better-auth writes a row per request and consumes only the row it was handed, so ending the
// others is this app's job, at the three moments a link stops being the member's way in: a newer
// one is minted, a reset lands, or the member changes the password while signed in. ./index.ts
// calls it for the first two and ./members.ts for the third.

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
 * requests whose deletes interleave would each delete the other's link and leave the member none,
 * where this keeps the newest. a new row a later request has already deleted matches nothing, so
 * nothing is deleted on its behalf.
 */
export async function deleteResetLinks(
	db: Db,
	userId: string,
	{ olderThan }: { readonly olderThan?: string } = {}
): Promise<void> {
	await db.delete(authVerification).where(
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
