// the one piece of markup an operator surface reads out of a string, and the whole of it: paired
// backticks mark a command, a variable name or a value a machine would print, and everything else
// is prose.
//
// the operator strings a deployment answers with are written where the failure is known —
// `packages/app/src/lib/server/email/smtp-config.ts` marks a variable name and an echoed value
// that way — so a screen either renders the marks or shows an operator a literal backtick.
//
// it is in this package because both operator surfaces read one of those sentences: the dashboard
// draws them from a `load`, and the console reads the same sentences off the wire (./console/
// report.ts). a second parser is two answers to what a backtick means, and the one that drifts is
// the one nobody is looking at — see CLAUDE.md, which is where the rule for promoting a module
// into this package is written.
//
// it returns segments rather than a string of html, and that is the point of the module: the
// strings it is handed interpolate values an operator set, so nothing here may reach a screen as
// markup. a segment is escaped by whatever renders it, like any other expression.
//
// nothing else is parsed. no emphasis, no links, no fenced block — a second mark would be a
// second thing every one of these sentences has to be written against.

/**
 * a run of the source string, and whether it was marked as code.
 *
 * `text` is the run itself with its delimiting backticks already removed, so a renderer
 * prints it verbatim and decides only which element to put around it.
 */
export type CodeSpan = {
	text: string;
	code: boolean;
};

/**
 * split `source` on paired backticks.
 *
 * what a mark goes around, which is the rule every author of one of these strings writes to:
 * an environment-variable name, a command, or a value quoted verbatim — one echoed back from
 * the configuration or the input that produced it, or one the reader is being told to type.
 * nothing else. ordinary prose, a product noun, a capability label and a number stated as a
 * number (a count, a limit, a port named in a sentence) all stay unmarked, so a mark on the
 * screen means "this is the string, character for character" and never emphasis.
 *
 * one rule, because a screen renders several of these sentences at once: a fold puts a refusal
 * directly above the way out of it, so a name marked in one and not the other is the same name
 * printed two ways within an inch.
 *
 * an unpaired backtick is not a delimiter and is kept as text — a string ending mid-mark
 * renders with a stray backtick in it, which is a typo somebody can see and fix, where
 * swallowing the tail would silently drop the end of a sentence naming what to set.
 *
 * no segment is ever empty, and two plain runs never come back adjacent, so a caller can
 * render the list with no emptiness check of its own.
 */
export function codeSpans(source: string): CodeSpan[] {
	const segments: CodeSpan[] = [];

	// an empty run carries nothing to render, and an empty span (``) is the source having
	// marked nothing — both leave the list untouched. merging a plain run onto the plain run
	// before it is what keeps that from showing up as a seam.
	const push = (text: string, code: boolean) => {
		if (text === '') return;
		const last = segments.at(-1);
		if (!code && last && !last.code) {
			last.text += text;
			return;
		}
		segments.push({ text, code });
	};

	let cursor = 0;
	while (cursor < source.length) {
		const open = source.indexOf('`', cursor);
		if (open === -1) break;

		const close = source.indexOf('`', open + 1);
		if (close === -1) break;

		push(source.slice(cursor, open), false);
		push(source.slice(open + 1, close), true);
		cursor = close + 1;
	}

	push(source.slice(cursor), false);
	return segments;
}
