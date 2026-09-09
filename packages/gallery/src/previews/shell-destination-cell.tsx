import type { DestinationLinkProps } from '@better-giving/operator/components/shell/DestinationCell';
import { DestinationCell } from '@better-giving/operator/components/shell/DestinationCell';

/*
 * one cell at every claim it can make about where the reader is, and every pointer state, out of
 * the rail that normally arranges them.
 *
 * out of the rail on purpose: `.adm-rail__cells > .adm-dest` in
 * packages/operator/src/styles/adm.css is what makes a cell a tab or a row, and everything the cell
 * owns by itself — the band, the accent edge, the hue and weight change — is drawn on the bare
 * `.adm-dest`. a specimen inside a rail shows the arrangement and hides the element.
 * ./shell-app-shell.tsx is where the arrangement is.
 *
 * `current` is three values and two of them are the same drawing. `page` and bare `true` are the
 * address itself; `section` is a destination that only contains it. all three take `.is-current`
 * and the sheet reads none of the kinds, so what separates them is `aria-current` alone — `page`
 * against `true` — and no specimen here can show it. it is the difference between a reader being
 * told the section is the screen and being told it contains it, and it is stated rather than drawn.
 *
 * the two pointer states are the whole of what a cell pins: adm.css draws `.adm-dest` a hover
 * twin, a focus twin and both crossed with current, and a destination is not a control that can be
 * pressed shut or taken away. the current-and-hovered pair is drawn because the two must be
 * unmistakably different and only the pair says whether they are.
 *
 * `short` is the word a narrow window reads and `children` is the word a wide one does, and the
 * sheet chooses: both are in the markup and one is hidden, so a destination announces exactly one
 * name at every width. **a cell with no `short` shows nothing at all below 64rem** — adm.css
 * hides `.adm-dest__full` unconditionally and only the wide width puts it back — which is what the
 * `short`-less specimens are here to make visible by narrowing the window.
 *
 * `link` is what the cell is drawn as, and a mounted rail always states one: this package declares
 * no router (CLAUDE.md — the graph is `app → operator ← console`), so a bare anchor to an internal
 * address takes the whole document with it. the last specimen hands one in, and what it proves is
 * that the class list and the `aria-current` the cell settled reach whatever it was drawn as.
 */

/* stands in for the router link a surface hands in. it does nothing with the address on purpose —
   what is being shown is that the cell's own class list and currency arrive at the element the
   caller chose, not at an anchor this package picked. */
function StandInLink({ children, ...rest }: DestinationLinkProps) {
	return <span {...rest}>{children}</span>;
}

export default function ShellDestinationCellPreview() {
	return (
		<div className="adm-stack">
			<DestinationCell href="#" short="Forms">
				Donation forms
			</DestinationCell>

			<DestinationCell href="#" short="Forms" current="page">
				Donation forms — the address itself
			</DestinationCell>

			<DestinationCell href="#" short="Forms" current="section">
				Donation forms — a section the address is under
			</DestinationCell>

			{/* bare `true`, which the component reads as `page`. */}
			<DestinationCell href="#" short="Forms" current>
				Donation forms — current stated as true
			</DestinationCell>

			<DestinationCell href="#" short="hover" state="hover">
				hover
			</DestinationCell>

			<DestinationCell href="#" short="focus" state="focus">
				focus
			</DestinationCell>

			<DestinationCell href="#" short="Forms" current="page" state="hover">
				current and hovered — the pair that has to be unmistakable
			</DestinationCell>

			<DestinationCell href="#" short="Forms" current="page" state="focus">
				current and focused — the band and the ring are one property
			</DestinationCell>

			{/* no `short`, so nothing is drawn below 64rem. */}
			<DestinationCell href="#">No short word, so a narrow window shows nothing</DestinationCell>

			{/* `href` left off, which is the component's own '#'. */}
			<DestinationCell short="Set up">Settings, with no address stated</DestinationCell>

			<DestinationCell href="#" short="Gifts">
				Recurring gifts that could not be collected this month
			</DestinationCell>

			<DestinationCell href="#" short="Donors" current="section" link={StandInLink}>
				Donors — drawn as the link the surface handed in
			</DestinationCell>
		</div>
	);
}
