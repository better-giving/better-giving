import { and, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporterPage } from '../db/schema';

// how the donation path meets a supporter's fundraiser: which page a gift through a form is given
// on, and whether that page takes a gift at all.
//
// a gift names its page in `donation.supporter_page_id`, read off the gift's own form inside the
// insert: a fundraiser owns exactly one settings row (`supporter_page_form_id_idx`), so the form
// decides the page and nothing on the wire is asked. the opening gift (../donations/record.ts) takes
// the page as it stands (`supporterPageOf`), because the submission already refused a page that is
// not live and shown (`fundraiserTakingGifts`). the later charges of a repeating gift and a second
// deposit to a crypto address copy the opening gift's form (../donations/collect.ts,
// ../donations/settle.ts) and name the page only when it was neither ended nor hidden at the moment
// the money moved (`supporterPageCountingOf`), so an ended or hidden page stops growing; a late
// webhook for a charge made before that still counts. a charge that does not count keeps the form
// and stays in the organisation's books, and every reader of a page's gifts goes by
// `supporter_page_id`, never `form_id`, so it shows nowhere on the page. a page shown again counts
// from then on, and what arrived while it was hidden stays off it. a gift in hand
// (../donations/record-in-hand.ts) names a form off the Forms list, which no fundraiser's row is on
// (`ownedByNoPage` in ../forms/queries.ts).

/** the supporter page owning `formId`'s row, or null, as a value an insert binds. */
export function supporterPageOf(formId: string | null): SQL<string | null> {
	return sql<
		string | null
	>`(select ${supporterPage.id} from ${supporterPage} where ${supporterPage.formId} = ${formId})`;
}

/**
 * the supporter page owning `formId`'s row, as a value an insert binds — or null where none does, or
 * where the page was ended or hidden at or before `receivedAt`, the moment the money moved.
 */
export function supporterPageCountingOf(
	formId: string | null,
	receivedAt: Date
): SQL<string | null> {
	return sql<string | null>`(select ${supporterPage.id} from ${supporterPage} where ${and(
		sql`${supporterPage.formId} = ${formId}`,
		or(isNull(supporterPage.endedAt), gt(supporterPage.endedAt, receivedAt)),
		or(isNull(supporterPage.hiddenAt), gt(supporterPage.hiddenAt, receivedAt))
	)})`;
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
