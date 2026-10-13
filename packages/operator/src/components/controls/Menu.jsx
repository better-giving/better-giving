import { Menu as ArkMenu } from '@ark-ui/react/menu';
import { Mark } from '../status/Mark.jsx';
import { Button } from './Button.jsx';

/**
 * @import { SyntheticEvent } from 'react'
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
 * @property {string} label the press's name. it says what the menu holds, `More` and not `Open
 *   menu`. the press draws its mark alone and this is its accessible name, unless `labelled`.
 * @property {boolean | undefined} [labelled] `label` drawn as the press's words after its mark, and
 *   then the press's name by being its text. for a menu that is a screen's way to make something —
 *   `Add a block` over the kinds it may be — where a mark alone does not say which thing is made.
 * @property {readonly MenuItem[]} items
 * @property {MarkName | undefined} [mark] the press's mark, `ellipsis` unless stated.
 * @property {ButtonVariant | undefined} [variant]
 * @property {ButtonSize | undefined} [size]
 * @property {boolean | undefined} [open] the list held open whatever is pressed, Escape and a press
 *   outside included. a specimen's prop: a screen opens a menu by the press an operator makes on it.
 * @property {boolean | undefined} [held] a write of the screen's is in flight and a line picked now
 *   would be sent against what it is about to change: the press says it is unavailable with
 *   `aria-disabled` and opens nothing until the caller lets go. it keeps the focus, which
 *   `disabled` would drop.
 * @property {string | undefined} [describedBy] the id of what the press is described by — the
 *   refusal its last line came back with.
 */

/* a press that opens a short list of actions. the machine is ark's menu and everything it answers
   for is left to it: the `menu` and `menuitem` roles, the press opening on Enter, Space and the down
   arrow, the arrows and Home and End inside, typeahead, Escape and a press outside closing it, and
   the focus handed back to the press when it closes. what this adds is the look — the list is
   ../forms/SelectWithNote.jsx's surface and the line its row, so the two read as one family — and
   a link line, which the machine follows as a link. the link is out of the tab sequence, as every
   other line is: the list holds the focus and the machine walks its lines by the arrows, and a
   link Tab could land on would take the focus off the list, where neither the arrows nor Tab
   reach anything.

   the list stands in the flow under the press rather than in a portal, for
   ../forms/SelectWithNote.jsx's reason: `.adm-menuwrap` is what lifts it over whatever follows
   (../../styles/adm.css). an empty menu is a press that opens onto nothing, so a caller with no
   line to offer draws no menu. */
/** @param {MenuProps} props */
export function Menu({
	label,
	labelled = false,
	items,
	mark = 'ellipsis',
	variant = 'default',
	size = 'md',
	open,
	held = false,
	describedBy
}) {
	/* turned away on the way down, before the machine's own handlers on the press hear it: they
	   skip an event already cancelled, and Tab is let through so the focus can still leave. */
	/** @param {SyntheticEvent} event */
	const refuse = (event) => {
		if (!held) return;
		if ('key' in event && event.key === 'Tab') return;
		event.preventDefault();
	};
	return (
		<div className="adm-menuwrap">
			<ArkMenu.Root open={open}>
				<ArkMenu.Trigger asChild>
					<Button
						type="button"
						variant={variant}
						size={size}
						mark={mark}
						aria-label={labelled ? undefined : label}
						aria-disabled={held || undefined}
						aria-describedby={describedBy}
						onClickCapture={refuse}
						onKeyDownCapture={refuse}
					>
						{labelled ? label : null}
					</Button>
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
										tabIndex={-1}
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
