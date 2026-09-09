// how app code reads a rejection the database produced, without matching on prose.
//
// D1 flattens an error to a message and appends sqlite's symbolic extended result code
// (`SQLITE_CONSTRAINT_UNIQUE`); the sentence in front of it is upstream's to reword and there is
// no numeric `errcode` on a D1 error. so the code's name is the only stable thing to read, and
// reading it means walking `cause`: a statement issued through drizzle comes back as drizzle's own
// `Failed query: insert into …` with D1's error demoted to `.cause`, so the outermost message
// never carries the code and a match against it fails silently rather than loudly.
//
// this is the app-side twin of ./rejection.testing.ts, which does the same walk for a spec that
// asserts on the whole chain as text. that file imports the walk from here rather than keeping a
// second copy, because two walks that disagree would make a spec pass against a module that had
// stopped classifying anything.
//
// nothing here decides what a code means. a caller maps the codes it can act on to its own
// vocabulary and treats the rest as a fault it cannot explain — the mapping belongs to whoever
// knows which of its statements could have failed, which is never this module.

/**
 * every message in an error's cause chain, outermost first.
 *
 * it stops at the first link that is not an `Error`, which is what a `cause` set to a string or to
 * a plain object produces. a non-`Error` throw is therefore an empty chain rather than a coerced
 * one — a value with no message has nothing to contribute to a match, and stringifying it would
 * run whatever `toString` the thrower supplied.
 */
export function causeChain(error: unknown): string[] {
	const chain: string[] = [];
	for (let current: unknown = error; current instanceof Error; current = current.cause) {
		chain.push(current.message);
	}
	return chain;
}

/**
 * sqlite's extended result code, from anywhere in the chain, or `null`.
 *
 * `null` covers two cases a caller must treat the same way: an error that is not the database's at
 * all, and one that is but carries no code. neither is a rejection this app can explain, and
 * inventing a code for either would put a made-up constraint name in front of whoever is reading
 * the logs.
 *
 * ---------------------------------------------------------------------------
 * one message carries two codes, and taking the first one is the trap this function exists to
 * close.
 *
 * a foreign key rejection reads:
 *
 *   D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
 *
 * — the primary code, then the extended one. a caller wants the extended one, because the primary
 * is shared by every constraint there is: `SQLITE_CONSTRAINT` cannot tell a duplicate key from a
 * missing parent row, so a mapping built on it collapses every refusal into one. and it fails
 * quietly rather than loudly, since `SQLITE_CONSTRAINT` is itself a real code and reads like a
 * correct answer.
 *
 * so the longest match wins rather than the first. an extended code is its primary code plus a
 * suffix, so "longest" is "most specific" by construction — and it stays true through a rewording
 * of the sentence around them, which matching on `(extended: …)` would not. a message carrying only
 * a primary code still answers with it.
 * ---------------------------------------------------------------------------
 */
export function sqliteResultCode(error: unknown): string | null {
	let best: string | null = null;
	for (const message of causeChain(error)) {
		for (const match of message.matchAll(SQLITE_CODE)) {
			if (best === null || match[0].length > best.length) best = match[0];
		}
	}
	return best;
}

/**
 * the shape of a result code: `SQLITE_` and uppercase words under underscores.
 *
 * anchored on a word boundary at both ends so that a value quoted inside a message — a column
 * holding the text `SQLITE_CONSTRAINT_CHECK`, which `STRICT` happily stores — cannot be read as the
 * code unless it is the whole token, which is the closest this can get to unambiguous without
 * parsing a sentence upstream is free to rewrite.
 */
const SQLITE_CODE = /\bSQLITE_[A-Z]+(?:_[A-Z]+)*\b/g;
