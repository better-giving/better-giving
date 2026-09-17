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
// no flow logic: which coins, which is picked and which were refused are `coinSelect` (./connect.ts),
// the order a search lists them in is ./coins.ts, and the sentence under the box is the card's.

import partStyles from './styles/parts.css?inline';
import coinStyles from './styles/coins.css?inline';
import { searchCoins } from './coins';
import { part, partWhen } from './parts';

/** one coin as `coinSelect` lists it. */
type CoinOption = {
	readonly value: string;
	readonly label: string;
	readonly name: string;
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

/** what the box asks while closed with nothing picked, and while open for a search. */
const CHOOSE = 'Choose a coin';
const SEARCH = 'Search by symbol or name';

/** the sentence a refused coin carries in the list, under its own unchanged label. */
const REFUSED = 'no longer accepted';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * lucide's `chevron-down`, `search` and `check` (https://lucide.dev, ISC), each drawn in
 * `currentColor` at its source's own stroke. a circle is written as the path it describes.
 */
const GLYPHS = {
	chevron: ['m6 9 6 6 6-6'],
	search: ['m21 21-4.34-4.34', 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0'],
	tick: ['M20 6 9 17l-5-5']
} as const;

function glyph(doc: Document, name: keyof typeof GLYPHS, className: string): SVGElement {
	const svg = doc.createElementNS(SVG, 'svg');
	svg.setAttribute('class', className);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const d of GLYPHS[name]) {
		const path = doc.createElementNS(SVG, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	}
	return svg;
}

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

/** a coin's round mark, holding the first letter of its name: no logo is served for any coin. */
function logo(doc: Document, name: string): HTMLElement {
	const mark = node(doc, 'span', 'logo', [node(doc, 'span', 'initial', [name.slice(0, 1)])]);
	mark.setAttribute('aria-hidden', 'true');
	return mark;
}

/** the ticker and the name after it, in two inks. */
function words(doc: Document, option: CoinOption): HTMLElement {
	return node(doc, 'span', 'coin-text', [
		node(doc, 'span', 'coin-ticker', [option.label]),
		' ',
		node(doc, 'span', 'coin-label', [option.name])
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

	root.appendChild(node(doc, 'div', 'field-row', [label, box, list, noMatch, message]));

	let current: CoinChoice | null = null;
	/** one row per coin, built from the first choice: the coins a card lists never change. */
	let rows: {
		readonly option: CoinOption;
		readonly row: HTMLElement;
		readonly note: HTMLElement;
		readonly tick: SVGElement;
	}[] = [];
	let open = false;
	/** the coins the search is showing, in the order it shows them. */
	let shown: CoinOption[] = [];
	let highlighted: string | null = null;

	const now = (): CoinChoice => {
		if (current === null) throw new Error('unreachable: the list is patched before it is shown');
		return current;
	};

	const build = (choice: CoinChoice): void => {
		rows = choice.options.map((option, at) => {
			const note = node(doc, 'span', 'message', [REFUSED]);
			const tick = glyph(doc, 'tick', 'tick');
			const row = node(doc, 'div', 'option', [
				logo(doc, option.name),
				node(doc, 'span', 'option-text', [words(doc, option), note]),
				tick
			]);
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

	const paint = (): void => {
		const choice = now();
		const picked = choice.options.find((option) => option.value === choice.value);
		box.classList.toggle('open', open);
		input.setAttribute('aria-expanded', String(open));
		input.placeholder = open ? SEARCH : picked === undefined ? CHOOSE : '';
		lead.replaceChildren(
			open ? search : picked === undefined ? node(doc, 'span', 'logo-slot') : logo(doc, picked.name)
		);
		chosen.replaceChildren(...(open || picked === undefined ? [] : [words(doc, picked)]));

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

	/** the coins the text finds, with the highlight on the first the account still takes. */
	const filter = (): void => {
		const choice = now();
		shown = searchCoins(choice.options, input.value);
		const first = shown.find((option) => !option.refused);
		const keep = shown.some((option) => option.value === highlighted && !option.refused);
		highlighted = keep ? highlighted : (first?.value ?? null);
	};

	const openList = (): void => {
		if (open) return;
		open = true;
		input.value = '';
		filter();
		// the picked coin is where the arrow keys start, where it is still one to pick.
		const choice = now();
		if (choice.options.some((option) => option.value === choice.value && !option.refused)) {
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
		filter();
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
			if (current === null) build(choice);
			current = choice;
			if (open) filter();
			else shown = [...choice.options];
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
