import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { page, type Page } from '../db/schema';

/** a campaign that answers at its address: `page_name_check` holds every campaign to a name. */
export type ServedCampaign = Page & {
	readonly name: string;
	readonly state: 'live' | 'ended';
};

/**
 * the campaign at `slug` — live, drawn from its published page, or ended, drawn as having ended —
 * or `null` where none answers there. a never-published campaign's slug is held but answers nothing.
 */
export async function readServedCampaign(db: Db, slug: string): Promise<ServedCampaign | null> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			and(eq(page.type, 'campaign'), eq(page.slug, slug), inArray(page.state, ['live', 'ended']))
		);
	return (row as ServedCampaign | undefined) ?? null;
}
