import { Menu as ArkMenu } from '@ark-ui/react/menu';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { AnchorHTMLAttributes, ComponentType, ReactElement } from 'react'
 * @import { MarkName } from '../status/Mark.jsx'
 */

/**
 * what a link this package draws through a caller's component is handed: an anchor's own
 * attributes with the address required. a router's link that takes `href` fits it as it is.
 *
 * @typedef {Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string }} ShellLinkProps
 */

/**
 * one row. `onSelect` is a press; `href` is a link, followed the way any link is (Enter and Space
 * click it, as a press does). `internal` draws the link through the menu's `link`, for an address on
 * this surface; without it the row is a plain anchor, for a page outside it.
 *
 * the label is text: it is the row's accessible name, what typeahead matches, and the row's
 * identity in the machine, so no two rows of one menu share one.
 *
 * @typedef {{ readonly label: string; readonly mark?: MarkName | undefined; readonly destructive?: boolean | undefined } & (
 *   | { readonly onSelect: () => void; readonly href?: undefined; readonly internal?: undefined }
 *   | { readonly href: string; readonly internal?: boolean | undefined; readonly onSelect?: undefined }
 * )} ActionMenuItem
 *
 * a run of rows; a menu of several runs draws a `ds-menu-separator` between each.
 *
 * @typedef {readonly ActionMenuItem[]} ActionMenuRun
 */

/**
 * @typedef {object} ActionMenuProps
 * @property {ReactElement} trigger the press that opens the menu, a single element the machine
 *   takes over with `asChild`: it gains `aria-haspopup`, `aria-expanded` and `aria-controls`, and
 *   the panel is named by it.
 * @property {readonly ActionMenuRun[]} runs
 * @property {{ title: string; meta?: string | undefined } | undefined} [header] text above the
 *   rows that is not one of them: who is signed in.
 * @property {'below-end' | 'above-start'} placement where the panel stands against the press, as
 *   menu-css's note puts it: under it with the ends aligned for a row's or a header's More, above
 *   it with the starts aligned for an account button at the foot of a sidebar.
 * @property {ComponentType<ShellLinkProps> | undefined} [link] what an `internal` row is drawn
 *   as. this package declares no router, so the surface that has one hands it in.
 * @property {boolean | undefined} [open] the panel held open: a specimen's prop.
 */

/* a press and the panel it opens, drawn with menu-css. the machine is ark's menu, and what it
   answers for is left to it: the `menu` and `menuitem` roles, Enter, Space and ArrowDown opening it
   on the first row, the arrows, Home, End and typeahead inside, Escape, Tab and a press outside
   closing it, and focus handed back to the press. it marks the row it is on `data-highlighted`,
   which is the attribute menu-css paints.

   the panel stays where the press is in the tree rather than in a portal: menu-css's note asks
   for a panel no ancestor clips, and the positioner is `position: fixed` against the viewport, so
   only a transformed ancestor could; inside the shell's drawer it is what keeps the panel inside
   the modal `<dialog>`, which leaves the rest of the page inert. */
/** @param {ActionMenuProps} props */
export function ActionMenu({ trigger, runs, header, placement, link, open }) {
	const Internal = link ?? 'a';
	const filled = runs.filter((run) => run.length > 0);
	return (
		<ArkMenu.Root
			open={open}
			navigate={followLink}
			positioning={{
				placement: placement === 'below-end' ? 'bottom-end' : 'top-start',
				// menu-css: the panel stands 4px from its press.
				gutter: 4,
				strategy: 'fixed'
			}}
		>
			<ArkMenu.Trigger asChild>{trigger}</ArkMenu.Trigger>
			<ArkMenu.Positioner>
				<ArkMenu.Content className="ds-menu">
					{header ? (
						<>
							<div className="ds-menu-header" role="presentation">
								<span className="ds-menu-header-title">{header.title}</span>
								{header.meta ? <span className="ds-menu-header-meta">{header.meta}</span> : null}
							</div>
							<hr className="ds-menu-separator" />
						</>
					) : null}
					{filled.map((run, at) => (
						<Run key={run[0]?.label} run={run} apart={at > 0} Internal={Internal} />
					))}
				</ArkMenu.Content>
			</ArkMenu.Positioner>
		</ArkMenu.Root>
	);
}

/* Enter or Space on a link row follows it with the row's own `click()`, which bubbles and can be
   cancelled as a press's click is: an internal row's router link hears it and routes, a plain
   anchor follows as a link, and the row's handler closes the menu. the machine's default
   (`clickIfLink` in @zag-js/dom-query) dispatches a click that does not bubble, which react's
   handlers never see, so a routed row loaded the whole document. */
/** @param {{ node: HTMLAnchorElement }} details */
function followLink({ node }) {
	queueMicrotask(() => node.click());
}

/**
 * @param {{ run: ActionMenuRun; apart: boolean; Internal: ComponentType<ShellLinkProps> | 'a' }} props
 */
function Run({ run, apart, Internal }) {
	return (
		<>
			{apart ? <ArkMenu.Separator className="ds-menu-separator" /> : null}
			{run.map((item) => {
				const className = item.destructive
					? 'ds-menu-item ds-menu-item-destructive'
					: 'ds-menu-item';
				/* the glyph sits in a `ds-lead-1lh` box first so it stays on the label's first line
				   when the label wraps, and the label is last (menu-css). */
				const face = (
					<>
						{item.mark ? (
							<span className="ds-lead-1lh">
								<Mark name={item.mark} />
							</span>
						) : null}
						<span>{item.label}</span>
					</>
				);
				if (item.href === undefined)
					return (
						<ArkMenu.Item
							key={item.label}
							value={item.label}
							className={className}
							onSelect={item.onSelect}
						>
							{face}
						</ArkMenu.Item>
					);
				const Anchor = item.internal ? Internal : 'a';
				return (
					<ArkMenu.Item key={item.label} value={item.label} asChild>
						<Anchor className={className} href={item.href}>
							{face}
						</Anchor>
					</ArkMenu.Item>
				);
			})}
		</>
	);
}
