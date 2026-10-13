import { Button } from '@better-giving/operator/components/controls/Button';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Form } from 'react-router';
import { operatorLinks } from '$lib/admin/operator-links';
import { STAFF_USER_ID } from '$lib/server/auth';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { listConnections, revokeConnectorKey } from '$lib/server/connector/keys';
import { notFound } from '$lib/server/db/load-failure';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.connector';

// the connections from Claude and ChatGPT through Better Giving's connector: one row per connection,
// each with Disconnect, which revokes its key at once ($lib/server/connector/keys.ts) — the next
// request the connector sends on it is refused `key_refused`, and the chat tells the operator to
// connect again. a connection is made only from the chat, through the Allow screen
// (./_app.admin.connector.allow.tsx); nothing here makes one. deployer-only, as every screen under
// Integrations is.

const NOT_HERE = 'Only the person who set up this deployment can see its connections.';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Claude & ChatGPT' }];
}

export async function loader({ context }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const rows = await listConnections(context.get(database));
	return {
		connections: rows.map((row) => ({
			id: row.id,
			key: `${row.prefix}…${row.lastFour}`,
			createdAt: row.createdAt.toISOString(),
			lastUsedAt: row.lastUsedAt?.toISOString() ?? null
		}))
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const id = (await request.formData()).get('connection');
	if (typeof id !== 'string') return { disconnected: false };
	return { disconnected: await revokeConnectorKey(context.get(database), id, 'dashboard') };
}

const day = (iso: string) => iso.slice(0, 10);

export default function ConnectorConnections({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<PanelRoute>
			<h1>Claude &amp; ChatGPT</h1>
			{actionData?.disconnected ? (
				<Banner tone="done" word="Disconnected">
					That connection can no longer reach this deployment.
				</Banner>
			) : null}
			{loaderData.connections.length === 0 ? (
				<p>
					Nothing is connected. To connect, add Better Giving in Claude or ChatGPT and type your
					donation page’s address there.
				</p>
			) : (
				<Stack>
					{loaderData.connections.map((connection) => (
						<Form method="post" key={connection.id} className="adm-actions">
							<span>
								Connected {day(connection.createdAt)} · key {connection.key}
								{connection.lastUsedAt
									? ` · last used ${day(connection.lastUsedAt)}`
									: ' · not used yet'}
							</span>
							<input type="hidden" name="connection" value={connection.id} />
							<Button>Disconnect</Button>
						</Form>
					))}
				</Stack>
			)}
		</PanelRoute>
	);
}
