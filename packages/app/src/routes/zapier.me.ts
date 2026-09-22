import { eq } from 'drizzle-orm';
import { orgProfile } from '$lib/server/db/schema';
import { zapierJson } from '$lib/server/zapier/surface';
import { database } from '../context';
import type { Route } from './+types/zapier.me';

// Zapier's connection test: who the key belongs to. a bad key never reaches here — ./zapier.ts
// answers it 401 — so a connection with a wrong key fails at connect time.
//
// **`organisation` is a public field.** the Zapier app's connection label reads it, and renaming it
// breaks the label on every connection already made. `null` until the console has set the
// organisation's legal name.

export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	const [profile] = await context
		.get(database)
		.select({ legalName: orgProfile.legalName })
		.from(orgProfile)
		.where(eq(orgProfile.id, 'default'));
	return zapierJson({ organisation: profile?.legalName ?? null });
}
