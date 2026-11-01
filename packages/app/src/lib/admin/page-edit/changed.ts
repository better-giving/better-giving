import { readAmount, suggestedEntries } from '$lib/forms/amounts';
import { parseRichText, type RichTextDocument } from '$lib/rich-text/document';

// whether a section card on a page's edit screen holds anything its Save would write: each box read
// as the save stores it, on the side the card was seeded with and on the side the operator has
// typed. a box that only looks different — `1,000` against `1000`, an id left in a hidden program
// select — is no change, so a card whose save would move nothing offers no Save.
//
// pure, so the comparisons are specified without a dom (./changed.spec.ts).

/** a box's value as conform's `form.value` or a seed holds it: a string, a list, a tick or nothing. */
type Held = unknown;

const text = (held: Held): string => (typeof held === 'string' ? held : '');

/** a tick as conform holds a checkbox (`on`, or nothing) and a seed holds it (a boolean). */
const ticked = (held: Held): boolean => held === true || held === 'on';

/** an amount box as its minor units, the text itself where it reads as no amount. */
function amountOf(held: Held, currency: string): number | string {
	const entry = text(held).trim();
	if (entry === '') return '';
	return readAmount(entry, currency).minor ?? entry;
}

/** a list of amount boxes as the save stores it: each amount once, in order, blanks dropped. */
function amountsOf(held: Held, currency: string): string {
	const rows = Array.isArray(held) ? held.map(text) : typeof held === 'string' ? [held] : [];
	return suggestedEntries(rows)
		.map((entry) => amountOf(entry.text, currency))
		.join('\n');
}

/**
 * whether the amount boxes named `names` read differently on the two sides. a list box (the
 * Donation page's suggested amounts) is compared as the stored list.
 */
export function amountsChanged(
	seed: Readonly<Record<string, Held>>,
	held: Readonly<Record<string, Held>>,
	names: readonly string[],
	currency: string
): boolean {
	return names.some((name) =>
		Array.isArray(seed[name]) || Array.isArray(held[name])
			? amountsOf(seed[name], currency) !== amountsOf(held[name], currency)
			: amountOf(seed[name], currency) !== amountOf(held[name], currency)
	);
}

/** whether the checkboxes named `names` stand differently on the two sides. */
export function ticksChanged(
	seed: Readonly<Record<string, Held>>,
	held: Readonly<Record<string, Held>>,
	names: readonly string[]
): boolean {
	return names.some((name) => ticked(seed[name]) !== ticked(held[name]));
}

/** whether the text boxes named `names` read differently on the two sides, trimmed. */
export function textsChanged(
	seed: Readonly<Record<string, Held>>,
	held: Readonly<Record<string, Held>>,
	names: readonly string[]
): boolean {
	return names.some((name) => text(seed[name]).trim() !== text(held[name]).trim());
}

/**
 * the program group's two boxes as the save stores them: the id counts only while the mode pins
 * one. the select is in the tree in every mode and hidden in two of them
 * ($lib/admin/forms/program-fields.tsx), so a group taken off a pin still submits the id it was
 * pinned to, and `parseFormProgram` in $lib/server/forms/form-input.ts drops it.
 */
function programOf(held: Readonly<Record<string, Held>>): string {
	const mode = text(held.program_mode);
	return mode === 'pinned' ? `${mode}:${text(held.program_id)}` : mode;
}

/** whether the program group would store something other than what it was seeded with. */
export function programChanged(seed: unknown, held: unknown): boolean {
	const record = (boxes: unknown) =>
		(typeof boxes === 'object' && boxes !== null ? boxes : {}) as Record<string, Held>;
	return programOf(record(seed)) !== programOf(record(held));
}

/** a description as the save stores it: the rule's parse, so two spellings of one document agree. */
export function storyKey(doc: RichTextDocument): string {
	const parsed = parseRichText(doc);
	return JSON.stringify(parsed.ok ? parsed.doc : doc);
}
