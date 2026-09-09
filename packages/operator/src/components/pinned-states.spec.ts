import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../styles/raw-values';

// every member of a component's pinned-state union is a state the sheets actually draw for that
// component.
//
// **it exists because a pinned state is a class and nothing else.** a component offering
// `state="active"` writes `is-active` onto its element, and where no rule matches that class the
// element paints exactly as it did at rest — no error, no warning, and a specimen in
// packages/gallery that reads as a component with nothing wrong with it. the union in a component's
// JSDoc is the one statement of what it offers, ../styles/adm.css and ../styles/base.css are the
// one statement of what is drawn, and until this file nothing compared the two.
//
// **it sweeps from the components and never from the sheets.** a twin drawn for a component that
// does not offer it as a member costs nothing: the pseudo-class beside it is what a real pointer
// reaches, and the twin is only ever spent by a specimen. a member with no rule behind it is the
// asymmetric half — a promise the sheet does not keep — so the rule runs one way, from the union to
// the sheets.
//
// **a universal rule counts as drawn.** ../styles/base.css draws one ring for the whole surface as
// a bare `.is-focus`, and that ring is the whole of what focus is here; a per-component restatement
// of it would be a rule existing so that this gate could find it. so a selector that is exactly
// `.is-<member>` satisfies that member for every component.
//
// **a rule scoped to a class the component writes counts, whichever shape writes it.**
// `.adm-check--boxed.is-hover` is ./forms/CheckboxGroup.jsx's hover and reaches its boxed rows
// alone, which is a narrowing of where the state paints rather than an absence of it — the prop's
// own comment in that file is where that is said. what this reads is whether some rule naming one
// of the component's own classes paints the pinned member at all.
//
// **what it sweeps is the components drawing from ./closed-sets.js's shared set, and it is blind to
// a pinned union that names none of it.** ./controls/SaveButton.jsx pins a class from a union of its
// own the same way and is not read here: one of its members deliberately writes no class at all, so
// a rule holding every member of every `state` prop to a selector would need an exception, and
// ../styles/raw-values.ts's header argues in its own terms against a gate that carries one. a
// component leaving the shared set entirely therefore leaves this sweep, which is a change big
// enough to be read; a member added to a union that stays in it — ./controls/Button.jsx's two — is
// caught here on the next run.
//
// the classes a component writes are read off its source with its comments blanked, because the
// prose in these files names classes it does not write — ./controls/Button.jsx's header names
// `.adm-btn` and ./forms/Field.jsx's names `.adm-actions`. a `//` line is blanked along with the
// block comments, and the two strippers only ever err by dropping a class the component did write:
// that reads a real rule as belonging to nobody and fails here, which is the direction to be wrong
// in.
//
// it reads source text and the sheets, for ../styles/raw-values.ts's reason: what a component draws
// is not observable from a value, and the pool this runs in is `node` (../../vite.config.ts).

/** the two sheets an operator surface is dressed from, which are the whole of what a class can hit. */
const SHEETS = ['src/styles/adm.css', 'src/styles/base.css'];

/** the set every one of the unions below names rather than spells (./closed-sets.js). */
const SHARED = 'src/components/closed-sets.js';

/** the components, at the depth this package keeps them: the tree ./raw-values.spec.ts globs too. */
const COMPONENTS = 'src/components/*/*.jsx';

/**
 * the pinned-state prop, whose type expression is the union read here. it is matched on naming the
 * shared set, which is what tells it from the other two `state` props in this tree: a save reports
 * its own write (./controls/SaveButton.jsx) and a record carries the word its status is called
 * (./data/RecordCard.jsx), and neither is a state a pointer reaches.
 */
const STATE_PROP = /@property\s*\{([^}]*\bPointerState\b[^}]*)\}\s*\[state\]/;

/** the shared set's own members, where all seven unions point. */
const SHARED_SET = /@typedef\s*\{([^}]*)\}\s*PointerState/;

/** a stated member of a union. */
const MEMBER = /'([a-z][\w-]*)'/g;

/** a class in a selector. */
const SELECTOR_CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

/** a class a component writes, which in this package is every one of them. */
const WRITTEN_CLASS = /\badm-[\w-]+/g;

/** one component that offers a pinned state: what it offers, and what its markup is dressed by. */
type Component = {
	readonly file: string;
	readonly members: readonly string[];
	readonly classes: ReadonlySet<string>;
};

const read = (file: string): string => readFileSync(file, 'utf8');

/** a comment carries no class this file may read, and neither shape of one does. */
const uncommented = (source: string): string => stripComments(source).replace(/\/\/[^\n]*/g, '');

const classesOf = (selector: string): Set<string> =>
	new Set([...selector.matchAll(SELECTOR_CLASS)].map(([, name]) => name ?? ''));

/** every selector the given sheet states, one per comma, at-rules left out. */
function selectorsIn(css: string): string[] {
	return [...stripComments(css).matchAll(/([^{}]+)\{/g)]
		.flatMap(([, header]) => (header ?? '').split(','))
		.map((selector) => selector.trim().replace(/\s+/g, ' '))
		.filter((selector) => selector !== '' && !selector.startsWith('@'));
}

function membersIn(expression: string, shared: readonly string[]): string[] {
	const stated = [...expression.matchAll(MEMBER)].map(([, member]) => member ?? '');
	return expression.includes('PointerState') ? [...shared, ...stated] : stated;
}

describe('every pinned state a component offers is one the sheets draw', () => {
	const shared = membersIn(SHARED_SET.exec(read(SHARED))?.[1] ?? '', []);

	const files = globSync(COMPONENTS);
	const offering: Component[] = files
		.map((file) => ({ file, source: read(file) }))
		.filter(({ source }) => STATE_PROP.test(source))
		.map(({ file, source }) => ({
			file,
			members: membersIn(STATE_PROP.exec(source)?.[1] ?? '', shared),
			classes: new Set([...uncommented(source).matchAll(WRITTEN_CLASS)].map(([name]) => name))
		}));

	const selectors = SHEETS.map((sheet) => ({ sheet, found: selectorsIn(read(sheet)) }));

	const drawn = (component: Component, member: string): boolean =>
		selectors.some(({ found }) =>
			found.some((selector) => {
				if (selector === `.is-${member}`) return true;
				const classes = classesOf(selector);
				if (!classes.has(`is-${member}`)) return false;
				return [...component.classes].some((written) => classes.has(written));
			})
		);

	it('reads a union out of every component that offers a pinned state', () => {
		// the non-empty assertion every source-reading gate in this repo makes first, per file rather
		// than over the total: a union this stopped parsing reads as a component offering nothing and
		// therefore promising nothing, which is a passing gate forever.
		expect(offering.filter(({ members }) => members.length === 0).map(({ file }) => file)).toEqual(
			[]
		);
	});

	it('finds the components and the sheets it is meant to be guarding', () => {
		// the same guard from the other side. the glob is counted against the tree it reaches and the
		// components offering a state are counted on their own, because a prop deleted from a
		// component takes that component out of the sweep without taking a file out of the glob.
		expect(files.length).toBeGreaterThan(20);
		expect(offering.length).toBeGreaterThanOrEqual(7);
		for (const { sheet, found } of selectors) {
			expect(found.filter((selector) => selector.includes('.is-')).length, sheet).toBeGreaterThan(
				0
			);
		}
	});

	it('draws every member of every union it read', () => {
		const promised = offering.flatMap(({ file, members, classes }) =>
			members
				.filter((member) => !drawn({ file, members, classes }, member))
				.map((member) => `${file} state="${member}" — no rule in ${SHEETS.join(' or ')}`)
		);
		expect(promised).toEqual([]);
	});
});
