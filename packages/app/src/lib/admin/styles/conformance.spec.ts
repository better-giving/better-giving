import {
	rawLengthViolations,
	stripComments,
	styleObjectsIn
} from '@better-giving/operator/styles/raw-values';
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the /admin stylesheets open by making claims about the tree rather than about themselves, and
// this file is what makes them true instead of merely stated. four are
// packages/operator/src/styles/tokens.css's: every
// `--admin-*` a screen reads is defined there, every name defined there is read by something unless
// it is a member of a scale, no name the scale exemption holds is read by anything, and no scoped
// style block in /admin spells a length of its own. four
// are the element sheet's: every interactive rule it writes pairs its state pseudo with the class
// that forces the same state, every class it draws is carried by markup somewhere in this
// repository, every class it draws is inside the `adm-` and `is-` vocabulary, and no duration in it
// is a literal. two more are the two sheets' together, and the screens' beside them: every
// `font-size` written reads a type role rather than a step of the ladder under it, and every
// `font-weight` reads one too. one is ../../../app.css's: every rule /admin
// ships stands inside one of the five layers declared there. colour is the twelfth and is gated
// separately, by ./raw-color.spec.ts. the first two live in a different package than this file
// does — packages/operator/src/styles/ — so every path below spells the whole route from the
// repository root to a file that is not a sibling, and stays relative for one that still is.
//
// one file rather than one per claim, because what is being asserted is one thing in eleven parts:
// that a sheet's header describes the tree it sits in. a reader who breaks any of them should meet
// the others on the way to the failure.
//
// two of the eleven are written so that no hand-maintained list stands behind them. the twin check
// compares a selector against the other members of its own list rather than against the contents of
// an `:is()` group, because the sheets write a plain list. the motion check reads no block of
// selectors at all: it asserts that no duration outside packages/operator/src/styles/tokens.css is
// a literal and that every
// `--admin-dur-*` is re-pointed under reduced motion, which together cannot be defeated by writing
// the next transition above a list.
//
// the layer check is ordering hygiene inside /admin and is worth keeping as that. what it is not is
// a guard on the donation form: the form's sheets are adopted into a shadow root, an encapsulation
// context is settled before layers are ever compared, and ../../../app.css states the two facts that
// actually govern that boundary. a sheet that forgets its `@layer` loses its place in the order; it
// reaches nothing in the form either way.
//
// the length check hands packages/operator/src/styles/raw-values.ts this surface's screens and
// nothing else, and that boundary is chosen rather than overlooked: what
// packages/operator/src/styles/tokens.css claims is about screens. the sweep itself, the two
// breakpoints it lets through and the `raw-length-ok:` bargain are written beside the assertion
// there, because they are one rule wherever a screen lives; the list handed to it is this file's,
// because it is not. ./raw-color.spec.ts is the other half of the same arrangement, for colour.

const TOKENS_FILE = '../operator/src/styles/tokens.css';
// the element sheet, which holds `elements` and `layout` and is therefore where every state ladder
// and every declared motion in /admin is written.
const ELEMENT_FILE = '../operator/src/styles/adm.css';
// the faces, which is the one sheet that draws no rule: `@font-face` blocks and nothing else.
const FONTS_FILE = '../operator/src/styles/fonts.css';
const APP_FILE = 'src/app.css';

// src/lib/donate/** is swept out rather than in. the donor page draws the donation form's own
// card, dressed from packages/form's four sheets and its token file, so an /admin token is exactly
// what a screen there must not carry — and the gate over those values is the form package's own
// browser specs against that token file. its src/lib/donate/page.css is the page's chrome and is
// gated by nothing: it is no operator screen and carries no /admin token.
const DONATE = 'src/lib/donate/';
const screens = globSync('src/**/*.tsx').filter((file) => !file.startsWith(DONATE));
// the four sheets live in packages/operator, a sibling package this file reaches out of rather
// than a directory inside this one.
const sheets = globSync('../operator/src/styles/*.css');
// src/app.css is named rather than swept: it is where the layer order every one of the four
// sheets is read inside gets declared.
const stylesheets = [...sheets, APP_FILE];
const sources = [...screens, ...stylesheets];

const DEFINITION = /^\s*(--admin-[\w-]+)\s*:/gm;
const REFERENCE = /var\(\s*(--admin-[\w-]+)/g;

// a token nothing reads is deleted, because a name with no site behind it is a decision nobody can
// see the effect of changing. what is exempt is membership of a scale — a rung of a ramp, a spacing
// step, a type step — because a scale is read by counting along it and one with holes in it is no
// longer one anybody can count along. the exemption is never a token that has
// merely not been reached for yet.
//
// the exemption is checked in both directions, and the second direction is why: a name here that
// something has since reached for goes on claiming to be unread, and nothing about the tree says
// otherwise. `exempts no token anything reads` is what fails then.
//
// the same twenty-three are named in packages/operator/src/styles/tokens.css's own header. they are written in both places on purpose:
// the paragraph is what a reader meets, and this is what fails.
const SCALE_EXEMPT = [
	// the unread rungs of the three chromatic ladders. each ladder is twelve rungs because the rung
	// number is the job, and a family whose middle is missing is one where the next value drawn in
	// that tone is a number somebody picks. the neutral ladder is read end to end and is absent
	// here for that reason rather than by oversight.
	//
	// the accent: no operator screen draws a ground lighter than rung 3 or a chromatic border, so
	// the two lightest rungs go unread and so do the two between the line rung and the solid band.
	// rung 9 joins them because this family's solid band is too bright to carry a label, which
	// packages/operator/src/styles/tokens.css argues at `--admin-accent-solid-1`; rung 10 is read
	// once, by the rail's current edge.
	'--admin-accent-1',
	'--admin-accent-2',
	'--admin-accent-7',
	'--admin-accent-8',
	'--admin-accent-9',
	// the blocker: a red band, a red word and a destructive fill are the whole of what this tone
	// draws, so its tint band and its border band each spend one rung and the rest are unread.
	'--admin-blocker-1',
	'--admin-blocker-2',
	'--admin-blocker-4',
	'--admin-blocker-5',
	'--admin-blocker-7',
	'--admin-blocker-8',
	// the attention ochre, and its two solid rungs are in this list rather than in use. rung 9 is
	// lighter than rung 8 in this family, so an ochre bright enough to be a solid ground is too
	// bright to be a boundary or a glyph on white — the two roles that would have taken it take
	// rung 11 instead, which packages/operator/src/styles/tokens.css argues at their entries.
	'--admin-attention-1',
	'--admin-attention-2',
	'--admin-attention-4',
	'--admin-attention-5',
	'--admin-attention-7',
	'--admin-attention-8',
	'--admin-attention-9',
	'--admin-attention-10',
	// the one rung of the type scale nothing reads: the step between the section heading's size
	// and the page title's. a size is read by counting along the scale, and a scale that stops at
	// whatever the last screen needed is one the next screen extends by inventing a step — the top
	// rung is off this list because the dashboard's headline figure spends it, and the floor is off
	// it because `--admin-fineprint-size` is.
	'--admin-text-xl',
	// the weight scale's top. three of the four weights are drawn and this is the fourth; it is a
	// self-hosted file either way, so the name existing is what says the face has four.
	'--admin-weight-bold',
	// the spacing scale's top two steps. its zero is not here: `.adm-code` in
	// packages/operator/src/styles/base.css spends it to say a literal inside a sentence takes no
	// inline padding, which is the rung naming "no gap" so a rule can say it.
	'--admin-space-11',
	'--admin-space-12'
];

// the five layers, in the order ../../../app.css declares them. later wins, which is why `layout` is
// last: a screen's arrangement of an element outranks that element's own rule without either one
// raising its specificity to say so.
const LAYERS = ['tokens', 'reset', 'base', 'elements', 'layout'];

const read = (file: string) => readFileSync(file, 'utf8');

function referenced(file: string) {
	const found: { token: string; at: string }[] = [];
	read(file)
		.split('\n')
		.forEach((line, i) => {
			for (const [, token] of line.matchAll(REFERENCE)) {
				if (token) found.push({ token, at: `${file}:${i + 1}` });
			}
		});
	return found;
}

const defined = new Set(
	[...read(TOKENS_FILE).matchAll(DEFINITION)].flatMap((m) => (m[1] ? [m[1]] : []))
);
const reads = sources.flatMap(referenced);
const readNames = new Set(reads.map((r) => r.token));

// every class this repository's markup writes onto an element, from every screen on both operator
// surfaces. built once: the question a stylesheet asks is whether anything anywhere carries a
// name, so the answer is one set rather than one per sheet.
//
// the console's screens are in it as well as this surface's, and that is not the same boundary the
// raw-value sweeps keep. those ask something of a screen, so each surface hands its own list. this
// asks whether a rule in a shared sheet is dead — and packages/operator/src/styles/adm.css is read
// by both operator surfaces, so a class only the console wears is a class something wears. globbed
// across the package line the way the sheets themselves are above; nothing here imports from there.
//
// packages/operator/src/components/** and .../behaviour/** are in it for the same reason as the
// console: a mark, a banner, a save button and the trigger that opens an anchored card are drawn
// once there and mounted by both surfaces, so a class only one of those shared modules writes is
// still a class something wears. it is the same package as the sheets above, which is why a class
// that lives only in a component reads as worn here.
//
// packages/gallery/src/** is deliberately not in it, and that absence is the gate rather than a
// glob somebody forgot. this asks whether a rule is dead, and a preview is a specimen rather than
// a screen anybody is served — so a class worn only there is worn by nothing, which is exactly the
// finding. adding that glob would let one preview keep any rule in the sheet alive forever.
const worn = new Set(
	[
		...screens,
		...globSync('../console-ui/src/**/*.tsx'),
		...globSync('../operator/src/components/**/*.jsx'),
		// the specs beside them are filtered out rather than globbed around: a case is not a screen,
		// so a class worn only by one is worn by nothing — the same finding the gallery's absence
		// above is there to keep. the components glob escapes this by extension alone, their specs
		// being `.tsx` beside `.jsx`, which is an accident rather than a rule.
		...globSync('../operator/src/behaviour/*.tsx').filter((f) => !f.includes('.spec.'))
	].flatMap((f) => [...classesCarried(read(f))])
);

// the three states a rule may force, and the class that forces each. `disabled` is not among them
// and needs no twin: it is a real attribute, so a page that wants a disabled control sets it and
// gets exactly what the product renders.
const STATE_TWINS: readonly [state: string, twin: string][] = [
	[':hover', '.is-hover'],
	[':active', '.is-active'],
	[':focus-visible', '.is-focus']
];

// every block a stylesheet opens: the text in front of its `{`, the line that text starts on, the
// blocks it stands inside, and the declarations between its own braces. comments are blanked rather
// than removed above, so every line survives the strip and is what a failure names.
//
// one parser rather than one per check. three of the checks below read a selector, one reads a
// declaration's value and one reads which at-rule a rule stands in, and a second walk over the same
// braces would be a second answer to "what is a rule here" that nothing compares against the first.
type Block = {
	selector: string;
	line: number;
	within: string[];
	declarations: { property: string; value: string; line: number }[];
};

function blocks(css: string) {
	const found: Block[] = [];
	const open: Block[] = [];
	let buffer = '';
	let started = 0;
	stripComments(css)
		.split('\n')
		.forEach((line, i) => {
			for (const ch of line) {
				if (ch === '{') {
					const block: Block = {
						selector: buffer.trim().replace(/\s+/g, ' '),
						line: started + 1,
						within: open.map((b) => b.selector),
						declarations: []
					};
					found.push(block);
					open.push(block);
					buffer = '';
				} else if (ch === '}' || ch === ';') {
					// a declaration is the text since the last brace or semicolon; its property is what
					// stands before the first `:` and its value is the rest. a selector never reaches here:
					// it ends at a `{`.
					const text = buffer.trim().replace(/\s+/g, ' ');
					const colon = text.indexOf(':');
					const holder = open.at(-1);
					if (holder && colon !== -1) {
						holder.declarations.push({
							property: text.slice(0, colon).trim(),
							value: text.slice(colon + 1).trim(),
							line: started + 1
						});
					}
					if (ch === '}') open.pop();
					buffer = '';
				} else {
					if (buffer.trim() === '') started = i;
					buffer += ch;
				}
			}
			buffer += '\n';
		});
	return found;
}

// the rules, which is every block that is not an at-rule.
const selectors = (css: string) =>
	blocks(css).filter((b) => b.selector !== '' && !b.selector.startsWith('@'));

// a selector list split at its own commas. depth is counted, so a comma inside `:is(…)` or `min(…)`
// does not split the selector holding it.
function splitList(list: string) {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < list.length; i++) {
		const ch = list[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === ',' && depth === 0) {
			parts.push(list.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(list.slice(from));
	return parts.map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p !== '');
}

// a state pseudo is twinned when the list it stands in also holds the selector produced by swapping
// that pseudo for its class. the test is against the whole list rather than against an exact string,
// so a rule naming four controls at once still counts and the two orders both count.
//
// the swap is at the pseudo's own position rather than at the end of the member, which is what makes
// a descendant selector answerable: `[aria-expanded]:hover .adm-mark` is twinned by
// `[aria-expanded].is-hover .adm-mark` and by nothing else.
function untwinnedStates(css: string, file: string) {
	const found: string[] = [];
	for (const { selector, line } of selectors(css)) {
		const members = splitList(selector);
		const list = new Set(members);
		for (const member of members) {
			for (const [state, twin] of STATE_TWINS) {
				for (
					let at = member.indexOf(state);
					at !== -1;
					at = member.indexOf(state, at + state.length)
				) {
					const twinned = (member.slice(0, at) + twin + member.slice(at + state.length))
						.trim()
						.replace(/\s+/g, ' ');
					if (!list.has(twinned)) {
						found.push(`${file}:${line} ${state} with no ${twin} — ${member} — in ${selector}`);
					}
				}
			}
		}
	}
	return found;
}

// ---- the classes a sheet draws, against the classes markup carries -------------------------
//
// a class in a selector. bounded so that `.5rem` is a length and not a class, and so that the
// second half of `.adm-mark--lg` stays part of the one name.
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

// what a class may be written into, and nothing else. an attribute value, an expression handed to
// `class` or `className`, and the `class:` directive are the four positions, and reading only those
// is what stops the sweep counting a class named in prose or in an aria-label as a call site.
//
// the script block is out of the sweep for the same reason: a `Record` keyed `'date'` or a union of
// state names is not markup, and counting one would let a class survive on a string that never
// reaches an element. a react screen has no script block to strip and needs none — a string in its
// module scope is not in any of the four positions either.
function classesCarried(source: string) {
	const markup = source
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const carried = new Set<string>();
	const words = (text: string) =>
		text.split(/\s+/).forEach((w) => {
			if (w) carried.add(w);
		});
	for (const [, value] of markup.matchAll(/\bclass(?:Name)?\s*=\s*"([^"]*)"/g)) words(value ?? '');
	for (const [, value] of markup.matchAll(/\bclass(?:Name)?\s*=\s*'([^']*)'/g)) words(value ?? '');
	// `class={…}`, read to its matching brace so that a nested object or array is one expression.
	// what counts inside it is a string literal: a template literal spells every class it may apply
	// as one, so a branch nobody takes today still has a call site.
	for (const opener of markup.matchAll(/\bclass(?:Name)?\s*=\s*\{/g)) {
		let depth = 1;
		let at = opener.index + opener[0].length;
		while (at < markup.length && depth > 0) {
			if (markup[at] === '{') depth++;
			else if (markup[at] === '}') depth--;
			at++;
		}
		const expression = markup.slice(opener.index + opener[0].length, at - 1);
		for (const [, single, double] of expression.matchAll(/'([^']*)'|"([^"]*)"/g))
			words(single ?? double ?? '');
		// a template literal is read for its own text and its holes are blanked: what stands between
		// the holes is class text, and what is inside one is scanned by the pass above — a class
		// applied on a branch is a quoted string wherever the branch is written.
		for (const [, template] of expression.matchAll(/`([^`]*)`/g))
			words((template ?? '').replace(/\$\{[^}]*\}/g, ' '));
	}
	for (const [, name] of markup.matchAll(/\bclass:([\w-]+)/g)) if (name) carried.add(name);
	return carried;
}

// a class the sweep cannot see says so out loud and names itself, which is the bargain
// `raw-colour-ok:` and `raw-length-ok:` strike one line at a time. it names the class rather than
// standing on its line because a selector list spans lines and a rule's classes are not all on the
// one this file would report.
const CARRIED = /carried-ok:/;

// which screens carry a class is not this gate's business, and that is a decision rather than a
// gap. what fails is a class no markup anywhere writes.
//
// the sweep reads a `class` attribute and nothing else, so a screen that assembles its class list
// in script — a `$derived` array, a function returning the string — writes a name this file cannot
// see. that is what the note above is for, and it is why one names the screen it is answering for
// rather than only itself.
function unwornClasses(file: string) {
	const source = read(file);
	const exempt = new Set<string>();
	for (const line of source.split('\n')) {
		if (!CARRIED.test(line)) continue;
		for (const [, name] of line.matchAll(CLASS)) if (name) exempt.add(name);
	}
	const found: string[] = [];
	const seen = new Set<string>();
	for (const { selector, line } of selectors(source)) {
		for (const [, name] of selector.matchAll(CLASS)) {
			if (!name || seen.has(name)) continue;
			seen.add(name);
			if (!worn.has(name) && !exempt.has(name)) found.push(`${file}:${line} .${name}`);
		}
	}
	return found;
}

// ---- the type roles, and the one direction that makes them roles -----------------------------
//
// a rule reads a role and a role reads a step, for the reason a component reads an alias and never
// a ladder rung: the step is where a size came from and the role is what it is for. a rule that
// reads the step is a rank nothing can re-point in one place, and it satisfies both of the other
// two sweeps on its way past — the value resolves to packages/operator/src/styles/tokens.css and no
// literal is spelled — so this is the only thing that sees it.
//
// the two role sets are read off that file rather than listed here, and the shape they are read by
// is the rule itself: a role is a name it defines as `--admin-<role>-size: var(--admin-text-*)` or
// `--admin-<role>-weight: var(--admin-weight-*)`, which is the one place a step may be read and is
// a custom property rather than a declaration this sweep sees. deriving them is what stops a role
// added to the token file from needing a line here, and it keeps `--admin-mark-size` out of the
// size set — a shape stays out by not reading the type ladder, rather than by being a shape, so
// re-pointing that entry at `--admin-text-md` is what would promote it.
//
// the ladder's own names are excluded by prefix, which the shape alone does not do: an alias
// `--admin-weight-heavy: var(--admin-weight-bold)` ends the way a role ends and reads the ladder
// the way a role reads it, so it would be minted as a role and become readable from a rule — the
// ladder under another spelling, which is the one thing this layer exists to stop.
const LADDER_NAME = /^--admin-(text|weight)-/;
//
// the code face is the one exception and is named, because its size and its leading are literals
// off both ladders: packages/operator/src/styles/tokens.css argues that at their entries, and
// without this line every rule setting text in the mono face would read as off-role.
const CODE_FACE = ['--admin-code-size'];

const roleDefinitions = [...read(TOKENS_FILE).matchAll(/^\s*(--admin-[\w-]+)\s*:([^;}]*)/gm)];

const rolesOf = (ending: RegExp, ladder: RegExp) =>
	new Set([
		...roleDefinitions.flatMap(([, name, value]) =>
			name && value && !LADDER_NAME.test(name) && ending.test(name) && ladder.test(value)
				? [name]
				: []
		)
	]);

const SIZE_ROLES = rolesOf(/-size(?:-sm)?$/, /var\(\s*--admin-text-/);
for (const name of CODE_FACE) SIZE_ROLES.add(name);
const WEIGHT_ROLES = rolesOf(/-weight(?:-[\w-]+)?$/, /var\(\s*--admin-weight-/);

// a type declaration that reads no role says so out loud on its own line and gives its reason —
// the bargain `raw-length-ok:` strikes in
// packages/operator/src/styles/raw-values.ts, for the half of the system that is type. what it
// excuses is a rank departed from rather than a rank stated: a variant quieting the word it
// modifies, an emphasis inside a run, and the three declarations in
// packages/operator/src/styles/base.css's reset that state no rank at all. the note is read off the
// raw line and the value off the stripped one, so a note inside a comment is not a hatch that is
// documented and dead.
const TYPE_ESCAPE = /type-ok:/;

// the note stands on the declaration's own line or in the comment immediately above it, and both
// are read because the sheets' formatter folds a trailing comment long enough to carry a reason
// into the value it was excusing. a line is comment text when the strip blanked it and the raw line
// still holds something, which is what the parser already knows rather than a second guess at css
// syntax; a selector or another declaration between the two ends the search, so a rule's own header
// comment excuses nothing inside it.
//
// a declaration whose own line opens a block is excused by nothing, and that is the same rule held
// to over a rule written on one line: there the note stands beside a selector, so it reads as the
// rule's header rather than as this declaration's reason — and the header above such a rule reaches
// every declaration between the braces, there being no selector line in between for the walk to
// stop at. the brace is looked for in the stripped line rather than the raw one, so a `{` inside a
// comment is not a block being opened.
function excused(raw: string[], blanked: string[], line: number) {
	let at = line - 1;
	if ((blanked[at] ?? '').includes('{')) return false;
	if (TYPE_ESCAPE.test(raw[at] ?? '')) return true;
	for (at -= 1; at >= 0; at -= 1) {
		if ((blanked[at] ?? '').trim() !== '' || (raw[at] ?? '').trim() === '') return false;
		if (TYPE_ESCAPE.test(raw[at] ?? '')) return true;
	}
	return false;
}

// every declaration a sheet writes for one of the named properties, with the block it stands in.
// `@font-face` is out by name, and that is the difference between a rank and a descriptor:
// `@font-face { font-weight: 400 }` in packages/operator/src/styles/fonts.css says which face the
// file behind it is, not how loud anything on a screen is drawn.
//
// named, so a nested `@media`, `@container` or `@supports` stays in the sweep: css nesting puts
// one inside a rule, nothing here forbids it, and the ranks it states are ranks.
// a descriptor block nothing writes a `font-size` into needs no line here: `@property`'s
// declarations are `syntax`, `inherits` and `initial-value`, none of which this sweep reads.
const DESCRIPTOR_BLOCK = /^@font-face\b/;

function typeDeclarations(css: string, properties: string[]) {
	return blocks(css)
		.filter((b) => b.selector !== '' && !DESCRIPTOR_BLOCK.test(b.selector))
		.flatMap((b) => b.declarations.map((d) => ({ ...d, selector: b.selector })))
		.filter((d) => properties.includes(d.property));
}

const readsRole = (value: string, roles: Set<string>) => {
	const named = value.trim().match(/^var\(\s*(--admin-[\w-]+)\s*\)$/);
	return named?.[1] !== undefined && roles.has(named[1]);
};

// a value that states no rank at all. `inherit` is the reset's whole vocabulary and is not a size
// or a weight: it says the rank comes from wherever the element is standing.
const NO_RANK = (value: string) => value.trim() === 'inherit';

function offRoleType(css: string, file: string) {
	const raw = css.split('\n');
	const blanked = stripComments(css).split('\n');
	const found: string[] = [];
	const report = (d: { property: string; value: string; line: number; selector: string }) => {
		if (excused(raw, blanked, d.line)) return;
		found.push(`${file}:${d.line} ${d.selector} — ${d.property}: ${d.value}`);
	};
	// the `font` shorthand is flagged wherever it is written, at any value. it resets
	// `font-variant-numeric`, which packages/operator/src/styles/tokens.css argues a money column
	// cannot survive, and it carries a size past a sweep that reads only `font-size`.
	for (const d of typeDeclarations(css, ['font'])) report(d);
	for (const d of typeDeclarations(css, ['font-size']))
		if (!NO_RANK(d.value) && !readsRole(d.value, SIZE_ROLES)) report(d);
	for (const d of typeDeclarations(css, ['font-weight']))
		if (!NO_RANK(d.value) && !readsRole(d.value, WEIGHT_ROLES)) report(d);
	return found;
}

const offRoleTypeIn = (file: string) => offRoleType(read(file), file);

// the same rule over a screen, which writes its type in a style object rather than in a rule. the
// sweep reaches those objects the way the length gate does and for the same reason — a class name
// or a ternary is not a declaration — and it reads the three camel-cased keys a style object could
// carry a rank in. no screen carries one today, so what this holds is the one surface the doctrine
// is otherwise unenforced on: a `fontSize: 'var(--admin-text-sm)'` resolves to a defined token and
// spells no literal, so every other gate in this file passes it.
//
// the value is read quoted or bare, and the bare branch is the half a css sweep never needs: a
// screen states a weight as `fontWeight: 600` and a size as `fontSize: 14` — the idiomatic react
// spellings, and the two most likely ranks a screen ever writes. a bare name is read the same way
// and reported, because a rank held in a variable is a rank this file cannot resolve to a role.
const SCREEN_TYPE =
	/\b(fontSize|fontWeight|font)\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([\w.]+))/g;

function offRoleTypeInObjects(source: string, file: string) {
	const found: string[] = [];
	for (const object of styleObjectsIn(source)) {
		for (const [, key, single, double, template, bare] of object.matchAll(SCREEN_TYPE)) {
			const value = single ?? double ?? template ?? bare ?? '';
			if (key === 'font') found.push(`${file} font: ${value}`);
			else if (key === 'fontSize' && !NO_RANK(value) && !readsRole(value, SIZE_ROLES))
				found.push(`${file} fontSize: ${value}`);
			else if (key === 'fontWeight' && !NO_RANK(value) && !readsRole(value, WEIGHT_ROLES))
				found.push(`${file} fontWeight: ${value}`);
		}
	}
	return found;
}

const offRoleTypeInScreen = (file: string) => offRoleTypeInObjects(read(file), file);

// ---- the closed vocabulary the sheets draw ---------------------------------------------------
//
// `adm-` is an element and `is-` is a state pinned on one, and the repository's own .claude/CLAUDE.md and the
// element sheet's header state that those two are the whole of it. the sweep above asks
// whether a class is worn and answers yes for a borrowed name the markup happens to carry, which
// is the shape that lets the next one in.
const NAMESPACE = /^(adm-|is-)/;

function foreignClasses(file: string) {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const { selector, line } of selectors(read(file))) {
		for (const [, name] of selector.matchAll(CLASS)) {
			if (!name || seen.has(name)) continue;
			seen.add(name);
			if (!NAMESPACE.test(name)) found.push(`${file}:${line} .${name}`);
		}
	}
	return found;
}

// ---- motion, which is collapsed at source ---------------------------------------------------
const REDUCED_MOTION = /prefers-reduced-motion/;
const MOTION_PROPERTY = /^(transition|animation)(-|$)/;
// a time with a number in front of it. `linear`, `infinite` and a keyframe name called `adm-pulse`
// hold an `s` and none of them holds a digit before one, which is what the lookbehind and the
// leading digits together are for.
const LITERAL_TIME = /(?<![\w.-])\d*\.?\d+m?s(?![\w-])/;
const DURATION_TOKEN = /^--admin-dur-/;

// every transition and animation an /admin sheet declares, with the value it declares it at.
function motionDeclarations(file: string) {
	return blocks(read(file))
		.flatMap((b) => b.declarations.map((d) => ({ ...d, file })))
		.filter((d) => MOTION_PROPERTY.test(d.property));
}

// the `--admin-dur-*` names packages/operator/src/styles/tokens.css defines, split by whether the definition stands inside the
// reduced-motion block. a name in the first set and not the second goes on running at its full
// length for a reader who asked for less of it.
function durations(file: string) {
	const at = { root: new Set<string>(), reduced: new Set<string>() };
	for (const block of blocks(read(file))) {
		const reduced = block.within.some((w) => REDUCED_MOTION.test(w));
		for (const { property } of block.declarations) {
			if (!DURATION_TOKEN.test(property)) continue;
			(reduced ? at.reduced : at.root).add(property);
		}
	}
	return at;
}

// ---- the layer every rule stands inside -----------------------------------------------------
//
// the top-level blocks of a sheet. a stylesheet's `@import` and its `@layer` statement open no
// block at all, so what is left at the top level is either a layer or a rule that escaped one.
const topLevel = (file: string) => blocks(read(file)).filter((b) => b.within.length === 0);

const LAYER_BLOCK = new RegExp(`^@layer\\s+(${LAYERS.join('|')})$`);
const AT_PROPERTY = /^@property\s/;

describe('the --admin-* token layer is what /admin is drawn from', () => {
	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read, which is the
		// failure the whole file exists to refuse. every count below is a floor rather than the number
		// today, so adding a screen is not an edit here.
		expect(screens.length).toBeGreaterThan(0);
		expect(sheets.length).toBeGreaterThanOrEqual(4);
		expect(stylesheets).toContain(APP_FILE);
		expect(stylesheets).toContain(ELEMENT_FILE);
		// a tokens.css this file failed to parse would define nothing, and "nothing defined is unread"
		// is a sentence that passes.
		expect(defined.size).toBeGreaterThan(150);
		expect(readNames.size).toBeGreaterThan(150);
	});

	it('defines every token the scale exemption names', () => {
		// an exemption for a token that no longer exists is a dead pointer, and it is the shape the
		// list rots into: the token goes, the line naming it stays.
		expect(SCALE_EXEMPT.filter((t) => !defined.has(t))).toEqual([]);
	});

	it('exempts no token anything reads', () => {
		// the register over-claims silently and in one direction only: a name reached for after it was
		// exempted goes on being listed as unread, here and in the paragraph
		// packages/operator/src/styles/tokens.css's header holds, and the case above passes either way
		// because it only asks whether the name still exists.
		expect(SCALE_EXEMPT.filter((t) => readNames.has(t))).toEqual([]);
	});

	it('reads no --admin-* that tokens.css does not define', () => {
		const undefinedReads = reads.filter((r) => !defined.has(r.token));
		expect(undefinedReads.map((r) => `${r.at} ${r.token}`)).toEqual([]);
	});

	it('defines no --admin-* that nothing reads, outside the scale exemption', () => {
		const exempt = new Set(SCALE_EXEMPT);
		const unread = [...defined].filter((t) => !readNames.has(t) && !exempt.has(t));
		expect(unread.sort()).toEqual([]);
	});
});

describe('no raw length in a scoped style block in /admin', () => {
	it('writes none into a screen', () => {
		// the screens are handed over as a list rather than globbed by the sweep, so the console's
		// screens reach the same sweep from the console's own spec. what this file still owns is
		// which files are in the list, and the `finds the files it is meant to be guarding` case
		// that says the glob reaching them matched something and that more than a handful of the
		// files it matched carry a block at all.
		expect(rawLengthViolations(screens)).toEqual([]);
	});
});

describe('every state the element sheet draws can be pinned without a pointer', () => {
	const parsed = selectors(read(ELEMENT_FILE));

	it('finds the selectors it is meant to be reading', () => {
		// a parse that returned nothing would report every rule twinned, which is the answer this check
		// exists to refuse. the floors are floors and not the counts today.
		expect(parsed.length).toBeGreaterThan(100);
		const states = parsed.filter((s) => STATE_TWINS.some(([state]) => s.selector.includes(state)));
		expect(states.length).toBeGreaterThan(20);
		// and what it returns has to be selectors rather than fragments of prose or halves of a
		// declaration: every one opens the way a selector opens and none of them carries a `;`. no
		// single rule is named here, so renaming one is not an edit to this file.
		//
		// a keyframe offset opens with a digit, which no other selector does. it is admitted whole
		// — every part of it an offset — so that a fragment merely starting with a digit does not
		// come through beside it.
		const KEYFRAME_OFFSET = /^\d*\.?\d+%(\s*,\s*\d*\.?\d+%)*$/;
		const notSelectors = parsed.filter(
			(s) =>
				(!/^[.#:[a-zA-Z*]/.test(s.selector) && !KEYFRAME_OFFSET.test(s.selector)) ||
				s.selector.includes(';')
		);
		expect(notSelectors.map((s) => `${ELEMENT_FILE}:${s.line} ${s.selector}`)).toEqual([]);
	});

	it('writes no :hover, :active or :focus-visible without its .is-* twin in the same list', () => {
		// the twin is what lets a specimen pin a state without a pointer on the element and read the
		// rule that fires. a rule with no twin goes on drawing the resting state under a page that says
		// it is showing hover, which is a page lying rather than a page missing something.
		expect(untwinnedStates(read(ELEMENT_FILE), ELEMENT_FILE)).toEqual([]);
	});
});

describe('every class an /admin stylesheet draws is carried by markup', () => {
	it('finds the markup it is meant to be reading', () => {
		// a sweep that read no class would report every rule carried, which is the answer this check
		// exists to refuse. the floors are floors and not the counts today.
		expect(worn.size).toBeGreaterThan(50);
		// and it has to be reading classes rather than every word in the markup: a sweep that counted
		// prose would carry `the` and `a` and never fail again.
		expect(worn.has('the')).toBe(false);
		expect(worn.has('adm-btn')).toBe(true);
	});

	it.each(stylesheets)('%s', (file) => {
		// a rule for a class nothing sets is a rule a reader has to rule out before finding the one
		// that draws the state in front of them, and nothing on a screen says it is dead.
		expect(unwornClasses(file)).toEqual([]);
	});

	it.each(stylesheets)('%s draws no class outside the adm- and is- vocabulary', (file) => {
		// a sheet this parser found no rule in would report every class inside the set, so the floor
		// is what makes the assertion under it mean something. it counts the rules the sweep below
		// consumes rather than the blocks around them: a regression that left every block standing
		// and captured no selector — every one of them reading as an at-rule, say — reports no class
		// at all and passes a block count in the hundreds.
		//
		// the two sheets that draw no rule are off the floor rather than floored at zero, which is
		// an assertion with no failing input. packages/operator/src/styles/fonts.css is `@font-face`
		// and nothing else and ../../../app.css opens no block at all, and that each is read is
		// asserted where it means something: `every rule an /admin sheet writes stands inside a
		// declared layer` below floors the first's top-level blocks and reads the second's layer
		// statement.
		if (file !== APP_FILE && file !== FONTS_FILE)
			expect(selectors(read(file)).length).toBeGreaterThan(0);
		// worn is not the same question as inside the set: a borrowed name the markup happens to
		// carry passes the sweep above and is still a rule a reader cannot find by the name of the
		// block it belongs to.
		expect(foreignClasses(file)).toEqual([]);
	});
});

describe('every font-size and font-weight in /admin reads a type role', () => {
	// a fixture rather than the tree, for the reason packages/operator/src/styles/design-copy.spec.ts
	// states about its own: the cases below can only ever assert that the sheets come back clean,
	// and a clean answer is what a working sweep and a blind one both give. each pair is the same
	// declaration twice — once as the gate must refuse it, once as it must pass.
	const fixture = `
		@font-face { font-weight: 400; }
		.adm-a { font-size: var(--admin-text-sm); font-weight: var(--admin-weight-medium); }
		.adm-b { font-size: var(--admin-label-size); font-weight: var(--admin-label-weight); }
		.adm-c { font-size: 0.9rem; font-weight: 600; }
		.adm-d { font-size: inherit; font-weight: inherit; }
		.adm-e { font: inherit; }
		.adm-f {
			font: inherit; /* type-ok: excused on its own line. */
		}
		.adm-g {
			/* type-ok: excused by the comment above it. */
			font-weight: 600;
		}
		/* a rule's own header, which excuses nothing inside it — type-ok: not from here. */
		.adm-h {
			font-weight: 600;
		}
		/* the same header over a one-line rule — type-ok: not from here either. */
		.adm-i { font-weight: 600; }
		.adm-j { font-weight: 600; /* type-ok: a note on the line that opens the block. */ }
		.adm-k {
			@media (min-width: 40rem) {
				font-size: 0.9rem;
			}
		}
	`;
	const caught = offRoleType(fixture, 'fixture.css');

	it('finds the declarations it is meant to be reading', () => {
		// without this the suite passes loudest when a glob is wrong, a parse changed or a
		// `font-size` came to be written in a shape the block reader splits differently — and the
		// case under it goes green on nothing. the floor is a floor and not the count today.
		const swept = sheets.flatMap((file) =>
			typeDeclarations(read(file), ['font-size', 'font-weight', 'font'])
		);
		expect(swept.filter((d) => d.property === 'font-size').length).toBeGreaterThan(30);
		expect(swept.filter((d) => d.property === 'font-weight').length).toBeGreaterThan(20);
		expect(screens.length).toBeGreaterThan(0);
	});

	it('catches a step read, a literal and the shorthand, and passes a role', () => {
		expect(caught).toEqual([
			'fixture.css:7 .adm-e — font: inherit',
			'fixture.css:3 .adm-a — font-size: var(--admin-text-sm)',
			'fixture.css:5 .adm-c — font-size: 0.9rem',
			'fixture.css:24 @media (min-width: 40rem) — font-size: 0.9rem',
			'fixture.css:3 .adm-a — font-weight: var(--admin-weight-medium)',
			'fixture.css:5 .adm-c — font-weight: 600',
			'fixture.css:17 .adm-h — font-weight: 600',
			'fixture.css:20 .adm-i — font-weight: 600',
			'fixture.css:21 .adm-j — font-weight: 600'
		]);
	});

	// a screen states a rank in a style object rather than in a rule, so the sweep over one is a
	// second reader with its own vocabulary and gets its own fixture. the case below it can only
	// ever assert that the screens come back clean, and the two spellings a screen is likeliest to
	// use — a bare number and a name held elsewhere — carry no quotes for that reader to find.
	const screenFixture = `
		<p style={{ fontSize: 'var(--admin-text-sm)', fontWeight: 600 }} />
		<p style={{ fontSize: 14, fontWeight: 'var(--admin-label-weight)' }} />
		<p style={{ font: 'inherit', fontWeight: rank }} />
		<p style={{ fontSize: 'var(--admin-label-size)' }} />
	`;

	it('catches an unquoted rank in a style object, and passes a role', () => {
		expect(offRoleTypeInObjects(screenFixture, 'fixture.tsx')).toEqual([
			'fixture.tsx fontSize: var(--admin-text-sm)',
			'fixture.tsx fontWeight: 600',
			'fixture.tsx fontSize: 14',
			'fixture.tsx font: inherit',
			'fixture.tsx fontWeight: rank'
		]);
	});

	it.each(sheets)('%s', (file) => {
		// the role layer is what makes a rank re-pointable in one place. a rule reading the step
		// under it is the rank spelled twice, and the two other sweeps over the same declaration
		// both pass it.
		expect(offRoleTypeIn(file)).toEqual([]);
	});

	it('writes no rank into a screen', () => {
		// the surface the doctrine would otherwise be unenforced on, and the one most likely to
		// drift: a screen's own style object reaches none of the sweeps above.
		expect(screens.flatMap(offRoleTypeInScreen)).toEqual([]);
	});
});

describe('every motion in /admin collapses at source', () => {
	// there is no per-selector reduced-motion block at the foot of the element sheet, and these two
	// assertions are why none is needed. they are strictly stronger together: the failure a
	// hand-maintained list of selectors cannot answer — the next `transition` written above it —
	// cannot arise here, because a duration that is not a token fails the first of them and a token
	// that is not re-pointed fails the second.
	const swept = stylesheets.filter((f) => f !== TOKENS_FILE).flatMap((f) => motionDeclarations(f));
	const dur = durations(TOKENS_FILE);

	it('finds the declarations and the block it is meant to be comparing', () => {
		// both halves have to be non-empty or the comparison passes by reading nothing.
		expect(swept.length).toBeGreaterThan(5);
		expect(dur.root.size).toBeGreaterThanOrEqual(4);
		expect(dur.reduced.size).toBeGreaterThan(0);
	});

	it('writes no literal duration outside tokens.css', () => {
		const literal = swept.filter((d) => LITERAL_TIME.test(d.value));
		expect(literal.map((d) => `${d.file}:${d.line} ${d.property}: ${d.value}`)).toEqual([]);
	});

	it('takes every duration from a token', () => {
		// a declaration with no `--admin-*` in it at all has its length written into it some other way,
		// which is the same failure as a literal one step further from the eye.
		const untokened = swept.filter((d) => !d.value.includes('var(--admin-'));
		expect(untokened.map((d) => `${d.file}:${d.line} ${d.property}: ${d.value}`)).toEqual([]);
	});

	it('re-points every --admin-dur-* inside the reduced-motion block', () => {
		const running = [...dur.root].filter((t) => !dur.reduced.has(t));
		expect(running.sort()).toEqual([]);
	});
});

describe('every rule an /admin sheet writes stands inside a declared layer', () => {
	const statement = read(APP_FILE).match(/@layer\s+([^;{]+);/);

	it('declares the five layers, in order', () => {
		expect(statement).not.toBeNull();
		expect(statement?.[1]?.split(',').map((n) => n.trim())).toEqual(LAYERS);
	});

	it('holds no rule of its own in src/app.css', () => {
		// it is the declaration and the imports and nothing else. a rule here would sit outside every
		// layer it names, which is the one thing the file exists to prevent.
		expect(topLevel(APP_FILE)).toEqual([]);
	});

	it.each(sheets)('%s', (file) => {
		const top = topLevel(file);
		// a sheet this parser found nothing in would report every rule layered, so the floor is what
		// makes the assertion under it mean something.
		expect(top.length).toBeGreaterThan(0);
		const outside = top.filter(
			(b) => !LAYER_BLOCK.test(b.selector) && !AT_PROPERTY.test(b.selector)
		);
		expect(outside.map((b) => `${file}:${b.line} ${b.selector}`)).toEqual([]);
	});
});
