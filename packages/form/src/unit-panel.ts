// the "What you give" panel the unit pill opens on the first step: a search box over the currency,
// the served coins and, once the donor types, the stocks a ticker search finds.
//
// the card (./views.ts) and the deployment's own donation page (`src/lib/donate/` in packages/app)
// mount it alike: `createUnitPanel(doc, handlers)` hands back `host`, a node the caller places beside
// the pill, and
//
//   update(choice)   the list patched to `choice`, which is `unitSelect` (./connect.ts) narrowed to
//                    `UnitChoice` below;
//   open(anchor)     the panel shown over `anchor.pill`, as wide as `anchor.field`, the caret in its box;
//   close()          the panel hidden, reporting nothing;
//   focus()          the caret into the search box;
//   stop()           the machine, the ticker search and the listeners an open panel sets, stopped.
//
// the panel closes itself on a pick, on Escape in an empty search, on a press outside it and on a
// focus that leaves it, and reports each through `handlers.onClose`. `restoreFocus` is true for a pick
// and for Escape, where the caret has nowhere left to stand and the caller puts it back on the pill;
// false where the donor already took it somewhere else.
//
// a shadow root of its own: a host page's `input { … }` rule would otherwise reach the box. the panel
// stands in the top layer and is positioned against the viewport (./zag.ts); the registry's colour and
// type variables reach it by inheritance from where the caller places `host`, which is why it is
// placed inside the card rather than on the page's body.
//
// the look is the registry's combobox (./registry/styles/combobox-css.usage.md is the markup contract)
// on its select rows (select-css), with the marks and the panel's own placement in ./styles/units.css.
//
// zag's combobox machine runs the search box and the list. three things it does not: the panel's
// own open state, which the machine is held to (`open`); a press or a focus outside, because its
// layer would swallow Escape before the box saw it (`disableLayer`, and
// `dismissOutside` below); and Escape itself, which bubbles out of the box with its default already
// prevented by the machine and is answered by the host's own keydown listener below, which never
// skips an event for that.

import * as zag from '@zag-js/combobox';
import { normalizeProps, VanillaMachine } from '@zag-js/vanilla';
import comboboxStyles from './registry/styles/combobox-css.css?inline';
import fieldStyles from './registry/styles/field-css.css?inline';
import selectStyles from './registry/styles/select-css.css?inline';
import unitStyles from './styles/units.css?inline';
import { searchCoins } from './coins';
import { glyph } from './glyph';
import { createTickerSearch, stocksGroup, type TickerSearch } from './ticker-search';
import {
	COIN_REFUSED,
	FLAG_SRC,
	type FlagCountry,
	noStockMatch,
	UNIT_GROUPS,
	UNIT_PANEL_NAME,
	unitKey
} from './unit';
import type { TickerMatch } from './v1';
import { type Props, rootNodeOf, showWhile, spread } from './zag';

/** the currency or a served coin as `unitSelect` lists it, keyed by `unitKey` (./unit.ts). */
export type UnitOption = {
	readonly group: 'currency' | 'coin';
	readonly value: string;
	/** the code a row leads with: `USD`, `BTC`. */
	readonly label: string;
	/** the plain-text name on the row's second line. */
	readonly name: string;
	/** a currency's flag, where ./unit.ts's table has one. */
	readonly country?: FlagCountry;
	/** a coin's network, which the row badges where it is not the coin's own name. */
	readonly network?: string;
	/** a coin's own logo, as the processor serves it. */
	readonly logo?: string;
	/** a coin the account refused on this card: listed, and passed over. */
	readonly refused?: boolean;
};

/** `unitSelect` as the panel reads it, with `''` for nothing picked yet. */
export type UnitChoice = {
	readonly value: string;
	/** the search box's placeholder, and its hidden label. */
	readonly search: string;
	readonly options: readonly UnitOption[];
	/** whether a ticker search stands under the list once the donor types. */
	readonly stocks: boolean;
	readonly onChange: (value: string) => void;
};

export type UnitPanelHandlers = {
	/** `createTickerRead` (./embed/api.ts) on the card; the donation page's own read beside it. */
	readonly searchTickers: (query: string, signal: AbortSignal) => Promise<readonly TickerMatch[]>;
	readonly onClose: (detail: { readonly restoreFocus: boolean }) => void;
};

/** what an open panel stands against: the pill it covers and the field whose width it takes. */
export type UnitPanelAnchor = { readonly pill: HTMLElement; readonly field: HTMLElement };

export type UnitPanel = {
	readonly host: HTMLElement;
	update(choice: UnitChoice): void;
	open(anchor: UnitPanelAnchor): void;
	close(): void;
	focus(): void;
	stop(): void;
};

/** the sheets, built once per document for the reason `sheetFor` in ./embed/rows.ts builds its own. */
const sheets = new WeakMap<Document, readonly CSSStyleSheet[]>();

function sheetsFor(doc: Document): readonly CSSStyleSheet[] {
	const held = sheets.get(doc);
	if (held !== undefined) return held;
	const view = doc.defaultView;
	if (view === null) return [];
	// the order combobox-css.usage.md gives, its `variables` inherited rather than adopted, then the
	// form's own.
	const built = [fieldStyles, selectStyles, comboboxStyles, unitStyles].map((css) => {
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

type Group = 'currency' | 'coin' | 'stock';

/** what a row's 32px mark draws: an image over the letter it falls back to, a letter, or a stock. */
type Mark =
	| {
			readonly kind: 'image';
			readonly src: string;
			readonly letter: string;
			readonly remote: boolean;
	  }
	| { readonly kind: 'letter'; readonly letter: string }
	| { readonly kind: 'stock' };

/** one row of the list, in whichever group it is listed under. */
type Row = {
	readonly value: string;
	readonly group: Group;
	readonly label: string;
	readonly name: string;
	readonly badge: string | null;
	readonly refused: boolean;
	readonly mark: Mark;
};

/**
 * a coin's network is badged where it says something the coin's name does not: USDT on Tron and WBTC
 * on Ethereum carry one, Bitcoin on Bitcoin and Ethereum on Ethereum do not.
 */
function badgeOf(option: UnitOption): string | null {
	const network = option.network?.trim() ?? '';
	if (network === '' || network.toLowerCase() === option.name.trim().toLowerCase()) return null;
	return network;
}

function markOf(option: UnitOption): Mark {
	if (option.group === 'currency') {
		const letter = option.label.slice(0, 1);
		return option.country === undefined
			? { kind: 'letter', letter }
			: { kind: 'image', src: FLAG_SRC[option.country], letter, remote: false };
	}
	const letter = option.name.slice(0, 1).toUpperCase();
	return option.logo === undefined
		? { kind: 'letter', letter }
		: { kind: 'image', src: option.logo, letter, remote: true };
}

function rowOfOption(option: UnitOption): Row {
	return {
		value: option.value,
		group: option.group,
		label: option.label,
		name: option.name,
		badge: option.group === 'coin' ? badgeOf(option) : null,
		refused: option.refused === true,
		mark: markOf(option)
	};
}

function rowOfStock(match: TickerMatch): Row {
	return {
		value: unitKey({ kind: 'stock', ticker: match.symbol }),
		group: 'stock',
		label: match.symbol,
		name: match.name ?? '',
		badge: null,
		refused: false,
		mark: { kind: 'stock' }
	};
}

/**
 * a row's mark in the registry's 32px slot: a round disc holding the letter, with the image laid
 * over it or the stock glyph in its place.
 *
 * a coin's logo is the processor's, fetched into a page this project does not own, so it is drawn
 * lazy, with no referrer, and taken out on `error` so the letter under it shows. a flag is inline
 * (`FLAG_SRC` in ./unit.ts) and asks no origin.
 */
function markNode(doc: Document, mark: Mark): HTMLElement {
	const disc = node(doc, 'span', 'unit-mark');
	if (mark.kind === 'stock') disc.appendChild(glyph(doc, 'trending-up', 'unit-glyph'));
	else disc.appendChild(node(doc, 'span', 'unit-letter', [mark.letter]));
	if (mark.kind === 'image') {
		const image = node(doc, 'img', 'unit-image');
		image.alt = '';
		image.decoding = 'async';
		if (mark.remote) {
			image.loading = 'lazy';
			image.referrerPolicy = 'no-referrer';
		}
		image.src = mark.src;
		image.addEventListener('error', () => image.remove());
		disc.appendChild(image);
	}
	const slot = node(doc, 'span', 'ds-combobox-mark', [disc]);
	slot.setAttribute('aria-hidden', 'true');
	return slot;
}

/**
 * a row's nodes, the tick slot and the refusal line kept apart so a render can fill or empty the one
 * and place or take out the other: a row is kept by value across renders, and a coin can be refused
 * after its row was built.
 */
type RowNodes = {
	readonly row: HTMLElement;
	readonly text: HTMLElement;
	readonly reason: HTMLElement;
	readonly tick: HTMLElement;
};

/**
 * the registry's combobox row: the mark, the code with its badge on line one, the plain name under
 * it, and the tick slot. a stock row carries its ticker and its company name and nothing else: no
 * price and no estimate is fetched for it anywhere.
 */
function rowNodes(doc: Document, row: Row): RowNodes {
	const line = node(doc, 'span', 'ds-combobox-line', [
		node(doc, 'span', 'ds-option-label', [row.label])
	]);
	if (row.badge !== null) line.appendChild(node(doc, 'span', 'ds-combobox-badge', [row.badge]));
	const text = node(doc, 'span', 'ds-combobox-text', [line]);
	if (row.name !== '') text.appendChild(node(doc, 'span', 'ds-option-meta', [row.name]));
	const reason = node(doc, 'span', 'ds-option-meta', [COIN_REFUSED]);
	const tick = node(doc, 'span', 'ds-combobox-tick');
	tick.setAttribute('aria-hidden', 'true');
	const element = node(doc, 'div', 'ds-option ds-combobox-option', [
		markNode(doc, row.mark),
		text,
		tick
	]);
	return { row: element, text, reason, tick };
}

/** the machine's id, and the prefix of every id in the root. */
const ID = 'unit';

/** the groups in the order the list draws them. */
const GROUPS: readonly Group[] = ['currency', 'coin', 'stock'];

/**
 * what the list draws for the search as typed: its rows in order, and the one sentence a group says
 * under its heading. the Stocks group's is the ticker search's answer; with stocks off no search is
 * made, so a search that finds no row at all is said under the Crypto group instead, where the
 * registry's own example draws a no-match (./registry/styles/combobox-css.usage.md).
 */
type Listing = {
	readonly rows: readonly Row[];
	readonly said: { readonly group: Group; readonly sentence: string } | null;
	readonly collection: ReturnType<typeof zag.collection<Row>>;
};

/** the options of one group the search finds, in `searchCoins`' order (./coins.ts). */
function found(options: readonly UnitOption[], group: Group, query: string): Row[] {
	const searchable = options
		.filter((option) => option.group === group)
		.map((option) => ({
			// a coin is found by its processor code too (`searchCoins` in ./coins.ts); a currency by
			// its code, never by the list's own key.
			value: option.group === 'coin' ? option.value.slice('coin:'.length) : option.label,
			label: option.label,
			name: option.name,
			option
		}));
	return searchCoins(searchable, query).map((entry) => rowOfOption(entry.option));
}

/** `children` under `parent` in order, moved only where they differ: a moved row loses its hover. */
function place(parent: HTMLElement, children: readonly HTMLElement[]): void {
	children.forEach((child, at) => {
		const there = parent.children[at] ?? null;
		if (there !== child) parent.insertBefore(child, there);
	});
	while (parent.children.length > children.length) parent.lastElementChild?.remove();
}

/**
 * each root around `node`, its own first and the outermost last, with the host each shadow root
 * hangs from (null for the outermost). a closed root is reachable this way from inside it.
 */
function ringsAround(node: Node): { readonly root: Node; readonly host: Element | null }[] {
	const rings: { readonly root: Node; readonly host: Element | null }[] = [];
	let root = node.getRootNode();
	for (;;) {
		// read on a fragment only: a detached anchor can be a root too, and its `host` is its URL's.
		const host =
			root.nodeType === root.DOCUMENT_FRAGMENT_NODE
				? ((root as Partial<ShadowRoot>).host ?? null)
				: null;
		rings.push({ root, host });
		if (host === null) return rings;
		root = host.getRootNode();
	}
}

export function createUnitPanel(doc: Document, handlers: UnitPanelHandlers): UnitPanel {
	const host = doc.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	root.adoptedStyleSheets = [...sheetsFor(doc)];

	const label = node(doc, 'label', 'ds-sr-only');
	const input = node(doc, 'input', 'ds-combobox-input');
	const box = node(doc, 'div', 'ds-combobox-box', [glyph(doc, 'search', ''), input]);
	// in the panel rather than outside it: the donor types into a panel already showing, so the
	// region is in the tree before any sentence arrives in it.
	const status = node(doc, 'p', 'ds-sr-only');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	const list = node(doc, 'div', 'ds-combobox-list');
	const panel = node(doc, 'div', 'ds-combobox ds-combobox-popover unit-panel', [
		label,
		box,
		status,
		list
	]);
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-label', UNIT_PANEL_NAME);
	panel.setAttribute('popover', 'manual');
	root.appendChild(panel);

	const groups = new Map(
		GROUPS.map((group) => {
			const heading = node(doc, 'div', 'ds-combobox-heading', [UNIT_GROUPS[group]]);
			const message = node(doc, 'p', 'ds-combobox-message');
			message.id = `${ID}-${group}-message`;
			return [group, { element: node(doc, 'div', '', [heading]), heading, message }] as const;
		})
	);
	/** one set of nodes per row value, so a row a search hides and brings back is the same node. */
	const rowsByValue = new Map<string, RowNodes>();

	let current: UnitChoice | null = null;
	/** the search as typed, which narrows the currency and the coins and is what the stocks are asked. */
	let query = '';
	let stocks: TickerSearch = { status: 'idle' };
	let anchor: UnitPanelAnchor | null = null;
	let shown = false;
	/** the press and focus listeners an open panel sets, taken away when it closes. */
	let outside: AbortController | null = null;

	/**
	 * the listing for the search and the ticker answer standing now, rebuilt only when one of them or
	 * the choice changed, because the machine reads its collection on every lookup.
	 */
	let listed: {
		readonly query: string;
		readonly choice: UnitChoice | null;
		readonly stocks: TickerSearch;
		readonly listing: Listing;
	} | null = null;
	const listing = (): Listing => {
		const choice = current;
		if (listed?.query === query && listed.choice === choice && listed.stocks === stocks) {
			return listed.listing;
		}
		const options = choice?.options;
		const group = choice?.stocks === true ? stocksGroup(stocks) : null;
		const rows = [
			...found(options ?? [], 'currency', query),
			...found(options ?? [], 'coin', query),
			...(group !== null && 'rows' in group ? group.rows.map(rowOfStock) : [])
		];
		const searched = query.trim();
		const next: Listing = {
			rows,
			said:
				group !== null && 'sentence' in group
					? { group: 'stock', sentence: group.sentence }
					: choice?.stocks !== true && searched !== '' && rows.length === 0
						? { group: 'coin', sentence: noStockMatch(searched) }
						: null,
			collection: zag.collection({
				items: rows,
				itemToValue: (row) => row.value,
				itemToString: (row) => row.label,
				isItemDisabled: (row) => row.refused
			})
		};
		listed = { query, choice, stocks, listing: next };
		return next;
	};

	/** where the panel's top edge stands: the pill's top, ending at the pill's right, the field wide. */
	const anchorRect = () => {
		if (anchor === null) return null;
		const pill = anchor.pill.getBoundingClientRect();
		const width = anchor.field.getBoundingClientRect().width;
		return { x: pill.right - width, y: pill.top, width, height: 0 };
	};

	const machine = new VanillaMachine(zag.machine, () => ({
		id: ID,
		ids: {
			label: `${ID}-label`,
			control: `${ID}-control`,
			input: `${ID}-input`,
			positioner: `${ID}-panel`,
			content: `${ID}-list`,
			item: (value: string) => `${ID}-option-${value}`,
			itemGroup: (group: string | number) => `${ID}-group-${group}`,
			itemGroupLabel: (group: string | number) => `${ID}-heading-${group}`
		},
		getRootNode: rootNodeOf(box, doc),
		collection: listing().collection,
		value: current === null || current.value === '' ? [] : [current.value],
		open: shown,
		disableLayer: true,
		inputBehavior: 'autohighlight' as const,
		// the box holds a search and nothing else; the pill is what names the pick.
		selectionBehavior: 'clear' as const,
		positioning: {
			placement: 'bottom-start' as const,
			strategy: 'fixed' as const,
			gutter: 0,
			sameWidth: true,
			flip: false,
			getAnchorRect: anchorRect
		},
		onInputValueChange: ({ inputValue }: zag.InputValueChangeDetails) => {
			query = inputValue;
			if (current?.stocks === true) tickers.search(inputValue);
		},
		// on every pick, the picked row again included, which `onValueChange` does not hear: a re-pick
		// is how a coin whose price check failed is asked again (`SET_UNIT` in ./checkout.machine.ts).
		onSelect: ({ itemValue }: zag.SelectionDetails) => {
			current?.onChange(itemValue);
			dismiss(true);
		}
	}));

	/**
	 * has the machine re-read what changed outside it — the panel's open state, the options, a ticker
	 * answer. it runs its watchers on those only when it publishes, and it publishes on its own state
	 * and context alone. `notify` is that publish, a public field at runtime and `private` in
	 * `dist/machine.d.ts` of `@zag-js/vanilla` 1.43.3, read with `@zag-js/combobox` 1.43.3; that
	 * version has no public publish. `updateProps`, the typed way, nests one more closure around the
	 * props on every call, and every prop read then runs through all of them.
	 */
	const publish = (): void => (machine as unknown as { notify(): void }).notify();

	const tickers = createTickerSearch({
		search: (text, signal) => handlers.searchTickers(text, signal),
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
		onChange: (state) => {
			stocks = state;
			publish();
		}
	});

	const rowFor = (row: Row): RowNodes => {
		const kept = rowsByValue.get(row.value);
		if (kept !== undefined) return kept;
		const built = rowNodes(doc, row);
		rowsByValue.set(row.value, built);
		return built;
	};

	const render = (): void => {
		const choice = current;
		if (choice === null) return;
		const api = zag.connect(machine.service, normalizeProps);
		spread(panel, api.getPositionerProps() as Props, ID);
		spread(label, api.getLabelProps() as Props, ID);
		spread(box, api.getControlProps() as Props, ID);
		spread(input, api.getInputProps() as Props, ID);
		spread(list, api.getContentProps() as Props, ID);
		if (label.textContent !== choice.search) label.textContent = choice.search;
		input.placeholder = choice.search;

		const now = listing();
		const sentence = now.said?.sentence ?? null;
		const drawn: HTMLElement[] = [];
		for (const key of GROUPS) {
			const group = groups.get(key);
			const mine = now.rows.filter((row) => row.group === key);
			const said = now.said?.group === key ? sentence : null;
			// a group draws only with rows or a sentence of its own: a bare heading reads as an empty
			// section, so the Stocks group stays away until a search has answered.
			if (group === undefined || (mine.length === 0 && said === null)) continue;
			spread(group.element, api.getItemGroupProps({ id: key }) as Props, ID);
			spread(group.heading, api.getItemGroupLabelProps({ htmlFor: key }) as Props, ID);
			const nodes = mine.map((row) => {
				const { row: element, text, reason, tick } = rowFor(row);
				spread(element, api.getItemProps({ item: row }) as Props, ID);
				if (row.refused !== (reason.parentNode === text)) {
					if (row.refused) text.appendChild(reason);
					else reason.remove();
				}
				const picked = api.getItemState({ item: row }).selected;
				if (picked !== (tick.firstChild !== null)) {
					tick.replaceChildren(...(picked ? [glyph(doc, 'tick', '')] : []));
				}
				return element;
			});
			if (said === null) group.element.removeAttribute('aria-describedby');
			else group.element.setAttribute('aria-describedby', group.message.id);
			if (group.message.textContent !== (said ?? '')) group.message.textContent = said ?? '';
			place(group.element, [group.heading, ...nodes, ...(said === null ? [] : [group.message])]);
			drawn.push(group.element);
		}
		place(list, drawn);
		// written only on a change: a live region rewritten with the same words may say them again.
		if (status.textContent !== (sentence ?? '')) status.textContent = sentence ?? '';
		showWhile(panel, shown);
	};
	machine.subscribe(render);

	/** hides the panel and starts its next opening on an empty search. */
	const hide = (): void => {
		shown = false;
		outside?.abort();
		outside = null;
		zag.connect(machine.service, normalizeProps).setInputValue('');
		publish();
	};

	const dismiss = (restoreFocus: boolean): void => {
		if (!shown) return;
		hide();
		handlers.onClose({ restoreFocus });
	};

	/**
	 * a press outside the panel and the pill, or a focus that leaves the panel, closes it: the donor
	 * has moved on, so the caret is left where they took it. a press on the pill is the caller's own
	 * toggle and is left to it.
	 */
	const dismissOutside = (): void => {
		outside = new AbortController();
		const { signal } = outside;
		const ours = (target: Node) => panel.contains(target) || anchor?.pill.contains(target) === true;
		// a press is judged on every root from the host's out to the document, because a page may
		// hold the form inside a closed shadow root of its own, and the path an outer root sees then
		// stops at that root's host. a root whose path enters a root further in leaves the press to
		// that root's listener, which sees deeper; a press that never enters one is judged where it
		// stops.
		const rings = ringsAround(host);
		rings.forEach((ring, index) => {
			const further: readonly EventTarget[] = rings
				.slice(0, index)
				.flatMap((inner) => (inner.host === null ? [] : [inner.host]));
			ring.root.addEventListener(
				'pointerdown',
				(event) => {
					const path = event.composedPath();
					if (path.some((target) => target instanceof Node && ours(target))) return;
					if (path.some((target) => further.includes(target))) return;
					dismiss(false);
				},
				{ capture: true, signal }
			);
		});
		panel.addEventListener(
			'focusout',
			(event) => {
				const next = event.relatedTarget;
				if (next instanceof Node && !ours(next)) dismiss(false);
			},
			{ signal }
		);
	};

	// Escape reaches the host with its default prevented by the machine's own handler on the box,
	// which is the event this answers: a typed search is cleared first, an empty one closes the panel.
	// it goes no further once answered, so one press never also closes something around the card.
	host.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !shown) return;
		event.stopPropagation();
		if (query !== '') zag.connect(machine.service, normalizeProps).setInputValue('');
		else dismiss(true);
	});

	machine.start();

	return {
		host,
		update(choice) {
			current = choice;
			publish();
		},
		open(next) {
			anchor = next;
			if (shown) return;
			shown = true;
			dismissOutside();
			publish();
			input.focus();
		},
		close() {
			if (shown) hide();
		},
		focus() {
			input.focus();
		},
		stop() {
			outside?.abort();
			outside = null;
			tickers.dispose();
			machine.stop();
			showWhile(panel, false);
		}
	};
}
