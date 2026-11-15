// the thank-you's employer ask: the box, its two presses, and the row and link that replace them.
//
// a block of its own the takeover holds under the receipt, the way ./deposit.ts is the address
// screen's. it draws what it is handed — the words are the card's (`takeoverFor` in ./views.ts) and
// the box's value, whether it holds an answer and whether its write is in flight are the flow's
// (`employerField` and `sendEmployerButton` in ./connect.ts) — and decides nothing about the flow.
//
// what the donor types leaves through `input` and nowhere else: no attribute, no event, no console.

import { glyph } from './glyph';
import { part, partWhen, REGISTRY_CLASS } from './parts';
import { MAX_EMPLOYER } from './v1';

/** the ask's words and where it stands, as the card states them. */
export type EmployerAskScreen = {
	readonly phase: 'asking' | 'sending' | 'sent' | 'skipped';
	readonly heading: string;
	readonly hint: string;
	readonly label: string;
	readonly send: string;
	readonly skip: string;
	/** the sentence over a refused or unanswered write, or `''`. */
	readonly refusal: string;
	/** the status row's heading and line once the ask is closed, `''` while it is open. */
	readonly doneHeading: string;
	readonly doneBody: string;
	readonly link: string;
	readonly giftUrl: string;
};

/** the box and the send as the flow holds them on this snapshot. */
export type EmployerAskControls = {
	readonly value: string;
	/** the box holds an answer the flow takes. */
	readonly given: boolean;
	readonly busy: boolean;
};

export type EmployerAskHandlers = {
	readonly input: (typed: string) => void;
	readonly send: () => void;
	readonly skip: () => void;
	/**
	 * a refusal has just been drawn. the card's region states it (`announce` in ./views.ts) and says
	 * only changed words, so a second refusal in a row is reported here to be said again.
	 */
	readonly refused: () => void;
};

export type EmployerAskView = {
	readonly root: HTMLElement;
	/** `null` is a thank-you with no ask, which draws nothing. */
	update(screen: EmployerAskScreen | null, controls: EmployerAskControls): void;
};

const FIELD_ID = 'employer';
const HEADING_ID = 'employer-heading';
const HINT_ID = 'employer-hint';
const REFUSAL_ID = 'employer-problem';

export function createEmployerAsk(doc: Document, handlers: EmployerAskHandlers): EmployerAskView {
	const make = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		attributes: Readonly<Record<string, string>> = {},
		children: readonly Node[] = []
	): HTMLElementTagNameMap[K] => {
		const node = doc.createElement(tag);
		for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
		for (const child of children) node.appendChild(child);
		return node;
	};
	const text = (node: Node, words: string): void => {
		if (node.textContent !== words) node.textContent = words;
	};
	const attribute = (node: Element, name: string, value: string | null): void => {
		if (value === null) node.removeAttribute(name);
		else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
	};
	const hide = (node: HTMLElement, hidden: boolean): void => {
		if (node.hidden !== hidden) node.hidden = hidden;
	};

	// `tabindex` as every `heading` on the card carries one, so the caret has somewhere to land.
	const heading = make('h3', { id: HEADING_ID, part: part('heading'), tabindex: '-1' });
	const hint = make('p', { id: HINT_ID, class: 'aside employer-hint' });
	const label = make('label', { part: part('label'), for: FIELD_ID });
	const field = make('input', {
		id: FIELD_ID,
		part: part('field'),
		class: REGISTRY_CLASS.field,
		maxlength: String(MAX_EMPLOYER),
		autocomplete: 'organization'
	});
	// the card's error idiom (`.message` in ./styles/parts.css): under the box, tied to it while shown,
	// and said through the card's one region rather than a live region of its own. the box is not
	// marked invalid, because nothing about what was typed was refused.
	const refusal = make('p', { id: REFUSAL_ID, class: 'message' });
	refusal.hidden = true;
	const sendLabel = make('span', { class: 'action-label' });
	const spinner = make('span', { class: 'ds-spinner', 'aria-hidden': 'true' });
	// a submit button while the ask is open, so Enter in the box presses it through the card's own
	// `<form>`; `aria-disabled` rather than `disabled`, which the platform's implicit submission would
	// skip silently and which takes the control out of the tab order.
	const send = make('button', { type: 'submit', class: REGISTRY_CLASS.action }, [
		sendLabel,
		spinner
	]);
	const skip = make('button', {
		type: 'button',
		part: part('action-quiet'),
		class: 'ds-btn ds-btn-secondary ds-btn-lg'
	});
	const ask = make('div', { role: 'group', 'aria-labelledby': HEADING_ID, class: 'employer-ask' }, [
		make('div', { class: 'employer-head' }, [heading, hint]),
		make('div', { class: 'field-row' }, [label, field, refusal]),
		make('div', { class: 'employer-actions' }, [send, skip])
	]);

	const doneHeading = make('h3', { part: part('heading'), tabindex: '-1' });
	const doneBody = make('p', { class: 'aside' });
	// the caret's landing when the ask closes, so the press that closed it is answered where the
	// donor is. a status rather than an alert: what it says is an outcome they asked for.
	const status = make('div', { role: 'status', tabindex: '-1', class: 'employer-done' }, [
		make('div', {}, [doneHeading, doneBody])
	]);
	status.hidden = true;
	const mark = glyph(doc, 'done', 'employer-done-mark');
	const link = make('a', { part: part('link') });
	link.hidden = true;

	const root = make('div', { class: 'employer' }, [ask, status, link]);
	root.hidden = true;

	field.addEventListener('input', () => handlers.input(field.value));
	send.addEventListener('click', () => handlers.send());
	skip.addEventListener('click', () => handlers.skip());

	let drawnPhase: EmployerAskScreen['phase'] | null = null;

	return {
		root,
		update(screen, controls) {
			hide(root, screen === null);
			if (screen === null) {
				// the default button leaves with the ask, so Enter on another screen presses its own.
				attribute(send, 'type', 'button');
				drawnPhase = null;
				return;
			}
			const open = screen.phase === 'asking' || screen.phase === 'sending';
			hide(ask, !open);
			hide(status, open);
			hide(link, open);

			text(heading, screen.heading);
			text(hint, screen.hint);
			text(label, screen.label);
			if (field.value !== controls.value) field.value = controls.value;
			text(sendLabel, screen.send);
			text(skip, screen.skip);
			attribute(send, 'type', open ? 'submit' : 'button');
			attribute(send, 'aria-disabled', controls.given ? null : 'true');
			attribute(send, 'aria-busy', controls.busy ? 'true' : null);
			attribute(send, 'part', partWhen('action', { busy: controls.busy }));

			if (screen.refusal !== '' && refusal.hidden) handlers.refused();
			text(refusal, screen.refusal);
			hide(refusal, screen.refusal === '');
			attribute(
				field,
				'aria-describedby',
				screen.refusal === '' ? HINT_ID : `${HINT_ID} ${REFUSAL_ID}`
			);

			text(doneHeading, screen.doneHeading);
			text(doneBody, screen.doneBody);
			const sent = screen.phase === 'sent';
			if (sent && mark.parentNode !== status) status.prepend(mark);
			if (!sent && mark.parentNode === status) mark.remove();
			attribute(link, 'href', screen.giftUrl);
			text(link, screen.link);

			const closing = !open && (drawnPhase === 'asking' || drawnPhase === 'sending');
			drawnPhase = screen.phase;
			if (closing) status.focus();
		}
	};
}
