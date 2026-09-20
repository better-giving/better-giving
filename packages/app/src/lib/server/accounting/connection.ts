import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { quickbooksConnection } from '../db/schema';
import type { ConnectionSnapshot, ConnectionStore, TokenPair } from './provider';

// the one QuickBooks company this deployment is connected to, read and written.
//
// every read and write of `quickbooks_connection` is here, so the table object never leaves this
// file — the same boundary ../donations/queries.ts draws around `donation` and ../ledger/queries.ts
// around the two ledger tables. the one exception is deliberate and is not a second writer:
// ../accounting/outbox.ts reads `start_at` off this table on the settlement path, because what it
// needs is one column and taking a whole connection there would put a credential on the gift path.
//
// **nothing here touches `quickbooks_sync`.** the outbox is written by the posting that owes it and
// read by the delivery that sends it; a connection is not either of those.
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
 * pins the same literal for its own one-column read.
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
 * the date history starts from, and none of those is a credential. the adapter's own read is
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
	 * it is the instant the connection was made; {@link saveQuickbooksStartAt} is where the operator
	 * answers it afterwards, and a reconnect keeps whatever that answer was.
	 */
	readonly startAt: Date;
};

/**
 * the company connected, replacing whatever was connected before.
 *
 * an upsert on the one id rather than an insert, because connecting again is the ordinary way out
 * of a dead credential: the row's check pins it to one, so an insert would be refused on exactly
 * the path an operator is using to fix something. the accounts, the company name and the date
 * history starts from are left where they were — a reconnect keeps every answer an operator has
 * already given, and a different realm is corrected by picking again on the screen that lists them.
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
		.onConflictDoUpdate({ target: quickbooksConnection.id, set: credential });
}

/** what Intuit calls the company, read back after the connection was made. */
export async function saveQuickbooksCompanyName(db: Db, companyName: string): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({ companyName })
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * how much of this deployment's history goes over, moved.
 *
 * the callback writes the moment the connection was made, which is the only answer available while
 * nobody has been asked — and this is where the operator answers it afterwards. it moves nothing
 * already queued: what `start_at` decides is whether a settling gift is owed at all
 * (../accounting/outbox.ts), asked once, at the settlement.
 */
export async function saveQuickbooksStartAt(db: Db, startAt: Date): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({ startAt })
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * the three accounts an operator picked, each id with the name to print beside it.
 *
 * all three together, because the schema takes them that way: `..._name_needs_id_check` refuses a
 * name with no id, and a send needs all three anyway — a screen that could save one of them would
 * be a screen an operator leaves half-done with nothing saying so.
 */
export async function saveQuickbooksAccounts(
	db: Db,
	accounts: {
		readonly income: ChosenAccount;
		readonly fee: ChosenAccount;
		readonly deposit: ChosenAccount;
	}
): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({
			incomeAccountId: accounts.income.id,
			incomeAccountName: accounts.income.name,
			feeAccountId: accounts.fee.id,
			feeAccountName: accounts.fee.name,
			depositAccountId: accounts.deposit.id,
			depositAccountName: accounts.deposit.name
		})
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
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
 */
export function quickbooksStore(db: Db): ConnectionStore {
	return {
		async read(): Promise<ConnectionSnapshot | null> {
			const [row] = await db
				.select({
					realmId: quickbooksConnection.realmId,
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

		async saveTokens(tokens: TokenPair): Promise<void> {
			await db
				.update(quickbooksConnection)
				.set({
					accessToken: tokens.accessToken,
					accessTokenExpiresAt: tokens.accessTokenExpiresAt,
					refreshToken: tokens.refreshToken,
					refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
				})
				.where(eq(quickbooksConnection.id, CONNECTION_ID));
		}
	};
}

/** the pair the schema writes together, read back as the one thing it is. */
function chosen(id: string | null, name: string | null): ChosenAccount | null {
	return id === null ? null : { id, name: name ?? id };
}
