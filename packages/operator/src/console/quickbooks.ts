// the company this deployment sends its books to, and the presses an operator has over it — named
// once for both ends of the wire.
//
// it is here for the reason ./recurring.ts is here: the deployment holds the connection and the
// credential, answers with these values, the operator console draws them, and the two packages
// import nothing of each other's.
//
// **the connection is the deployment's and can be nowhere else.** the tokens live in
// `quickbooks_connection` on the deployment's own D1 and the calls to Intuit are made with them, so
// every reading below is one only the deployment can take. the console never holds a token and
// never sees one: what crosses is a company's name, a chart of accounts an operator picks three
// entries out of, and how far behind the books are.
//
// **connecting starts on the console and finishes in a browser.** the press below answers an
// address, the operator's browser opens it, and Intuit sends that browser back to the deployment —
// never to the console, which is a binary on somebody's laptop that Intuit cannot reach. so the
// console's part ends at handing over an address, and what it learns afterwards it learns by
// reading this surface again.
//
// **it is a block and never a member of the report**, the same decision ./recurring.ts and
// ./payments.ts state: a deployment that keeps its books somewhere else is not half set up, and a
// line on the run an operator works down until it is clear would be a permanent unfinished item on
// every fork that never connects QuickBooks.
//
// nothing here states a rule about the books. what a connection may hold is decided in
// `packages/app/src/lib/server/accounting/`, and its sentences arrive in `detail`.

/**
 * the Accounting API host a real company's books answer on.
 *
 * both ends name it: the deployment posts to it, and the console draws it as the example an empty
 * address box stands on.
 *
 * **it is the only Intuit host stated here.** which host a deployment is built against is a
 * configuration value, and a second one sitting in vocabulary every surface can reach is something
 * for a screen to branch on — nothing in this repository reads which host it holds.
 */
export const QUICKBOOKS_PRODUCTION_URL = 'https://quickbooks.api.intuit.com';

/** an account in the company's books as the connection holds it: what to post to, and what to print. */
export interface ChosenAccountLine {
	readonly id: string;
	readonly name: string;
}

/**
 * the three places a gift is posted into, each one account an operator picks.
 *
 *   income  — where the gift is counted as income.
 *   fee     — where the processor's fee is counted as a cost.
 *   deposit — the asset the gift arrived in.
 */
export const QUICKBOOKS_ACCOUNT_ROLES = ['income', 'fee', 'deposit'] as const;

export type QuickbooksAccountRole = (typeof QUICKBOOKS_ACCOUNT_ROLES)[number];

/**
 * one account in the company's own chart, as the picker offers it.
 *
 * `type`, `subType` and `classification` are Intuit's own words and are carried rather than
 * translated: an operator recognises them from their own books, and a closed vocabulary here would
 * be a list to keep in step with somebody else's.
 *
 * `roles` is which of the three this account may be picked for, decided on the deployment: Intuit
 * refuses a post into an account whose type does not fit the place it is posted to, so the one list
 * is filtered per picker and an account fitting none is offered by none of them. a save naming an
 * account outside its role is refused whatever the screen offered.
 */
export interface LedgerAccountLine {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly subType: string | null;
	readonly classification: string | null;
	readonly roles: readonly QuickbooksAccountRole[];
}

/**
 * the company this deployment is connected to.
 *
 * `companyName` is null in the window between the connection being written and Intuit answering
 * what the company is called — the name is a label rather than the connection, so a read that did
 * not land leaves the connection standing and this null.
 *
 * the three accounts are null until an operator has picked them, and they are picked together: a
 * connection holding one of the three is a state the deployment refuses to write.
 */
export interface QuickbooksCompany {
	readonly state: 'connected';
	/** Intuit's id for the company, which every call is addressed to. */
	readonly realmId: string;
	readonly companyName: string | null;
	readonly income: ChosenAccountLine | null;
	readonly fee: ChosenAccountLine | null;
	readonly deposit: ChosenAccountLine | null;
	/** the earliest business date a gift is sent from, as an ISO-8601 instant. */
	readonly startAt: string;
}

/** whether a company is connected at all. the ordinary state of a fresh fork is `disconnected`. */
export type QuickbooksConnectionLine = { readonly state: 'disconnected' } | QuickbooksCompany;

/**
 * what an operator does about a chart that could not be read, as a closed set the console switches
 * on, and `null` where the deployment names nothing they can do.
 *
 *   reconnect — the credential has lapsed, and connecting the company again is what mends it.
 *   wait      — the deployment could not reach Intuit and goes on trying, so there is nothing to do.
 *
 * it is what to do and never why it failed, because the whole of what the console draws is the
 * operator's next move: the port's own vocabulary is a list of ten reasons
 * (`ACCOUNTING_FAILURE_REASONS` in `packages/app/src/lib/server/accounting/provider.ts`) that would
 * have to be kept in step here to say one thing.
 *
 * a fact rather than a sentence read for one, for the reason `RecurringSetupReason` in
 * ./recurring.ts is: `detail` is prose written for an operator and free to change wording, and a
 * console matching a fragment of it silently stops matching the next time somebody edits a string.
 *
 * **closed here and open on the wire.** the two ends are two binaries an operator upgrades
 * separately, so a deployment a release ahead names a recourse the installed console has never
 * heard of — a console reading one off this surface checks it against this set and draws nothing
 * where it is not in it, rather than trusting the type it was handed.
 */
export const QUICKBOOKS_RECOURSES = ['reconnect', 'wait'] as const;

export type QuickbooksRecourse = (typeof QUICKBOOKS_RECOURSES)[number];

/**
 * the company's chart of accounts, for the picker — or the fact that it could not be read.
 *
 * `unreadable` is a state and not a failure of the request, the shape ./recurring.ts's reading
 * takes and for its reason: it says nothing about the connection, and `detail` is the deployment's
 * own sentence, which names what to fix. null where nothing is connected, because there is no
 * company to have a chart.
 */
export type QuickbooksAccountsReading =
	| {
			readonly state: 'unreadable';
			readonly recourse: QuickbooksRecourse | null;
			readonly detail: string;
	  }
	| { readonly state: 'read'; readonly accounts: readonly LedgerAccountLine[] };

/** how far behind the books are. */
export interface QuickbooksBacklogLine {
	/** how many gifts were given up on. what the retry press acts on, and nothing else. */
	readonly failed: number;
	/**
	 * when the oldest gift still owed was queued, as an ISO-8601 instant, or null where none is.
	 *
	 * every gift not yet sent counts, whether it is waiting on a backoff or was given up on: what
	 * it answers is how far behind the books are. so it is never {@link failed}'s own wait, and a
	 * screen saying it was would read a gift queued behind a backfill back as a failure that old.
	 */
	readonly oldestWaitingAt: string | null;
}

/** everything the screen draws, in one read. */
export interface QuickbooksReport {
	readonly connection: QuickbooksConnectionLine;
	readonly accounts: QuickbooksAccountsReading | null;
	readonly backlog: QuickbooksBacklogLine;
	/**
	 * the address to register in the operator's own Intuit app: where Intuit sends a browser back
	 * to once a company has been chosen.
	 *
	 * the whole address and never a path the console joins to a hostname: the path belongs to
	 * `packages/app`, which the console may not import from (CLAUDE.md → The map), and no hostname
	 * is committed to this repository — the deployment reads its own off the request that arrived.
	 */
	readonly callbackAddress: string;
}

/**
 * every press this surface takes, as the `press` on the body.
 *
 *   connect     — answers the address the operator's browser opens to connect a company. it is
 *                 minted here because this surface is behind the console's credential and the
 *                 address it answers is not: an unguarded one would let an outsider connect their
 *                 own books and take this organisation's gifts into them.
 *   accounts    — the three accounts a gift is posted into, by id. the names are read off the
 *                 company's own chart rather than sent, so a pick is checked against the books it
 *                 claims to be in.
 *   start-date  — the earliest business date a gift is sent from.
 *   retry       — every gift that was given up on, queued again.
 *   disconnect  — the credential revoked at Intuit and the connection gone from here.
 */
export const QUICKBOOKS_PRESSES = [
	'connect',
	'accounts',
	'start-date',
	'retry',
	'disconnect'
] as const;

export type QuickbooksPress = (typeof QUICKBOOKS_PRESSES)[number];

/**
 * what a press that landed answers with.
 *
 * only two of them have anything to say beyond having happened, and what the rest change is read
 * back off {@link QuickbooksReport} — so there is no arm carrying a field that is null for every
 * press but one.
 */
export type QuickbooksPressReport =
	| { readonly press: 'connect'; readonly url: string }
	| { readonly press: 'accounts' | 'start-date' | 'disconnect' }
	| { readonly press: 'retry'; readonly retried: number };
