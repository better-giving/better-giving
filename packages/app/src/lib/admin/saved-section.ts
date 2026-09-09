// which section of a screen a redirect is reporting the save of.
//
// every save in /admin is POST-redirect-GET, so the thing that just happened has to survive the
// redirect. it survives as a marker in a one-shot cookie — `$lib/server/flash.ts` sets it on the
// redirect and takes it on the GET that lands — and this file is what a screen asks whether that
// marker is a section of its own.
//
// the marker names the section rather than being a bare flag, and that has nothing to do with how
// it travels. a bare flag is what the three save buttons on
// `src/routes/_app.admin.forms.$id.tsx` cannot be told apart by: one write would light all three,
// so each button reports only its own. a screen with one button still names it, so the rule is the
// dashboard's rather than any one screen's.
//
// the section names are the screen's, listed at its own `load` and never assembled here — this
// only decides what counts as one. `load` is the one place the marker is read, and now the only
// place it can be: the cookie is `httpOnly`, so no component can reach it, and taking it is what
// clears it — a second reader would be a second consumer of a marker that exists to be delivered
// exactly once.
//
// what a marker no section answers to reports is nothing, and it is not a guard against a value
// somebody typed: an `httpOnly` flash cannot be hand-typed, bookmarked or pasted — it is written
// by a redirect this app performed and read on the one response that follows it. it is refused
// because the marker is a string crossing a boundary and this is where the screen says which
// strings it has buttons for — a section renamed on a screen and left behind here would otherwise
// light nothing and say nothing about why.
//
// the outcome of a write that lands somewhere else is not this: a create redirects to the list the
// record it made is on, which is a screen the button it was pressed on is not on, so it reports as
// a banner where it lands. both of them do it the same way — the flash carries the record's id, and
// the list looks it up against the rows it has already read, so an id nothing answers to reports
// nothing exactly as a marker no section answers to does. the two are
// `src/routes/_app.admin.donors._index.tsx` and `src/routes/_app.admin.forms._index.tsx`.

/**
 * the section named by the marker, or `null` where none of this screen's is.
 *
 * the sections are passed in rather than declared here so that the union a screen's `load`
 * publishes is the one list, and a section added to a screen without a button to report it is a
 * type error at that screen rather than a silent extra key here.
 *
 * `null` in and `null` out, because a plain visit carries no flash at all and that is the ordinary
 * case rather than an edge of one.
 */
export function savedSection<K extends string>(
	marker: string | null,
	sections: readonly K[]
): K | null {
	return sections.find((section) => section === marker) ?? null;
}
