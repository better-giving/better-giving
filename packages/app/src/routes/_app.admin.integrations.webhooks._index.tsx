import { UrlText } from '@better-giving/operator/components/data/CodeSlab';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { data, href, Link } from 'react-router';
import { useAfterPaint } from '$lib/admin/after-paint';
import { screenTitle } from '$lib/admin/screen-title';
import { WEBHOOK_EVENT_TYPES } from '$lib/webhooks/catalog';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { listDestinations } from '$lib/server/webhooks/destinations';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.webhooks._index';

// every address this deployment posts signed events to, with how many events each takes and
// whether it is paused. a destination is added on ./_app.admin.integrations.webhooks.new.tsx and
// edited, resumed and deleted on its own page, ./_app.admin.integrations.webhooks.$id.tsx; what a
// destination is is `$lib/server/webhooks/destinations.ts`'s header.
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.integrations.api.tsx
// reads, and a member's GET is answered with the dashboard's not-found.
//
// **no signing secret is on this page**: the list reads none, and the destination's own page is
// the one that shows it.
//
// a delete reports by the state it leaves — the row gone from this list — and says so to a reader
// who cannot see it go: the deleted address rides the redirect as a flash ($lib/server/flash.ts),
// and is written into a status region once the region has been drawn empty
// ($lib/admin/after-paint.ts). the delete was pressed on another page, so this region arrives with
// the landing, and one arriving already holding the words is an insertion nobody announces.

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'Webhooks';

const NOT_HERE =
	'No page at /admin/integrations/webhooks for a member’s session. Webhook destinations are added ' +
	'and changed from the deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

/** how many of the catalog's events a destination takes, as the list says it. */
function eventsTaken(n: number): string {
	if (n === WEBHOOK_EVENT_TYPES.length) return 'All events';
	return `${n} ${n === 1 ? 'event' : 'events'}`;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const destinations = (await listDestinations(context.get(database))).map((destination) => ({
		id: destination.id,
		url: destination.url,
		events: eventsTaken(destination.events.length),
		paused: destination.paused
	}));

	// the delete that just landed, taken: read and cleared on this one response, so a reload says
	// nothing. the marker is the deleted destination's address.
	const landed = await takeFlash(request, SAVED_FLASH);
	return data(
		{ destinations, deleted: landed?.marker ?? null },
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/** the three columns as the Webhooks board draws them; the shares sum to the whole of the table. */
const COLUMNS = [
	{ key: 'url', label: 'Destination', width: '60%' },
	{ key: 'events', label: 'Events', width: '22%' },
	{ key: 'status', label: 'Status', width: '18%', neverDash: true }
] as const;

export default function Webhooks({ loaderData }: Route.ComponentProps) {
	const { destinations, deleted } = loaderData;
	const said = useAfterPaint(deleted === null ? null : `Deleted ${deleted}.`);

	return (
		<Column wide>
			<DataTable
				// the count where there are rows, and the screen's own noun where there are none: an
				// empty table draws no caption and is named from this string instead.
				caption={
					destinations.length > 0
						? `${destinations.length} ${destinations.length === 1 ? 'destination' : 'destinations'}.`
						: 'Webhooks'
				}
				columns={COLUMNS}
				rows={destinations.map((destination) => ({
					id: destination.id,
					cells: {
						url: (
							<Link to={href('/admin/integrations/webhooks/:id', { id: destination.id })}>
								<UrlText>{destination.url}</UrlText>
							</Link>
						),
						events: destination.events,
						status: destination.paused ? <StatusWord tone="attention">Paused</StatusWord> : null
					}
				}))}
				empty="No destinations yet"
				add="Add destination"
				addHref={href('/admin/integrations/webhooks/new')}
			/>
			<p className="adm-vh" role="status">
				{said}
			</p>
		</Column>
	);
}
