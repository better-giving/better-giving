import type { KeyboardEvent, SyntheticEvent } from 'react';
import { currencySymbol, digitGrouping } from '$lib/donations/money';
import { groupAmountEntry, ungroupAmountEdit } from '$lib/forms/amounts';

// what every box an operator types a sum of money in does as it is typed, whoever holds what is in
// it: ./editor/money-field.tsx, and the form's own amount boxes in ./forms/giving-fields.tsx. the
// digits are grouped as they are typed, `100000` drawn `100,000`, the way a screen groups the
// currency (`groupAmountEntry` in `$lib/forms/amounts.ts`), and what the holder is handed is the
// text with the box's own separators taken out. the grouped text is what a box posts: `readAmount`
// reads grouping where it is well formed and refuses a comma anywhere else.
//
// a separator is the box's own when the box drew it, and a comma the operator typed is theirs:
// each edit is read against the text the box last drew (`ungroupAmountEdit`), so a digit typed into
// `1,000` regroups to `10,000` while a paste of `1,0000` stays as typed for the parse to refuse.
// the last drawn text is also taken at every keydown, which is the text in front of the edit that
// key makes whatever wrote it — a form's reset, or a holder writing the box itself.
//
// a currency mark typed in front of the figure — `$` for USD — stands outside the grouping, so
// `$1000` is drawn `$1,000` and handed on as `$1000` for the holder to read.
//
// the caret stays among the digits the operator was typing between: after a press it stands after
// as many digits and points as it stood after in what was typed, wherever the grouping moved the
// separators. a paste is a press like any other.
//
// Backspace just after one of the box's own separators deletes the digit in front of it, and
// Delete just before one the digit behind it. deleting the separator alone would leave the figure
// as it was, drawn back the same, and the key would do nothing. a comma in text the box did not
// group is the operator's, and either key deletes it as typed.
//
// nothing is rewritten while an input method is composing in the box: writing its value cancels
// the composition. the text is regrouped once the composition ends.

/** a box a sum is typed in, as a field's handlers type it: an input, or the textarea it may draw. */
type MoneyBox = HTMLInputElement | HTMLTextAreaElement;

/** the text each box last drew, or held in front of a keystroke. */
const drawnIn = new WeakMap<MoneyBox, string>();

/** whether an input method is composing in the box the event is from. */
export function isComposing(event: SyntheticEvent): boolean {
	const native = event.nativeEvent;
	return (native instanceof InputEvent || native instanceof KeyboardEvent) && native.isComposing;
}

/** `text` split where the figure starts, after a currency mark and any space round it: `['$ ', '1,000']`. */
function splitMark(text: string, currency: string): readonly [mark: string, figure: string] {
	const symbol = currencySymbol(currency);
	const at = text.indexOf(symbol);
	if (at === -1 || text.slice(0, at).trim() !== '') return ['', text];
	const figure = text.slice(at + symbol.length).trimStart();
	return [text.slice(0, text.length - figure.length), figure];
}

/** an amount box's text as the box draws it: `groupAmountEntry`, after any currency mark. */
export function drawAmountEntry(text: string, currency: string): string {
	const [mark, figure] = splitMark(text, currency);
	return mark + groupAmountEntry(figure, currency);
}

/** whether every separator in `figure` is one the box would draw, and there is one. */
function groupedByBox(figure: string, currency: string): boolean {
	const { separator } = digitGrouping(currency);
	return (
		figure.includes(separator) &&
		groupAmountEntry(figure.split(separator).join(''), currency) === figure
	);
}

/**
 * where the caret goes in `shown` to stand after as many characters that are not `separator` as it
 * stood after at `caret` in `typed`.
 */
function caretIn(shown: string, typed: string, caret: number, separator: string): number {
	if (shown === typed) return caret;
	const kept = typed.slice(0, caret).split(separator).join('').length;
	let at = 0;
	for (let passed = 0; at < shown.length && passed < kept; at += 1) {
		if (shown[at] !== separator) passed += 1;
	}
	return at;
}

/**
 * the text of the box an edit landed in, without the box's own separators, and the box drawn
 * grouped with the caret placed — unless an input method is composing in it.
 *
 * drawn and placed here, before react renders the same text: an input whose value already matches
 * is left alone, so the caret is not thrown to the end. a box nothing has drawn yet was drawn by
 * its markup, which is its `defaultValue`.
 */
export function regroupAmountBox(event: SyntheticEvent<MoneyBox>, currency: string): string {
	const box = event.currentTarget;
	const typed = box.value;
	const [mark, figure] = splitMark(typed, currency);
	const [, drawn] = splitMark(drawnIn.get(box) ?? box.defaultValue, currency);
	const entry = mark + ungroupAmountEdit(drawn, figure, currency);
	if (isComposing(event)) return entry;
	const shown = drawAmountEntry(entry, currency);
	if (shown !== typed) {
		const { separator } = digitGrouping(currency);
		const caret = caretIn(shown, typed, box.selectionStart ?? typed.length, separator);
		box.value = shown;
		box.setSelectionRange(caret, caret);
	}
	drawnIn.set(box, shown);
	return entry;
}

/**
 * a key pressed in a money box: the text in front of its edit kept as the box's last drawn, and a
 * Backspace just after one of the box's own separators, or a Delete just before one, made as one
 * over the digit beyond it. the edit lands as a keystroke's does — the text through the platform's
 * own setter, which react has no copy of, and an `input` raised — so the box's holder hears it as
 * typing and groups it again.
 */
export function keyInAmountBox(event: KeyboardEvent<MoneyBox>, currency: string) {
	const box = event.currentTarget;
	if (isComposing(event)) return;
	const text = box.value;
	drawnIn.set(box, text);
	const at = box.selectionStart;
	if (event.altKey || event.ctrlKey || event.metaKey || at === null || at !== box.selectionEnd) {
		return;
	}
	const { separator } = digitGrouping(currency);
	const back = event.key === 'Backspace' && text[at - 1] === separator;
	const forward = event.key === 'Delete' && text[at] === separator;
	if (!(back || forward) || !groupedByBox(splitMark(text, currency)[1], currency)) return;
	event.preventDefault();
	const digit = back ? at - 2 : at + 1;
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set?.call(
		box,
		text.slice(0, digit) + text.slice(digit + 1)
	);
	const caret = back ? digit : at;
	box.setSelectionRange(caret, caret);
	box.dispatchEvent(
		new InputEvent('input', {
			bubbles: true,
			inputType: back ? 'deleteContentBackward' : 'deleteContentForward'
		})
	);
}
