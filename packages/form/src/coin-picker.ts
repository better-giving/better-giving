// the coin list a `crypto` gift is chosen in: a box a donor searches in and the list it narrows.
//
// the card draws it (`coins` on `CardView` in ./views.ts) and the crypto option stands it in its row
// (./embed/nowpayments.ts), which is a light-DOM node for the reason ./embed/rows.ts gives. so it
// carries a shadow root of its own: a host page's `input { … }` rule would otherwise reach the box.
// every id below is inside that root, which is what lets the label, the list and the sentence under
// the box be referenced from it.
//
// the combobox pattern with a listbox (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): the box is
// an editable `role="combobox"`, the highlight is `aria-activedescendant`, and the caret never leaves
// the box. a refused coin stays listed, `aria-disabled` and passed over by the arrow keys.
//
// the chips narrowing the list sit inside that pattern rather than across it, and three rules are
// what keep them there. they are buttons outside the listbox, so the arrow keys reach none of them
// and nothing `aria-activedescendant` can name is anything but an option. a pointer pressing one
// never takes the caret out of the box, the same way a pointer picking a coin does not. and pressing
// one puts the caret back in the box and opens the list, so the box is focused whenever a highlight
// is being read out of it — which is the invariant `aria-activedescendant` rests on. Tab still walks
// out of the box and onto the chips, and the list closes behind it as it closes for any other Tab.
//
// a row is a mark and two lines: the ticker on the first, the network's pill on the second, and the
// closed box reads the same way along one line. the coin's name is drawn nowhere — it says again
// what the ticker and the pill already say, and a two-word network pushing it onto a second line was
// a row that changed height for nothing. it stays on the option for two readings that are not a row:
// a donor typing it still finds the coin (`searchCoins` in ./coins.ts), and its first letter is the
// lettered mark a missing logo falls back to.
//
// no flow logic: which coins, which is picked and which were refused are `coinSelect` (./connect.ts),
// the order a search lists them in is ./coins.ts, and the sentence under the box is the card's.

import partStyles from './styles/parts.css?inline';
import coinStyles from './styles/coins.css?inline';
import { COIN_FILTERS, filterCoins, networkTint, searchCoins, type CoinFilter } from './coins';
import { glyph } from './glyph';
import { part, partWhen } from './parts';

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
	readonly popular: boolean;
	readonly stablecoin: boolean;
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
};

/**
 * the words on each chip.
 *
 * one per `CoinFilter` (./coins.ts), so a filter added there is a compile error here until it is
 * given words rather than a chip that draws empty.
 */
const CHIP_WORDS: Record<CoinFilter, string> = {
	all: 'All',
	popular: 'Popular',
	stable: 'Stablecoins'
};

/** what the box asks while closed with nothing picked, and while open for a search. */
const CHOOSE = 'Choose a coin';
const SEARCH = 'Search by symbol or name';

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

export function createCoinPicker(doc: Document): CoinPicker {
	const host = doc.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	root.adoptedStyleSheets = [...sheetsFor(doc)];

	const label = node(doc, 'label', '', ['Which coin']);
	label.setAttribute('part', part('label'));
	label.htmlFor = 'coin';

	const input = node(doc, 'input', '');
	input.id = 'coin';
	input.type = 'text';
	input.autocomplete = 'off';
	input.spellcheck = false;
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-expanded', 'false');
	input.setAttribute('aria-controls', 'coin-list');

	const chosen = node(doc, 'span', 'chosen');
	chosen.id = 'coin-chosen';
	const lead = node(doc, 'span', 'lead');
	const search = glyph(doc, 'search', 'glyph');
	const box = node(doc, 'div', 'picker', [
		lead,
		node(doc, 'span', 'words', [input, chosen]),
		glyph(doc, 'chevron', 'glyph')
	]);

	const chips = node(doc, 'div', 'chips');
	chips.setAttribute('role', 'group');
	chips.setAttribute('aria-label', 'Narrow the coin list');
	chips.hidden = true;

	const list = node(doc, 'div', 'coin-list');
	list.id = 'coin-list';
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', 'Which coin');
	list.hidden = true;
	const noMatch = node(doc, 'p', 'no-match', ['No coin matches']);
	noMatch.hidden = true;
	const message = node(doc, 'p', 'message');
	message.id = 'coin-problem';
	message.hidden = true;

	root.appendChild(node(doc, 'div', 'field-row', [label, box, chips, list, noMatch, message]));

	let current: CoinChoice | null = null;
	/** one row per coin, built from the first choice: the coins a card lists never change. */
	let rows: {
		readonly option: CoinOption;
		readonly row: HTMLElement;
		readonly note: HTMLElement;
		readonly tick: SVGElement;
	}[] = [];
	/** one button per chip drawn, empty where the served list carries no flag to narrow by. */
	let chipRow: { readonly filter: CoinFilter; readonly button: HTMLButtonElement }[] = [];
	let chosenFilter: CoinFilter = 'all';
	let open = false;
	/** the coins the chip and the search are showing together, in the order they show them. */
	let shown: CoinOption[] = [];
	let highlighted: string | null = null;

	const now = (): CoinChoice => {
		if (current === null) throw new Error('unreachable: the list is patched before it is shown');
		return current;
	};

	/**
	 * the chips the served list has anything to narrow by, built from the first choice with the rows.
	 *
	 * a chip is drawn for a flag some coin on the list carries, and `all` is drawn only when one of
	 * the other two is: a lone `All` narrows nothing and is a control that does not answer a press.
	 * so a deployment whose list carries neither flag draws the list it drew before the chips
	 * existed, rather than a row of controls that hold every coin whichever is pressed.
	 */
	const buildChips = (choice: CoinChoice): void => {
		const carried = COIN_FILTERS.filter(
			(filter) => filter === 'all' || filterCoins(choice.options, filter).length > 0
		);
		if (carried.length < 2) return;
		chipRow = carried.map((filter) => {
			const button = node(doc, 'button', 'chip', [CHIP_WORDS[filter]]);
			button.type = 'button';
			// the caret stays in the box while a pointer presses, as it does while one picks a coin.
			button.addEventListener('mousedown', (event) => event.preventDefault());
			button.addEventListener('click', () => narrowTo(filter));
			chips.appendChild(button);
			return { filter, button };
		});
		chips.hidden = false;
	};

	const build = (choice: CoinChoice): void => {
		rows = choice.options.map((option, at) => {
			const note = node(doc, 'span', 'message', [REFUSED]);
			const tick = glyph(doc, 'tick', 'tick');
			const row = node(doc, 'div', 'option', [logo(doc, option), words(doc, option), note, tick]);
			row.id = `coin-option-${at}`;
			row.setAttribute('role', 'option');
			// the caret stays in the box while a pointer picks.
			row.addEventListener('mousedown', (event) => event.preventDefault());
			row.addEventListener('click', () => pick(option.value));
			list.appendChild(row);
			return { option, row, note, tick };
		});
	};

	/** the option a keyboard or a pointer landed on, taken if the account still takes it. */
	const pick = (value: string): void => {
		const option = now().options.find((candidate) => candidate.value === value);
		if (option === undefined || option.refused) return;
		close();
		now().onChange(value);
	};

	/**
	 * the chip a donor pressed: the list narrowed to it, open, with the caret in the box.
	 *
	 * the caret is moved rather than left where it was because a keyboard donor reaches a chip by
	 * tabbing out of the box, and a list whose highlight is read from `aria-activedescendant` says
	 * nothing at all while the box it is set on is not the focused element.
	 */
	const narrowTo = (filter: CoinFilter): void => {
		chosenFilter = filter;
		input.focus();
		if (!open) {
			openList();
			return;
		}
		narrow();
		paint();
	};

	/**
	 * the picked coin's mark in the box, one node per coin.
	 *
	 * held rather than rebuilt, because `paint` runs on every keystroke and a fresh `<img>` each time
	 * is a fresh request on a page whose cache this element does not control.
	 */
	const leadMarks = new Map<string, HTMLElement>();
	const leadMark = (option: CoinOption): HTMLElement => {
		const held = leadMarks.get(option.value);
		if (held !== undefined) return held;
		const built = logo(doc, option);
		leadMarks.set(option.value, built);
		return built;
	};

	const paint = (): void => {
		const choice = now();
		const picked = choice.options.find((option) => option.value === choice.value);
		box.classList.toggle('open', open);
		input.setAttribute('aria-expanded', String(open));
		input.placeholder = open ? SEARCH : picked === undefined ? CHOOSE : '';
		lead.replaceChildren(
			open ? search : picked === undefined ? node(doc, 'span', 'logo-slot') : leadMark(picked)
		);
		chosen.replaceChildren(...(open || picked === undefined ? [] : [words(doc, picked)]));
		for (const { filter, button } of chipRow) {
			button.setAttribute('aria-pressed', String(filter === chosenFilter));
		}

		const refusedNow = new Map(choice.options.map((option) => [option.value, option.refused]));
		const visible = new Set(shown.map((option) => option.value));
		for (const { option, row, note, tick } of rows) {
			const refused = refusedNow.get(option.value) === true;
			row.hidden = !visible.has(option.value);
			row.setAttribute('aria-selected', String(option.value === choice.value));
			if (refused) row.setAttribute('aria-disabled', 'true');
			else row.removeAttribute('aria-disabled');
			row.classList.toggle('highlighted', option.value === highlighted);
			note.hidden = !refused;
			tick.toggleAttribute('hidden', option.value !== choice.value);
		}
		// reordered only while open, so a search's ranking is what the list reads in.
		if (open) {
			for (const option of shown) {
				const entry = rows.find((candidate) => candidate.option.value === option.value);
				if (entry !== undefined) list.appendChild(entry.row);
			}
		}
		list.hidden = !open || shown.length === 0;
		noMatch.hidden = !open || shown.length > 0;

		const active = rows.find((entry) => entry.option.value === highlighted);
		if (open && active !== undefined) {
			input.setAttribute('aria-activedescendant', active.row.id);
			active.row.scrollIntoView?.({ block: 'nearest' });
		} else {
			input.removeAttribute('aria-activedescendant');
		}
	};

	/**
	 * the coins the chip keeps and the text then finds, with the highlight on the first of those the
	 * account still takes.
	 *
	 * the two narrowings compose in one direction and ./coins.ts argues why they are two calls: the
	 * chip is the set, the search runs inside it.
	 */
	const narrow = (): void => {
		const choice = now();
		shown = searchCoins(filterCoins(choice.options, chosenFilter), input.value);
		const first = shown.find((option) => !option.refused);
		const keep = shown.some((option) => option.value === highlighted && !option.refused);
		highlighted = keep ? highlighted : (first?.value ?? null);
	};

	const openList = (): void => {
		if (open) return;
		open = true;
		input.value = '';
		narrow();
		// the picked coin is where the arrow keys start, where the chip has left it on the list and
		// the account still takes it. read off `shown` rather than off the whole list, because a
		// highlight on a coin the chip is hiding is a combobox naming a row nobody can see.
		const choice = now();
		if (shown.some((option) => option.value === choice.value && !option.refused)) {
			highlighted = choice.value;
		}
		paint();
	};

	function close(): void {
		if (!open) return;
		open = false;
		input.value = '';
		highlighted = null;
		paint();
	}

	/** the highlight moved to the next coin the account still takes, in `step`'s direction. */
	const move = (step: 1 | -1): void => {
		const takeable = shown.filter((option) => !option.refused);
		if (takeable.length === 0) return;
		const at = takeable.findIndex((option) => option.value === highlighted);
		const next =
			at === -1
				? step === 1
					? 0
					: takeable.length - 1
				: (at + step + takeable.length) % takeable.length;
		highlighted = takeable[next]?.value ?? null;
		paint();
	};

	box.addEventListener('click', () => {
		input.focus();
		openList();
	});
	input.addEventListener('input', () => {
		const wasOpen = open;
		if (!wasOpen) {
			const typed = input.value;
			openList();
			input.value = typed;
		}
		narrow();
		paint();
	});
	input.addEventListener('keydown', (event) => {
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				if (!open) openList();
				else move(event.key === 'ArrowDown' ? 1 : -1);
				return;
			case 'Enter':
				if (!open) return;
				event.preventDefault();
				if (highlighted !== null) pick(highlighted);
				return;
			case 'Escape':
				if (!open) return;
				event.preventDefault();
				close();
				return;
		}
	});
	input.addEventListener('blur', () => close());

	return {
		host,
		update(choice, problem) {
			if (current === null) {
				build(choice);
				buildChips(choice);
			}
			current = choice;
			if (open) narrow();
			else shown = filterCoins(choice.options, chosenFilter);
			paint();
			const invalid = problem !== '';
			message.textContent = problem;
			message.hidden = !invalid;
			box.setAttribute('part', partWhen('field', { invalid }));
			if (invalid) input.setAttribute('aria-invalid', 'true');
			else input.removeAttribute('aria-invalid');
			input.setAttribute('aria-describedby', invalid ? 'coin-chosen coin-problem' : 'coin-chosen');
		},
		focus() {
			input.focus();
		}
	};
}
