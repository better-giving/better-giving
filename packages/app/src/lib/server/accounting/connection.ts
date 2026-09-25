import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { quickbooksConnection } from '../db/schema';
import type { ProcessorName } from '../payments/provider';
import {
	ACCOUNT_ROLES,
	HOLDING_OF,
	ROLE_LABELS,
	type AccountingProvider,
	type AccountRole,
	type ConnectionSnapshot,
	type ConnectionStore,
	type HoldingRole,
	type TokenPair,
	type TokenSave
} from './provider';
import { defaultAccounts } from './quickbooks-accounts';

// the one QuickBooks company this deployment is connected to, read and written.
//
// every read and write of `quickbooks_connection` is here, so the table object never leaves this
// file — the same boundary ../donations/queries.ts draws around `donation` and ../ledger/queries.ts
// around the two ledger tables. the one exception is deliberate, and it is two columns:
// ../accounting/outbox.ts reads `start_at` on the settlement path, because taking a whole
// connection there would put a credential on the gift path, and it writes `start_at` too, because
// moving the date re-queues gifts and the date has to land in the same `batch()` as the queue rows
// it decides. it reads `realm_id` inside the same statements (`CONNECTED_REALM`), and
// ./deliver.ts writes that realm onto a queue row, for the same reason: which company a row's
// record reached is judged by the statement that acts on it.
//
// **nothing here touches `quickbooks_sync`.** the outbox is written by the posting that owes it and
// by a move of the start date (./outbox.ts), and read by the delivery that sends it; a connection is
// none of those.
//
// ---------------------------------------------------------------------------
// why the adapter takes {@link quickbooksStore} rather than a `Db`.
//
// the adapter refreshes a credential that rotates, and Intuit stops renewing the token it rotated
// away from 24 hours later — so a refresh that reads, calls and does not write loses the connection
// once that day is out.
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

/** the pair of columns each role's pick is stored in: the id to post to, and the name to print. */
const ACCOUNT_COLUMNS = {
	income: { id: 'incomeAccountId', name: 'incomeAccountName' },
	fee: { id: 'feeAccountId', name: 'feeAccountName' },
	stripeBalance: { id: 'stripeBalanceAccountId', name: 'stripeBalanceAccountName' },
	paypalBalance: { id: 'paypalBalanceAccountId', name: 'paypalBalanceAccountName' },
	chariotBalance: { id: 'chariotBalanceAccountId', name: 'chariotBalanceAccountName' },
	nowpaymentsBalance: { id: 'nowpaymentsBalanceAccountId', name: 'nowpaymentsBalanceAccountName' },
	undepositedFunds: { id: 'undepositedFundsAccountId', name: 'undepositedFundsAccountName' }
} as const satisfies Record<
	AccountRole,
	{
		id: keyof typeof quickbooksConnection.$inferSelect;
		name: keyof typeof quickbooksConnection.$inferSelect;
	}
>;

/** an account in the company's books as the connection holds it: what to post to, and what to print. */
export type ChosenAccount = {
	readonly id: string;
	readonly name: string;
};

/** each role's pick, or null where nobody has picked one. */
export type ChosenAccounts = Readonly<Record<AccountRole, ChosenAccount | null>>;

/**
 * the connection as the screen that made it reads it back.
 *
 * no token on it, and that is the whole shape: a screen renders the company, the accounts and the
 * date gifts are sent from, and none of those is a credential. the adapter's own read is
 * {@link quickbooksStore} and is the only one that carries tokens at all.
 */
export type QuickbooksConnectionView = {
	readonly realmId: string;
	/** null until the company name has been read back from Intuit. */
	readonly companyName: string | null;
	readonly accounts: ChosenAccounts;
	/** when the connection moved to this company, while nobody has saved its accounts since. */
	readonly movedAt: Date | null;
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
	 * operator answers it afterwards, and a reconnect keeps whatever that answer was. a move to
	 * another company is dated by it too.
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
 * **what the company's own books said is kept only while it is the same company.** the accounts
 * and the name Intuit gave are that realm's words — against a different realm those ids name
 * nothing, every gift is refused as an invalid reference, and a screen drawing the new company's
 * name beside the old company's accounts reads as correct. so they are cleared by the same
 * statement that writes the credential, on a `case` over the realm the row already held: reading
 * first and writing after would be a window in which a gift settles against either.
 *
 * **a move is written down, and a reconnect to the same company keeps it.** `moved_at` is what
 * keeps the connect-time fill off a moved connection ({@link fillQuickbooksAccounts}), and it stays
 * set across any number of reconnects until an operator saves accounts — so a second trip through
 * Intuit's consent screen after a move is not a first connect that fills itself.
 *
 * `start_at` is untouched on both arms. it is the operator's own answer rather than the company's,
 * and it is as true of the books they have just connected as of the ones they left.
 *
 * answers with the company the row held before, or null where none was connected. it is read in
 * the same `batch()` as the write, so it is the row this write replaced and not one a second
 * callback wrote in between — and the caller tells a reconnect from a move by comparing realms.
 */
export async function connectQuickbooks(
	db: Db,
	connection: NewConnection
): Promise<ReplacedCompany | null> {
	const credential = {
		realmId: connection.realmId,
		accessToken: connection.tokens.accessToken,
		accessTokenExpiresAt: connection.tokens.accessTokenExpiresAt,
		refreshToken: connection.tokens.refreshToken,
		refreshTokenExpiresAt: connection.tokens.refreshTokenExpiresAt
	};
	// each id with the name beside it, because `..._name_needs_id_check` in ../db/schema.ts refuses
	// a name whose id has gone.
	const accountsKept = Object.fromEntries(
		ACCOUNT_ROLES.flatMap((role) => {
			const { id, name } = ACCOUNT_COLUMNS[role];
			return [
				[id, keptForTheSameCompany(quickbooksConnection[id])],
				[name, keptForTheSameCompany(quickbooksConnection[name])]
			];
		})
	);
	const [before] = await db.batch([
		db
			.select({
				realmId: quickbooksConnection.realmId,
				companyName: quickbooksConnection.companyName,
				movedAt: quickbooksConnection.movedAt
			})
			.from(quickbooksConnection)
			.where(eq(quickbooksConnection.id, CONNECTION_ID)),
		db
			.insert(quickbooksConnection)
			.values({ id: CONNECTION_ID, ...credential, startAt: connection.startAt })
			.onConflictDoUpdate({
				target: quickbooksConnection.id,
				set: {
					...credential,
					...accountsKept,
					companyName: keptForTheSameCompany(quickbooksConnection.companyName),
					movedAt: sql`case when ${sameCompany} then ${quickbooksConnection.movedAt} else ${connection.startAt.getTime()} end`
				}
			})
	]);
	return before[0] ?? null;
}

/** the company a connect replaced: its realm, its name where one had been read back, and its move. */
export type ReplacedCompany = {
	readonly realmId: string;
	readonly companyName: string | null;
	readonly movedAt: Date | null;
};

/**
 * whether the incoming realm is the one the row already carried.
 *
 * every column reference on this side of a `do update` is the row as it stood before the write, so
 * the comparison is the stored realm against `excluded`'s — which is how one statement decides
 * something a read would have had to go first to learn.
 */
const sameCompany = sql`${quickbooksConnection.realmId} = excluded.${sql.identifier(quickbooksConnection.realmId.name)}`;

/** what `column` holds where the incoming realm is the one the row already carried, and null where it is not. */
function keptForTheSameCompany(column: SQLiteColumn): SQL {
	return sql`case when ${sameCompany} then ${column} end`;
}

/** what Intuit calls the company, read back after the connection was made. */
export async function saveQuickbooksCompanyName(db: Db, companyName: string): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({ companyName })
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/** what an operator saves: income and fees always, and each holding where they chose one. */
export type SavedAccounts = {
	readonly income: ChosenAccount;
	readonly fee: ChosenAccount;
} & Readonly<Record<HoldingRole, ChosenAccount | null>>;

/**
 * the accounts an operator picked, each id with the name to print beside it, as one write.
 *
 * every role at once, because the save is the operator's whole answer: a holding left null is a
 * processor they chose not to send, and it holds that processor's gifts alone. income and fees are
 * never null here, since every gift needs the first and every processor's the second.
 *
 * it is also what ends a move's hold: the operator has now said which accounts in the new company
 * are the right ones, so `moved_at` is cleared by the same statement.
 */
export async function saveQuickbooksAccounts(db: Db, accounts: SavedAccounts): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set({ ...accountColumns(accounts), movedAt: null })
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
}

/**
 * the roles the company's chart named, written only where no account is held yet, only while
 * `realmId` is still the company connected, and never over a move nobody has answered. a role the
 * chart named none for stays null.
 *
 * the callback fills these from a chart it read a moment earlier, and two things can land in
 * between: an operator's save on the console, and a reconnect to a different company. every check
 * is in the UPDATE's own where clause rather than a read before it, so neither is overwritten by a
 * guess made before it — and one company's account ids, small integers that name real and different
 * accounts in another, never reach the other's connection.
 */
export async function fillQuickbooksAccounts(
	db: Db,
	realmId: string,
	accounts: ChosenAccounts
): Promise<void> {
	await db
		.update(quickbooksConnection)
		.set(accountColumns(accounts))
		.where(
			and(
				eq(quickbooksConnection.id, CONNECTION_ID),
				eq(quickbooksConnection.realmId, realmId),
				isNull(quickbooksConnection.movedAt),
				...ACCOUNT_ROLES.map((role) => isNull(quickbooksConnection[ACCOUNT_COLUMNS[role].id]))
			)
		);
}

/**
 * each role the chart names an account for, where nothing is picked yet — and, for each processor
 * this deployment takes gifts through whose holding the chart names none for, one made for it.
 *
 * made rather than left unpicked because the account a processor's balance belongs in is one most
 * companies do not have until somebody makes it, and a Bank account in its place is the one choice
 * that must not be made: it is named after the processor (`ROLE_LABELS` in ./provider.ts) so a
 * bookkeeper finds it, and an Other Current Asset. a processor this deployment holds no credentials
 * for gets none, so a company's chart is not handed accounts nothing will ever post to. undeposited
 * funds is never made: every company has one, and one the chart lacks is the operator's to pick.
 *
 * nothing it throws escapes: the connection is already stored, and a fault here turning the page
 * into a 500 would tell the operator a connect that landed had failed. a failure logs its reason or
 * the thrown error's name and nothing more — a detail or message can quote Intuit's answer.
 */
export async function fillAccountsFromChart(
	db: Db,
	provider: AccountingProvider,
	realmId: string,
	processors: readonly ProcessorName[]
): Promise<void> {
	try {
		// skips the chart read on a same-company reconnect, which kept its picks, and on a move.
		const connection = await readQuickbooksConnection(db);
		if (connection === null || connection.movedAt !== null || hasPicks(connection)) return;

		const chart = await provider.listAccounts();
		if (!chart.ok) {
			console.error('quickbooks account fill: chart read failed', chart.reason);
			return;
		}
		const filled: Record<AccountRole, ChosenAccount | null> = { ...defaultAccounts(chart.value) };
		for (const processor of processors) {
			const role = HOLDING_OF[processor];
			if (filled[role] !== null) continue;
			const made = await provider.createHoldingAccount(ROLE_LABELS[role]);
			if (made.ok) filled[role] = made.value;
			else console.error('quickbooks account fill: holding not made', role, made.reason);
		}
		await fillQuickbooksAccounts(db, realmId, filled);
	} catch (error) {
		console.error(
			'quickbooks account fill: threw',
			error instanceof Error ? error.name : typeof error
		);
	}
}

function hasPicks(connection: QuickbooksConnectionView): boolean {
	return ACCOUNT_ROLES.some((role) => connection.accounts[role] !== null);
}

function accountColumns(accounts: ChosenAccounts) {
	return Object.fromEntries(
		ACCOUNT_ROLES.flatMap((role) => {
			const { id, name } = ACCOUNT_COLUMNS[role];
			const account = accounts[role];
			return [
				[id, account?.id ?? null],
				[name, account?.name ?? null]
			];
		})
	);
}

/**
 * the connection as a screen reads it, or null where no company is connected.
 *
 * a point lookup: the id is the primary key and the check pins it to one literal, so "which
 * connection is live" is never a question with an ordering in it.
 */
export async function readQuickbooksConnection(db: Db): Promise<QuickbooksConnectionView | null> {
	const [row] = await db
		.select()
		.from(quickbooksConnection)
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
	if (row === undefined) return null;

	return {
		realmId: row.realmId,
		companyName: row.companyName,
		accounts: rolesOf(row, (id, name) => (id === null ? null : { id, name: name ?? id })),
		movedAt: row.movedAt,
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
 * at once — a delivery run and a console read, or two runs — and each is issued a pair against the
 * same stored token. the write that matches is the first to land; a write that matches nothing is a
 * caller whose pair lost that race, and it is refused rather than landed on top of the winner's.
 * the loser's pair is not dead — Intuit keeps a refresh token it rotated away from renewing for 24
 * hours — but the row holds one credential, and the winner's is the one every later call renews
 * from. the loser settles by reading what the winner stored, never by rolling anything back
 * (CLAUDE.md -> Bans -> The ledger).
 */
export function quickbooksStore(db: Db): ConnectionStore {
	return {
		async read(): Promise<ConnectionSnapshot | null> {
			const [row] = await db
				.select()
				.from(quickbooksConnection)
				.where(eq(quickbooksConnection.id, CONNECTION_ID));
			if (row === undefined) return null;
			return {
				// the port's word for it: the adapter addresses Intuit's realm through it, and the
				// column keeps the vendor's name the way the table does (./provider.ts).
				companyId: row.realmId,
				accessToken: row.accessToken,
				accessTokenExpiresAt: row.accessTokenExpiresAt,
				refreshToken: row.refreshToken,
				refreshTokenExpiresAt: row.refreshTokenExpiresAt,
				accounts: rolesOf(row, (id) => id)
			};
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

/** each role's pair of columns off one row, read as whatever `read` makes of an id and its name. */
function rolesOf<T>(
	row: typeof quickbooksConnection.$inferSelect,
	read: (id: string | null, name: string | null) => T
): Readonly<Record<AccountRole, T>> {
	return Object.fromEntries(
		ACCOUNT_ROLES.map((role) => {
			const { id, name } = ACCOUNT_COLUMNS[role];
			return [role, read(row[id] as string | null, row[name] as string | null)];
		})
	) as Record<AccountRole, T>;
}
