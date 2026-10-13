import { Button } from '@better-giving/operator/components/controls/Button';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Form, redirect } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { STAFF_USER_ID } from '$lib/server/auth';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { issueCode } from '$lib/server/connector/keys';
import { connectorOrigin } from '$lib/server/connector/origin';
import { CONNECTOR_RETURN } from '$lib/server/connector/surface';
import { notFound } from '$lib/server/db/load-failure';
import { readOrgProfile } from '$lib/server/org/queries';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.connector.allow';

// the Allow screen: where Better Giving's connector sends an operator who asked Claude or ChatGPT to
// connect to this deployment. it sits behind the dashboard's own sign-in (./_app.tsx's gate sends a
// signed-out operator to sign in and back here), so the deployment's sign-in is the only login there
// is. Allow issues a single-use code ($lib/server/connector/keys.ts) and sends the browser to the
// connector's return — `CONNECTOR_RETURN`, fixed in code — with it; Deny sends it there with
// `error=access_denied`. both carry `iss`, this deployment's published origin, so the connector can
// refuse a return arriving from a deployment other than the one it bound `state` to (RFC 9207).
// the key itself is minted only when the connector redeems the code (./connector.v1.exchange.ts).
// a route action, so no auth HTTP API is added (CLAUDE.md → Product surface).
//
// **only the deployer reaches it**, as with every screen under Integrations: a connection reads
// donors and can publish pages, which is the deployer's to hand out.

/** an opaque `state` the connector sends and gets back; bounded, so nothing long is echoed. */
const STATE = /^[A-Za-z0-9._~-]{1,512}$/;

const NOT_HERE = 'Only the person who set up this deployment can connect it to Claude or ChatGPT.';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Connect Claude or ChatGPT' }];
}

function readState(url: URL): string | null {
	const state = url.searchParams.get('state');
	return state !== null && STATE.test(state) ? state : null;
}

export async function loader({ context, url }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const profile = await readOrgProfile(context.get(database));
	return { orgName: profile?.legalName ?? null, state: readState(url) };
}

export async function action({ context, request, url }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const state = readState(url);
	if (state === null)
		return {
			error:
				'This link is missing what Claude or ChatGPT needs back. Start connecting again from the chat.'
		};
	const back = new URL(CONNECTOR_RETURN);
	back.searchParams.set('state', state);
	back.searchParams.set('iss', connectorOrigin(url, context.get(platform).env));
	const body = await request.formData();
	if (body.get('intent') === 'allow') {
		back.searchParams.set('code', await issueCode(context.get(database), context.get(staff).id));
	} else {
		back.searchParams.set('error', 'access_denied');
	}
	throw redirect(back.href, 303);
}

export default function ConnectorAllow({ loaderData, actionData }: Route.ComponentProps) {
	const who = loaderData.orgName ?? 'this organisation';
	return (
		<PanelRoute>
			<Stack tight>
				{loaderData.orgName ? <p className="adm-caption">{loaderData.orgName}</p> : null}
				<h1>Connect Claude or ChatGPT</h1>
			</Stack>
			{loaderData.state === null || (actionData && 'error' in actionData) ? (
				<Banner tone="blocker" word="Can’t connect from this link">
					{actionData?.error ??
						'This link is missing what Claude or ChatGPT needs back. Start connecting again from the chat.'}
				</Banner>
			) : (
				<Stack>
					<p>
						Better Giving’s connector is asking to act for {who} from your Claude or ChatGPT. Once
						you allow it, the chat can:
					</p>
					<ul>
						<li>make, edit, publish and end campaigns, and edit the donation page and forms</li>
						<li>read your results, gifts and recurring gifts</li>
						<li>read your donors’ names and email addresses</li>
						<li>add a photo to a page through a link it gives you</li>
					</ul>
					<p>
						It can’t refund a gift, change a donor’s monthly gift, or touch anything set up in the
						console. You can disconnect it at any time under Integrations.
					</p>
					<Form method="post" className="adm-actions">
						<Button variant="primary" name="intent" value="allow">
							Allow
						</Button>
						<Button name="intent" value="deny">
							Don’t allow
						</Button>
					</Form>
				</Stack>
			)}
		</PanelRoute>
	);
}
