import { readFileSync } from 'node:fs';

// the two gates that keep a value out of a screen, as assertions a caller hands a file list.
// what each refuses is a value written into a screen instead of taken from ./tokens.css: a raw
// colour anywhere in /admin's css, and a raw length in a screen's own scoped <style> block.
//
// they take a list rather than glob one tree because the screens they measure do not all live in
// one. every surface calls these from its own spec file with its own globs, and keeps its own case
// asserting that those globs matched something —
// packages/app/src/lib/admin/styles/raw-color.spec.ts and .../conformance.spec.ts are the
// dashboard's two, ../components/raw-values.spec.ts is this package's own over the components
// beside it, packages/console-ui/src/raw-values.spec.ts is the console's, and
// packages/emails/src/raw-values.spec.ts is the mail templates' — five in all. that case travels
// with the caller and is never shared away: a glob that quietly stops matching reads as a passing
// gate forever, and only the surface that wrote the glob knows what it was supposed to reach.
//
// a file contributes only the css it could actually hold — a .jsx or .tsx file its style objects,
// everything else its whole text. the distinction is what stops a `.jsx` component from
// false-positiving on its own markup: a ternary's `:` or a `part="field"` string is not a css
// declaration, and only the actual style objects are swept.
//
// each returns what it found rather than asserting it: the caller is the one that knows which files
// it globbed and what that glob was meant to reach, and a finding already carries the `file:line`
// its `expect(...).toEqual([])` prints.
//
// this is a test rather than a check the type system performs, and the difference is the reason it
// exists: what is read here is the files on disk, and what fails is what is in them.
//
// the split between the two is deliberate and is not symmetric. colour is gated everywhere,
// because there is no legitimate raw one. length is gated only in the files a caller hands to
// rawLengthViolations, and every caller hands screens: `1px` borders and `2px` outline offsets are
// legitimate and everywhere, so a length rule over the sheets would be mostly allowlist, and an
// allowlist is the thing that rots. ./adm.css holds drawing geometry no token covers — a caret's
// triangle, a checkbox's own square, a track's bound — and a token per shape would be a scale
// nobody counts along. a raw length there carries a `raw-length-ok:` note and is caught by review.
//
// ./tokens.css is where literals belong and is the one file exempt from the colour sweep. a caller
// leaves it out of the list it hands here and asserts that the exemption is still one file rather
// than a list, because a surface that split its values across four token files would turn a
// one-file exemption into a four-file allowlist without a line of this file changing.

const COLOUR_FUNCTIONS = [
	'rgba?',
	'hsla?',
	'hwb',
	'oklch',
	'oklab',
	'lab',
	'lch',
	'color',
	// two that read as a derivation rather than as a value, and are neither: `color-mix` mixes
	// two colours this file would each have caught alone, and `light-dark` states a second one
	// for a mode /admin does not have.
	'color-mix',
	'light-dark'
];

// the closed `<named-color>` set. it is a deny list rather than an allow list and it does not
// rot, because css fixed the names and adds none: `color: white` is the cheapest way past a
// gate that only reads hex.
//
// `transparent`, `currentColor` and `inherit` are absent on purpose. none of them is a named
// colour — each names where the colour comes from instead of what it is — and all three are
// load-bearing here: the focus ring is a box-shadow over a `2px solid transparent` outline,
// the reset states a zero border in `currentcolor` so a rule can give it a width alone, and the
// reset hands type and ink down by `inherit`.
const NAMED_COLOURS =
	`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
	 blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
	 crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
	 darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
	 darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
	 dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
	 gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
	 lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
	 lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
	 lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
	 magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
	 mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
	 mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
	 palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
	 powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
	 seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
	 steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
	 yellowgreen`.split(/\s+/);

// the system colours, on the same footing: each one hands a value to the reader's platform,
// which is a second palette /admin has no say in. the forced-colours path here deliberately
// names none of them — the focus ring's box-shadow drops and the transparent outline under it
// is what the reader's own colours paint, so nothing has to be spelled.
const SYSTEM_COLOURS =
	`AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText
	 Field FieldText GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem
	 SelectedItemText VisitedText`.split(/\s+/);

// a hex triple/quad, a colour function call, or a colour spelled as a word. matched only
// after a `:` on the same line, so an id selector (`#panel {`) is not mistaken for a hex
// value. a word is bounded against `-` as well as against `\w`, so the `field` inside
// `--admin-field-border` is a token name and not the system colour, and it is bounded
// against `(` on the right, so the maths function `tan()` is not the colour `tan`.
const RAW_COLOUR = new RegExp(
	`(#[0-9a-fA-F]{3,8}\\b` +
		`|(?<![\\w-])(?:${COLOUR_FUNCTIONS.join('|')})\\(` +
		`|(?<![\\w-])(?:${[...NAMED_COLOURS, ...SYSTEM_COLOURS].join('|')})(?![\\w(-]))`,
	'i'
);

// every unit /admin could write. a duration is `ms` or `s` and neither is here, because a duration
// is gated separately and everywhere rather than only in a scoped block — see the motion cases in
// packages/app/src/lib/admin/styles/conformance.spec.ts. `fr` and `%` are absent for the same
// reason a grid line number is: they describe a share of something the screen already owns, not a
// size taken from the scale.
const RAW_LENGTH = /(?<![\w.#-])\d*\.?\d+(?:px|rem|em|ch|vh|dvh|vw)(?![\w-])/g;

// the two breakpoints, and they are permitted in a media condition only: a media condition cannot
// read a custom property, so those two numbers are the one place this system is spelled as a
// literal at its call site. the same number in a declaration is `--admin-measure-column` spelled by
// hand and fails here, and it is the same length as well as the same string: ./base.css leaves the
// document root's font-size at the initial value, so a rem in a declaration and a rem in a media
// condition resolve against the same size.
const BREAKPOINTS = new Set(['44rem', '64rem']);
// the full-height column measures itself against the viewport, and no token could hold that.
const VIEWPORT_LENGTHS = new Set(['100dvh']);

// a deliberate raw value says so out loud on its own line and gives its reason: the value is
// allowed, the silence is not. moving these assertions between packages never moves where an
// exception is recorded — it stays a note on the line it excuses.
const COLOUR_ESCAPE = /raw-colour-ok:/;
const LENGTH_ESCAPE = /raw-length-ok:/;

// a comment is blanked rather than removed, so a line keeps both its number and its columns. the
// number is what a failure names, and the columns are what let an escape note be read off the same
// line after it has been taken out of the value.
//
// exported because every sweep over /admin's css has to agree on which text is a comment: the two
// below read the note off the raw line and the value off the stripped one, and the block parser in
// packages/app/src/lib/admin/styles/conformance.spec.ts reads its selectors off the stripped one
// too. two answers to "what is a comment here" is how a hatch comes to be documented and dead.
export const stripComments = (css: string) =>
	css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

// the style objects a .jsx or .tsx file writes, brace-balanced so a nested object or a spread does
// not end the block early. a react file carries no css of its own otherwise: a class name is a
// different sweep's business, not this file's, and nothing sweeps it any more, so this is the one
// place a port, a screen or a mail template could still slip a raw colour or length past every
// other gate.
//
// two shapes, because a style object is written in two places. an inline `style={{ ... }}` is one.
// the other is an object hoisted out of the markup and annotated `CSSProperties`, which is how
// packages/emails writes every one of its styles: a mail's styling is inline attributes and
// nothing else, so the objects are named, documented and shared rather than spelled at each
// element. a sweep that read only the inline shape would report a clean file for a template whose
// every value is a literal — the gate reading nothing and passing loudest, which is the failure
// this file exists over. the annotation has to stand before the object for the second shape to be
// found, so `satisfies CSSProperties` after one is a shape nothing here reaches.
export const styleObjectsIn = (source: string) => {
	const found: string[] = [];
	for (const opener of source.matchAll(/style\s*=\s*\{\{|CSSProperties[^\n=]*=\s*\{/g)) {
		let depth = 1;
		let at = opener.index + opener[0].length;
		while (at < source.length && depth > 0) {
			if (source[at] === '{') depth++;
			else if (source[at] === '}') depth--;
			if (depth === 0) break;
			at++;
		}
		found.push(source.slice(opener.index + opener[0].length, at));
	}
	return found;
};

// the css a file contributes to a sweep. a .jsx or .tsx file contributes its style objects
// — the rest of the file holds neither a colour nor a length this system governs — and every
// other file contributes its whole text.
const cssIn = (file: string) => {
	const source = readFileSync(file, 'utf8');
	if (file.endsWith('.jsx') || file.endsWith('.tsx')) return styleObjectsIn(source);
	return [source];
};

// a colour is read off what follows the first `:` on the line, so a selector is never mistaken for
// a value.
function colourViolations(css: string, file: string) {
	const found: string[] = [];
	// the escape note is read off the raw line and the colour off the stripped one. a css comment
	// is the only way to write the note, so testing the stripped line for it is how a hatch comes
	// to be documented and dead — which is the failure shape this file exists over.
	const raw = css.split('\n');
	stripComments(css)
		.split('\n')
		.forEach((line, i) => {
			const colon = line.indexOf(':');
			if (colon === -1 || COLOUR_ESCAPE.test(raw[i] ?? '')) return;
			// a face name is not a colour. the faces ./fonts.css loads are the red hat family, so
			// `font-family: 'Red Hat Text'` carries a named colour inside a proper noun. the
			// property is what exempts the line rather than the quotes around the value: a colour
			// is never quoted in css but is quoted in the `style={{ color: 'red' }}` object this
			// same sweep reads out of a .tsx screen.
			if (line.slice(0, colon).trim().toLowerCase() === 'font-family') return;
			const value = line.slice(colon + 1);
			if (RAW_COLOUR.test(value)) found.push(`${file}:${i + 1} ${line.trim()}`);
		});
	return found;
}

// a length is read off the whole line rather than off what follows a `:`, unlike the colour sweep:
// a selector holds no length, and a media condition may be written as a range with no colon in it
// at all.
function lengthViolations(css: string, file: string) {
	const found: string[] = [];
	// the note is read off the raw line and the length off the stripped one, as above.
	const raw = css.split('\n');
	stripComments(css)
		.split('\n')
		.forEach((line, i) => {
			if (LENGTH_ESCAPE.test(raw[i] ?? '')) return;
			const condition = line.includes('@media');
			for (const [value] of line.matchAll(RAW_LENGTH)) {
				if (VIEWPORT_LENGTHS.has(value)) continue;
				if (condition && BREAKPOINTS.has(value)) continue;
				found.push(`${file}:${i + 1} ${value} — ${line.trim()}`);
			}
		});
	return found;
}

/** every raw colour written into the css the given files contribute, as `file:line rule`. */
export const rawColourViolations = (files: string[]) =>
	files.flatMap((file) => cssIn(file).flatMap((css) => colourViolations(css, file)));

/** every raw length written into the css the given files contribute, as `file:line value — rule`. */
export const rawLengthViolations = (files: string[]) =>
	files.flatMap((file) => cssIn(file).flatMap((css) => lengthViolations(css, file)));
