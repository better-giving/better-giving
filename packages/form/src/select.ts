// the closed choice a donor makes in one control: the cause a gift is credited to, and how a
// tribute is dedicated. zag's select machine (`@zag-js/select`, driven through `@zag-js/vanilla`)
// runs it — the machine `@ark-ui/react`'s `Select` is built on, so a react surface drawing that
// component answers a key the way this one does.
//
// what the machine owns and nothing here overrides: the listbox pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) with the box as its `role="combobox"`, the
// arrow keys, typeahead, Enter and Space, Escape back to the box, the pointer, and the dismissal on a
// press outside. what this file owns is the nodes the machine's props are spread onto, and two
// things about the page the card lands on.
//
// the list stands in the top layer, and the machine's style is written property by property, for
// the reasons ./zag.ts gives.
//
// the machine is started on the first `update`, because that is where the options arrive, and its
// root node is the node the box is standing in — the card's shadow root — so the machine's lookups
// by id and its outside-press test are scoped to that root rather than to the host's document.

import * as zag from '@zag-js/select';
import { normalizeProps, VanillaMachine } from '@zag-js/vanilla';
import { glyph } from './glyph';
import { part, partWhen } from './parts';
import { lostWhileOpen, type Props, rootNodeOf, showWhile, spread } from './zag';

type Choice = { readonly value: string; readonly label: string };

/** a closed choice as ./connect.ts projects it, which is what `update` reads. */
export type SelectChoice = {
	readonly value: string;
	readonly options: readonly Choice[];
	readonly onChange: (value: string) => void;
};

export type SelectBox = {
	readonly label: HTMLLabelElement;
	/** the closed box, which carries `part="field"` and is what the label names. */
	readonly trigger: HTMLButtonElement;
	/** the open list's positioner, laid out nowhere while the list is closed. */
	readonly list: HTMLElement;
	update(choice: SelectChoice): void;
	/** closes a list a move took off the screen (`lostWhileOpen` in ./zag.ts). */
	reattached(): void;
	/**
	 * stops the machine and the listeners an open list sets on the host's document; safe to repeat.
	 * what zag writes to the host's window and body past this is in ./zag.ts's header.
	 */
	stop(): void;
};

/**
 * one closed choice, its label included.
 *
 * `id` is the box's own id, so a label or a test naming `#program` still finds the control a donor
 * operates. `hideLabel` is for a box whose resting option already says what it is for, where the
 * words are for the accessible name alone.
 */
export function createSelect(
	doc: Document,
	id: string,
	labelText: string,
	hideLabel = false
): SelectBox {
	const label = doc.createElement('label');
	label.setAttribute('part', part('label'));
	if (hideLabel) label.className = 'vh';
	label.textContent = labelText;

	// every option's words stacked in one cell, the chosen one visible: the box is as wide as its
	// longest option whichever is chosen, so the tribute's name beside it does not move when the kind
	// changes (`.dedication` in ./styles/layout.css).
	const words = doc.createElement('span');
	words.className = 'select-words';
	const trigger = doc.createElement('button');
	// the box stands in the card's `<form>`, and a button there with no type submits it. set here
	// rather than left to the machine's props, which reach it only on the first `update`.
	trigger.type = 'button';
	trigger.setAttribute('part', part('field'));
	trigger.appendChild(words);
	trigger.appendChild(glyph(doc, 'chevron', 'glyph'));

	const content = doc.createElement('div');
	content.setAttribute('part', part('select-list'));
	const list = doc.createElement('div');
	list.setAttribute('popover', 'manual');
	list.appendChild(content);

	const run = (value: string, options: readonly Choice[]) =>
		new VanillaMachine(zag.machine, {
			id,
			ids: {
				root: `${id}-root`,
				label: `${id}-label`,
				trigger: id,
				positioner: `${id}-positioner`,
				content: `${id}-list`,
				item: (item: string | number) => `${id}-option-${item}`
			},
			getRootNode: rootNodeOf(trigger, doc),
			collection: zag.collection({
				items: [...options],
				itemToValue: (item) => item.value,
				itemToString: (item) => item.label
			}),
			defaultValue: [value],
			positioning: { placement: 'bottom-start', strategy: 'fixed', gutter: 0 },
			onValueChange: ({ value: picked }) => {
				const next = picked[0];
				if (next !== undefined && next !== current?.value) current?.onChange(next);
			}
		});

	let machine: ReturnType<typeof run> | null = null;
	let current: SelectChoice | null = null;
	const rows = new Map<string, { row: HTMLElement; tick: SVGElement; word: HTMLElement }>();

	const render = (): void => {
		if (machine === null || current === null) return;
		const api = zag.connect(machine.service, normalizeProps);
		// the label's `for` names the hidden native select the machine can render for a form post, and
		// this box draws none: the card submits through the flow, never through a form. its click
		// handler is what puts the caret on the box instead.
		const { for: _for, ...labelProps } = api.getLabelProps() as Props;
		spread(label, labelProps, id);
		spread(trigger, api.getTriggerProps() as Props, id);
		spread(list, api.getPositionerProps() as Props, id);
		spread(content, api.getContentProps() as Props, id);
		const chosen = api.value[0];
		for (const item of api.collection.items) {
			const node = rows.get(item.value);
			if (node === undefined) continue;
			const state = api.getItemState({ item });
			spread(node.row, api.getItemProps({ item }) as Props, id);
			spread(node.tick, api.getItemIndicatorProps({ item }) as Props, id);
			node.row.setAttribute('part', partWhen('select-option', { selected: state.selected }));
			node.word.toggleAttribute('data-chosen', item.value === chosen);
		}
		showWhile(list, api.open);
	};

	const build = (choice: SelectChoice): void => {
		for (const option of choice.options) {
			const word = doc.createElement('span');
			word.textContent = option.label;
			words.appendChild(word);
			const text = doc.createElement('span');
			text.textContent = option.label;
			const tick = glyph(doc, 'tick', 'tick');
			const row = doc.createElement('div');
			row.appendChild(text);
			row.appendChild(tick);
			content.appendChild(row);
			rows.set(option.value, { row, tick, word });
		}
		machine = run(choice.value, choice.options);
		machine.subscribe(render);
		machine.start();
	};

	return {
		label,
		trigger,
		list,
		update(choice) {
			const first = current === null;
			current = choice;
			if (first) build(choice);
			// the flow is the one holding the answer. the machine is told only when the two disagree,
			// which is a value the flow settled without a pick — a resumed gift, a trip back a step.
			const api = machine === null ? null : zag.connect(machine.service, normalizeProps);
			if (api !== null && api.value[0] !== choice.value) api.setValue([choice.value]);
			render();
		},
		reattached() {
			if (machine === null) return;
			const api = zag.connect(machine.service, normalizeProps);
			if (lostWhileOpen(list, api.open)) api.setOpen(false);
		},
		stop() {
			machine?.stop();
			machine = null;
			showWhile(list, false);
		}
	};
}
