/**
 * a row's place in a list ordered newest first by a time and then by id, which the next batch
 * resumes strictly past, so a row that joins or leaves the list between loads moves no other row
 * across a batch's edge. `at` is the time in epoch milliseconds, as `at()` columns store it
 * (./schema.ts).
 */
export type KeysetCursor = { readonly at: number; readonly id: string };

/** the text a `KeysetCursor` travels as, which `parseKeysetCursor` reads back. */
export function keysetCursorText({ at, id }: KeysetCursor): string {
	return Buffer.from(`${at}.${id}`).toString('base64url');
}

/** a cursor `keysetCursorText` wrote, or null for any other text. */
export function parseKeysetCursor(text: string): KeysetCursor | null {
	const match = /^(\d+)\.(\S+)$/.exec(Buffer.from(text, 'base64url').toString());
	if (match === null) return null;
	const at = Number(match[1]);
	if (!Number.isSafeInteger(at)) return null;
	return { at, id: match[2] ?? '' };
}
