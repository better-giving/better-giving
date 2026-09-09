import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// every component packages/operator publishes has a preview here, and every preview here previews a
// published component. the two lists are compared rather than counted: a count passes while a
// preview is written for the wrong module.
//
// this is the gate under the rule in CLAUDE.md that a component's preview lands in the same change
// as the component. src/main.tsx globs ./previews/*.tsx, so registration is the file existing and
// there is no list to forget — but nothing about globbing makes a file get written, and a component
// that ships without one is absent from the single page somebody opens to find out the system has
// it. the sheets do not say what exists and neither does the exports map on its own; this page does.
//
// the manifest is read from a literal path rather than imported. packages/operator's `exports` map
// is a closed list and ./package.json is not on it, which is the same closure this file is asserting
// against — so the one place that has to see past it is this one, and it says so.
const manifest = JSON.parse(readFileSync('../operator/package.json', 'utf8'));

// a published module's preview is `<group>-<module-in-kebab>.tsx`. the prefix is not decoration:
// shell/Dialog and behaviour/Dialog are two different components, and a flat name would give them
// one file between them.
const kebab = (name: string) => name.replace(/(?<=[a-z])(?=[A-Z])/g, '-').toLowerCase();

describe('every published component has a preview', () => {
	// two shapes on the map carry something to look at: `./components/<group>/<Module>` and
	// `./behaviour/<Module>`. the patterns are named rather than a single loose one, so that an entry
	// like `./console/org` — a value module two segments deep, the same shape as a component's — is
	// excluded by not matching rather than by an exception somebody has to remember.
	//
	// ./components/closed-sets falls outside both, and that is the right answer for it: it exports
	// `{}` at runtime and carries only JSDoc typedefs, so there is no component to render. its
	// members are drawn as states of the components that take them, which is the only place a
	// `PointerState` is visible at all.
	const published: string[] = [];
	for (const entry of Object.keys(manifest.exports)) {
		const component = /^\.\/components\/(\w+)\/(\w+)$/.exec(entry);
		if (component?.[1] && component[2])
			published.push(`${component[1]}-${kebab(component[2])}.tsx`);
		const behaviour = /^\.\/behaviour\/(\w+)$/.exec(entry);
		if (behaviour?.[1]) published.push(`behaviour-${kebab(behaviour[1])}.tsx`);
	}
	published.sort();

	const previews = globSync('*.tsx', { cwd: 'src/previews' }).sort();

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read, which is
		// the failure this file exists to refuse. the same case is made in ./raw-values.spec.ts.
		expect(published.length).toBeGreaterThan(0);
		expect(previews.length).toBeGreaterThan(0);
	});

	it('previews exactly what the exports map publishes', () => {
		// one assertion over both directions. a published component with no preview and a preview of
		// something unpublished are the same defect read from either end — the page and the map
		// disagreeing about what this system has.
		expect(previews).toEqual(published);
	});
});
