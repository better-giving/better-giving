import zapierImage from '@better-giving/operator/brand/zapier.png';

/**
 * every destination the staff surface has, in the order an operator works: the state of giving in
 * one look, then the campaigns, the fundraisers supporters start beside them, and the forms that
 * take the money, the donors it came from, the gifts themselves, the ones that repeat, who may
 * sign in, the organisation's settings and its payments, the systems outside that read it, and the
 * books all of it lands in. the dashboard is first
 * because it is the surface's own address and what an operator opens on, and each record after it
 * is a step further from the page or form that produced it.
 *
 * the dashboard states figures, Settings and Payments each describe the one deployment, and every
 * other one is a collection. Settings holds what the organisation holds one of — its profile with
 * its mission, logo and brand colour, and the address this deployment reaches it at — and shows the
 * mail values it sends with. Payments reads where each processor's account stands and never holds a
 * key. the site list is a card on Donation forms and spam protection is set in `.env`, so neither is
 * a destination here (AGENTS.md → Boundaries). the colleagues who may sign in are the one thing
 * about access that is a collection rather than a singleton, which is why Members is on this rail
 * and the sign-in password is not.
 *
 * a `label` is the word a fundraiser says and a path is the word the domain uses, and the two need
 * not be one: `/admin/donations` is Gifts. CLAUDE.md → Product surface is the rule, and it is why a
 * section is never named after the table under it.
 *
 * bare paths, as every address in this app is: nothing configures a base path, so a fork that ever
 * did would change every link and every server redirect at once rather than one call site at a
 * time.
 *
 * the rail's column draws the destinations in five groups: the dashboard alone, the one
 * destination stating figures; the records of giving; Members, Settings and Payments — who may
 * sign in, what the organisation is and what it takes gifts through, none of them a record of a
 * gift; the integrations, the ways a system outside the deployment reaches it; and the books, which
 * everything above writes into. a rule is the whole of the separation between the other four. the
 * integrations carry the one heading, because their entries are named after a mechanism rather
 * than a record — API — and that word in a run of records says nothing about what it holds. the
 * groups are the shape `Shell` takes as `groups`,
 * and `DESTINATIONS` is the same entries flat, which is what a match against an address walks.
 *
 * `deployer: true` marks a group, or one destination in a group, drawn for the deployer's session
 * alone: every page behind it answers a member with not-found, and a row leading there would be a
 * way to a refusal. `destinationGroupsFor` picks the groups and rows for a session, and
 * ../../routes/_app.tsx hands it the same predicate the pages behind them read.
 *
 * `mark` is the glyph the column draws beside a label — a name from
 * packages/operator/src/components/status/glyphs.js — or, for a destination named after another
 * company's product, that company's image as packages/operator publishes it, `{ src }`.
 *
 * `children` are the pages a destination is split into, drawn under it as its sections: Settings'
 * three, one per form (../../routes/_app.admin.settings_.organisation.tsx and the two beside it).
 * they share their parent's `deployer` mark, since a section is drawn only where its parent is.
 */
export const DESTINATION_GROUPS = [
	{
		destinations: [
			// the surface's own address, and the one destination with nothing under it —
			// `currentDestination` below matches it exactly for that reason.
			{
				href: '/admin',
				label: 'Dashboard',
				mark: 'layout-dashboard'
			}
		]
	},
	{
		destinations: [
			// first of the records of giving: a campaign is what an operator opens most weeks, and its
			// page is where the gifts it raises come in.
			{
				href: '/admin/campaigns',
				label: 'Campaigns',
				mark: 'megaphone'
			},
			// directly after the campaigns: a supporter's page raises money the way a campaign does, and
			// a supporter starts one from a campaign's card (./supporter-pages/supporter-pages.tsx).
			{
				href: '/admin/supporter-pages',
				label: 'Supporter pages',
				mark: 'user-plus'
			},
			{ href: '/admin/forms', label: 'Donation forms', mark: 'form' },
			// directly after the forms, because a program is what a form asks a donor about: it is named
			// here and then pinned or offered there, and neither screen means anything without the other.
			{ href: '/admin/programs', label: 'Programs', mark: 'folder-heart' },
			{ href: '/admin/donors', label: 'Donors', mark: 'users' },
			{ href: '/admin/donations', label: 'Gifts', mark: 'hand-heart' },
			{ href: '/admin/recurring', label: 'Recurring gifts', mark: 'repeat' }
		]
	},
	{
		destinations: [
			// who may sign in to this rail, which is no record of giving. a colleague is a row
			// somebody adds and removes, which is what makes it a collection.
			{ href: '/admin/members', label: 'Members', mark: 'shield-check' },
			// the organisation's own details and where this deployment reaches it, beside who may
			// sign in: both are about the deployment rather than about a gift. `/admin/settings` itself
			// redirects to the first section (../../routes/_app.admin.settings.tsx).
			{
				href: '/admin/settings',
				label: 'Settings',
				mark: 'settings',
				deployer: true,
				children: [
					{
						href: '/admin/settings/organisation',
						label: 'Organisation details',
						mark: 'building-2'
					},
					{ href: '/admin/settings/notifications', label: 'Notifications', mark: 'bell' },
					{ href: '/admin/settings/mail', label: 'Mail', mark: 'mail' }
				]
			},
			// where each payment processor the deployment holds keys for stands, and the two presses
			// that act on its account (../../routes/_app.admin.payments.tsx).
			{
				href: '/admin/payments',
				label: 'Payments',
				mark: 'credit-card',
				deployer: true
			}
		]
	},
	{
		heading: 'Integrations',
		deployer: true,
		destinations: [
			{
				href: '/admin/integrations/zapier',
				label: 'Zapier',
				mark: { src: zapierImage }
			},
			{ href: '/admin/integrations/api', label: 'API', mark: 'key-round' },
			{
				href: '/admin/integrations/webhooks',
				label: 'Webhooks',
				mark: 'webhook'
			},
			// the connections from Claude and ChatGPT through Better Giving's connector, each with
			// Disconnect (../../routes/_app.admin.integrations.connector.tsx).
			{
				href: '/admin/integrations/connector',
				label: 'AI',
				mark: 'sparkles'
			}
		]
	},
	{
		destinations: [
			// last, in a group of its own: the journal entries every record above posts, and where a
			// correction is posted against them. neither a record of giving nor a way in.
			{ href: '/admin/books', label: 'Books', mark: 'book-open' }
		]
	}
] as const;

type DestinationGroup = (typeof DESTINATION_GROUPS)[number];
type Destination = DestinationGroup['destinations'][number];

export const DESTINATIONS: readonly Destination[] = DESTINATION_GROUPS.flatMap(
	(group): readonly Destination[] => group.destinations
);

/** a group as the rail draws it for one session: the cells that session may open. */
type DrawnGroup = Omit<DestinationGroup, 'destinations'> & {
	readonly destinations: readonly Destination[];
};

/**
 * the rail drawn for a session: every group for the deployer, and for a member none marked
 * `deployer` and no cell marked so in the groups left.
 */
export function destinationGroupsFor(deployer: boolean): readonly DrawnGroup[] {
	if (deployer) return DESTINATION_GROUPS;
	return DESTINATION_GROUPS.filter((group) => !('deployer' in group)).map((group) => ({
		...group,
		destinations: group.destinations.filter((destination) => !('deployer' in destination))
	}));
}

/** the staff surface's own address, which is the dashboard's and is under no other destination. */
const SURFACE = '/admin';

/**
 * the destination a path belongs to — its `label`, and whether the path is that destination's own
 * address or a screen under it. `undefined` for a path under none of them.
 *
 * longest matching prefix, so `/admin/forms/new` marks Donation forms rather than nothing: a rail
 * that goes blank one level down leaves the reader with nothing on screen saying where they are.
 *
 * `SURFACE` below is the exception, and it is the reason the rule is not a plain prefix test: the
 * dashboard's address is a prefix of every other destination's, so matching it as one would mark
 * two cells on every screen and leave the rail no longer saying where the reader is. it is a page
 * and holds nothing, so it is matched exactly and nothing sits under it.
 *
 * the prefix has to end at a segment boundary. `/admin/donors` is not the section a hypothetical
 * `/admin/donorships` belongs to, and a bare `startsWith` says it is.
 *
 * the `kind` rides along because marking a cell and claiming the address are two different
 * things, and the prefix match is the only place the difference is known: at /admin/forms/new the
 * rail's Donation forms cell is the section the reader is in, not the page they are on. it is
 * stated here or nowhere — packages/operator is a leaf and names no surface's route table.
 *
 * `child` is the section of a destination with `children` the path is in, the one the shell marks
 * as the page under its parent row; absent on a path under none of them.
 */
export function currentDestination(
	pathname: string
): { label: string; kind: 'page' | 'section'; child?: string } | undefined {
	let best: Destination | undefined;
	for (const destination of DESTINATIONS) {
		if (!within(pathname, destination.href)) continue;
		if (!best || destination.href.length > best.href.length) best = destination;
	}
	if (!best) return undefined;
	const kind = pathname === best.href ? 'page' : 'section';
	const child =
		'children' in best
			? best.children.find((section) => within(pathname, section.href))?.href
			: undefined;
	return child === undefined ? { label: best.label, kind } : { label: best.label, kind, child };
}

/** whether `pathname` is `href` or a screen under it, a segment boundary apart. */
function within(pathname: string, href: string): boolean {
	return pathname === href || (href !== SURFACE && pathname.startsWith(`${href}/`));
}
