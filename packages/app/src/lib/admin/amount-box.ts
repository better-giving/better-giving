import type { KeyboardEvent } from 'react';
import { digitGrouping } from '$lib/donations/money';
import { groupAmountEntry, ungroupAmountEntry } from '$lib/forms/amounts';

// what every box an operator types a sum of money in does as it is typed, whoever holds what is in
// it: ./editor/money-field.tsx, and the form's own amount boxes in ./forms/giving-fields.tsx. the
// digits are grouped as they are typed, `100000` drawn `100,000`, the way a screen groups the
// currency (`groupAmountEntry` in `$lib/forms/amounts.ts`), and what the holder is handed is the
// text with the separators taken out — the text `readAmount` reads, which refuses a separator.
//
// the caret stays among the digits the operator was typing between: after a press it stands after
// as many digits and points as it stood after in what was typed, wherever the grouping moved the
// separators. a paste is a press like any other.
//
// a separator is the grouping's and never the operator's, so Backspace just after one deletes the
// digit in front of it. deleting the separator alone would leave the figure as it was, drawn back
// the same, and the key would do nothing.

/** a box a sum is typed in, as a field's handlers type it: an input, or the textarea it may draw. */
type MoneyBox = HTMLInputElement | HTMLTextAreaElement;

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
 * `box`'s text drawn grouped with the caret placed, and the text with the separators taken out.
 *
 * drawn and placed here, before react renders the same text: an input whose value already matches
 * is left alone, so the caret is not thrown to the end.
 */
export function regroupAmountBox(box: MoneyBox, currency: string): string {
	const typed = box.value;
	const entry = ungroupAmountEntry(typed, currency);
	const shown = groupAmountEntry(entry, currency);
	if (shown !== typed) {
		const { separator } = digitGrouping(currency);
		const caret = caretIn(shown, typed, box.selectionStart ?? typed.length, separator);
		box.value = shown;
		box.setSelectionRange(caret, caret);
	}
	return entry;
}

/**
 * a Backspace just after a separator, made as one over the digit in front of it. the edit lands as
 * a keystroke's does — the text through the platform's own setter, which react has no copy of, and
 * an `input` raised — so the box's holder hears it as typing and groups it again.
 */
export function deleteOverSeparator(event: KeyboardEvent<MoneyBox>, currency: string) {
	const box = event.currentTarget;
	const at = box.selectionStart;
	if (event.key !== 'Backspace' || event.altKey || event.ctrlKey || event.metaKey) return;
	if (event.nativeEvent.isComposing || at === null || at < 2 || at !== box.selectionEnd) return;
	if (box.value[at - 1] !== digitGrouping(currency).separator) return;
	event.preventDefault();
	const text = box.value.slice(0, at - 2) + box.value.slice(at - 1);
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set?.call(box, text);
	box.setSelectionRange(at - 2, at - 2);
	box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
}
