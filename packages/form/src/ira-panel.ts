// what the IRA (QCD) option holds once it is open: the box naming the donor's custodian and the
// benefits panel under it.
//
// the card draws it (`ira` on `CardView` in ./views.ts) and the option stands it in its row in the
// payment box (./embed/pledge.ts), which is a light-DOM node for the reason ./embed/rows.ts gives. so
// it carries a shadow root of its own, as the unit panel does (./unit-panel.ts): a host page's
// `input { … }` rule would otherwise reach the box. the label, the box and the sentence under it are
// all inside that root, which is what lets one reference the other.
//
// the box is the card's floating-label field (`.floating` in ./styles/parts.css), drawn the way the
// details step's name boxes are (`textField` in ./views.ts). no flow logic: the value, the cap and
// whether to say anything are the card's.

import partStyles from './styles/parts.css?inline';
import layoutStyles from './styles/layout.css?inline';
import { BENEFITS, benefitsPanel } from './pledge-screen';
import { part, partWhen } from './parts';

/** the box as `custodianField` (./connect.ts) projects it. */
export type CustodianField = {
	readonly value: string;
	readonly maxLength?: number;
	readonly required?: boolean;
	readonly onChange: (value: string) => void;
};

export type IraPanel = {
	/** the node the IRA (QCD) option stands in its row. */
	readonly host: HTMLElement;
	/** the box patched to `field`, and `problem` said under it — `''` for nothing wrong. */
	update(field: CustodianField, problem: string): void;
	/** the caret into the box, which is where a press refused for the custodian sends it. */
	focus(): void;
};

/** the sheets, built once per document for the reason `sheetFor` in ./embed/rows.ts builds its own. */
const sheets = new WeakMap<Document, readonly CSSStyleSheet[]>();

function sheetsFor(doc: Document): readonly CSSStyleSheet[] {
	const held = sheets.get(doc);
	if (held !== undefined) return held;
	const view = doc.defaultView;
	if (view === null) return [];
	const built = [partStyles, layoutStyles].map((css) => {
		const sheet = new view.CSSStyleSheet();
		sheet.replaceSync(css);
		return sheet;
	});
	sheets.set(doc, built);
	return built;
}

export function createIraPanel(
	doc: Document,
	/**
	 * the review step's Continue, pressed. the box has no form owner in this root, so Enter in it
	 * reaches no default button, where the gift page's box presses Continue through its form.
	 */
	onEnter: () => void
): IraPanel {
	const host = doc.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	root.adoptedStyleSheets = [...sheetsFor(doc)];

	const field = doc.createElement('input');
	field.id = 'custodian';
	field.setAttribute('part', part('field'));
	field.setAttribute('autocomplete', 'off');
	// blank on purpose: `:placeholder-shown` is how the floating label knows the box is empty
	// (`textField` in ./views.ts).
	field.setAttribute('placeholder', ' ');
	const words = doc.createElement('span');
	words.className = 'label-words';
	words.textContent = 'Custodian';
	const label = doc.createElement('label');
	label.setAttribute('part', part('label'));
	label.htmlFor = field.id;
	label.append(words);
	const message = doc.createElement('p');
	message.className = 'message';
	message.id = 'custodian-problem';
	message.hidden = true;
	const row = doc.createElement('div');
	row.className = 'field-row floating';
	row.append(label, field, message);

	const panel = doc.createElement('div');
	panel.className = 'ira-panel';
	panel.append(row, benefitsPanel(doc, BENEFITS.ira_qcd, 'h4'));
	root.append(panel);

	let current: CustodianField | null = null;
	field.addEventListener('input', () => current?.onChange(field.value));
	field.addEventListener('keydown', (event) => {
		// an Enter that commits an input method's word is the method's, not a press (229 is the
		// keyCode an engine reports for a key the method holds).
		if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		onEnter();
	});

	return {
		host,
		update(next, problem) {
			current = next;
			if (field.value !== next.value) field.value = next.value;
			field.required = next.required === true;
			if (next.maxLength === undefined) field.removeAttribute('maxlength');
			else field.maxLength = next.maxLength;
			const wrong = problem !== '';
			if (message.textContent !== problem) message.textContent = problem;
			message.hidden = !wrong;
			field.setAttribute('part', partWhen('field', { invalid: wrong }));
			if (wrong) {
				field.setAttribute('aria-invalid', 'true');
				field.setAttribute('aria-describedby', message.id);
			} else {
				field.removeAttribute('aria-invalid');
				field.removeAttribute('aria-describedby');
			}
		},
		focus: () => field.focus()
	};
}
