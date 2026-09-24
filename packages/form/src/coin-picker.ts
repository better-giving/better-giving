// the coin list a `crypto` gift is chosen in: a box a donor searches in and the list it narrows.
//
// the card draws it (`coins` on `CardView` in ./views.ts) and the crypto option stands it in its row
// (./embed/nowpayments.ts), which is a light-DOM node for the reason ./embed/rows.ts gives. so it
// carries a shadow root of its own: a host page's `input { … }` rule would otherwise reach the box.
// every id below is inside that root, which is what lets the label, the list and the sentence under
// the box be referenced from it.
//
// zag's combobox machine (`@zag-js/combobox`, driven through `@zag-js/vanilla`) runs it — the machine
// `@ark-ui/react`'s `Combobox` is built on — with the combobox pattern and a listbox
// (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): the box is an editable `role="combobox"`, the
// highlight is `aria-activedescendant`, and the caret never leaves the box. what the machine owns is
// the arrow keys, Enter, Escape, the pointer, and the dismissal on a press or a focus outside, Tab
// out of the box included. a refused coin stays listed, and the machine reads it as a disabled item:
// `aria-disabled`, passed over by the arrow keys and taken by no press.
//
// the list stands in the top layer, and the machine's style is written property by property, for
// the reasons ./zag.ts gives; the machine's root node is this shadow root.
//
// the search is the whole of how a donor narrows the list, and nothing else in this root takes a
// press: the box and the rows are all a pointer can reach, so nothing `aria-activedescendant` can
// name is anything but an option. a press anywhere on the box is a press on its input.
//
// a row is a mark and two lines: the ticker on the first, the network's pill on the second, and the
// closed box reads the same way along one line. the coin's name is drawn nowhere — it says again
// what the ticker and the pill already say, and a two-word network pushing it onto a second line was
// a row that changed height for nothing. it stays on the option for two readings that are not a row:
// a donor typing it still finds the coin (`searchCoins` in ./coins.ts), and its first letter is the
// lettered mark a missing logo falls back to.
//
// no flow logic: which coins, which is picked and which were refused are `coinSelect` (./connect.ts),
// the order a search lists them in is ./coins.ts — the machine's collection is that search's answer,
// never a filter of its own — and the sentence under the box is the card's.

import * as zag from '@zag-js/combobox';
import { normalizeProps, VanillaMachine } from '@zag-js/vanilla';
import partStyles from './styles/parts.css?inline';
import coinStyles from './styles/coins.css?inline';
import { networkTint, searchCoins } from './coins';
import { glyph } from './glyph';
import { part, partWhen } from './parts';
import { lostWhileOpen, type Props, rootNodeOf, showWhile, spread } from './zag';

/**
 * one coin as `coinSelect` lists it.
 *
 * exported because ./views.ts narrows the same list to it on the way in: one shape, so a field added
 * to what a row draws is added in one place rather than in two that drift.
 */
export type CoinOption = {
	readonly value: string;
	readonly label: string;
	readonly name: string;
	readonly network: string;
	/** the processor's own logo for the coin, absent where its list carries none. */
	readonly logo?: string;
	readonly refused: boolean;
};

/** the choice as `coinSelect` projects it, with `''` for none. */
export type CoinChoice = {
	readonly value: string;
	readonly options: readonly CoinOption[];
	readonly onChange: (value: string) => void;
};

export type CoinPicker = {
	/** the node the crypto option stands in its row. */
	readonly host: HTMLElement;
	/** the list patched to `choice`, and `problem` said under the box — `''` for nothing wrong. */
	update(choice: CoinChoice, problem: string): void;
	/** the caret into the box, which is where a refusal about the coin sends it. */
	focus(): void;
	/** closes a list a move took off the screen (`lostWhileOpen` in ./zag.ts). */
	reattached(): void;
	/**
	 * stops the machine and the listeners an open list sets on the host's document; safe to repeat.
	 * what zag writes to the host's window and body past this is in ./zag.ts's header.
	 */
	stop(): void;
};

/** what the box asks while closed with nothing picked, and while open for a search. */
const CHOOSE = 'Choose a coin';
const SEARCH = 'Search by symbol or name';

/** what the list says when a search finds no coin. */
const NO_MATCH = 'No coin matches';

/** the sentence a refused coin carries in the list, under its own unchanged label. */
const REFUSED = 'no longer accepted';

/** the sheets, built once per document for the reason `sheetFor` in ./embed/rows.ts builds its own. */
const sheets = new WeakMap<Document, readonly CSSStyleSheet[]>();

function sheetsFor(doc: Document): readonly CSSStyleSheet[] {
	const held = sheets.get(doc);
	if (held !== undefined) return held;
	const view = doc.defaultView;
	if (view === null) return [];
	const built = [partStyles, coinStyles].map((css) => {
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

/**
 * a coin's mark: the processor's own logo where the list carries one, standing in the round lettered
 * shape it falls back to.
 *
 * the image is a third party's, in a page this project does not own, and the fallback is what makes
 * that safe: a host's `img-src` policy, a request that failed and a path that stopped resolving all
 * end at the same `error`, which takes the image out and leaves the letter under it showing. the row
 * loses a picture and nothing else, because the ticker beside it is what names the coin.
 *
 * lazy, and sized by the sheet rather than by the file: the list is closed until a donor opens it, so
 * nothing is fetched on the step the box is drawn on, and a row stands at the same height before and
 * after its image arrives. the referrer is withheld because the host page's url is not the
 * processor's to learn from a form embedded in it.
 */
function logo(doc: Document, option: CoinOption): HTMLElement {
	const mark = node(doc, 'span', 'logo', [node(doc, 'span', 'initial', [option.name.slice(0, 1)])]);
	mark.setAttribute('aria-hidden', 'true');
	if (option.logo === undefined) return mark;
	const image = node(doc, 'img', 'coin-logo');
	image.loading = 'lazy';
	image.decoding = 'async';
	image.referrerPolicy = 'no-referrer';
	image.alt = '';
	image.src = option.logo;
	image.addEventListener('error', () => image.remove());
	mark.appendChild(image);
	return mark;
}

/**
 * the ticker and the network's pill, in two inks — one node, drawn on two lines in a row of the list
 * and along one line in the closed box, which is ./styles/coins.css's call and not this function's.
 *
 * the network's words are the served config's own and are drawn as they arrive; the pill's colour is
 * `networkTint` (./coins.ts) and no rule of this file's.
 *
 * no whitespace between the two: the step between them is the sheet's, and a text node here would add
 * one the sheet cannot take back. so they stay one run of inline content wherever the sheet leaves
 * them inline, which is what lets the box above cut a long pill with an ellipsis (`.chosen` there).
 */
function words(doc: Document, option: CoinOption): HTMLElement {
	const network = node(doc, 'span', 'net', [option.network]);
	network.dataset.tint = String(networkTint(option.network));
	return node(doc, 'span', 'coin-text', [
		node(doc, 'span', 'coin-ticker', [option.label]),
		network
	]);
}

/** the machine's id, and the id of the box its label names. */
const ID = 'coin';

/** what the machine holds as picked: the flow's coin, unless the account refused it since. */
function held(choice: CoinChoice): string[] {
	const picked = choice.options.find((option) => option.value === choice.value);
	return picked === undefined || picked.refused ? [] : [picked.value];
}

export function createCoinPicker(doc: Document): CoinPicker {
	const host = doc.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	root.adoptedStyleSheets = [...sheetsFor(doc)];

	const label = node(doc, 'label', '', ['Which coin']);
	label.setAttribute('part', part('label'));

	const input = node(doc, 'input', '');
	const chosen = node(doc, 'span', 'chosen');
	chosen.id = 'coin-chosen';
	const lead = node(doc, 'span', 'lead');
	const search = glyph(doc, 'search', 'glyph');
	const box = node(doc, 'div', 'picker', [
		lead,
		node(doc, 'span', 'words', [input, chosen]),
		glyph(doc, 'chevron', 'glyph')
	]);

	// the rows, and the sentence standing where they would when a search finds none: either is the
	// open list's surface. the sentence is a status that stays in the tree with its words emptied,
	// because a live region shown at the moment it speaks is not read out. it stands beside the
	// listbox rather than in it — a listbox owns options and groups only, and `.coin-list[data-empty]`
	// takes the listbox off screen at the moment the sentence speaks — so a press on it is kept from
	// counting as one outside the list (`onPointerDownOutside` below).
	const content = node(doc, 'div', 'coin-list');
	content.setAttribute('part', part('select-list'));
	const noMatch = node(doc, 'p', 'no-match');
	noMatch.setAttribute('part', part('select-list'));
	noMatch.setAttribute('role', 'status');
	const list = node(doc, 'div', '', [content, noMatch]);
	list.setAttribute('popover', 'manual');
	const message = node(doc, 'p', 'message');
	message.id = 'coin-problem';
	message.hidden = true;

	root.appendChild(node(doc, 'div', 'field-row', [label, box, list, message]));

	let current: CoinChoice | null = null;
	let invalid = false;
	/** the search as typed, which is what the machine's collection is narrowed by. */
	let query = '';
	/** one row per coin, built from the first choice: the coins a card lists never change. */
	const rows = new Map<
		string,
		{ readonly row: HTMLElement; readonly note: HTMLElement; readonly tick: SVGElement }
	>();

	/**
	 * the coins the search finds, in `searchCoins`' order, as the machine's collection — rebuilt only
	 * when the search or the list changed, because the machine reads it on every lookup.
	 */
	let found: {
		readonly query: string;
		readonly options: readonly CoinOption[];
		readonly collection: ReturnType<typeof zag.collection<CoinOption>>;
	} | null = null;
	const collectionNow = () => {
		const options = current?.options ?? [];
		if (found === null || found.query !== query || found.options !== options) {
			found = {
				query,
				options,
				collection: zag.collection({
					items: searchCoins(options, query),
					itemToValue: (option) => option.value,
					itemToString: (option) => `${option.label} ${option.network}`,
					isItemDisabled: (option) => option.refused
				})
			};
		}
		return found.collection;
	};

	const getRootNode = rootNodeOf(box, doc);
	const run = (choice: CoinChoice) =>
		new VanillaMachine(zag.machine, () => ({
			id: ID,
			ids: {
				root: `${ID}-root`,
				label: `${ID}-label`,
				control: `${ID}-control`,
				input: ID,
				positioner: `${ID}-positioner`,
				content: `${ID}-list`,
				item: (value: string) => `${ID}-option-${value}`
			},
			getRootNode,
			collection: collectionNow(),
			defaultValue: held(choice),
			invalid,
			openOnClick: true,
			inputBehavior: 'autohighlight' as const,
			// the box shows the picked coin in words of its own (`chosen`), so the input holds a search
			// and nothing else.
			selectionBehavior: 'clear' as const,
			positioning: { placement: 'bottom-start' as const, strategy: 'fixed' as const, gutter: 0 },
			onInputValueChange: ({ inputValue }: zag.InputValueChangeDetails) => {
				query = inputValue;
			},
			onValueChange: ({ value }: zag.ValueChangeDetails<CoinOption>) => {
				const next = value[0];
				if (next !== undefined && next !== current?.value) current?.onChange(next);
			},
			// the box is the list's own control, and a press on its mark or its chevron is a press on
			// the input rather than one outside the list. the no-match sentence is the list's own
			// surface, and a press on it keeps the list and the search.
			onPointerDownOutside: (event: zag.PointerDownOutsideEvent) => {
				const path = event.detail.originalEvent.composedPath();
				if (path.includes(box) || path.includes(noMatch)) event.preventDefault();
			}
		}));

	let machine: ReturnType<typeof run> | null = null;
	const connected = () => (machine === null ? null : zag.connect(machine.service, normalizeProps));

	/**
	 * the picked coin's mark in the box, one node per coin.
	 *
	 * held rather than rebuilt, because the box is patched on every keystroke and a fresh `<img>`
	 * each time is a fresh request on a page whose cache this element does not control.
	 */
	const leadMarks = new Map<string, HTMLElement>();
	const leadMark = (option: CoinOption): HTMLElement => {
		const kept = leadMarks.get(option.value);
		if (kept !== undefined) return kept;
		const built = logo(doc, option);
		leadMarks.set(option.value, built);
		return built;
	};

	const render = (): void => {
		const api = connected();
		if (api === null || current === null) return;
		const choice = current;
		spread(label, api.getLabelProps() as Props, ID);
		spread(box, api.getControlProps() as Props, ID);
		spread(input, api.getInputProps() as Props, ID);
		spread(list, api.getPositionerProps() as Props, ID);
		spread(content, api.getContentProps() as Props, ID);

		const collection = collectionNow();
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
		// the rows in the search's ranking, moved only where one is out of place: a row moved under a
		// resting pointer loses its hover.
		let at = 0;
		for (const option of collection.items) {
			const row = rows.get(option.value)?.row;
			if (row === undefined) continue;
			const there = content.children[at] ?? null;
			if (there !== row) content.insertBefore(row, there);
			at += 1;
		}
		// written only on a change: a live region rewritten with the same words may say them again.
		const said = api.open && collection.size === 0 ? NO_MATCH : '';
		if (noMatch.textContent !== said) noMatch.textContent = said;

		const picked = choice.options.find((option) => option.value === choice.value);
		input.placeholder = api.open ? SEARCH : picked === undefined ? CHOOSE : '';
		lead.replaceChildren(
			api.open ? search : picked === undefined ? node(doc, 'span', 'logo-slot') : leadMark(picked)
		);
		chosen.replaceChildren(...(api.open || picked === undefined ? [] : [words(doc, picked)]));
		showWhile(list, api.open);
		// Escape closes the list with the search still typed, and the closed box shows the picked
		// coin rather than a search nobody is running.
		if (!api.open && api.inputValue !== '') api.setInputValue('');
	};

	const build = (choice: CoinChoice): void => {
		for (const option of choice.options) {
			const note = node(doc, 'span', 'message', [REFUSED]);
			const tick = glyph(doc, 'tick', 'tick');
			const row = node(doc, 'div', 'option', [logo(doc, option), words(doc, option), note, tick]);
			content.appendChild(row);
			rows.set(option.value, { row, note, tick });
		}
		machine = run(choice);
		machine.subscribe(render);
		machine.start();
	};

	// the caret stays in the box, as zag keeps it there on a press on the listbox.
	noMatch.addEventListener('pointerdown', (event) => event.preventDefault());

	box.addEventListener('click', (event) => {
		if (event.target === input) return;
		input.focus();
		if (connected()?.open !== true) input.click();
	});

	return {
		host,
		update(choice, problem) {
			const first = current === null;
			current = choice;
			invalid = problem !== '';
			if (first) build(choice);
			// the flow is the one holding the answer. the machine is told only when the two disagree,
			// which is a value the flow settled without a pick — a resumed gift, a coin refused since.
			const api = connected();
			const value = held(choice);
			if (api !== null && api.value.join() !== value.join()) api.setValue(value);
			render();
			message.textContent = problem;
			message.hidden = !invalid;
			box.setAttribute('part', partWhen('field', { invalid }));
			input.setAttribute('aria-describedby', invalid ? 'coin-chosen coin-problem' : 'coin-chosen');
		},
		focus() {
			input.focus();
		},
		reattached() {
			const api = connected();
			if (api !== null && lostWhileOpen(list, api.open)) api.setOpen(false);
		},
		stop() {
			machine?.stop();
			machine = null;
			showWhile(list, false);
		}
	};
}
