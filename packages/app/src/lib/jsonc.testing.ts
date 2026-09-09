/**
 * a jsonc document parsed, for the specs that hold this app's code to the config files it is
 * built and deployed with.
 *
 * two of them read one — `$lib/server/wrangler-config.testing.ts` for wrangler.jsonc, and
 * `form-rules.spec.ts` at the package root for tsconfig.json. the reader lives here rather than
 * in either of them because a second hand-written copy of the comment stripper below is a parser
 * that fixes a bug on one side only.
 *
 * `unknown` on the way out, deliberately: each caller narrows to the handful of fields it actually
 * reads, and a shared shape would grow every field any of them ever wants.
 */

import { readFileSync } from 'node:fs';

/**
 * hand-parsed rather than imported: these files are jsonc, `JSON.parse` refuses both the comments
 * and a trailing comma, and a parser package pulled in to read three files in three tests is a
 * dependency every install carries. what is left after the pass below is json, and `JSON.parse`
 * failing on it is the signal that the file stopped being valid.
 */
export function readJsonc(path: string): unknown {
	return JSON.parse(withoutJsoncExtras(readFileSync(path, 'utf8')));
}

/**
 * the same document without its comments or its trailing commas.
 *
 * one pass rather than a regex, because the two things a regex confuses are both in wrangler.jsonc:
 * a comment holding a double quote (`"Couldn't find a D1 DB named 'better-giving'"`) and a string
 * holding what looks like the start of a comment. inside a string literal nothing is a comment,
 * and inside a comment nothing opens a string.
 */
function withoutJsoncExtras(text: string): string {
	let out = '';
	const commas: number[] = [];
	let at = 0;
	while (at < text.length) {
		if (text.startsWith('//', at)) {
			const end = text.indexOf('\n', at);
			at = end === -1 ? text.length : end;
			continue;
		}
		if (text.startsWith('/*', at)) {
			const end = text.indexOf('*/', at + 2);
			at = end === -1 ? text.length : end + 2;
			continue;
		}
		const char = text.charAt(at);
		if (char === '"') {
			const end = endOfString(text, at);
			out += text.slice(at, end);
			at = end;
			continue;
		}
		if (char === ',') commas.push(out.length);
		out += char;
		at += 1;
	}
	// a comma with nothing but whitespace between it and the bracket that closes its container.
	const trailing = commas.filter((comma) => /^\s*[}\]]/.test(out.slice(comma + 1)));
	let kept = '';
	let cut = 0;
	for (const comma of trailing) {
		kept += out.slice(cut, comma);
		cut = comma + 1;
	}
	return kept + out.slice(cut);
}

/** the index just past the closing quote of the string literal starting at `from`. */
function endOfString(text: string, from: number): number {
	for (let at = from + 1; at < text.length; at += 1) {
		if (text.charAt(at) === '\\') {
			at += 1;
			continue;
		}
		if (text.charAt(at) === '"') return at + 1;
	}
	return text.length;
}
