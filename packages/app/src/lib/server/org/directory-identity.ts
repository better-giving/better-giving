import type { Client } from '@libsql/client';

// the two profile values a processor's directory finds and contacts the organisation by, read for
// `pnpm setup-webhook:chariot` (../../../../scripts/setup-webhook.ts).
//
// raw SQL over the client rather than ./queries.ts, because the script runs under plain node, which
// cannot resolve the extensionless imports under ../db/schema.ts. ./directory-identity.db.spec.ts
// reads it over the row `saveOrgProfile` writes, so the column names here cannot drift from it.

/** the EIN as stored (`XX-XXXXXXX`) and the notification address, each `null` where none is saved. */
export type DirectoryIdentity = {
	readonly ein: string | null;
	readonly notificationEmail: string | null;
};

export async function readDirectoryIdentity(client: Client): Promise<DirectoryIdentity> {
	const { rows } = await client.execute(
		"SELECT tax_id, notification_email FROM org_profile WHERE id = 'default'"
	);
	const row = rows[0];
	return { ein: text(row?.tax_id), notificationEmail: text(row?.notification_email) };
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}
