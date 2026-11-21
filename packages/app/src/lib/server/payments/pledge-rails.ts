import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { pledgeRail, type PledgeMethod, type PledgeRail } from '../db/schema';

// the deployment's own details for its two pledge rails, stock and IRA (QCD), read and written.
//
// every read and write of `pledge_rail` is here, so the table object never leaves this file. what a
// row may hold is the schema's (`pledgeRail` in ../db/schema.ts): a rail on carries every detail, a
// rail off keeps whatever was saved, and no row reads as a rail off with nothing saved.

/** where a donor's broker transfers shares. */
export type StockDetails = {
	readonly brokerageName: string;
	readonly dtcNumber: string;
	readonly accountNumber: string;
	readonly accountName: string;
};

/** who an IRA custodian's check is made out to, and where it is mailed. */
export type IraQcdDetails = {
	readonly payeeName: string;
	readonly mailingAddress: string;
};

type Saved<T> = { readonly [K in keyof T]: T[K] | null };

/**
 * one rail as /admin/payments and the donation form read it. on, every detail is there to print;
 * off, each is whatever was last saved, or null.
 */
export type PledgeRailSetting<T> =
	| { readonly enabled: true; readonly details: T }
	| { readonly enabled: false; readonly details: Saved<T> };

export type PledgeRails = {
	readonly stock: PledgeRailSetting<StockDetails>;
	readonly ira_qcd: PledgeRailSetting<IraQcdDetails>;
};

function stockOf(row: PledgeRail | undefined): PledgeRailSetting<StockDetails> {
	const details = {
		brokerageName: row?.brokerageName ?? null,
		dtcNumber: row?.dtcNumber ?? null,
		accountNumber: row?.accountNumber ?? null,
		accountName: row?.accountName ?? null
	};
	const { brokerageName, dtcNumber, accountNumber, accountName } = details;
	// `pledge_rail_enabled_complete_check` makes the nulls unreachable on a rail that is on; the
	// narrowing is what lets the type say so.
	if (
		row?.enabled &&
		brokerageName !== null &&
		dtcNumber !== null &&
		accountNumber !== null &&
		accountName !== null
	) {
		return { enabled: true, details: { brokerageName, dtcNumber, accountNumber, accountName } };
	}
	return { enabled: false, details };
}

function iraQcdOf(row: PledgeRail | undefined): PledgeRailSetting<IraQcdDetails> {
	const payeeName = row?.payeeName ?? null;
	const mailingAddress = row?.mailingAddress ?? null;
	if (row?.enabled && payeeName !== null && mailingAddress !== null) {
		return { enabled: true, details: { payeeName, mailingAddress } };
	}
	return { enabled: false, details: { payeeName, mailingAddress } };
}

/** a rail turned on, with every detail a donor on it is shown. */
export type EnabledPledgeRail =
	| { readonly rail: 'stock'; readonly details: StockDetails }
	| { readonly rail: 'ira_qcd'; readonly details: IraQcdDetails };

/**
 * turn a rail on with these details, replacing any saved before — the Save on /admin/payments.
 *
 * the details are the caller's parse: a blank one reaching here is refused by the database
 * (`SQLITE_CONSTRAINT_CHECK`) and thrown, and the rail stays as it was. one upsert, so a first save
 * and a later one are the same statement; `created_at` is left out of its update, and drizzle
 * stamps `updated_at` itself (`saveOrgProfile` in ../org/queries.ts states that half).
 */
export async function enablePledgeRail(db: Db, input: EnabledPledgeRail): Promise<void> {
	const columns =
		input.rail === 'stock'
			? {
					enabled: true,
					brokerageName: input.details.brokerageName,
					dtcNumber: input.details.dtcNumber,
					accountNumber: input.details.accountNumber,
					accountName: input.details.accountName
				}
			: {
					enabled: true,
					payeeName: input.details.payeeName,
					mailingAddress: input.details.mailingAddress
				};
	await db
		.insert(pledgeRail)
		.values({ id: input.rail, ...columns })
		.onConflictDoUpdate({ target: pledgeRail.id, set: columns });
}

/**
 * turn a rail off, keeping its details — Disable on /admin/payments. pledges already made on it stay
 * waiting on Gifts: nothing here reads them. a rail with no row is off already, and stays rowless.
 */
export async function disablePledgeRail(db: Db, rail: PledgeMethod): Promise<void> {
	await db.update(pledgeRail).set({ enabled: false }).where(eq(pledgeRail.id, rail));
}

/** both rails, each on with its details or off with what was saved. */
export async function readPledgeRails(db: Db): Promise<PledgeRails> {
	const rows = await db.select().from(pledgeRail);
	return {
		stock: stockOf(rows.find((r) => r.id === 'stock')),
		ira_qcd: iraQcdOf(rows.find((r) => r.id === 'ira_qcd'))
	};
}
