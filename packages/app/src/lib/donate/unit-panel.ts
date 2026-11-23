import { createUnitPanel, type UnitOption, type UnitPanel } from '@better-giving/form/unit-panel';
import { type RefObject, useEffect, useRef, useState } from 'react';
import type { SelectProps } from './normalize';
import { deploymentTickerSearch } from './ports';

// the "What you give" panel the first step's unit pill opens, mounted the way
// packages/form/src/views.ts mounts it for the element: `createUnitPanel` hands back a host, placed
// in the How much line beside the pill, and the list is patched from the projection.
//
// mounted after the first commit and never on the server: it carries its own shadow root and its
// own machine, so the server html holds the pill and the client adds the panel beside it. the host
// goes straight into the line rather than into a node react renders for it, because a wrapper would
// be a box in the line's flow (`.amount-head` in packages/form/src/styles/layout.css) where the host
// itself is none (`:host` in packages/form/src/styles/units.css).

export type UnitPanelSeats = {
	/** whether the panel is mounted: a live flow to report a pick to, and a pill to open it from. */
	readonly mounted: boolean;
	readonly formId: string;
	/** the How much line, which the host is placed in after the pill. */
	readonly line: RefObject<HTMLElement | null>;
	readonly pill: RefObject<HTMLButtonElement | null>;
	/** the amount group, whose width the open panel takes. */
	readonly field: RefObject<HTMLElement | null>;
	/** `unitSelect` as the projection states it now. */
	readonly choice: SelectProps;
};

/** whether the panel is open, and the pill's press, which opens or closes it. */
export type UnitPanelControl = { readonly open: boolean; readonly toggle: () => void };

export function useUnitPanel({
	mounted,
	formId,
	line,
	pill,
	field,
	choice
}: UnitPanelSeats): UnitPanelControl {
	const [panel, setPanel] = useState<UnitPanel | null>(null);
	const [open, setOpen] = useState(false);
	/** the choice the last render projected, so a pick reports through the flow as it stands. */
	const latest = useRef(choice);
	/** the list the panel was last handed, so a render that moved none of it repaints nothing there. */
	const drawn = useRef<{ readonly panel: UnitPanel; readonly key: string } | null>(null);

	useEffect(() => {
		latest.current = choice;
	});

	useEffect(() => {
		const node = line.current;
		if (!mounted || node === null) return;
		const made = createUnitPanel(node.ownerDocument, {
			searchTickers: deploymentTickerSearch(formId),
			onClose: ({ restoreFocus }) => {
				setOpen(false);
				if (restoreFocus) pill.current?.focus();
			}
		});
		node.appendChild(made.host);
		setPanel(made);
		return () => {
			made.stop();
			made.host.remove();
			setPanel(null);
			setOpen(false);
		};
	}, [mounted, formId, line, pill]);

	// the panel rebuilds its collection for every choice it is handed, and each projection is a new
	// one, so it is handed one only where something it draws has moved.
	useEffect(() => {
		if (panel === null) return;
		const options = choice.options as readonly UnitOption[];
		const key = [
			choice.value,
			choice.search ?? '',
			choice.stocks === true,
			...options.map((option) => `${option.value}${option.refused === true ? '!' : ''}`)
		].join('\n');
		if (drawn.current?.panel === panel && drawn.current.key === key) return;
		drawn.current = { panel, key };
		panel.update({
			value: choice.value,
			search: choice.search ?? '',
			options,
			stocks: choice.stocks === true,
			onChange: (value) => latest.current.set(value)
		});
	});

	const toggle = (): void => {
		const anchor = pill.current;
		const width = field.current;
		if (panel === null || anchor === null || width === null) return;
		if (open) {
			panel.close();
			setOpen(false);
			return;
		}
		setOpen(true);
		panel.open({ pill: anchor, field: width });
	};

	return { open, toggle };
}
