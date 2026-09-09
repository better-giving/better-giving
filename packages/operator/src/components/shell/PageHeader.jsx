/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} PageHeaderProps
 * @property {ReactNode} [title]
 * @property {ReactNode} [beside] a word about the page as a whole, on the heading's own baseline —
 *   a status, a count, the state the thing being looked at is in. it qualifies the title, which is
 *   why it is beside it; anything qualifying what the page holds belongs in the page.
 * @property {ReactNode} [standfirst]
 * @property {ReactNode} [pageAction] one action, and it acts on the page rather than on anything
 *   in it.
 * @property {ReactNode} [back]
 */

/* a title, a word beside it, a standfirst, and one slot for an action that acts on the page rather
   than on anything in it.

   the word beside the title is inside the title block rather than a third child of the row: the
   row is spaced apart, so a word put straight into it would be pushed to the far end away from the
   name it qualifies, or into the middle of a row it shares with what acts on the page. inside that
   block the name and the word are their own row — `.adm-pageheader__name` in
   ../../styles/adm.css — because the block is a single column and a word added to it stacks under
   the name rather than standing on its baseline. the row is drawn whether or not a word was handed
   in: one shape for the header to have, rather than a second one that only appears sometimes.

   no slot here carries the name of a route-module export react router strips — `loader`,
   `action`, `middleware`, `headers` — which is why the trailing one is `pageAction`.
   packages/app/src/routes.spec.ts sweeps every route module for `$lib/server/**` reachable from
   what ships to a browser, and it reads a JSX attribute name as an identifier: a route exporting
   `action` and writing `action={…}` here would reach its own handler through its own component,
   and be reported as D1 and the stripe client in the bundle a visitor downloads. that spec's case
   "mounts the page header on a route that exports an action, and reaches nothing" holds it. */
/** @param {PageHeaderProps} props */
export function PageHeader({ title, beside, standfirst, pageAction, back }) {
	return (
		<header className="adm-pageheader">
			{back}
			<div className="adm-pageheader__row">
				<div className="adm-pageheader__title">
					<div className="adm-pageheader__name">
						<h1>{title}</h1>
						{beside}
					</div>
					{standfirst ? <p className="adm-standfirst">{standfirst}</p> : null}
				</div>
				{pageAction}
			</div>
		</header>
	);
}
