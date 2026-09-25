import type {
	LedgerAccountLine,
	QuickbooksAccountRole,
	QuickbooksAccountsReading,
	QuickbooksConnectionLine,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport,
	QuickbooksStartAtSide
} from '@better-giving/operator/console/quickbooks';
import {
	QUICKBOOKS_ACCOUNT_ROLES,
	QUICKBOOKS_PRESSES
} from '@better-giving/operator/console/quickbooks';
import { readQuickbooksBacklog, retryFailedEntries } from '$lib/server/accounting/backlog';
import {
	connectFlowOrigin,
	mintConnectLink,
	QUICKBOOKS_CALLBACK_PATH
} from '$lib/server/accounting/connect-link';
import {
	disconnectQuickbooks,
	readQuickbooksConnection,
	saveQuickbooksAccounts,
	type ChosenAccount,
	type QuickbooksConnectionView,
	type SavedAccounts
} from '$lib/server/accounting/connection';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import {
	moveQuickbooksStartAt,
	previewQuickbooksStartAt,
	type StartAtMoveSide
} from '$lib/server/accounting/outbox';
import {
	HOLDING_ROLES,
	isHoldingRole,
	ROLE_LABELS,
	type AccountingFailureReason,
	type AccountRole,
	type HoldingRole,
	type LedgerAccount
} from '$lib/server/accounting/provider';
import {
	fitsRole,
	ROLE_TYPES,
	UNDEPOSITED_FUNDS
} from '$lib/server/accounting/quickbooks-accounts';
import { readAuthEnv, resolveAuthSecret } from '$lib/server/auth';
import { consoleJson } from '$lib/server/console/surface';
import type { Db } from '$lib/server/db/client';
import { database, platform } from '../context';
import type { Route } from './+types/console.quickbooks';

// where this deployment's books stand, and every press an operator has over them.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read or press — see the header there,
// and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the connection.** the
// tokens are rows in its own D1 and every call to Intuit is made with them, so the chart of
// accounts an operator picks each role's account out of can be read here and nowhere else. the
// console never holds a token and never sees one.
//
// **connecting starts here and finishes in a browser, and that split is not a convenience.** the
// press below answers a signed address; the operator's browser opens it; Intuit sends that browser
// back to ./quickbooks.callback.tsx. Intuit cannot be pointed at a console running on somebody's
// laptop, so the console's part of connecting ends at handing over an address — and the address has
// to be minted behind this credential, because an unguarded one would let an outsider connect their
// own books and take this organisation's gifts into them
// ($lib/server/accounting/connect-link.ts argues the whole of it).
//
// **a read that could not be made is a state and a 200**, the same shape ./console.recurring.ts's
// read takes: a chart this deployment could not fetch says nothing about the connection, and the
// sentence it carries is the port's own, which names what to fix.
//
// **the accounts are picked by id and the names are read off the company's own chart.** a name the
// caller sent would be a label on this deployment's row that nothing in the books ever agreed to,
// and an id the chart does not hold, or one whose type does not fit that role
// ($lib/server/accounting/quickbooks-accounts.ts), is refused rather than stored — the same decision
// ./console.webhook-repair.ts makes about the endpoint it acts on, for the same reason: what a press
// acts on is settled here rather than sent.
//
// **the backlog is the one thing here that is not about Intuit at all.** how many gifts were given
// up on, and how far behind the books are, are rows in `quickbooks_sync`
// ($lib/server/accounting/backlog.ts) — read without a credential, so a deployment whose connection
// has died still says how much is waiting behind it.
//
// **this is a block and never a member of the report**, the decision ./console.recurring.ts and
// ./console.payments.ts both state: a deployment that keeps its books elsewhere is not half set up,
// and a line on the run an operator works down until it is clear would be a permanent unfinished
// item on every fork that never connects QuickBooks.

// the wire's roles are the port's, both ways round: operator cannot import from this package, so
// the two unions are spelled twice and a role on one side only fails to compile here.
type SameRoles = [AccountRole] extends [QuickbooksAccountRole]
	? [QuickbooksAccountRole] extends [AccountRole]
		? true
		: false
	: false;
true satisfies SameRoles;

/** where a caller reads what this address takes, on every refusal of a body. */
const PRESS_BODY_FIX =
	'Send `{ "press": "connect" }`. The presses this address takes are ' +
	`${QUICKBOOKS_PRESSES.join(', ')}.`;

/**
 * where the books stand, changing nothing.
 *
 * the connection is read first and the chart only after it: a deployment with no company connected
 * has no books to ask about, so `accounts` is null rather than an empty list — an empty one is a
 * picker a console would draw over a company that does not exist.
 */
export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);
	const { env } = context.get(platform);
	const [connection, backlog] = await Promise.all([
		readQuickbooksConnection(db),
		readQuickbooksBacklog(db)
	]);

	const report: QuickbooksReport = {
		connection: connectionLine(connection),
		accounts: connection === null ? null : await accountsReading(env, db),
		backlog: {
			failed: backlog.failed,
			oldestWaitingAt: backlog.oldestWaitingAt?.toISOString() ?? null
		},
		// what an operator registers at Intuit, so it is the same address the round trip is made
		// against and not whichever hostname the console reached this deployment on.
		callbackAddress: `${connectFlowOrigin(readAuthEnv(env), new URL(request.url))}${QUICKBOOKS_CALLBACK_PATH}`
	};

	return consoleJson(report);
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md).
	const body = await readBody(request);
	if (body === null) return badBody('The request body is not a JSON object.');

	const press = QUICKBOOKS_PRESSES.find((name) => name === body.press);
	if (press === undefined) return badBody('The request body names no press this address takes.');

	return act(press, body, context, request);
}

/** one press, each arm answering what it has to say and nothing more. */
async function act(
	press: QuickbooksPress,
	body: Record<string, unknown>,
	context: Route.ActionArgs['context'],
	request: Request
): Promise<Response> {
	const db = context.get(database);
	const { env } = context.get(platform);

	if (press === 'connect') {
		const signingKey = await resolveAuthSecret(db, readAuthEnv(env));
		// 500 for $lib/server/auth/gate.ts's reason: nothing the caller sent is wrong, and the
		// message names the table and the command that mints the row.
		if (!signingKey.ok)
			return consoleJson({ error: 'no_signing_key', message: signingKey.message }, 500);
		const report: QuickbooksPressReport = {
			press,
			url: await mintConnectLink({
				secret: signingKey.secret,
				origin: connectFlowOrigin(readAuthEnv(env), new URL(request.url)),
				now: new Date()
			})
		};
		return consoleJson(report);
	}

	if (press === 'disconnect') {
		// revoked first and deleted whatever that answered — $lib/server/accounting/provider.ts
		// argues it at the arm, and a row kept over a failed revoke would be a connection nothing can
		// use. what the revoke answered is still said, because a grant left live at Intuit is only
		// ended from Intuit's side.
		const revoked = await createAccountingProvider(env, db).revokeTokens();
		await disconnectQuickbooks(db);
		const report: QuickbooksPressReport = {
			press,
			revoke: revoked.ok
				? { state: 'revoked' }
				: {
						state: 'not_revoked',
						detail: revoked.detail,
						// where QuickBooks Online lists a company's connected apps
						// (https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/technical-requirements).
						fix:
							'This deployment no longer holds the connection, but Intuit may still list the app ' +
							'as connected. In QuickBooks Online, open Apps, then My Apps, and disconnect it there.'
					}
		};
		return consoleJson(report);
	}

	// every press left needs a company: two of them write onto the connection row, one queues gifts
	// again for a deployment that has nowhere to send them, and the preview answers for a move that
	// could not be made. connecting and disconnecting are above this line because both have to work
	// with no row at all.
	if ((await readQuickbooksConnection(db)) === null) return notConnected();

	if (press === 'retry') {
		const report: QuickbooksPressReport = { press, retried: await retryFailedEntries(db) };
		return consoleJson(report);
	}

	if (press === 'start-date' || press === 'start-date-preview') {
		const startAt = strictInstant(body.startAt);
		if (startAt === null)
			return badBody(
				`\`startAt\` is ${JSON.stringify(body.startAt) ?? 'missing'}, which is not a date. Send ` +
					'a calendar date as YYYY-MM-DD, or an ISO-8601 instant with its offset, such as ' +
					'2026-04-01T00:00:00.000Z.'
			);
		if (press === 'start-date') {
			await moveQuickbooksStartAt(db, startAt, new Date());
			return consoleJson({ press } satisfies QuickbooksPressReport);
		}
		const move = await previewQuickbooksStartAt(db, startAt, new Date());
		const report: QuickbooksPressReport = {
			press,
			startAt: startAt.toISOString(),
			queues: startAtSide(move.queues),
			drops: startAtSide(move.drops)
		};
		return consoleJson(report);
	}

	// what is left is the `accounts` press, and the chart is read before anything is stored: the
	// names beside the ids are the company's own words rather than the caller's.
	const chart = await createAccountingProvider(env, db).listAccounts();
	if (!chart.ok)
		return consoleJson(
			{
				error: 'accounts_unreadable',
				message: chart.detail,
				fix: 'Read the chart of accounts again once that is fixed, then pick the accounts.'
			},
			502
		);

	const picked = pickedAccounts(body, chart.value);
	if (picked.state === 'misfit') return misfit(picked.role, picked.account);
	if (picked.state === 'absent')
		return consoleJson(
			{
				error: 'bad_body',
				message:
					'`income` and `fee` each have to name an account in the connected company’s own ' +
					`chart of accounts, and ${HOLDING_ROLES.map((role) => `\`${role}\``).join(', ')} ` +
					'each have to name one or be null.',
				fix: 'Read this address again for the chart, and send the `id` of one of its accounts for every role, or null for a holding nobody takes gifts into.'
			},
			400
		);

	await saveQuickbooksAccounts(db, picked.accounts);
	return consoleJson({ press } satisfies QuickbooksPressReport);
}

/** the connection as the console draws it, or the ordinary state of a fork nobody has connected. */
function connectionLine(connection: QuickbooksConnectionView | null): QuickbooksConnectionLine {
	if (connection === null) return { state: 'disconnected' };
	return {
		state: 'connected',
		realmId: connection.realmId,
		companyName: connection.companyName,
		...connection.accounts,
		awaitingAccounts: connection.movedAt !== null,
		startAt: connection.startAt.toISOString()
	};
}

/** one side of a start-date move with its dates as instants on the wire. */
function startAtSide(side: StartAtMoveSide): QuickbooksStartAtSide {
	return {
		gifts: side.gifts,
		corrections: side.corrections,
		reversals: side.reversals,
		earliest: side.earliest?.toISOString() ?? null,
		latest: side.latest?.toISOString() ?? null
	};
}

/** the company's own chart, or the deployment's sentence about why it could not be read. */
async function accountsReading(env: unknown, db: Db): Promise<QuickbooksAccountsReading> {
	const chart = await createAccountingProvider(env, db).listAccounts();
	if (!chart.ok)
		return { state: 'unreadable', recourse: recourseFor(chart.reason), detail: chart.detail };
	return { state: 'read', accounts: chart.value.map(accountLine) };
}

/** one account as the picker offers it, with the roles it may be picked for. */
function accountLine(account: LedgerAccount): LedgerAccountLine {
	return { ...account, roles: QUICKBOOKS_ACCOUNT_ROLES.filter((role) => fitsRole(account, role)) };
}

/**
 * what an operator does about a chart that could not be read, off the reason the port answered
 * with.
 *
 * only the two the operator's next move differs on are named, and every other reason answers
 * `null`: the console draws the move and not the fault, so a reason mapped to a move nobody can
 * make would be a sentence telling somebody to do something about a rate limit.
 */
function recourseFor(reason: AccountingFailureReason): QuickbooksRecourse | null {
	if (reason === 'reconnect_needed') return 'reconnect';
	if (reason === 'unreachable') return 'wait';
	return null;
}

/**
 * the picks as the connection stores them — or `absent` where a role is left out of the body or
 * names an account the company's books do not hold, or `misfit` where one names an account whose
 * type does not fit that role ($lib/server/accounting/quickbooks-accounts.ts).
 *
 * every role is named, because the save is the operator's whole answer
 * ($lib/server/accounting/connection.ts): income and fees an id each, and each holding an id or
 * null. a holding missing from the body is refused rather than read as null, so a console that
 * knows fewer roles than this deployment cannot clear the rest by leaving them out.
 */
function pickedAccounts(
	body: Record<string, unknown>,
	chart: readonly LedgerAccount[]
):
	| { state: 'picked'; accounts: SavedAccounts }
	| { state: 'absent' }
	| { state: 'misfit'; role: AccountRole; account: LedgerAccount } {
	const income = inChart(body.income, chart);
	const fee = inChart(body.fee, chart);
	if (income === undefined || fee === undefined) return { state: 'absent' };

	const holdings: Partial<Record<HoldingRole, LedgerAccount | null>> = {};
	for (const role of HOLDING_ROLES) {
		if (!(role in body)) return { state: 'absent' };
		const sent = body[role];
		if (sent === null) {
			holdings[role] = null;
			continue;
		}
		const account = inChart(sent, chart);
		if (account === undefined) return { state: 'absent' };
		holdings[role] = account;
	}

	const accounts: Record<AccountRole, LedgerAccount | null> = {
		income,
		fee,
		...(holdings as Record<HoldingRole, LedgerAccount | null>)
	};
	for (const role of QUICKBOOKS_ACCOUNT_ROLES) {
		const account = accounts[role];
		if (account !== null && !fitsRole(account, role)) return { state: 'misfit', role, account };
	}
	return {
		state: 'picked',
		accounts: {
			income: chosen(income),
			fee: chosen(fee),
			...(Object.fromEntries(
				HOLDING_ROLES.map((role) => {
					const account = accounts[role];
					return [role, account === null ? null : chosen(account)];
				})
			) as Record<HoldingRole, ChosenAccount | null>)
		}
	};
}

/** one id, as the account the company's books hold under it. */
function inChart(id: unknown, chart: readonly LedgerAccount[]): LedgerAccount | undefined {
	return chart.find((entry) => entry.id === id);
}

/** the account as the connection stores it: the id to post to and the company's own name for it. */
const chosen = (account: LedgerAccount): ChosenAccount => ({ id: account.id, name: account.name });

/**
 * a pick the company holds in a place this deployment will not post to.
 *
 * 400 like the pick the books do not hold: the body named it, and a different id is the fix.
 */
function misfit(role: AccountRole, account: LedgerAccount): Response {
	const takes = [...ROLE_TYPES[role]].join(' or ');
	const label = ROLE_LABELS[role];

	if (isHoldingRole(role) && account.type === 'Bank')
		return consoleJson(
			{
				error: 'account_wrong_type',
				message:
					`\`${role}\` names ${account.name}, a Bank account. ${label} is where a gift waits ` +
					'until it is paid out or banked, and this deployment sends QuickBooks no payout, so ' +
					'a gift posted to the bank is a deposit the bank feed never shows. Record each payout ' +
					'from the bank feed as a transfer out of this account instead.',
				fix: `Send the \`id\` of an ${takes} account for \`${role}\`, such as one named ${label}.`
			},
			400
		);

	if (isHoldingRole(role) && account.subType === UNDEPOSITED_FUNDS)
		return consoleJson(
			{
				error: 'account_wrong_type',
				message:
					`\`${role}\` names ${account.name}, which holds the gifts received in hand until they ` +
					`are banked. ${label} needs an account of its own, so what it holds says what the ` +
					'processor still owes.',
				fix: `Send the \`id\` of another ${takes} account for \`${role}\`, such as one named ${label}.`
			},
			400
		);

	return consoleJson(
		{
			error: 'account_wrong_type',
			message:
				`\`${role}\` names ${account.name}, whose type is ${account.type}, and what is posted ` +
				`to ${label} there lands on the wrong statement. \`${role}\` takes an account of type ${takes}.`,
			fix: `Send the \`id\` of an account of type ${takes} from the company’s chart for \`${role}\`.`
		},
		400
	);
}

/** the body as an object, or null where it is not one. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return null;
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
	return body as Record<string, unknown>;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * `startAt` as an instant, or null where it is not exactly a calendar date (its first moment in
 * UTC) or a full ISO-8601 instant with its offset.
 *
 * `new Date` is never the reader: it takes "April 1" and `1` as 2001 and rolls 2026-02-31 into
 * March, and a start date moved to 2001 queues every gift the deployment has ever taken. so each
 * field is read on its own and has to come back out of `Date.UTC` unchanged.
 */
function strictInstant(sent: unknown): Date | null {
	if (typeof sent !== 'string') return null;
	const fields = CALENDAR_DATE.exec(sent) ?? INSTANT.exec(sent);
	if (fields === null) return null;
	const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '', sign, oh, om] =
		fields;
	const [offsetHours, offsetMinutes] = [Number(oh ?? 0), Number(om ?? 0)];
	if (offsetHours > 23 || offsetMinutes > 59) return null;
	const wall = new Date(
		Date.UTC(
			Number(year),
			Number(month) - 1,
			Number(day),
			Number(hour),
			Number(minute),
			Number(second),
			Number(fraction.padEnd(3, '0').slice(0, 3))
		)
	);
	const survived =
		wall.getUTCFullYear() === Number(year) &&
		wall.getUTCMonth() === Number(month) - 1 &&
		wall.getUTCDate() === Number(day) &&
		wall.getUTCHours() === Number(hour) &&
		wall.getUTCMinutes() === Number(minute) &&
		wall.getUTCSeconds() === Number(second);
	if (!survived) return null;
	const offset = (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
	return new Date(wall.getTime() - offset);
}

const badBody = (message: string): Response =>
	consoleJson({ error: 'bad_body', message, fix: PRESS_BODY_FIX }, 400);

/**
 * the press that cannot happen because there is nothing to act on.
 *
 * 409 rather than 400 for ./console.recurring.ts's reason: nothing the caller sent is wrong, and no
 * body they could send moves it — what does is connecting a company.
 */
const notConnected = (): Response =>
	consoleJson(
		{
			error: 'not_connected',
			message: 'No QuickBooks company is connected to this deployment.',
			fix: 'Press Connect, open the address it answers with, and choose a company at Intuit.'
		},
		409
	);
