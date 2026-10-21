import { Button } from '@better-giving/operator/components/controls/Button';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { data } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { APP_NAME } from '$lib/admin/screen-title';
import {
	CLEARED_CONNECT_STATE_COOKIE,
	connectFlowOrigin,
	connectStateFrom,
	QUICKBOOKS_CALLBACK_PATH
} from '$lib/server/accounting/connect-link';
import {
	connectQuickbooks,
	fillAccountsFromChart,
	saveQuickbooksCompanyName
} from '$lib/server/accounting/connection';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { queueOwedReversals } from '$lib/server/accounting/outbox';
import { readAuthEnv } from '$lib/server/auth';
import { servedProcessors } from '$lib/server/payments/factory';
import { secretEquals } from '$lib/server/secret-compare';
import { database, platform } from '../context';
import type { Route } from './+types/quickbooks.callback';

// where Intuit sends the operator's browser back, and where the company becomes connected.
//
// public for ./quickbooks.connect.tsx's reason and named on ../routes.spec.ts's list with it: the
// caller is a browser arriving from somebody else's site, holding no session this deployment could
// ask for. what stands in for one is the `state` that went out in a cookie on that same browser,
// checked before anything is exchanged ($lib/server/accounting/connect-link.ts).
//
// **the cookie is what makes the round trip single-use.** the start address is signed rather than
// spendable — nothing is spendable once without storage — so what cannot happen twice is this: the
// cookie is cleared on every arm below, and a second arrival carrying the same `state` has nothing
// left to match against.
//
// **the code is exchanged once and the connection is written before anything else is asked.** a
// code presented twice can invalidate the tokens it already issued
// ($lib/server/accounting/provider.ts), so the order is fixed: check the `state`, take the realm off
// the redirect, exchange, write. what comes after is the queue and a label.
//
// **a refund or dispute the books took while nothing was connected is queued once the connection
// is written.** its own gate found no company, so a reconnect to the company holding its gift is the
// moment it is owed there ($lib/server/accounting/outbox.ts's `queueOwedReversals`); against any
// other company it queues nothing, because that company's books do not hold the gift.
//
// **the company's name is read afterwards and its failure changes nothing.** the connection is the
// tokens and the realm; the name is what an operator reads to tell they connected the books they
// meant to. a read that did not land leaves the row exactly as connected as it was, with the name
// null until something reads it again ($lib/server/accounting/connection.ts).
//
// **the accounts are filled from the company's own chart, afterwards and on the same terms.** an
// operator connecting books has nothing picked, and a connection with nothing picked sends nothing;
// so each role the chart names an account for ($lib/server/accounting/quickbooks-accounts.ts) is
// saved and the pickers on Books open on it, and each processor this deployment takes gifts
// through whose holding the chart names none for is given one ($lib/server/accounting/connection.ts).
// a role left unpicked holds the gifts that need it until the operator picks it on Books. a
// chart that could not be read, or a fault anywhere in the fill, leaves every role unpicked and logs
// why. a reconnect to the same company keeps what was picked before, and nothing overwrites it.
//
// **a trip back naming a different company fills nothing.** the connect clears the old company's
// accounts, and those unpicked accounts are the one thing holding every queued gift — donor names
// and addresses among them — out of books nobody has yet said are the right ones. filling them from
// the new chart would release that backlog within a minute of a wrong pick in Intuit's company
// list. so the move is stored, the page names both companies, and sending waits for an operator
// to choose on Books — across every reconnect in between, since the move is written on the
// row and only an operator's save clears it. a reconnect while it stands draws the same page, with
// no previous company to name.
//
// **it ends on a page rather than a redirect into Books.** what happened at Intuit — a different
// company, a cancel, a refusal — is said once, here, where the trip ended, and every arm leads back
// to Books, where whatever is left to do is.

export const links = operatorLinks;

/**
 * the outcome, because this is the one page of the trip anybody reads.
 *
 * the company is not named even where it is known: a tab title is read in a strip of them, and the
 * one thing worth telling apart there is whether the trip worked.
 */
export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	const said =
		loaderData.outcome === 'refused' ? 'QuickBooks not connected' : 'QuickBooks connected';
	return [{ title: `${said} · ${APP_NAME}` }];
}

/**
 * why a trip back was refused.
 *
 *   state       — the browser carried no `state` cookie, or not the one that went out. the round
 *                 trip was not this deployment's, or it has already been spent.
 *   cancelled   — the operator cancelled on Intuit's consent screen, which comes back as
 *                 `error=access_denied` and no code (RFC 6749 §4.1.2.1).
 *   unavailable — Intuit came back with `temporarily_unavailable` or `server_error`: its trouble,
 *                 and a later try is the whole of the fix.
 *   request     — Intuit came back with any other `error`, or sent no code, or named no company.
 *   exchange    — the code could not be exchanged. the port's reason and detail are logged; neither
 *                 is shown, because this page is read by whoever holds the tab.
 *
 * every refusal but a cancel is logged with the `error` Intuit sent: a cancel is the operator's own
 * choice, and every other one is something whoever runs the deployment may be asked about.
 */
type Refusal = 'state' | 'cancelled' | 'unavailable' | 'request' | 'exchange';

/** RFC 6749 §4.1.2.1's two errors that say the authorization server is the trouble. */
const INTUIT_TROUBLE = new Set(['temporarily_unavailable', 'server_error']);

// the query is anybody's to write, so what reaches the log is clipped.
const LOGGED_ERROR_MAX = 64;

export async function loader({ context, request }: Route.LoaderArgs) {
	// every answer carries it: what makes this trip unrepeatable is the cookie being gone
	// afterwards. inside the handler rather than at module scope, because this module ships a
	// component and a bundler keeps a module-scope binding after dropping the export that used it
	// (../routes.spec.ts).
	const spent = { 'set-cookie': CLEARED_CONNECT_STATE_COOKIE };
	const url = new URL(request.url);
	const error = url.searchParams.get('error');
	const refused = (refusal: Refusal, status: number, ...cause: string[]) => {
		if (refusal !== 'cancelled')
			console.error(
				`quickbooks connect: refused (${refusal}), error=${error?.slice(0, LOGGED_ERROR_MAX) ?? 'none'}`,
				...cause
			);
		return data({ outcome: 'refused' as const, refusal }, { status, headers: spent });
	};

	const sent = connectStateFrom(request.headers);
	const returned = url.searchParams.get('state');
	if (sent === null || returned === null || !secretEquals(sent, returned)) {
		return refused('state', 403);
	}

	if (error === 'access_denied') return refused('cancelled', 400);
	if (error !== null && INTUIT_TROUBLE.has(error)) return refused('unavailable', 503);
	if (error !== null) return refused('request', 400);

	const code = url.searchParams.get('code');
	// Intuit names the company on the redirect rather than inside the token, and it is what every
	// later call is addressed to — so a trip back without one connects nothing.
	const realmId = url.searchParams.get('realmId');
	if (code === null || realmId === null) return refused('request', 400);

	const db = context.get(database);
	const { env } = context.get(platform);
	const provider = createAccountingProvider(env, db);

	const tokens = await provider.exchangeCode({
		code,
		// byte for byte what ./quickbooks.connect.tsx sent, which is what Intuit compares it against.
		// the host this request arrived on is not that: Intuit sends the browser to the address it
		// holds, and a deployment answering on a second hostname could be reached at one it was never
		// registered with ($lib/server/accounting/connect-link.ts).
		redirectUri: `${connectFlowOrigin(readAuthEnv(env), url)}${QUICKBOOKS_CALLBACK_PATH}`
	});
	// 502 rather than 400: the code was Intuit's to issue and this deployment's to spend, and
	// nothing the browser carried is what went wrong.
	if (!tokens.ok) {
		return refused('exchange', 502, tokens.reason, tokens.detail);
	}

	const connectedAt = new Date();
	const before = await connectQuickbooks(db, {
		realmId,
		tokens: tokens.value,
		startAt: connectedAt
	});
	await queueOwedReversals(db, connectedAt);

	const company = await provider.readCompany();
	if (company.ok) await saveQuickbooksCompanyName(db, company.value.companyName);
	const companyName = company.ok ? company.value.companyName : null;

	if (before !== null && (before.realmId !== realmId || before.movedAt !== null)) {
		const previousCompanyName = before.realmId === realmId ? null : before.companyName;
		return data(
			{ outcome: 'switched' as const, previousCompanyName, companyName },
			{ headers: spent }
		);
	}

	await fillAccountsFromChart(db, provider, realmId, servedProcessors(env).configured);
	return data({ outcome: 'connected' as const, companyName }, { headers: spent });
}

/** where every page of the round trip leads back to: the Books screen, at its QuickBooks half. */
const BOOKS = '/admin/books#quickbooks';

/**
 * the end of the trip, and the only page in this flow anybody reads on the way through. every arm
 * leads back to Books, where the trip began and where what is left to do is.
 */
export default function QuickbooksCallback({ loaderData }: Route.ComponentProps) {
	if (loaderData.outcome === 'connected') {
		return (
			<PanelRoute>
				<h1>
					{loaderData.companyName === null
						? 'QuickBooks is connected'
						: `${loaderData.companyName} is connected`}
				</h1>
				<BackToBooks />
			</PanelRoute>
		);
	}

	if (loaderData.outcome === 'switched') {
		return (
			<PanelRoute>
				<h1>QuickBooks is connected to a different company</h1>
				<p className="adm-prose">
					{`The connection moved from ${loaderData.previousCompanyName ?? 'the company connected before'} to ${loaderData.companyName ?? 'a company QuickBooks hasn’t named yet'}.`}
				</p>
				<p className="adm-prose">
					Go to Books and choose the accounts again. Nothing is sent to QuickBooks until you do.
				</p>
				<BackToBooks />
			</PanelRoute>
		);
	}

	if (loaderData.refusal === 'state') {
		return (
			<PanelRoute>
				<h1>This link has already been used or has expired</h1>
				<p className="adm-prose">Start again from Books.</p>
				<BackToBooks />
			</PanelRoute>
		);
	}

	if (loaderData.refusal === 'unavailable') {
		return (
			<PanelRoute>
				<h1>QuickBooks isn’t connected</h1>
				<p className="adm-prose">Intuit is having trouble.</p>
				<p className="adm-prose">Try again from Books in a few minutes.</p>
				<BackToBooks />
			</PanelRoute>
		);
	}

	return (
		<PanelRoute>
			<h1>QuickBooks isn’t connected</h1>
			<p className="adm-prose">
				{loaderData.refusal === 'cancelled'
					? 'You cancelled at Intuit.'
					: 'Intuit turned the connection down.'}
			</p>
			<p className="adm-prose">Try again from Books.</p>
			<BackToBooks />
		</PanelRoute>
	);
}

/**
 * the one control every page of the round trip carries: a whole-document load, since this page
 * stands outside the dashboard's layout and its session.
 */
function BackToBooks() {
	return (
		<div className="adm-actions">
			<Button as="a" href={BOOKS}>
				Back to Books
			</Button>
		</div>
	);
}
