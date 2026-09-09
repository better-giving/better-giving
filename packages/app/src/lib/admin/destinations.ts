/**
 * every destination the staff surface has, in the order an operator works: the state of giving in
 * one look, then the forms that take the money, the donors it came from, the gifts themselves, and
 * the ones that repeat. the dashboard is first because it is the surface's own address and what an
 * operator opens on, and each one after it is a step further from the form that produced the
 * record.
 *
 * the dashboard states figures and every other one is a collection. what a deployment holds one of
 * — payments, mail, spam protection, the site list, the organisation's legal identity — is set up
 * on the operator console and is not a destination here. the colleagues who may sign in are the
 * one thing about access that is a collection rather than a singleton, which is why Members is on
 * this rail and the sign-in password is not.
 *
 * a `label` is the word a fundraiser says and a path is the word the domain uses, and the two need
 * not be one: `/admin/donations` is Gifts. CLAUDE.md → Product surface is the rule, and it is why a
 * section is never named after the table under it.
 *
 * two words per destination, because the rail is drawn twice. the bar at the foot of a phone is one
 * tab per destination across the width of the screen — an equal share whatever the count, which
 * `packages/operator/src/styles/adm.css` sets — and `short` is a word that clears that share; the
 * column at the wide width has the room for `label`, which is the name the page itself carries and
 * is what a destination is called everywhere else. both words are in the markup and that sheet
 * chooses between them — a cell that swapped its own text would be a name changing under a reader
 * between two widths.
 *
 * `short` is one of `label`'s own words and never a synonym for it: a tab reading a word that
 * appears nowhere on the page it lands on is a second name for the same place, and the reader who
 * arrives has no way to tell they are where they meant to go.
 *
 * bare paths, as every address in this app is: nothing configures a base path, so a fork that ever
 * did would change every link and every server redirect at once rather than one call site at a
 * time.
 */
export const DESTINATIONS = [
	// the surface's own address, and the one destination with nothing under it — `currentDestination`
	// below matches it exactly for that reason.
	{ href: '/admin', label: 'Dashboard', short: 'Dashboard' },
	{ href: '/admin/forms', label: 'Donation forms', short: 'Forms' },
	// directly after the forms, because a program is what a form asks a donor about: it is named
	// here and then pinned or offered there, and neither screen means anything without the other.
	{ href: '/admin/programs', label: 'Programs', short: 'Programs' },
	{ href: '/admin/donors', label: 'Donors', short: 'Donors' },
	{ href: '/admin/donations', label: 'Gifts', short: 'Gifts' },
	{ href: '/admin/recurring', label: 'Recurring gifts', short: 'Recurring' },
	// last, and the only destination that is not a record of giving: it is who can open the four
	// above. what a deployment holds one of is set up on the console, and this is neither — a
	// colleague is a row somebody adds and removes, which is what makes it a collection.
	{ href: '/admin/members', label: 'Members', short: 'Members' }
] as const;

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
