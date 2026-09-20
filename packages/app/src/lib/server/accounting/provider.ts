// the accounting port: the one interface this app sends its books to an outside ledger through,
// and the one thing an adapter has to implement.
//
// it is the shape ../payments/provider.ts already holds over the processors, for the same stated
// reason: the vocabulary of somebody else's API — Intuit's refs, its faults, its decimal amounts,
// its rotating credential — stops at one file, and everything above it takes types this repository
// defines and can construct in a test with no network and no company. ./sole-importer.spec.ts is
// what keeps it to one file.
//
// **nothing here reaches the network or the database, and nothing may.** no `fetch`, no `Db`, no
// binding: this file is the vocabulary, ./connection.ts is what persists, ./record.ts is what reads
// the books, and ./quickbooks.ts is the one module that speaks to Intuit.
//
// ---------------------------------------------------------------------------
// three roles and never nine accounts.
//
// this app's own chart is the nine seeded rows in ../db/accounts.ts, and a connected company's is
// whatever its bookkeeper built. nothing maps one onto the other, so the operator picks three
// accounts in their own books — where income lands, where the processor's cut lands, which account
// the money arrived in — and every line this port carries names one of those three roles rather
// than an account on either side. ./record.ts is where a posting's local account becomes a role,
// and a posting that names an account with no role is refused there rather than sent somewhere
// plausible.
//
// ---------------------------------------------------------------------------
// minor units cross this port, decimals do not.
//
// every amount here is the integer the ledger holds (../ledger/posting.ts). an adapter converts to
// whatever its API takes, in itself, so that no caller above it ever holds a rounded figure.

/**
 * why a call did not succeed.
 *
 *   not_connected       — no company is connected. the ordinary state of a deployment nobody has
 *                         connected, and nothing about it is a fault.
 *   accounts_not_chosen — a company is connected and the three accounts have not been picked. the
 *                         connection is made on one screen and the accounts on another, so a send
 *                         in between is expected; `detail` names which of the three is missing.
 *   reconnect_needed    — the credential is dead. a refresh the provider rejected, or a call still
 *                         refused after one. retrying spends attempts on a connection that cannot
 *                         come back without somebody re-authorising it.
 *   not_found           — nothing in the books carries the id handed over.
 *   unmapped_account    — a posting names one of this app's accounts that no role covers, so there
 *                         is no account in the company's books to put it in. `detail` names it.
 *   invalid_record      — the provider refused the payload. the same payload is refused the same
 *                         way every time, until the data or the mapping changes.
 *   rate_limited        — the provider is shedding load.
 *   unreachable         — no answer settled whether the call took effect: a connection that failed,
 *                         or a wait that ran out.
 *   provider_error      — the provider faulted, or answered with something this app cannot read.
 *   internal_error      — this app handed the port something its contract says it never will. a
 *                         defect here rather than anything about the books.
 */
export const ACCOUNTING_FAILURE_REASONS = [
	'not_connected',
	'accounts_not_chosen',
	'reconnect_needed',
	'not_found',
	'unmapped_account',
	'invalid_record',
	'rate_limited',
	'unreachable',
	'provider_error',
	'internal_error'
] as const;
export type AccountingFailureReason = (typeof ACCOUNTING_FAILURE_REASONS)[number];

/** the reasons whose answer is to make the same call again, later. */
export const RETRYABLE_FAILURE_REASONS = [
	'rate_limited',
	'unreachable',
	'provider_error'
] as const satisfies readonly AccountingFailureReason[];

/**
 * the reasons whose answer is anything but the same call again.
 *
 * `not_connected` and `accounts_not_chosen` are terminal where ../payments/provider.ts calls its
 * own `not_configured` retryable, and the difference is what is waiting on the answer: a webhook
 * delivery held open across the minute an operator sets a variable is a gift recovered, where a
 * queued journal entry is already durable in `quickbooks_sync` and is re-queued by the sweep that
 * reads that table. so nothing is lost by stopping, and a deployment mid-setup does not burn a
 * row's attempts against a screen nobody has opened yet.
 */
export const TERMINAL_FAILURE_REASONS = [
	'not_connected',
	'accounts_not_chosen',
	'reconnect_needed',
	'not_found',
	'unmapped_account',
	'invalid_record',
	'internal_error'
] as const satisfies readonly AccountingFailureReason[];

/**
 * whether making the identical call again is worth anything.
 *
 * ./provider.spec.ts holds the two arrays to being a partition of `ACCOUNTING_FAILURE_REASONS`,
 * which is what makes a reason added later a failing test rather than one that silently answers
 * "do not retry".
 */
export function isRetryable(reason: AccountingFailureReason): boolean {
	return (RETRYABLE_FAILURE_REASONS as readonly AccountingFailureReason[]).includes(reason);
}

/**
 * why a call did not succeed, and whether to try it again.
 *
 * `retryable` is a field rather than something the caller derives, because the delivery reads
 * exactly it to choose between another attempt and a dead row — and it is set from the reason by
 * {@link failed} rather than written at a call site, so the two can never disagree.
 *
 * `detail` is read by an operator in the console and is written into `quickbooks_sync.last_error`.
 * it never carries a credential: a token is described, never quoted.
 */
export type AccountingFailure = {
	readonly ok: false;
	readonly reason: AccountingFailureReason;
	readonly detail: string;
	readonly retryable: boolean;
};

/** a refusal, with `retryable` taken off the partition above. */
export function failed(reason: AccountingFailureReason, detail: string): AccountingFailure {
	return { ok: false, reason, detail, retryable: isRetryable(reason) };
}

/** a discriminated pair, so a caller cannot reach the value without having checked `ok`. */
export type AccountingResult<T> = { readonly ok: true; readonly value: T } | AccountingFailure;

/**
 * which of the operator's three accounts a line belongs in.
 *
 * `deposit` is the asset side — what the gift arrived in — and is the one role that is never an
 * income or an expense account in the company's books.
 */
export type AccountRole = 'income' | 'fee' | 'deposit';

/** who gave, as the record carries them. */
export type Donor = {
	/** never blank: `contact.display_name` is NOT NULL and checked (../db/schema.ts). */
	readonly displayName: string;
	/** null where the donor left none — a cheque handed over at an event. */
	readonly email: string | null;
};

/**
 * a gift as it goes over: the money at face value, what the processor kept, and who gave it.
 *
 * one record for what the books hold as two entry groups. the gift and the processor's cut are
 * posted separately here (../donations/entries.ts) and are one transaction in the company's books,
 * so the fee is a line on this record rather than a record of its own — which is also why
 * ../accounting/outbox.ts queues no row for a `fee` group.
 */
export type GiftRecord = {
	/**
	 * the id every post is keyed on: the entry group's own id.
	 *
	 * it is written onto the record the provider creates, so a post whose answer never arrived is
	 * found rather than made twice. `entry_group_source_idx` is what makes it one per gift
	 * (../db/schema.ts).
	 */
	readonly key: string;
	/** business time: the day the money moved, which decides the period this lands in. */
	readonly occurredAt: Date;
	/** ISO-4217, uppercase, as `entry_group.currency` holds it. */
	readonly currency: string;
	readonly donor: Donor;
	/** the entry's memo, or null. */
	readonly memo: string | null;
	/** minor units, positive: the gift at face value, before anything was withheld. */
	readonly incomeMinor: number;
	/** minor units, zero where the processor took nothing — a cheque received in hand. */
	readonly feeMinor: number;
};

/** one side of a correcting entry, in the role it lands in. */
export type CorrectionLine = {
	readonly role: AccountRole;
	/** the ledger's own convention, named rather than signed: `+` is a debit (../ledger/posting.ts). */
	readonly posting: 'debit' | 'credit';
	/** minor units, positive. */
	readonly amountMinor: number;
};

/**
 * a correcting entry as it goes over.
 *
 * at least two lines, because an entry group that balances has at least two (`post()` refuses
 * fewer), and the tuple is what makes "a correction with one line" a shape no caller can build.
 */
export type CorrectionRecord = {
	/** the entry group's id, as {@link GiftRecord.key}. */
	readonly key: string;
	readonly occurredAt: Date;
	readonly currency: string;
	/** why the correction was posted — required at ../ledger/correct.ts, so never blank here. */
	readonly memo: string | null;
	readonly lines: readonly [CorrectionLine, CorrectionLine, ...CorrectionLine[]];
};

/** what one queued entry group turns out to be. */
export type Sendable =
	| { readonly kind: 'gift'; readonly gift: GiftRecord }
	| { readonly kind: 'correction'; readonly correction: CorrectionRecord };

/** what the provider called the record it created — `quickbooks_sync.remote_id`. */
export type RemoteRecord = {
	readonly remoteId: string;
};

/** the company a connection points at, as the screen that made it shows it. */
export type CompanyIdentity = {
	readonly realmId: string;
	readonly companyName: string;
};

/**
 * one account in the company's own chart, as the screen that picks the three offers it.
 *
 * `type` and `classification` are the provider's own words and are carried rather than translated:
 * the picker groups by them and the operator recognises them from their own books, and a closed
 * vocabulary here would be a list to keep in step with somebody else's.
 */
export type LedgerAccount = {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly classification: string | null;
};

/**
 * the credential an exchange or a refresh yields.
 *
 * **the refresh token rotates**, so this type carries one on every issue rather than only on the
 * first: a refresh that persists the access token and keeps the old refresh token loses the
 * connection the next time it is presented (`quickbooks_connection` in ../db/schema.ts).
 */
export type TokenPair = {
	readonly accessToken: string;
	readonly accessTokenExpiresAt: Date;
	readonly refreshToken: string;
	/** null where the provider states no expiry for it. */
	readonly refreshTokenExpiresAt: Date | null;
};

/**
 * what an adapter needs to make a call, read fresh each time.
 *
 * the three account ids are nullable together with nothing enforcing that they arrive as a set,
 * which is the state the schema allows and the console produces: connected on one screen, accounts
 * picked on another. an adapter names the missing one rather than refusing generically.
 */
export type ConnectionSnapshot = TokenPair & {
	readonly realmId: string;
	readonly incomeAccountId: string | null;
	readonly feeAccountId: string | null;
	readonly depositAccountId: string | null;
};

/**
 * the two operations an adapter performs against the stored connection, and nothing else.
 *
 * an adapter takes this rather than a `Db` for one structural reason: there is no shape in which a
 * rotated refresh token is obtained and dropped. the adapter cannot refresh without persisting,
 * because persisting is the only writing it can do — and it can be exercised with no database at
 * all, which is what ./quickbooks.spec.ts does. ./connection.ts is what builds one over `Db`.
 */
export type ConnectionStore = {
	/** the connection as it stands, or null where no company is connected. */
	read(): Promise<ConnectionSnapshot | null>;
	/** the pair just issued, replacing both tokens. */
	saveTokens(tokens: TokenPair): Promise<void>;
};

export interface AccountingProvider {
	/**
	 * what the provider calls the connected company.
	 *
	 * read after a connection is made so an operator can tell they connected the books they meant
	 * to, and re-read by the screen that shows the connection.
	 */
	readCompany(): Promise<AccountingResult<CompanyIdentity>>;

	/**
	 * the company's own chart of accounts, active accounts only, for the screen that picks the
	 * three.
	 *
	 * every account the company holds rather than a filtered set: which account a gift's income
	 * belongs in is a bookkeeping decision this codebase does not get to make, and a list narrowed
	 * by type here would be one an operator cannot find their own account in.
	 */
	listAccounts(): Promise<AccountingResult<readonly LedgerAccount[]>>;

	/** one gift into the company's books, keyed on {@link GiftRecord.key} so a retry lands once. */
	sendGift(gift: GiftRecord): Promise<AccountingResult<RemoteRecord>>;

	/** one correcting entry into the company's books, keyed the same way. */
	sendCorrection(correction: CorrectionRecord): Promise<AccountingResult<RemoteRecord>>;

	/**
	 * the authorization code from the redirect, exchanged for the first token pair.
	 *
	 * on the port rather than in the callback route, because a route building the exchange itself
	 * would be a second module speaking the provider's OAuth — which ./sole-importer.spec.ts
	 * refuses. it reads nothing and writes nothing: the caller persists what comes back, together
	 * with the `realmId` the redirect carried.
	 *
	 * **exchanged once.** a code presented twice can invalidate the tokens it already issued, so
	 * the caller verifies the OAuth `state` and writes the result before anything else can retry.
	 */
	exchangeCode(input: {
		readonly code: string;
		readonly redirectUri: string;
	}): Promise<AccountingResult<TokenPair>>;

	/**
	 * the stored credential invalidated at the provider.
	 *
	 * the first half of disconnecting; deleting the local row is the caller's, and it happens
	 * whatever this answers — a revoke that failed leaves a credential this deployment can no
	 * longer present, and keeping the row would leave a connection nothing can use.
	 */
	revokeTokens(): Promise<AccountingResult<null>>;
}
