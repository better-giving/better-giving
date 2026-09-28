import type { PageGoal } from '../../donate/blocks/types';
import type { Page } from '../../page/catalog';
import { dayOf } from '../../page/end-date';
import type { Db } from '../db/client';
import { type RaisedThroughForm, readRaisedThroughForm } from '../ledger/queries';

// what a campaign's goal bar says has been given toward it: settled gifts through the campaign's
// owned settings row, net of what was given back, recurring charges included and pending excluded —
// the dashboard's own raised figure (`readRaisedByMonth` in ../ledger/queries.ts) over that row's
// gifts alone.
//
// a `SUM` over the books on every draw, never stored and never cached (CLAUDE.md → Bans → the
// ledger). the served config's edge cache holds a capability; this is a number, and a cached one
// would tell a donor a refunded gift still counts. ./goal.spec.ts holds that this module reaches
// for no cache.

/** what has been raised through the campaign whose owned settings row is `formId`. */
export async function campaignRaised(db: Db, formId: string): Promise<RaisedThroughForm> {
	const raised = await readRaisedThroughForm(db, formId);
	if (raised === null) {
		throw new Error(
			`form ${formId} is not in this database, and a page's owned row is its foreign key`
		);
	}
	return raised;
}

/**
 * the goal bar's figures for a page whose document sets a goal, or null where it sets none — which
 * the read rule (`parsePage` in ../../page/catalog.ts) holds to campaigns alone. `formId` is the
 * page's owned settings row, and `locale` the served config's, which words the last day.
 */
export async function pageGoal(
	db: Db,
	formId: string,
	page: Page,
	locale: string
): Promise<PageGoal | null> {
	if (page.goalMinor === undefined) return null;
	const { raisedMinor } = await campaignRaised(db, formId);
	// the read rule holds `endsAt` and `endsZone` both or neither.
	const { endsAt, endsZone } = page;
	return {
		raisedMinor,
		goalMinor: page.goalMinor,
		endsAt:
			endsAt === undefined || endsZone === undefined ? null : lastDay(endsAt, endsZone, locale)
	};
}

/**
 * the day an end closes on, as a page states it: "December 31". the day is the one chosen, in the
 * zone it was chosen in, whatever zone the worker or the donor is in.
 */
function lastDay(endsAt: number, timeZone: string, locale: string): string | null {
	const day = dayOf(endsAt, timeZone);
	if (day === null) return null;
	// the day's own midnight in UTC, worded in UTC, so the words name the day `dayOf` found.
	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(Date.parse(day));
}
