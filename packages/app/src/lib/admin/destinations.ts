import zapierImage from '@better-giving/operator/brand/zapier.png';

/**
 * every destination the staff surface has, in the order an operator works: the state of giving in
 * one look, then the campaigns and forms that take the money, the donors it came from, the gifts
 * themselves, the ones that repeat, who may sign in, the systems outside that read it, and the
 * books all of it lands in. the dashboard is first because it is the surface's own address and
 * what an operator opens on, and each record after it is a step further from the page or form that
 * produced it.
 *
 * the dashboard states figures and every other one is a collection. what a deployment or its
 * organisation holds one of — payments, mail, spam protection, the site list, the organisation's
 * profile with its mission, logo and brand colour — is set up on the operator console and is not a
 * destination here (CLAUDE.md → Two operator surfaces). the colleagues who may sign in are the one
 * thing about access that is a collection rather than a singleton, which is why Members is on this
 * rail and the sign-in password is not.
 *
 * a `label` is the word a fundraiser says and a path is the word the domain uses, and the two need
 * not be one: `/admin/donations` is Gifts. CLAUDE.md → Product surface is the rule, and it is why a
 * section is never named after the table under it.
 *
 * two words per destination, because the rail is drawn twice. the bar at the foot of a phone is a
 * row of tabs across the width of the screen — an equal share each whatever the count, which
 * `packages/operator/src/styles/adm.css` sets — and `short` is a word that clears that share; the
 * column at the wide width has the room for `label`, which is the name the page itself carries and
 * is what a destination is called everywhere else. both words are in the markup and that sheet
 * chooses between them — a cell that swapped its own text would be a name changing under a reader
 * between two widths.
 *
 * the bar holds four destinations and a More tab, and `bar: true` marks the four. a tab for every
 * destination stops clearing `short` at the 375px floor with the integrations pages in the rail,
 * so the bar takes the destinations an operator opens most — the figures, the campaigns, the donors
 * and the gifts, in the rail's own order — and More opens a sheet holding every other one in the
 * column's order, under its rules and headings. a destination added here is on the sheet until it
 * is argued onto the bar, and one that joins it narrows every tab's share. More reads current while
 * the reader is in any of the sheet's destinations, so the bar never goes blank under them.
 *
 * `short` is one of `label`'s own words and never a synonym for it: a tab reading a word that
 * appears nowhere on the page it lands on is a second name for the same place, and the reader who
 * arrives has no way to tell they are where they meant to go.
 *
 * bare paths, as every address in this app is: nothing configures a base path, so a fork that ever
 * did would change every link and every server redirect at once rather than one call site at a
 * time.
 *
 * the rail's column draws the destinations in five groups: the dashboard alone, the one
 * destination stating figures; the records of giving; Members, who can open the rest and records
 * no gift; the integrations, the ways a system outside the deployment reaches it; and the books,
 * which everything above writes into. a rule is the whole of the separation between the other
 * four. the integrations carry the one heading, because their
 * entries are named after a mechanism rather than a record — API — and that word in a run of
 * records says nothing about what it holds. the groups are the shape `AppShell` takes as `groups`,
 * and `DESTINATIONS` is the same entries flat, which is what a match against an address walks.
 *
 * `deployer: true` marks a group drawn for the deployer's session alone: every page in it answers
 * a member with not-found, and a cell leading there would be a way to a refusal.
 * `destinationGroupsFor` picks the groups for a session, and ../../routes/_app.tsx hands it the
 * same predicate the pages behind the group read.
 *
 * `mark` is the glyph the column draws beside a label — a name from
 * packages/operator/src/components/status/glyphs.js — or, for a destination named after another
 * company's product, that company's image as packages/operator publishes it, `{ src }`. the bar at
 * a phone's width draws neither, so a mark is never the only thing telling two destinations apart.
 */
export const DESTINATION_GROUPS = [
	{
		destinations: [
			// the surface's own address, and the one destination with nothing under it —
			// `currentDestination` below matches it exactly for that reason.
			{
				href: '/admin',
				label: 'Dashboard',
				short: 'Dashboard',
				mark: 'layout-dashboard',
				bar: true
			}
		]
	},
	{
		destinations: [
			// first of the records of giving, and a tab on the phone's bar: a campaign is what an
			// operator opens most weeks, and its page is where the gifts it raises come in.
			{
				href: '/admin/campaigns',
				label: 'Campaigns',
				short: 'Campaigns',
				mark: 'megaphone',
				bar: true
			},
			{ href: '/admin/forms', label: 'Donation forms', short: 'Forms', mark: 'form' },
			// directly after the forms, because a program is what a form asks a donor about: it is named
			// here and then pinned or offered there, and neither screen means anything without the other.
			{ href: '/admin/programs', label: 'Programs', short: 'Programs', mark: 'folder-heart' },
			{ href: '/admin/donors', label: 'Donors', short: 'Donors', mark: 'users', bar: true },
			{ href: '/admin/donations', label: 'Gifts', short: 'Gifts', mark: 'hand-heart', bar: true },
			{ href: '/admin/recurring', label: 'Recurring gifts', short: 'Recurring', mark: 'repeat' }
		]
	},
	{
		destinations: [
			// who can open every destination on this rail, which is no record of giving. what a
			// deployment holds one of is set up on the console, and this is neither — a colleague
			// is a row somebody adds and removes, which is what makes it a collection.
			{ href: '/admin/members', label: 'Members', short: 'Members', mark: 'shield-check' }
		]
	},
	{
		heading: 'Integrations',
		deployer: true,
		destinations: [
			{
				href: '/admin/integrations/zapier',
				label: 'Zapier',
				short: 'Zapier',
				mark: { src: zapierImage }
			},
			{ href: '/admin/integrations/api', label: 'API', short: 'API', mark: 'key-round' },
			{
				href: '/admin/integrations/webhooks',
				label: 'Webhooks',
				short: 'Webhooks',
				mark: 'webhook'
			}
		]
	},
	{
		destinations: [
			// last, in a group of its own: the journal entries every record above posts, and where a
			// correction is posted against them. neither a record of giving nor a way in.
			{ href: '/admin/books', label: 'Books', short: 'Books', mark: 'book-open' }
		]
	}
] as const;

type DestinationGroup = (typeof DESTINATION_GROUPS)[number];
type Destination = DestinationGroup['destinations'][number];

export const DESTINATIONS: readonly Destination[] = DESTINATION_GROUPS.flatMap(
	(group): readonly Destination[] => group.destinations
);

/** the rail drawn for a session: every group for the deployer, and none marked `deployer` for a member. */
export function destinationGroupsFor(deployer: boolean): readonly DestinationGroup[] {
	return deployer
		? DESTINATION_GROUPS
		: DESTINATION_GROUPS.filter((group) => !('deployer' in group));
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
 */
export function currentDestination(
	pathname: string
): { label: string; kind: 'page' | 'section' } | undefined {
	let best: { href: string; label: string } | undefined;
	for (const destination of DESTINATIONS) {
		const at =
			pathname === destination.href ||
			(destination.href !== SURFACE && pathname.startsWith(`${destination.href}/`));
		if (!at) continue;
		if (!best || destination.href.length > best.href.length) best = destination;
	}
	if (!best) return undefined;
	return { label: best.label, kind: pathname === best.href ? 'page' : 'section' };
}
