import { Select, useSelectContext } from '@ark-ui/react/select';
import { part, partWhen } from '@better-giving/form/parts';
import { type ComponentProps, type ReactNode, useLayoutEffect, useRef } from 'react';
import type { SelectProps } from './normalize';

// the closed choice a donor makes in one control: the cause a gift is credited to, and how a
// tribute is dedicated. `@ark-ui/react`'s `Select` runs it, on the zag machine the embed drives
// through `@zag-js/vanilla` (@better-giving/form's src/select.ts), so a key is answered the same way
// on both surfaces and the form's sheets dress both from one set of rules.
//
// what ark owns and nothing here overrides: the listbox pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) with the box as its `role="combobox"` named by
// the label through `aria-labelledby`, the arrow keys, typeahead, Enter and Space, Escape back to the
// box, the pointer, and the dismissal on a press outside. what this file owns is the nodes, drawn in
// the embed's anatomy so the sheets reach them: the box is `part="field"`, the list `select-list`,
// a row `select-option` with `selected` on the chosen one, and the rest is selected by the
// `data-scope`/`data-part` pair ark writes.
//
// the root is the caller's own row (`asChild`), so the label, the box and the list stand as that
// row's children, where the row's gap and grid already place them.
//
// the list stands in the top layer (`popover="manual"`) and is placed against the viewport
// (`strategy: 'fixed'`). the card clips its overflow and is a query container, which makes it the
// box a fixed descendant is placed in and cut by; the top layer is above both, and it stays inside
// `[data-donate-root]`, where the tokens the sheets read are declared — a portal into the body would
// be outside it. `manual` because ark is the one dismissing it.

export type ChoiceProps = {
	/** the box's own id, so a label or a test naming `#program` finds the control a donor operates. */
	readonly id: string;
	readonly label: string;
	/** for a box whose resting option already says what it is for; the words then name it alone. */
	readonly hideLabel?: boolean;
	readonly choice: SelectProps;
	/** the row the choice stands in, which becomes ark's root. */
	readonly className: string;
	/** what else stands in that row, after the list. */
	readonly children?: ReactNode;
};

export function Choice({ id, label, hideLabel = false, choice, className, children }: ChoiceProps) {
	return (
		<Select.Root
			{...choice.root}
			asChild
			ids={{
				root: `${id}-root`,
				label: `${id}-label`,
				trigger: id,
				positioner: `${id}-positioner`,
				content: `${id}-list`,
				item: (value: string | number) => `${id}-option-${value}`
			}}
			positioning={{ placement: 'bottom-start', strategy: 'fixed', gutter: 0 }}
		>
			<div className={className}>
				<Select.Label asChild>
					<Caption part={part('label')} className={hideLabel ? 'vh' : undefined}>
						{label}
					</Caption>
				</Select.Label>
				<Select.Trigger part={part('field')}>
					{/*
					 * every option's words stacked in one cell, the chosen one visible: the box is as wide
					 * as its longest option whichever is chosen, so the tribute's name beside it does not
					 * move when the kind changes (`.select-words` in the form's layout sheet).
					 */}
					<span className="select-words">
						{choice.options.map((option) => (
							<span key={option.value} data-chosen={option.value === choice.value ? '' : undefined}>
								{option.label}
							</span>
						))}
					</span>
					<Select.Indicator asChild>
						<Glyph className="glyph" d="m6 9 6 6 6-6" />
					</Select.Indicator>
				</Select.Trigger>
				<List>
					<Select.Content part={part('select-list')}>
						{choice.root.collection.items.map((item) => (
							<Select.Item
								key={item.value}
								item={item}
								part={partWhen('select-option', { selected: item.value === choice.value })}
							>
								<Select.ItemText>{item.label}</Select.ItemText>
								<Select.ItemIndicator asChild>
									<Glyph className="tick" d="M20 6 9 17l-5-5" />
								</Select.ItemIndicator>
							</Select.Item>
						))}
					</Select.Content>
				</List>
				{children}
			</div>
		</Select.Root>
	);
}

/**
 * the label, without the `for` ark sets on it. that names the native select ark renders for a form
 * post, and this choice draws none: the card submits through the flow, never through a form. ark's
 * own click handler is what puts the caret on the box instead.
 */
function Caption({ htmlFor: _for, ...props }: ComponentProps<'label'>) {
	// biome-ignore lint/a11y/noLabelWithoutControl: the box names itself by this label's id through `aria-labelledby`, which ark sets on the trigger.
	return <label {...props} />;
}

/** the positioner, shown in the top layer while the list is open and taken out of it when it closes. */
function List({ children }: { readonly children: ReactNode }) {
	const { open } = useSelectContext();
	const node = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const list = node.current;
		if (list === null) return;
		const shown = list.matches(':popover-open');
		if (open && !shown) list.showPopover();
		else if (!open && shown) list.hidePopover();
	}, [open]);
	return (
		<Select.Positioner ref={node} popover="manual">
			{children}
		</Select.Positioner>
	);
}

/**
 * lucide's `chevron-down` and `check` (https://lucide.dev, ISC), in `currentColor` at the source's own
 * stroke — the two paths the embed's own glyphs draw for this control.
 */
function Glyph({ d, ...props }: ComponentProps<'svg'> & { readonly d: string }) {
	return (
		<svg
			{...props}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d={d} />
		</svg>
	);
}
