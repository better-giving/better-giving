import { Fragment } from 'react';
import { Button } from '../controls/Button.jsx';
import { Brand } from '../status/Brand.jsx';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { BrandName } from '../status/Brand.jsx'
 * @import { MarkName } from '../status/Mark.jsx'
 */

/**
 * one stated fact: what it is, and what it is called.
 *
 * `what` is a string rather than a node because it names the fact on the bar and is what the run
 * of them is keyed by — two facts called the same thing are one fact stated twice.
 *
 * @typedef {object} TopBarFact
 * @property {string} what
 * @property {MarkName} [mark] the shape the fact is led by instead of its caption word. `what` is
 *   still stated and still names the fact — it becomes the mark's accessible name, so the fact
 *   reads the same to someone who cannot see the shape.
 * @property {BrandName} [brand] the same slot and the same bargain, for a fact whose shape is a
 *   company's own logo rather than one of this system's. it is a second property and not a member of
 *   `mark` because the two are drawn from different things and tone differently — see
 *   ../status/Brand.jsx. a fact states one or the other; handed both it is led by the mark, which is
 *   this system's own.
 * @property {ReactNode} [name]
 * @property {boolean | undefined} [code] the mono face, for a value that must stay whole — an
 *   address, an id.
 * @property {ReactNode} [note] a second value about the same fact, after the name and quieter than
 *   it: the id beside a name, where the name is what a reader recognises the fact by and this is
 *   what they check it against something off the screen. it never identifies the fact, so a fact
 *   carrying one carries a `name` as well.
 * @property {ReactNode} [beside] the one control that acts on this fact, drawn after the name and
 *   inside the fact's own slot. it is the fact's and not the bar's: `end` is the control over the
 *   surface, and an act over a value belongs where the value is read.
 */

/**
 * @typedef {object} TopBarProps
 * @property {readonly TopBarFact[] | undefined} [facts] in the order they are read. the divider
 *   between two of them is drawn here rather than stated by a caller: it belongs to the pair and
 *   not to either fact, so a bar with one fact draws none.
 * @property {ReactNode} [end] what acts on the surface, at the bar's far end, named for the slot
 *   the sheet gives it rather than for an errand — what stands there is the calling surface's, and
 *   the rule is that each of them is an act over the surface and not over a fact stated on the bar.
 *   the slot arranges nothing, so a caller putting more than one control in it hands down the row.
 *   handled the way ./AppShell.jsx handles `signOut`: unstated it is the quiet button a specimen
 *   shows, and `null` is a bar with no control to draw at all. absence cannot say that, since a
 *   slot with a default of its own reads nothing stated as a request for the default.
 */

/* the head of a screen whose facts are stated rather than navigated.

   it is a bar of facts and one control, and it is not a rail: nothing on it goes anywhere. what
   earns a place is a fact that stays true across every screen of the surface and that the operator
   would otherwise have to go and look up — which is why the address is here and not in the ledger
   below it, where a line is an errand.

   a fact may be a link, and only where its destination is what its label names: a link landing
   somewhere other than the thing it is called is worse than no link. a fact may also carry one
   control, in its own slot, and only one that acts on that fact. what stands at the end is still
   the bar's own — every control there is over the surface rather than over anything stated on it,
   which is the whole of what decides which end a control belongs at.

   a fact may be led by a shape instead of its caption word, and only where the shape says what the
   word said. the word is still stated and becomes the shape's name, so the fact reads the same to
   someone who cannot see it. what a shape buys is the width the caption took, which is the bar's
   scarcest thing at the wide breakpoint where the run cannot wrap — so it is the caption that goes
   and never the value.

   the bar is drawn as the first row of ../../styles/adm.css's shell, the same way the identity band
   is, and neither one is placed by name. */
/** @param {TopBarProps} props */
export function TopBar({ facts = [{ what: 'Account', name: 'Riverbank Trust' }], end }) {
	/** @type {ReactNode} */
	const control =
		end === undefined ? (
			<Button variant="quiet" size="sm">
				Disconnect
			</Button>
		) : (
			end
		);
	return (
		/* a `header` rather than a div, and it is the banner: ./BareShell.jsx stands it beside `main`
		   rather than inside anything, which is what makes the element mean that without the role
		   being written. left a div, the facts and the controls beside them sit in no region at all,
		   and a reader moving by landmark reaches `main` and never the bar. */
		<header className="adm-topbar">
			{facts.map(({ what, mark, brand, name, code, note, beside }, at) => (
				<Fragment key={what}>
					{at === 0 ? null : <div className="adm-topbar__rule" />}
					<div className="adm-topbar__slot">
						{/* three shapes of markup and not one span with the caption swapped for a label, which
						    is ../status/Mark.jsx's own reason: what leads the fact is either a word a reader
						    sees or an image carrying that word as its name, and the two are different
						    elements — and the logo is a third, because it is drawn from a picture rather than
						    from this system's ink. the classes are spelled here rather than assembled, so
						    packages/app/src/lib/admin/styles/conformance.spec.ts can see them. */}
						{mark !== undefined ? (
							<Mark name={mark} label={what} className="adm-topbar__mark" />
						) : brand !== undefined ? (
							<Brand name={brand} label={what} className="adm-topbar__brand" />
						) : (
							<span className="adm-topbar__what">{what}</span>
						)}
						<span className={`adm-topbar__name${code ? ' adm-topbar__name--code' : ''}`}>
							{name}
						</span>
						{note === undefined ? null : <span className="adm-topbar__note">{note}</span>}
						{beside === undefined ? null : <span className="adm-topbar__beside">{beside}</span>}
					</div>
				</Fragment>
			))}
			{control === null ? null : <div className="adm-topbar__end">{control}</div>}
		</header>
	);
}
