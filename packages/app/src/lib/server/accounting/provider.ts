import type { ProcessorName } from '../payments/provider';

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
// the port carries no vendor's word, and everything under it still does.
//
// nothing on this surface says realm, Intuit or QuickBooks: a caller holds a company id at whatever
// ledger is connected, and ./quickbooks.ts maps Intuit's realm onto it. that is the whole of what a
// second adapter would need, and it is the difference between a seam and a name.
//
// **the tables and the modules over them keep `quickbooks` in their names, deliberately.** one
// adapter exists, `quickbooks_connection` and `quickbooks_sync` are what the schema holds, and a
// remote migration is a one-way door (CLAUDE.md -> Bans) — too much to spend on a word. so
// ./connection.ts reads `realm_id` into `companyId` in one select and the vendor stops there.
//
// ---------------------------------------------------------------------------
// a handful of roles and never nine accounts.
//
// this app's own chart is the nine seeded rows in ../db/accounts.ts, and a connected company's is
// whatever its bookkeeper built. nothing maps one onto the other, so the operator picks one account
// in their own books per role — where income lands, where the processor's cut lands, and where the
// money sits until it reaches the bank, one of those per party that holds it — and every line this
// port carries names one of those roles rather than an account on either side. ./record.ts is where
// a posting's local account becomes a role, and a posting that names an account with no role is
// refused there rather than sent somewhere plausible.
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
 *   accounts_not_chosen — a company is connected and its income or fee account has not been
 *                         picked. the connection is made on one screen and the accounts on another,
 *                         so a send in between is expected, and every record is behind it.
 *   holding_not_chosen  — income and fees are picked and the holding this record's money sits in
 *                         is not. it is that party's records waiting and nobody else's: a
 *                         processor an organisation never took a gift through needs no account.
 *                         `detail` names the holding.
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
 *   credential_unsaved  — the provider issued a new credential and this deployment could not store
 *                         it. the one still held keeps renewing for a while (Intuit's grace is 24
 *                         hours, ./quickbooks.ts), so the next run renews again and stores that.
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
	'credential_unsaved',
	'internal_error',
	'holding_not_chosen'
] as const;
export type AccountingFailureReason = (typeof ACCOUNTING_FAILURE_REASONS)[number];

/**
 * the reasons whose answer is to make the same call again, later.
 *
 * `holding_not_chosen` is here because the record itself is sound: the same call lands the moment
 * somebody picks the holding, and nothing about the call has to change for it to.
 */
export const RETRYABLE_FAILURE_REASONS = [
	'rate_limited',
	'unreachable',
	'provider_error',
	'credential_unsaved',
	'holding_not_chosen'
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
 * `retryable` is a field rather than something the caller derives: it is set from the reason by
 * {@link failed} rather than written at a call site, so no two refusals of one reason can disagree
 * about it. it answers whether the identical call is worth making again and nothing more — where a
 * refusal *lands* is the delivery's own table (`LANDING_OF` in ./deliver.ts), which is finer than
 * this partition and deliberately disagrees with it on two reasons.
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
 * where a gift's money sits until a payout moves it to the bank, one role per party holding it.
 *
 *   stripeBalance, paypalBalance, chariotBalance, nowpaymentsBalance
 *                    — what that processor holds for the organisation until it pays out.
 *   undepositedFunds — a gift received in hand, cash or a cheque, until somebody banks it.
 *
 * **none of them is the bank.** this app hears no payout, so nothing it sends can say money reached
 * a bank account: the bookkeeper records each payout off the bank feed as a transfer out of the
 * holding account it came from, and what a holding account still holds is what that party owes.
 */
export const HOLDING_ROLES = [
	'stripeBalance',
	'paypalBalance',
	'chariotBalance',
	'nowpaymentsBalance',
	'undepositedFunds'
] as const;
export type HoldingRole = (typeof HOLDING_ROLES)[number];

/** the holding each processor's gifts wait in until it pays out. */
export const HOLDING_OF: Readonly<Record<ProcessorName, HoldingRole>> = {
	stripe: 'stripeBalance',
	paypal: 'paypalBalance',
	chariot: 'chariotBalance',
	nowpayments: 'nowpaymentsBalance'
};

/** which of the operator's accounts a line belongs in: income, the processor's cut, or a holding. */
export const ACCOUNT_ROLES = ['income', 'fee', ...HOLDING_ROLES] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * what an operator-facing sentence calls each role, and the name an account made for a processor's
 * holding is given in the company's chart.
 */
export const ROLE_LABELS: Readonly<Record<AccountRole, string>> = {
	income: 'income',
	fee: 'processing fees',
	stripeBalance: 'Stripe balance',
	paypalBalance: 'PayPal balance',
	chariotBalance: 'Chariot balance',
	nowpaymentsBalance: 'NOWPayments balance',
	undepositedFunds: 'Undeposited Funds'
};

export function isHoldingRole(role: AccountRole): role is HoldingRole {
	return (HOLDING_ROLES as readonly AccountRole[]).includes(role);
}

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
	/** who holds the money until it is paid out or banked: the other side of the income and the fee. */
	readonly holding: HoldingRole;
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

/**
 * whether the record being sent has been handed to the provider before.
 *
 *   first — nothing has tried this record. the queue counts an attempt as it claims a row, before
 *           anything is sent (./deliver.ts), so a row claimed with none behind it is one no run has
 *           ever sent and the provider cannot already be holding it.
 *   again — an earlier attempt may have reached the provider, whether or not its answer did — its
 *           run may have died before writing anything down. the adapter looks before it creates.
 *
 * it is the caller's to state rather than the record's, because the record is read out of the books
 * (./record.ts) and this is a fact about the queue row carrying it.
 */
export type SendAttempt = 'first' | 'again';

/** what the provider called the record it created — `quickbooks_sync.remote_id`. */
export type RemoteRecord = {
	readonly remoteId: string;
};

/** the company a connection points at, as the screen that made it shows it. */
export type CompanyIdentity = {
	/** what the connected ledger calls this company. */
	readonly companyId: string;
	readonly companyName: string;
};

/**
 * one account in the company's own chart, as the screen that picks the roles' accounts offers it.
 *
 * `type`, `subType` and `classification` are the provider's own words and are carried rather than
 * translated: the picker groups by them and the operator recognises them from their own books, and
 * a closed vocabulary here would be a list to keep in step with somebody else's. which of them may
 * fill an {@link AccountRole} is the provider's own rule, derived from these words beside the
 * adapter (./quickbooks-accounts.ts) rather than folded into them.
 */
export type LedgerAccount = {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly subType: string | null;
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
 * each role's account id is nullable on its own: a company is connected on one screen and its
 * accounts picked on another, and a holding the operator has not chosen holds only the records that
 * need it — a Stripe gift waits on the Stripe balance and a cheque does not. so an adapter refuses a
 * record by the roles its own lines name, and never the whole connection over one gap.
 */
export type ConnectionSnapshot = TokenPair & {
	/** {@link CompanyIdentity.companyId}, as the stored connection holds it. */
	readonly companyId: string;
	readonly accounts: Readonly<Record<AccountRole, string | null>>;
};

/**
 * what became of a pair handed to {@link ConnectionStore.saveTokens}.
 *
 *   stored     — the stored credential is now this pair.
 *   superseded — the stored refresh token is no longer the one presented, so another caller
 *                renewed first and stored its own pair. this one is not dead — Intuit keeps a
 *                token it rotated away from renewing for 24 hours (./quickbooks.ts) — but the
 *                row holds one credential and the first to land is it, so the caller reads the
 *                connection again and continues on what the winner stored.
 */
export type TokenSave = 'stored' | 'superseded';

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
	/**
	 * the pair just issued, replacing both tokens — but only while `presented` is still the stored
	 * refresh token, which is what keeps two renewals at once from storing a dead one.
	 */
	saveTokens(presented: string, tokens: TokenPair): Promise<TokenSave>;
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
	 * the company's own chart of accounts, active accounts only, for the screen that picks each
	 * role's account.
	 *
	 * every account the company holds rather than a filtered set: which account a gift's income
	 * belongs in is a bookkeeping decision this codebase does not get to make, and a list narrowed
	 * by type here would be one an operator cannot find their own account in.
	 */
	listAccounts(): Promise<AccountingResult<readonly LedgerAccount[]>>;

	/**
	 * one account made in the company's chart to hold a processor's money until it pays out, for a
	 * connection whose chart names none.
	 *
	 * the only thing this port writes into a company besides a gift, a correction and the donor on
	 * one, and it is asked for by the connect-time fill alone (./connection.ts).
	 */
	createHoldingAccount(name: string): Promise<AccountingResult<LedgerAccount>>;

	/**
	 * one gift into the company's books, keyed on {@link GiftRecord.key} so a retry lands once.
	 *
	 * `revision` is the queue row's `updated_at` as the send's claim read it: it holds across a call
	 * that never answered and a run that died, and moves once a refusal is recorded on the row, so
	 * an adapter can repeat a request exactly where the last one may have landed and ask afresh
	 * where it was answered.
	 */
	sendGift(
		gift: GiftRecord,
		attempt: SendAttempt,
		revision: string
	): Promise<AccountingResult<RemoteRecord>>;

	/** one correcting entry into the company's books, keyed the same way. */
	sendCorrection(
		correction: CorrectionRecord,
		attempt: SendAttempt,
		revision: string
	): Promise<AccountingResult<RemoteRecord>>;

	/**
	 * where a browser is sent to authorise, as the route that redirects asks for it.
	 *
	 * on the port for the reason {@link exchangeCode} is, and for one more: a deployment short of
	 * the credentials this address is built from is refused here, in the same sentence every other
	 * arm gives (./factory.ts). a route that read the client id itself would be a second module
	 * deciding what a half-configured deployment is told, and the two would drift.
	 *
	 * `state` is the caller's to mint and to check on the way back: it has to ride a cookie on the
	 * browser that is about to travel, which is something no module down here holds.
	 */
	authorizeUrl(input: {
		readonly redirectUri: string;
		readonly state: string;
	}): Promise<AccountingResult<string>>;

	/**
	 * the authorization code from the redirect, exchanged for the first token pair.
	 *
	 * on the port rather than in the callback route, because a route building the exchange itself
	 * would be a second module speaking the provider's OAuth — which ./sole-importer.spec.ts
	 * refuses. it reads nothing and writes nothing: the caller persists what comes back, together
	 * with the company id the redirect carried.
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
