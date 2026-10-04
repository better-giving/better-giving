import { Menu as ArkMenu } from '@ark-ui/react/menu';
import { Mark } from '../status/Mark.jsx';
import { Button } from './Button.jsx';

/**
 * @import { ButtonSize, ButtonVariant } from './Button.jsx'
 * @import { MarkName } from '../status/Mark.jsx'
 */

/**
 * one line of the menu. a press runs `onSelect`; a line with `href` is a link instead, followed the
 * way any link is — the machine clicks it for Enter, so `newTab` and a pointer's own middle click
 * both behave as they would on the page.
 *
 * the label is text: it is the line's accessible name and what typeahead matches against, and it
 * is the line's identity in the machine, so no two lines of one menu share one.
 *
 * @typedef {{ readonly label: string } & (
 *   | { readonly onSelect: () => void; readonly href?: undefined; readonly newTab?: undefined }
 *   | { readonly href: string; readonly newTab?: boolean | undefined; readonly onSelect?: undefined }
 * )} MenuItem
 */

/**
 * @typedef {object} MenuProps
 * @property {string} label the press's accessible name. it is the press's only name — the press
 *   draws its mark alone — so it says what the menu holds, `More` and not `Open menu`.
 * @property {readonly MenuItem[]} items
 * @property {MarkName | undefined} [mark] the press's mark, `ellipsis` unless stated.
 * @property {ButtonVariant | undefined} [variant]
 * @property {ButtonSize | undefined} [size]
 * @property {boolean | undefined} [defaultOpen] the list open on the first draw. a specimen's prop:
 *   a screen opens a menu by the press an operator makes on it.
 */

/* a press that opens a short list of actions. the machine is ark's menu and everything it answers
   for is left to it: the `menu` and `menuitem` roles, the press opening on Enter, Space and the down
   arrow, the arrows and Home and End inside, typeahead, Escape and a press outside closing it, and
   the focus handed back to the press when it closes. what this adds is the look — the list is
   ../forms/SelectWithNote.jsx's surface and the line its row, so the two read as one family — and
   a link line, which the machine follows as a link.

   the list stands in the flow under the press rather than in a portal, for
   ../forms/SelectWithNote.jsx's reason: `.adm-menuwrap` is what lifts it over whatever follows
   (../../styles/adm.css). an empty menu is a press that opens onto nothing, so a caller with no
   line to offer draws no menu. */
/** @param {MenuProps} props */
export function Menu({
	label,
	items,
	mark = 'ellipsis',
	variant = 'default',
	size = 'md',
	defaultOpen
}) {
	return (
		<div className="adm-menuwrap">
			<ArkMenu.Root defaultOpen={defaultOpen}>
				<ArkMenu.Trigger asChild>
					<Button type="button" variant={variant} size={size} mark={mark} aria-label={label} />
				</ArkMenu.Trigger>
				<ArkMenu.Positioner>
					<ArkMenu.Content className="adm-menulist">
						{items.map((item) =>
							item.href === undefined ? (
								<ArkMenu.Item
									key={item.label}
									value={item.label}
									className="adm-menurow"
									onSelect={item.onSelect}
								>
									{item.label}
								</ArkMenu.Item>
							) : (
								<ArkMenu.Item key={item.label} value={item.label} asChild>
									<a
										className="adm-menurow"
										href={item.href}
										target={item.newTab ? '_blank' : undefined}
										rel={item.newTab ? 'noopener' : undefined}
									>
										{item.label}
										{item.newTab ? (
											<>
												<Mark name="arrow-up-right" />
												<span className="adm-vh"> (opens in a new tab)</span>
											</>
										) : null}
									</a>
								</ArkMenu.Item>
							)
						)}
					</ArkMenu.Content>
				</ArkMenu.Positioner>
			</ArkMenu.Root>
		</div>
	);
}
