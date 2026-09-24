import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { quickbooksConnection } from '../db/schema';
import type {
	AccountingProvider,
	ConnectionSnapshot,
	ConnectionStore,
	TokenPair,
	TokenSave
} from './provider';
import { defaultAccounts } from './quickbooks-accounts';

// the one QuickBooks company this deployment is connected to, read and written.
//
// every read and write of `quickbooks_connection` is here, so the table object never leaves this
// file — the same boundary ../donations/queries.ts draws around `donation` and ../ledger/queries.ts
// around the two ledger tables. the one exception is deliberate, and it is one column:
// ../accounting/outbox.ts reads `start_at` on the settlement path, because taking a whole
// connection there would put a credential on the gift path, and it writes `start_at` too, because
// moving the date re-queues gifts and the date has to land in the same `batch()` as the queue rows
// it decides.
//
// **nothing here touches `quickbooks_sync`.** the outbox is written by the posting that owes it and
// by a move of the start date (./outbox.ts), and read by the delivery that sends it; a connection is
// none of those.
//
// ---------------------------------------------------------------------------
// why the adapter takes {@link quickbooksStore} rather than a `Db`.
//
// the adapter refreshes a credential that rotates, and Intuit retires the token it rotated away
// from — so a refresh that reads, calls and does not write loses the connection at the next call.
// handing the adapter a `Db` would make persisting one thing it could do among many; handing it two
// functions makes persisting the only writing it can do at all. ./provider.ts's `ConnectionStore`
// states the contract and ./quickbooks.spec.ts exercises the adapter against a store in memory,
// with no database anywhere near it.

/**
 * the only id `quickbooks_connection` accepts, enforced by `quickbooks_connection_id_check` in
 * ../db/schema.ts. the precedent is `ORG_PROFILE_ID` in ../org/queries.ts, and ../accounting/outbox.ts
 * pins the same literal for its own reads and writes of `start_at`.
 */
const CONNECTION_ID = 'quickbooks';

/** an account in the company's books as the connection holds it: what to post to, and what to print. */
export type ChosenAccount = {
	readonly id: string;
	readonly name: string;
};

/**
 * the connection as the screen that made it reads it back.
 *
 * no token on it, and that is the whole shape: a screen renders the company, the three accounts and
 * the date gifts are sent from, and none of those is a credential. the adapter's own read is
 * {@link quickbooksStore} and is the only one that carries tokens at all.
 */
export type QuickbooksConnectionView = {
	readonly realmId: string;
	/** null until the company name has been read back from Intuit. */
	readonly companyName: string | null;
	readonly income: ChosenAccount | null;
	readonly fee: ChosenAccount | null;
	readonly deposit: ChosenAccount | null;
	/** the earliest business date a gift may be sent from. */
	readonly startAt: Date;
};

/** what a fresh connection is written from: the redirect's realm and the exchange's first pair. */
export type NewConnection = {
	/** Intuit's id for the company, read off the OAuth redirect rather than out of the token. */
	readonly realmId: string;
	readonly tokens: TokenPair;
	/**
	 * where a first connection starts sending from. the caller has nobody to ask at that moment, so
	 * it is the instant the connection was made; `moveQuickbooksStartAt` in ./outbox.ts is where the
	 * operator answers it afterwards, and a reconnect keeps whatever that answer was.
	 */
	readonly startAt: Date;
};

/**
 * the company connected, replacing whatever was connected before.
 *
 * an upsert on the one id rather than an insert, because connecting again is the ordinary way out
 * of a dead credential: the row's check pins it to one, so an insert would be refused on exactly
 * the path an operator is using to fix something.
 *
 * **what the company's own books said is kept only while it is the same company.** the three
 * accounts and the name Intuit gave are that realm's words — against a different realm those ids
 * name nothing, every gift is refused as an invalid reference, and a screen drawing the new
 * company's name beside the old company's accounts reads as correct. so they are cleared by the
 * same statement that writes the credential, on a `case` over the realm the row already held:
 * reading first and writing after would be a window in which a gift settles against either.
 *
 * `start_at` is untouched on both arms. it is the operator's own answer rather than the company's,
 * and it is as true of the books they have just connected as of the ones they left.
 */
export async function connectQuickbooks(db: Db, connection: NewConnection): Promise<void> {
	const credential = {
		realmId: connection.realmId,
		accessToken: connection.tokens.accessToken,
		accessTokenExpiresAt: connection.tokens.accessTokenExpiresAt,
		refreshToken: connection.tokens.refreshToken,
		refreshTokenExpiresAt: connection.tokens.refreshTokenExpiresAt
	};
	await db
		.insert(quickbooksConnection)
		.values({ id: CONNECTION_ID, ...credential, startAt: connection.startAt })
		.onConflictDoUpdate({
			target: quickbooksConnection.id,
			set: {
				...credential,
				companyName: keptForTheSameCompany(quickbooksConnection.companyName),
				// each id with the name beside it, because `..._name_needs_id_check` in ../db/schema.ts
				// refuses a name whose id has gone.
				incomeAccountId: keptForTheSameCompany(quickbooksConnection.incomeAccountId),
				incomeAccountName: keptForTheSameCompany(quickbooksConnection.incomeAccountName),
				feeAccountId: keptForTheSameCompany(quickbooksConnection.feeAccountId),
				feeAccountName: keptForTheSameCompany(quickbooksConnection.feeAccountName),
				depositAccountId: keptForTheSameCompany(quickbooksConnection.depositAccountId),
				depositAccountName: keptForTheSameCompany(quickbooksConnection.depositAccountName)
			}
		});
}

/**
 * what `column` holds where the incoming realm is the one the row already carried, and null where
 * it is not.
 *
 * every column reference on this side of a `do update` is the row as it stood before the write, so
 * the comparison is the stored realm against `excluded`'s — which is how one statement decides
 * something a read would have had to go first to learn.
 */
function keptForTheSameCompany(column: SQLiteColumn): SQL {
	return sql`case when ${quickbooksConnection.realmId} = excluded.${sql.identifier(quickbooksConnection.realmId.name)} then ${column} end`;
}

/** what Intuit calls the company, read back after the connection was made. */
export async function saveQuickbooksCompanyName(db: Db, companyName: string): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({ companyName })
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * the three accounts an operator picked, each id with the name to print beside it.
 *
 * all three together, because the schema takes them that way: `..._name_needs_id_check` refuses a
 * name with no id, and a send needs all three anyway — a screen that could save one of them would
 * be a screen an operator leaves half-done with nothing saying so.
 */
export async function saveQuickbooksAccounts(db: Db, accounts: ChosenAccounts): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set(accountColumns(accounts))
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * the roles the company's chart named, written only where no account is held yet and only while
 * `realmId` is still the company connected. a role the chart named none for stays null.
 *
 * the callback fills these from a chart it read a moment earlier, and two things can land in
 * between: an operator's save on the console, and a reconnect to a different company. both checks
 * are in the UPDATE's own where clause rather than a read before it, so neither is overwritten by a
 * guess made before it — and one company's account ids, small integers that name real and different
 * accounts in another, never reach the other's connection.
 */
export async function fillQuickbooksAccounts(
	db: Db,
	realmId: string,
	accounts: FilledAccounts
): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({
			incomeAccountId: accounts.income?.id ?? null,
			incomeAccountName: accounts.income?.name ?? null,
			feeAccountId: accounts.fee?.id ?? null,
			feeAccountName: accounts.fee?.name ?? null,
			depositAccountId: accounts.deposit?.id ?? null,
			depositAccountName: accounts.deposit?.name ?? null
		})
		.where(
			and(
				eq(quickbooksConnection.id, CONNECTION_ID),
				eq(quickbooksConnection.realmId, realmId),
				isNull(quickbooksConnection.incomeAccountId),
				isNull(quickbooksConnection.feeAccountId),
				isNull(quickbooksConnection.depositAccountId)
			)
		);
}

type FilledAccounts = {
	readonly income: ChosenAccount | null;
	readonly fee: ChosenAccount | null;
	readonly deposit: ChosenAccount | null;
};

/**
 * each role the chart names an account for, where nothing is picked yet.
 *
 * nothing it throws escapes: the connection is already stored, and a fault here turning the page
 * into a 500 would tell the operator a connect that landed had failed. a failure logs its reason or
 * the thrown error's name and nothing more — a detail or message can quote Intuit's answer.
 */
export async function fillAccountsFromChart(
	db: Db,
	provider: AccountingProvider,
	realmId: string
): Promise<void> {
	try {
		// skips the chart read on a same-company reconnect, which kept its picks.
		const connection = await readQuickbooksConnection(db);
		if (connection === null || hasPicks(connection)) return;

		const chart = await provider.listAccounts();
		if (!chart.ok) {
			console.error('quickbooks account fill: chart read failed', chart.reason);
			return;
		}
		await fillQuickbooksAccounts(db, realmId, defaultAccounts(chart.value));
	} catch (error) {
		console.error(
			'quickbooks account fill: threw',
			error instanceof Error ? error.name : typeof error
		);
	}
}

function hasPicks(connection: QuickbooksConnectionView): boolean {
	return connection.income !== null || connection.fee !== null || connection.deposit !== null;
}

type ChosenAccounts = {
	readonly income: ChosenAccount;
	readonly fee: ChosenAccount;
	readonly deposit: ChosenAccount;
};

function accountColumns(accounts: ChosenAccounts) {
	return {
		incomeAccountId: accounts.income.id,
		incomeAccountName: accounts.income.name,
		feeAccountId: accounts.fee.id,
		feeAccountName: accounts.fee.name,
		depositAccountId: accounts.deposit.id,
		depositAccountName: accounts.deposit.name
	};
}

/**
 * the connection as a screen reads it, or null where no company is connected.
 *
 * a point lookup: the id is the primary key and the check pins it to one literal, so "which
 * connection is live" is never a question with an ordering in it.
 */
export async function readQuickbooksConnection(db: Db): Promise<QuickbooksConnectionView | null> {
	const [row] = await db
		.select({
			realmId: quickbooksConnection.realmId,
			companyName: quickbooksConnection.companyName,
			incomeAccountId: quickbooksConnection.incomeAccountId,
			incomeAccountName: quickbooksConnection.incomeAccountName,
			feeAccountId: quickbooksConnection.feeAccountId,
			feeAccountName: quickbooksConnection.feeAccountName,
			depositAccountId: quickbooksConnection.depositAccountId,
			depositAccountName: quickbooksConnection.depositAccountName,
			startAt: quickbooksConnection.startAt
		})
		.from(quickbooksConnection)
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
	if (row === undefined) return null;

	return {
		realmId: row.realmId,
		companyName: row.companyName,
		income: chosen(row.incomeAccountId, row.incomeAccountName),
		fee: chosen(row.feeAccountId, row.feeAccountName),
		deposit: chosen(row.depositAccountId, row.depositAccountName),
		startAt: row.startAt
	};
}

/**
 * the credential gone from this deployment.
 *
 * the row and not a flag on it: a connection that is off but still holds a refresh token is a
 * credential kept for nothing. revoking it at Intuit is the adapter's half and happens first —
 * ./provider.ts's `revokeTokens` states why this runs whatever that answered.
 */
export async function disconnectQuickbooks(db: Db): Promise<void> {
	await db.delete(quickbooksConnection).where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * the two operations the adapter performs against the stored connection, over `Db`.
 *
 * `saveTokens` writes the two tokens and nothing else, so a refresh cannot touch the accounts an
 * operator picked or the date their history starts from.
 *
 * it writes against the refresh token the caller presented, because two renewals can be in flight
 * at once — a delivery run and a console read, or two runs — and Intuit retires the token each of
 * them presented. the write that matches is the one whose pair was issued against the credential
 * the row actually holds; a write that matches nothing is a caller holding a pair Intuit has
 * already retired, and it is refused rather than landed on top of a live one. the loser settles by
 * reading what the winner stored, never by rolling anything back (CLAUDE.md -> Bans -> The ledger).
 */
export function quickbooksStore(db: Db): ConnectionStore {
	return {
		async read(): Promise<ConnectionSnapshot | null> {
			const [row] = await db
				.select({
					// the port's word for it: the adapter addresses Intuit's realm through it, and the
					// column keeps the vendor's name the way the table does (./provider.ts).
					companyId: quickbooksConnection.realmId,
					accessToken: quickbooksConnection.accessToken,
					accessTokenExpiresAt: quickbooksConnection.accessTokenExpiresAt,
					refreshToken: quickbooksConnection.refreshToken,
					refreshTokenExpiresAt: quickbooksConnection.refreshTokenExpiresAt,
					incomeAccountId: quickbooksConnection.incomeAccountId,
					feeAccountId: quickbooksConnection.feeAccountId,
					depositAccountId: quickbooksConnection.depositAccountId
				})
				.from(quickbooksConnection)
				.where(eq(quickbooksConnection.id, CONNECTION_ID));
			return row ?? null;
		},

		async saveTokens(presented: string, tokens: TokenPair): Promise<TokenSave> {
			const [written] = await db
				.update(quickbooksConnection)
				.set({
					accessToken: tokens.accessToken,
					accessTokenExpiresAt: tokens.accessTokenExpiresAt,
					refreshToken: tokens.refreshToken,
					refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
				})
				.where(
					and(
						eq(quickbooksConnection.id, CONNECTION_ID),
						eq(quickbooksConnection.refreshToken, presented)
					)
				)
				// the id alone: what this read is for is whether a row matched, never what is in it.
				.returning({ id: quickbooksConnection.id });
			return written === undefined ? 'superseded' : 'stored';
		}
	};
}

/** the pair the schema writes together, read back as the one thing it is. */
function chosen(id: string | null, name: string | null): ChosenAccount | null {
	return id === null ? null : { id, name: name ?? id };
}
