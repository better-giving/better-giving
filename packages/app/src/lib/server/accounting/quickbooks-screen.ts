import { readAuthEnv } from '../auth/env';
import type { Db } from '../db/client';
import { servedProcessors } from '../payments/factory';
import type { Deferred } from '../runtime/deferred';
import { readQuickbooksBacklog } from './backlog';
import { connectFlowOrigin, QUICKBOOKS_CALLBACK_PATH } from './connect-link';
import { type ChosenAccount, readQuickbooksConnection } from './connection';
import { createAccountingProvider, type QuickbooksKeyName, unsetQuickbooksKeys } from './factory';
import type { StartAtMoveSide } from './outbox';
import {
	ACCOUNT_ROLES,
	type AccountingFailureReason,
	type AccountingResult,
	type AccountRole,
	failed,
	HOLDING_OF,
	HOLDING_ROLES,
	type HoldingRole,
	type LedgerAccount
} from './provider';
import { fitsRole } from './quickbooks-accounts';

// where this deployment's books stand at QuickBooks, as the deployer's half of the dashboard's
// Books screen draws it (../../../routes/_app.admin.books.tsx): the keys, the redirect address to
// register at Intuit, the company, the chart its accounts are picked from, and the gifts that
// did not sync.
//
// read-only, and every fact is assembled here so the screen is handed plain values: the chart is
// Intuit's and is read through the port with the deployment's own keys, and the rest are rows.
// a chart that could not be read is a state of the screen and never a failed page, with the port's
// sentence beside it.

/** an account in the company's chart as a picker offers it: `name — type`, and the roles it fits. */
type ChartLine = {
	readonly id: string;
	readonly label: string;
	readonly roles: readonly AccountRole[];
};

/**
 * what an operator does about a chart that could not be read: connect again where the credential
 * lapsed, wait where Intuit could not be reached, and nothing named for any other reason.
 */
type ChartRecourse = 'reconnect' | 'wait' | null;

export type QuickbooksScreen = {
	/** the variables Intuit cannot be reached without that are not set, and none once all are. */
	readonly unsetKeys: readonly QuickbooksKeyName[];
	/**
	 * the redirect address to register at Intuit, at the address the round trip is made against. a
	 * pin naming no address never gets this far: the dashboard's gate refuses it first
	 * (`requirePin` in ../auth/pin.ts).
	 */
	readonly callback: string;
	readonly company: QuickbooksCompanyLine | null;
	/** null where no company is connected, since there is no chart to have. */
	readonly chart:
		| { readonly state: 'read'; readonly accounts: readonly ChartLine[] }
		| { readonly state: 'unreadable'; readonly recourse: ChartRecourse; readonly detail: string }
		| null;
	/**
	 * the holdings a picker is drawn for: gifts recorded by hand always, each processor this
	 * deployment takes gifts through, and any holding the connection already stores — so the screen
	 * says where the books post today, and the picker is how a pick comes off.
	 */
	readonly holdings: readonly HoldingRole[];
	/** the gifts given up on, or null where none was or no company is connected to retry them for. */
	readonly backlog: QuickbooksBacklogLine | null;
};

type QuickbooksCompanyLine = {
	/** the company's name, or the id Intuit addresses it by until its name has been read. */
	readonly name: string;
	/** whether the connection moved to this company and nobody has saved its accounts since. */
	readonly awaitingAccounts: boolean;
	/** the earliest business date a gift is sent from, as the box holds it: `YYYY-MM-DD`. */
	readonly startOn: string;
	readonly picks: Readonly<Record<AccountRole, ChosenAccount | null>>;
};

type QuickbooksBacklogLine = {
	readonly failed: number;
	/** how far behind the books are, in words, or null where the oldest wait could not be read. */
	readonly behind: string | null;
	/** the refunds waiting behind those gifts and how many gifts they wait on, or null for none. */
	readonly held: { readonly refunds: number; readonly gifts: number } | null;
};

/**
 * how long the screen waits on Intuit for the chart before it draws the "can't be reached" state.
 * the adapter gives each call 20 seconds (`TIMEOUT_MS` in ./quickbooks.ts), and a read that renews
 * the credential first is two calls; the Books loader that waits on this also draws the ledger,
 * which needs nothing from Intuit.
 */
const CHART_WAIT_MS = 5_000;

/**
 * the chart, or `unreachable` once {@link CHART_WAIT_MS} has passed without it. the read is not
 * abandoned: a renewal inside it rotates the stored credential, so it runs to its end on
 * `deferred`, which shutdown waits for.
 */
async function chartWithin(
	read: Promise<AccountingResult<readonly LedgerAccount[]>>,
	deferred: Deferred
): Promise<AccountingResult<readonly LedgerAccount[]>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), CHART_WAIT_MS);
	});
	try {
		const chart = await Promise.race([read, late]);
		if (chart !== null) return chart;
		deferred.waitUntil(read);
		return failed(
			'unreachable',
			`QuickBooks did not answer within ${CHART_WAIT_MS / 1000} seconds.`
		);
	} finally {
		clearTimeout(timer);
	}
}

export async function readQuickbooksScreen(
	env: unknown,
	db: Db,
	deferred: Deferred,
	requestUrl: string,
	now: Date
): Promise<QuickbooksScreen> {
	const [connection, backlog] = await Promise.all([
		readQuickbooksConnection(db),
		readQuickbooksBacklog(db)
	]);
	const callback = `${connectFlowOrigin(readAuthEnv(env), new URL(requestUrl))}${QUICKBOOKS_CALLBACK_PATH}`;

	if (connection === null) {
		return {
			unsetKeys: unsetQuickbooksKeys(env),
			callback,
			company: null,
			chart: null,
			holdings: ['undepositedFunds'],
			// a gift given up on and a company gone is a press nothing can answer, so it is not drawn.
			backlog: null
		};
	}

	const chart = await chartWithin(createAccountingProvider(env, db).listAccounts(), deferred);
	const taken = new Set(servedProcessors(env).configured.map((name) => HOLDING_OF[name]));
	return {
		unsetKeys: unsetQuickbooksKeys(env),
		callback,
		company: {
			name: connection.companyName ?? connection.realmId,
			awaitingAccounts: connection.movedAt !== null,
			startOn: dayOf(connection.startAt),
			picks: connection.accounts
		},
		chart: chart.ok
			? {
					state: 'read',
					accounts: chart.value.map((account) => ({
						id: account.id,
						label: `${account.name} — ${account.type}`,
						roles: ACCOUNT_ROLES.filter((role) => fitsRole(account, role))
					}))
				}
			: { state: 'unreadable', recourse: recourseFor(chart.reason), detail: chart.detail },
		holdings: HOLDING_ROLES.filter(
			(role) => role === 'undepositedFunds' || taken.has(role) || connection.accounts[role] !== null
		),
		backlog:
			backlog.failed < 1
				? null
				: {
						failed: backlog.failed,
						behind: behindBy(backlog.oldestWaitingAt, now),
						held:
							backlog.heldBehindFailed.length === 0
								? null
								: {
										refunds: backlog.heldBehindFailed.length,
										gifts: new Set(backlog.heldBehindFailed.map((line) => line.waitsOn)).size
									}
					}
	};
}

function recourseFor(reason: AccountingFailureReason): ChartRecourse {
	if (reason === 'reconnect_needed') return 'reconnect';
	if (reason === 'unreachable') return 'wait';
	return null;
}

/** an instant as the calendar day it falls on in UTC, where business dates are stored. */
export function dayOf(at: Date): string {
	return at.toISOString().slice(0, 10);
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * how long the oldest gift still owed has waited. a figure and its unit are joined by a no-break
 * space, so "3 hours" never splits across two lines.
 */
function behindBy(since: Date | null, now: Date): string | null {
	if (since === null) return null;
	const waited = now.getTime() - since.getTime();
	if (waited < HOUR) return 'under an hour';
	if (waited < 2 * DAY) {
		const hours = Math.floor(waited / HOUR);
		return hours === 1 ? 'an hour' : `${hours} hours`;
	}
	return `${Math.floor(waited / DAY)} days`;
}

/** the confirm a move of the start date puts up, or null where the move touches nothing to agree to. */
export type StartDateAsk = {
	readonly title: string;
	readonly press: string;
	/** sending is the job asked for; skipping loses gifts and is danger. */
	readonly rank: 'exit' | 'danger';
	readonly lines: readonly string[];
};

/**
 * what moving the start date from `from` to `to` asks before it goes, off the preview's count.
 *
 * the direction decides which side is read: a move earlier queues and a move later drops. a refund
 * or dispute moves with the gift it reverses, so a side of those alone names no dates.
 */
export function startDateAsk(
	move: { readonly queues: StartAtMoveSide; readonly drops: StartAtMoveSide },
	from: string,
	to: string,
	company: string
): StartDateAsk | null {
	const earlier = to < from;
	const side = earlier ? move.queues : move.drops;
	if (side.gifts + side.corrections + side.reversals === 0) return null;
	return earlier
		? {
				title: 'Send past gifts?',
				press: 'Send gifts',
				rank: 'exit',
				lines: [
					...counted(side),
					`Company · ${company}`,
					'Any of these already entered in QuickBooks by hand will appear there twice.'
				]
			}
		: {
				title: 'Skip unsent gifts?',
				press: 'Skip gifts',
				rank: 'danger',
				lines: [...counted(side), stopped(`These won’t be sent to ${company}`)]
			};
}

/** a sentence ending on a name that already ends in a stop takes no second one. */
const stopped = (text: string): string => (text.endsWith('.') ? text : `${text}.`);

/** a side's counts, a line each and none for a zero, then the dates its gifts and corrections span. */
function counted(side: StartAtMoveSide): string[] {
	return [
		side.gifts > 0 ? `Gifts · ${side.gifts}` : null,
		side.corrections > 0 ? `Corrections · ${side.corrections}` : null,
		side.reversals > 0 ? `Refunds and disputes · ${side.reversals}` : null,
		side.earliest !== null && side.latest !== null
			? `Dated · ${datedSays(side.earliest, side.latest)}`
			: null
	].filter((line): line is string => line !== null);
}

const DAY_WORDS = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

/**
 * the business dates a side spans, each part said once: `2 to 12 September 2026`,
 * `3 June to 31 August 2026`, `30 December 2025 to 2 January 2026`, or the one day.
 */
function datedSays(earliest: Date, latest: Date): string {
	const part = (at: Date, type: Intl.DateTimeFormatPartTypes): string =>
		DAY_WORDS.formatToParts(at).find((one) => one.type === type)?.value ?? '';
	const whole = DAY_WORDS.format(latest);
	if (DAY_WORDS.format(earliest) === whole) return whole;
	const sameYear = part(earliest, 'year') === part(latest, 'year');
	const sameMonth = sameYear && part(earliest, 'month') === part(latest, 'month');
	const start = sameMonth
		? part(earliest, 'day')
		: sameYear
			? `${part(earliest, 'day')} ${part(earliest, 'month')}`
			: DAY_WORDS.format(earliest);
	return `${start} to ${whole}`;
}
