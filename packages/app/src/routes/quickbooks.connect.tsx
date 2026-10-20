import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { data, redirect } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { APP_NAME } from '$lib/admin/screen-title';
import {
	carriesConnectLink,
	connectFlowOrigin,
	connectStateCookie,
	mintConnectState,
	QUICKBOOKS_CALLBACK_PATH,
	readConnectLink
} from '$lib/server/accounting/connect-link';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { readAuthEnv, resolveAuthSecret } from '$lib/server/auth';
import { SIGNING_KEY_UNREADABLE } from '$lib/server/auth/signing-key';
import { database, platform } from '../context';
import type { Route } from './+types/quickbooks.connect';

// where connecting a QuickBooks company begins: the operator's browser lands here and is sent on to
// Intuit's consent screen.
//
// **it is public, and the guard is on the address rather than on the surface.** two surfaces start
// the trip behind two different credentials — the deployer's press on ./_app.admin.books.tsx, and
// the console, whose credential is a bearer header a browser attaches to nothing — so each mints a
// short-lived signed address behind its own and this route checks it
// ($lib/server/accounting/connect-link.ts), and ../routes.spec.ts holds the file on the public list
// with that reason beside it.
//
// what an unguarded one would cost is the whole of why it is guarded: whoever opens this is sent to
// Intuit and comes back with a company connected, so a stranger would connect *their* books and
// this organisation's gifts would be posted into them.
//
// **the `state` is minted here and not by the press that minted the address.** it has to be in a
// cookie on the browser that is about to travel, and the console is not that browser. a replayed
// start address therefore mints a fresh one, which is exactly what makes replaying it worth nothing.
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
	const linkRefused = () => data({ refusal: 'link' as Refusal }, { status: 403 });
	// the same refusal as an altered link's, before the key is read: a probe of the bare path costs
	// no database read.
	if (!carriesConnectLink(url)) return linkRefused();

	const authEnv = readAuthEnv(env);
	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		// 500 for $lib/server/auth/gate.ts's reasons: nothing the caller sent is wrong, and whoever
		// opened the address holds no session, so the cause, which can quote the database's own
		// error, goes to the logs and the browser is told the shared reply.
		console.error(
			'a QuickBooks connect address could not be checked — no signing key:',
			signingKey.cause
		);
		throw data(SIGNING_KEY_UNREADABLE, { status: 500 });
	}

	if (!(await readConnectLink({ secret: signingKey.secret, url, now: new Date() }))) {
		// one answer for absent, altered and expired alike: they are the same thing to do next, and
		// telling a forgery apart from a stale link in the answer would be this deployment reporting
		// on the attempt to whoever made it.
		return linkRefused();
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

/** where every page of the round trip leads back to: the Books screen, at its QuickBooks half. */
const BOOKS = '/admin/books#quickbooks';

/**
 * the page a browser that was not sent on is left looking at, and the way back to Books — where
 * the press that starts the trip is.
 */
export default function QuickbooksConnect({ loaderData }: Route.ComponentProps) {
	if (loaderData.refusal === 'setup') {
		return (
			<PanelRoute>
				<h1>This deployment has no QuickBooks keys</h1>
				<Banner
					word="Needs an Intuit app’s keys on the server"
					body={
						<>
							<h2 className="adm-banner__head">For whoever runs the server</h2>
							<p>
								Create an app at <a href={INTUIT_DEVELOPER}>Intuit Developer</a>, add the redirect
								address Books shows to its redirect URIs, put its client ID and secret in{' '}
								<InlineCode>.env</InlineCode> (DEPLOY.md, QuickBooks), and recreate the app:
							</p>
							<CodeSlab oneline content={RECREATE} copyable copyLabel="Copy the command" />
						</>
					}
				>
					To send gifts to QuickBooks, this site needs an Intuit app. Ask whoever set up this site
					to add it. The steps below are for them.
				</Banner>
				<BackToBooks />
			</PanelRoute>
		);
	}

	return (
		<PanelRoute>
			<h1>This link has expired</h1>
			<p className="adm-prose">Start again from Books.</p>
			<BackToBooks />
		</PanelRoute>
	);
}

/** where an operator creates the Intuit app whose keys go in `.env`. */
const INTUIT_DEVELOPER = 'https://developer.intuit.com/';

/** what recreating the app is, wherever `.env` changed. */
const RECREATE = 'docker compose up -d --force-recreate app';

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
