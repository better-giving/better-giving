import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { data, redirect } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { APP_NAME } from '$lib/admin/screen-title';
import {
	connectFlowOrigin,
	connectStateCookie,
	mintConnectState,
	QUICKBOOKS_CALLBACK_PATH,
	readConnectLink
} from '$lib/server/accounting/connect-link';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { readAuthEnv, resolveAuthSecret } from '$lib/server/auth';
import { database, platform } from '../context';
import type { Route } from './+types/quickbooks.connect';

// where connecting a QuickBooks company begins: the operator's browser lands here and is sent on to
// Intuit's consent screen.
//
// **it is public, and the guard is on the address rather than on the surface.** it cannot sit
// behind the dashboard's login — the operator is holding the console, which is a different sign-in
// — and it cannot sit on the console's own wire surface, because what has to happen here is a
// browser redirect and the console's credential is a bearer header a browser attaches to nothing.
// so the console mints a short-lived signed address and this route checks it
// ($lib/server/accounting/connect-link.ts), and ../routes.spec.ts holds the file on the public list
// with that reason beside it.
//
// what an unguarded one would cost is the whole of why it is guarded: whoever opens this is sent to
// Intuit and comes back with a company connected, so a stranger would connect *their* books and
// this organisation's gifts would be posted into them.
//
// **the `state` is minted here and not on the console.** it has to be in a cookie on the browser
// that is about to travel, and the console is not that browser. a replayed start address therefore
// mints a fresh one, which is exactly what makes replaying it worth nothing.
//
// **the `redirect_uri` sent to Intuit is the deployment's own address rather than this request's
// host.** it has to be the one registered with them, byte for byte, or the round trip is refused at
// their end — and a deployment answering on a second hostname can be opened at one it never
// registered. $lib/server/accounting/connect-link.ts holds that address for every spelling of it.
//
// the page below is drawn on the refusal arms alone — a start that landed is a redirect and renders
// nothing.

export const links = operatorLinks;

/**
 * a start that landed is a redirect and renders no document, so this names one of the two refusals
 * below rather than the trip out — which is the only thing a reader of this tab is ever looking at.
 *
 * the organisation's own name is not in it: this route stands outside the dashboard's layout, which
 * is where that name is read from ($lib/admin/screen-title.ts), and a browser mid-consent has no
 * session to read it with.
 */
export function meta(): Route.MetaDescriptors {
	return [{ title: `Connect QuickBooks · ${APP_NAME}` }];
}

/** what a browser that cannot be sent on is told, and there are only two reasons it cannot be. */
type Refusal = 'link' | 'setup';

export async function loader({ context, request }: Route.LoaderArgs) {
	const { env } = context.get(platform);
	const db = context.get(database);
	const url = new URL(request.url);

	const authEnv = readAuthEnv(env);
	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		// 500 for $lib/server/auth/gate.ts's reason: nothing the caller sent is wrong, and the
		// message names the table and the command that mints the row.
		throw data(signingKey.message, { status: 500 });
	}

	if (!(await readConnectLink({ secret: signingKey.secret, url, now: new Date() }))) {
		// one answer for absent, altered and expired alike: they are the same thing to do next, and
		// telling a forgery apart from a stale link in the answer would be this deployment reporting
		// on the attempt to whoever made it.
		return data({ refusal: 'link' as Refusal }, { status: 403 });
	}

	const state = mintConnectState();
	const started = await createAccountingProvider(env, db).authorizeUrl({
		redirectUri: `${connectFlowOrigin(authEnv, url)}${QUICKBOOKS_CALLBACK_PATH}`,
		state
	});
	// a deployment short of Intuit's credentials is refused by the port rather than by a read of the
	// values here: $lib/server/accounting/factory.ts owns what a half-configured deployment is told,
	// and a second reader would be a second answer to the same absence. 409 rather than 400: nothing
	// the caller sent is wrong and no value they could send would fix it.
	if (!started.ok) return data({ refusal: 'setup' as Refusal }, { status: 409 });

	return redirect(started.value, { headers: { 'set-cookie': connectStateCookie(state) } });
}

/**
 * the page a browser that was not sent on is left looking at.
 *
 * it draws no control, and that is the shape rather than an omission: what repairs either arm is on
 * the console, on the machine the operator opened this from, and a press here could only be a
 * second start address minted by the thing that already refused this one.
 */
export default function QuickbooksConnect({ loaderData }: Route.ComponentProps) {
	if (loaderData.refusal === 'setup') {
		return (
			<PanelRoute>
				<h1>This deployment has no QuickBooks credentials</h1>
				<p className="adm-prose">
					Put your Intuit app’s credentials in on the console, then try again.
				</p>
			</PanelRoute>
		);
	}

	return (
		<PanelRoute>
			<h1>This link has expired</h1>
			<p className="adm-prose">Go back to the console for a new one.</p>
		</PanelRoute>
	);
}
