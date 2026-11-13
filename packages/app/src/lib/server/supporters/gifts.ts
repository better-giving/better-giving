import { eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporterPage } from '../db/schema';

// how the donation path meets a supporter's fundraiser: which page a gift through a form is given
// on, and whether that page takes a gift at all.
//
// a gift names its page in `donation.supporter_page_id`, and the page is read off the gift's own
// form inside the insert (`supporterPageOf`): a fundraiser owns exactly one settings row
// (`supporter_page_form_id_idx`), so the form decides the page and nothing on the wire is asked.
// ../donations/record.ts spends it at the submission, and so do the later charges of a repeating gift
// and a second deposit to a crypto address, which copy the opening gift's form
// (../donations/collect.ts, ../donations/settle.ts). a gift in hand (../donations/record-in-hand.ts)
// names a form off the Forms list, which no fundraiser's row is on (`ownedByNoPage` in
// ../forms/queries.ts).

/** the supporter page owning `formId`'s row, or null, as a value an insert binds. */
export function supporterPageOf(formId: string | null): SQL<string | null> {
	return sql<
		string | null
	>`(select ${supporterPage.id} from ${supporterPage} where ${supporterPage.formId} = ${formId})`;
}

/**
 * whether the fundraiser owning `formId`'s row takes a new gift — live, and not hidden by staff — or
 * null where no fundraiser owns it. an ended, pending or hidden page refuses alike: the submission
 * says nothing a donor could tell the three apart by.
 */
export async function fundraiserTakingGifts(db: Db, formId: string): Promise<boolean | null> {
	const [row] = await db
		.select({ status: supporterPage.status, hiddenAt: supporterPage.hiddenAt })
		.from(supporterPage)
		.where(eq(supporterPage.formId, formId))
		.limit(1);
	if (!row) return null;
	return row.status === 'live' && row.hiddenAt === null;
}
