// the amount step's unit: the pill naming what the gift is given in, and the panel it opens — a box a
// donor searches in, a line saying what the list mixes, and the rows grouped under it.
//
// the pill is a button and the panel a non-modal popover in the top layer, whose top right stands on
// the pill's top right and whose width is the line the pill ends (`cover` below), so it covers the
// pill and the "How much" line and its search box stands where the pill was. the list is zag's
// combobox machine, as the coin list's is (./coin-picker.ts): the box is an editable
// `role="combobox"`, the highlight is `aria-activedescendant`, and the caret never leaves the box. the
// pill is the machine's trigger, which is what opens the list on a press and puts the caret in the
// box, and what Escape gives the caret back to.
//
// its own shadow root, for the coin list's reason about ids: the pill names the list it controls and
// the box names the line describing it, and every relationship stays inside one root. the parts it
// draws reach a host page through `exportparts` on the host.
//
// no flow logic: which units, which is picked and which were refused are `unitSelect` (./connect.ts),
// which groups stand and their words are ./unit.ts, and the order a search lists rows in is
// `searchCoins` (./coins.ts), run on each group alone over each unit's `code` rather than its value.

import * as zag from '@zag-js/combobox';
import { normalizeProps, VanillaMachine } from '@zag-js/vanilla';
import badgeStyles from './registry/styles/badge-css.css?inline';
import buttonStyles from './registry/styles/button-css.css?inline';
import partStyles from './styles/parts.css?inline';
import coinStyles from './styles/coins.css?inline';
import unitStyles from './styles/unit.css?inline';
import { REFUSED, roundMark, words } from './coin-picker';
import { searchCoins } from './coins';
import { glyph } from './glyph';
import { part, partWhen } from './parts';
import type { UnitWords } from './unit';
import { lostWhileOpen, type Props, rootNodeOf, showWhile, spread } from './zag';

/** one unit as `unitSelect` lists it. */
export type UnitOption = {
	readonly value: string;
	/** the code `value` carries without the half it is filed under: `USD`, `usdttrc20`. */
	readonly code: string;
	readonly kind: 'currency' | 'coin';
	/** the code the unit is shown under: `USD`, `BTC`. */
	readonly label: string;
	readonly name: string;
	/** a currency's symbol, which its mark holds. */
	readonly symbol?: string;
	/** a coin's network, drawn as its badge. */
	readonly network?: string;
	/** a coin's own logo, where the served list carries one. */
	readonly logo?: string;
	readonly refused: boolean;
};

export type UnitChoice = {
	readonly value: string;
	readonly options: readonly UnitOption[];
	readonly onChange: (value: string) => void;
};

export type UnitPicker = {
	/** the node the amount step stands at the end of its "How much" line. */
	readonly host: HTMLElement;
	update(choice: UnitChoice): void;
	/** the caret onto the pill, which is where a way back to the unit puts it. */
	focus(): void;
	/** closes a list a move took off the screen (`lostWhileOpen` in ./zag.ts). */
	reattached(): void;
	/** stops the machine and the listeners an open list sets on the host's document; safe to repeat. */
	stop(): void;
};

export type UnitPickerOptions = {
	/** a unit picked, after the panel closed: the caret goes on to the figure, the next decision. */
	readonly picked: () => void;
	/** the line the panel covers, whose width it takes; the pill's own box where it returns none. */
	readonly cover?: () => HTMLElement | null;
	/** whether the stocks group stands (`UnitRails.stocks` in ./unit.ts). */
	readonly stocks?: boolean;
};

/** the listbox's name, and the pill's spoken name before the code. */
const NAME = 'What you give';

/** each group's heading, in the fixed order the groups stand in. */
const GROUPS = [
	{ id: 'currency', heading: 'Currencies' },
	{ id: 'coin', heading: 'Crypto' }
] as const;

/** the stocks group's heading, and what it says in place of rows while nothing is typed. */
const STOCKS = 'Stocks';
const STOCKS_HINT = 'Type a ticker or company name, like AAPL.';

/** what the status says a search found, written only when it changes. */
function found(count: number): string {
	return count === 1 ? '1 result' : `${count} results`;
}

/** the sheets, built once per document for the reason `sheetFor` in ./embed/rows.ts builds its own. */
const sheets = new WeakMap<Document, readonly CSSStyleSheet[]>();

function sheetsFor(doc: Document): readonly CSSStyleSheet[] {
	const held = sheets.get(doc);
	if (held !== undefined) return held;
	const view = doc.defaultView;
	if (view === null) return [];
	// the registry's two before the form's own three, which adjust and place what they paint.
	const built = [buttonStyles, badgeStyles, partStyles, coinStyles, unitStyles].map((css) => {
		const sheet = new view.CSSStyleSheet();
		sheet.replaceSync(css);
		return sheet;
	});
	sheets.set(doc, built);
	return built;
}

function node<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	className: string,
	children: readonly (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const element = doc.createElement(tag);
	if (className !== '') element.className = className;
	for (const child of children) {
		element.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
	}
	return element;
}

/** a row's two lines: the code over a currency's name, or over a coin's network badge. */
function rowWords(doc: Document, option: UnitOption): HTMLElement {
	if (option.kind === 'coin')
		return words(doc, { label: option.label, network: option.network ?? '' });
	return node(doc, 'span', 'coin-text', [
		node(doc, 'span', 'coin-ticker', [option.label]),
		node(doc, 'span', 'unit-name', [option.name])
	]);
}

const ID = 'unit';

export function createUnitPicker(
	doc: Document,
	text: UnitWords,
	options: UnitPickerOptions
): UnitPicker {
	const host = doc.createElement('div');
	host.className = 'unit';
	host.setAttribute('exportparts', 'unit-pill, select-list, select-option, field');
	const root = host.attachShadow({ mode: 'open' });
	root.adoptedStyleSheets = [...sheetsFor(doc)];

	const code = node(doc, 'span', 'unit-code');
	const pill = node(doc, 'button', 'ds-btn ds-btn-sm', [
		code,
		glyph(doc, 'chevron', 'unit-chevron')
	]);
	pill.setAttribute('part', part('unit-pill'));

	const input = node(doc, 'input', '');
	input.setAttribute('aria-label', text.placeholder);
	const box = node(doc, 'div', 'picker', [glyph(doc, 'search', 'glyph'), input]);
	box.setAttribute('part', part('field'));
	const hint = node(doc, 'p', 'unit-hint', [text.hint]);
	hint.id = 'unit-hint';
	hint.hidden = text.hint === '';
	if (!hint.hidden) input.setAttribute('aria-describedby', hint.id);

	const content = node(doc, 'div', 'unit-list');
	// the sentence standing where the rows would when a search finds none, beside the listbox rather
	// than in it, for the reason ./coin-picker.ts gives for its own.
	const noMatch = node(doc, 'p', 'no-match', [text.noMatch]);
	noMatch.setAttribute('aria-hidden', 'true');
	noMatch.hidden = true;
	const panel = node(doc, 'div', 'unit-panel', [box, hint, content, noMatch]);
	panel.setAttribute('part', part('select-list'));
	const positioner = node(doc, 'div', '', [panel]);
	positioner.setAttribute('popover', 'manual');
	const status = node(doc, 'p', 'vh');
	status.setAttribute('role', 'status');

	root.append(pill, positioner, status);

	let current: UnitChoice | null = null;
	let query = '';
	/** set by a pick and spent on the pill taking the caret back, which the machine does on close. */
	let handOff = false;

	const groups = new Map<string, { readonly group: HTMLElement; readonly heading: HTMLElement }>();
	const rows = new Map<
		string,
		{ readonly row: HTMLElement; readonly note: HTMLElement; readonly tick: SVGElement }
	>();
	const stocksHint = node(doc, 'p', 'unit-hint', [STOCKS_HINT]);

	let searched: {
		readonly query: string;
		readonly options: readonly UnitOption[];
		readonly collection: ReturnType<typeof zag.collection<UnitOption>>;
	} | null = null;
	/**
	 * each group searched on its own and laid end to end; `render` draws each group's rows in this
	 * order, so the keys walk the rows as drawn.
	 */
	const collectionNow = () => {
		const all = current?.options ?? [];
		if (searched === null || searched.query !== query || searched.options !== all) {
			searched = {
				query,
				options: all,
				collection: zag.collection({
					items: GROUPS.flatMap(({ id }) =>
						searchCoins(
							all
								.filter((option) => option.kind === id)
								.map((option) => ({ ...option, value: option.code, option })),
							query
						).map(({ option }) => option)
					),
					itemToValue: (option) => option.value,
					itemToString: (option) => option.label,
					isItemDisabled: (option) => option.refused
				})
			};
		}
		return searched.collection;
	};

	const getRootNode = rootNodeOf(pill, doc);
	/** the line the panel covers, from the pill's top: the panel's top right is the pill's. */
	const anchorRect = () => {
		const own = pill.getBoundingClientRect();
		const line = options.cover?.()?.getBoundingClientRect() ?? own;
		return { x: line.left, y: Math.min(line.top, own.top), width: line.width, height: 0 };
	};
	const run = () =>
		new VanillaMachine(zag.machine, () => ({
			id: ID,
			ids: {
				input: `${ID}-search`,
				trigger: `${ID}-pill`,
				positioner: `${ID}-positioner`,
				content: `${ID}-list`,
				itemGroup: (id: string | number) => `${ID}-group-${id}`,
				itemGroupLabel: (id: string | number) => `${ID}-group-${id}-heading`,
				item: (value: string) => `${ID}-option-${value}`
			},
			getRootNode,
			collection: collectionNow(),
			defaultValue: current === null ? [] : [current.value],
			inputBehavior: 'autohighlight' as const,
			selectionBehavior: 'clear' as const,
			positioning: {
				placement: 'bottom-start' as const,
				strategy: 'fixed' as const,
				gutter: 0,
				flip: false,
				sameWidth: true,
				getAnchorRect: anchorRect
			},
			onInputValueChange: ({ inputValue }: zag.InputValueChangeDetails) => {
				query = inputValue;
			},
			onValueChange: ({ value }: zag.ValueChangeDetails<UnitOption>) => {
				const next = value[0];
				if (next === undefined) return;
				handOff = true;
				if (next !== current?.value) current?.onChange(next);
			},
			// the box, the hint and the no-match sentence are the panel's own surface and not outside it.
			onPointerDownOutside: (event: zag.PointerDownOutsideEvent) => {
				const { target } = event.detail;
				if (target instanceof Node && panel.contains(target)) event.preventDefault();
			}
		}));

	let machine: ReturnType<typeof run> | null = null;
	/** the collection the rows were last put in the order of; a row it drops stays, hidden, ahead. */
	let ordered: ReturnType<typeof collectionNow> | null = null;
	const connected = () => (machine === null ? null : zag.connect(machine.service, normalizeProps));

	const render = (): void => {
		const api = connected();
		if (api === null || current === null) return;
		const choice = current;
		const picked = choice.options.find((option) => option.value === choice.value);
		const label = picked?.label ?? '';

		spread(pill, api.getTriggerProps({ focusable: true }) as Props, ID);
		pill.setAttribute('aria-label', `${NAME}: ${label}`);
		pill.setAttribute('aria-controls', `${ID}-list`);
		// covered by the panel while it is open, so it is no second stop on the way out of it.
		pill.tabIndex = api.open ? -1 : 0;
		if (code.textContent !== label) code.textContent = label;

		spread(input, api.getInputProps() as Props, ID);
		input.placeholder = text.placeholder;
		spread(positioner, api.getPositionerProps() as Props, ID);
		spread(content, api.getContentProps() as Props, ID);
		content.removeAttribute('aria-labelledby');
		content.setAttribute('aria-label', NAME);

		const collection = collectionNow();
		if (ordered !== collection) {
			ordered = collection;
			for (const option of collection.items) {
				const row = rows.get(option.value)?.row;
				if (row !== undefined) row.parentElement?.appendChild(row);
			}
		}
		for (const option of choice.options) {
			const entry = rows.get(option.value);
			if (entry === undefined) continue;
			spread(entry.row, api.getItemProps({ item: option }) as Props, ID);
			entry.row.setAttribute(
				'part',
				partWhen('select-option', { selected: api.getItemState({ item: option }).selected })
			);
			spread(entry.tick, api.getItemIndicatorProps({ item: option }) as Props, ID);
			entry.row.hidden = !collection.has(option.value);
			entry.note.hidden = !option.refused;
		}
		for (const [id, { group, heading }] of groups) {
			spread(group, api.getItemGroupProps({ id }) as Props, ID);
			spread(heading, api.getItemGroupLabelProps({ htmlFor: id }) as Props, ID);
			group.hidden = !collection.items.some((option) => option.kind === id);
		}
		// the stocks group says what to type while nothing is, and holds no rows to narrow yet.
		const stocksGroup = groups.get('stock');
		if (stocksGroup !== undefined) stocksGroup.group.hidden = query.trim() !== '';
		stocksHint.hidden = query.trim() !== '';

		const said = !api.open ? '' : collection.size === 0 ? text.noMatch : found(collection.size);
		// written only on a change: a live region rewritten with the same words may say them again.
		if (status.textContent !== said) status.textContent = said;
		noMatch.hidden = !api.open || collection.size !== 0;

		showWhile(positioner, api.open);
		if (!api.open && api.inputValue !== '') api.setInputValue('');
	};

	const build = (choice: UnitChoice): void => {
		for (const { id, heading } of GROUPS) {
			const members = choice.options.filter((option) => option.kind === id);
			if (members.length === 0) continue;
			const head = node(doc, 'p', 'unit-group-heading', [heading]);
			const group = node(doc, 'div', 'unit-group', [head]);
			for (const option of members) {
				const note = node(doc, 'span', 'message', [REFUSED]);
				const tick = glyph(doc, 'tick', 'tick');
				const mark =
					option.kind === 'currency'
						? roundMark(doc, option.symbol ?? option.label.slice(0, 1), undefined)
						: roundMark(doc, option.name.slice(0, 1), option.logo);
				const row = node(doc, 'div', 'option', [mark, rowWords(doc, option), note, tick]);
				group.appendChild(row);
				rows.set(option.value, { row, note, tick });
			}
			content.appendChild(group);
			groups.set(id, { group, heading: head });
		}
		if (options.stocks === true) {
			const head = node(doc, 'p', 'unit-group-heading', [STOCKS]);
			const group = node(doc, 'div', 'unit-group', [head, stocksHint]);
			content.appendChild(group);
			groups.set('stock', { group, heading: head });
		}
		machine = run();
		machine.subscribe(render);
		machine.start();
	};

	// a pick closes the panel and the machine hands the caret back to the pill; the figure is the
	// next decision, so it goes on there.
	pill.addEventListener('focus', () => {
		if (!handOff) return;
		handOff = false;
		options.picked();
	});
	// the down arrow opens the list the way a press does, caret in the box.
	pill.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowDown') return;
		event.preventDefault();
		pill.click();
	});
	// the caret stays in the box, as zag keeps it there on a press on the listbox.
	panel.addEventListener('pointerdown', (event) => {
		if (event.target !== input) event.preventDefault();
	});

	return {
		host,
		update(choice) {
			const first = current === null;
			current = choice;
			if (first) build(choice);
			const api = connected();
			if (api !== null && api.value.join() !== choice.value) api.setValue([choice.value]);
			render();
		},
		focus() {
			pill.focus();
		},
		reattached() {
			const api = connected();
			if (api !== null && lostWhileOpen(positioner, api.open)) api.setOpen(false);
		},
		stop() {
			machine?.stop();
			machine = null;
			showWhile(positioner, false);
		}
	};
}
