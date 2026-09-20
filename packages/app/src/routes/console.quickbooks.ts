import type {
	QuickbooksAccountsReading,
	QuickbooksConnectionLine,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_PRESSES } from '@better-giving/operator/console/quickbooks';
import { readQuickbooksBacklog, retryFailedEntries } from '$lib/server/accounting/backlog';
import { QUICKBOOKS_CALLBACK_PATH, mintConnectLink } from '$lib/server/accounting/connect-link';
import {
	disconnectQuickbooks,
	readQuickbooksConnection,
	saveQuickbooksAccounts,
	saveQuickbooksStartAt,
	type ChosenAccount,
	type QuickbooksConnectionView
} from '$lib/server/accounting/connection';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import type { AccountingFailureReason, LedgerAccount } from '$lib/server/accounting/provider';
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
// accounts an operator picks three entries out of can be read here and nowhere else. the console
// never holds a token and never sees one.
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
// **the three accounts are picked by id and the names are read off the company's own chart.** a
// name the caller sent would be a label on this deployment's row that nothing in the books ever
// agreed to, and an id the chart does not hold is refused rather than stored — the same decision
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
	const [connection, backlog] = await Promise.all([
		readQuickbooksConnection(db),
		readQuickbooksBacklog(db)
	]);

	const report: QuickbooksReport = {
		connection: connectionLine(connection),
		accounts: connection === null ? null : await accountsReading(context.get(platform).env, db),
		backlog: {
			failed: backlog.failed,
			oldestWaitingAt: backlog.oldestWaitingAt?.toISOString() ?? null
		},
		callbackAddress: `${new URL(request.url).origin}${QUICKBOOKS_CALLBACK_PATH}`
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
			// the address this deployment answers on, learned from the request that reached it: no
			// hostname is committed to this repository (CLAUDE.md).
			url: await mintConnectLink({
				secret: signingKey.secret,
				origin: new URL(request.url).origin,
				now: new Date()
			})
		};
		return consoleJson(report);
	}

	if (press === 'retry') {
		const report: QuickbooksPressReport = { press, retried: await retryFailedEntries(db) };
		return consoleJson(report);
	}

	if (press === 'disconnect') {
		// revoked first and deleted whatever that answered — $lib/server/accounting/provider.ts
		// argues it at the arm, and a row kept over a failed revoke would be a connection nothing can
		// use.
		await createAccountingProvider(env, db).revokeTokens();
		await disconnectQuickbooks(db);
		return consoleJson({ press } satisfies QuickbooksPressReport);
	}

	// what is left writes onto the connection row, so there has to be one.
	if ((await readQuickbooksConnection(db)) === null) return notConnected();

	if (press === 'start-date') {
		const startAt = new Date(String(body.startAt));
		if (Number.isNaN(startAt.getTime()))
			return badBody('`startAt` is not a date. Send an ISO-8601 instant.');
		await saveQuickbooksStartAt(db, startAt);
		return consoleJson({ press } satisfies QuickbooksPressReport);
	}

	// what is left is the `accounts` press, and the chart is read before anything is stored: the
	// names beside the three ids are the company's own words rather than the caller's.
	const chart = await createAccountingProvider(env, db).listAccounts();
	if (!chart.ok)
		return consoleJson(
			{
				error: 'accounts_unreadable',
				message: chart.detail,
				fix: 'Read the chart of accounts again once that is fixed, then pick the three.'
			},
			502
		);

	const picked = pickedAccounts(body, chart.value);
	if (picked === null)
		return consoleJson(
			{
				error: 'bad_body',
				message:
					'`income`, `fee` and `deposit` each have to name an account in the connected ' +
					'company’s own chart of accounts.',
				fix: 'Read this address again for the chart, and send the `id` of one of its accounts for each of the three.'
			},
			400
		);

	await saveQuickbooksAccounts(db, picked);
	return consoleJson({ press } satisfies QuickbooksPressReport);
}

/** the connection as the console draws it, or the ordinary state of a fork nobody has connected. */
function connectionLine(connection: QuickbooksConnectionView | null): QuickbooksConnectionLine {
	if (connection === null) return { state: 'disconnected' };
	return {
		state: 'connected',
		realmId: connection.realmId,
		companyName: connection.companyName,
		income: connection.income,
		fee: connection.fee,
		deposit: connection.deposit,
		startAt: connection.startAt.toISOString()
	};
}

/** the company's own chart, or the deployment's sentence about why it could not be read. */
async function accountsReading(env: unknown, db: Db): Promise<QuickbooksAccountsReading> {
	const chart = await createAccountingProvider(env, db).listAccounts();
	if (!chart.ok)
		return { state: 'unreadable', recourse: recourseFor(chart.reason), detail: chart.detail };
	return { state: 'read', accounts: chart.value };
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
 * the three picks as the connection stores them, or null where any of the three names an account
 * the company's books do not hold.
 *
 * all three together, because the schema takes them that way and a send needs all three
 * ($lib/server/accounting/connection.ts): a press that saved two of them would leave an operator
 * half-done with nothing saying so.
 */
function pickedAccounts(
	body: Record<string, unknown>,
	chart: readonly LedgerAccount[]
): { income: ChosenAccount; fee: ChosenAccount; deposit: ChosenAccount } | null {
	const income = inChart(body.income, chart);
	const fee = inChart(body.fee, chart);
	const deposit = inChart(body.deposit, chart);
	if (income === null || fee === null || deposit === null) return null;
	return { income, fee, deposit };
}

/** one id, as the account the company's books hold under it. */
function inChart(id: unknown, chart: readonly LedgerAccount[]): ChosenAccount | null {
	const account = chart.find((entry) => entry.id === id);
	return account === undefined ? null : { id: account.id, name: account.name };
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
