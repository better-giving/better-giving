/**
 * the dedication's phrase, moved into the middle of a sentence.
 *
 * the phrase arrives worded for the head of a receipt row — "In memory of" — and every template
 * that prints it outside that row prints it inside a sentence. the case comes down and no word
 * changes: which two words a dedication uses is the caller's, for the reason `Dedication` in
 * ./receipt.tsx states, and this is the one thing done to them.
 */
export function midSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}
