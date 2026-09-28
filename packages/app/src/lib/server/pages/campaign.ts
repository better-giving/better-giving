import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { page, type Page } from '../db/schema';

/** the campaign donors are served at `slug`, or `null` where none answers there. */
export async function readServedCampaign(db: Db, slug: string): Promise<Page | null> {
	const [row] = await db
		.select()
		.from(page)
		.where(and(eq(page.type, 'campaign'), eq(page.slug, slug), eq(page.state, 'live')));
	return row ?? null;
}
