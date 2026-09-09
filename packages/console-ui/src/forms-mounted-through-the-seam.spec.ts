import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the console's gate over a screen that mounts a form itself instead of through the seam.
//
// **the claim is that no screen calls conform's `useForm`, and it is not that every form has a
// schema.** the fold that sets the staff password states no rule about its boxes — nothing about a
// value that can never be read back is decidable in the browser — so it mounts no schema at all and
// is right not to. a gate reading "every form goes through the seam" would report it, and the fix a
// reader would reach for is a schema invented to satisfy a test.
//
// what mounting one directly costs is ./lib/use-console-form.ts's whole subject: the id written a
// second time with nothing joining it to the box ids drawn off it, the timing set per screen, the
// deployment's own answer left with nowhere to go, and conform's props helper one spread away from
// a control it must never reach. the seam answers all of those once, which is worth having only if
// it is the one way in.
//
// the props helpers are not this: what a screen binds a box with is the seam's own `box`, and a
// screen that reached for `getInputProps` would have had to import it — which is the import this
// sweep already reports.
//
// it reads source because that is where the rule lives — a screen's own text, in every branch it
// draws. the shape is ./announced-refusals.spec.ts's and ./raw-values.spec.ts's: findings come back
// as a list so one failure names every offender at once, and the case counting what the glob
// reached is here for the reason written beside those — a sweep reaching nothing passes loudest.
//
// **the sweep globs `.tsx` and this file and the seam are both `.ts`**, which is the whole of how
// neither reports itself and how the fixture below can be written at all. packages/app's own mount
// rule sits at that package's root instead, because its fixtures are spelled inside a tree it
// sweeps whole; this one needs nowhere to go.

/** the one module in this package that may mount a form. */
const SEAM = 'src/lib/use-console-form.ts';

const MOUNT = /\buseForm\b/;
const CONFORM = /from\s+'(@conform-to\/react(?:\/future)?)'/g;

/** every place a source mounts a form itself, as the entry it reached conform through. */
function directMounts(source: string): string[] {
	if (!MOUNT.test(source)) return [];
	return [...source.matchAll(CONFORM)].map((found) => `useForm from '${found[1] as string}'`);
}

/** the same over the tree, as `path: violation`, so a failure names where to go. */
function acrossTheScreens(files: readonly string[]): string[] {
	return files.flatMap((file) =>
		directMounts(readFileSync(file, 'utf8')).map((violation) => `${file}: ${violation}`)
	);
}

describe('no console screen mounts a form itself', () => {
	const screens = globSync('src/**/*.tsx');

	it('finds the screens it is meant to be guarding', () => {
		expect(screens.length).toBeGreaterThan(20);
		// the page every fold is drawn inside, named rather than counted: it is where a form would be
		// mounted if the glob were reaching the wrong tree entirely.
		expect(screens).toContain('src/routes/_index.tsx');
	});

	it('reports a screen that reaches for conform itself', () => {
		const source = `
			import { useForm } from '@conform-to/react';
			export function Fold() {
				const [form] = useForm({ id: 'org' });
				return form;
			}
		`;
		expect(directMounts(source)).toEqual(["useForm from '@conform-to/react'"]);
	});

	it('reports the preview entry too, which mounts the same form a different way', () => {
		const source = `import { useForm } from '@conform-to/react/future';`;
		expect(directMounts(source)).toEqual(["useForm from '@conform-to/react/future'"]);
	});

	it('leaves a fold that states no rule about any box alone', () => {
		// no schema, no conform, one press: the fold whose values nothing in the browser can judge
		// looks exactly like this, and is not what this file is about.
		const source = `
			import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
			export function Fold({ write, busy, pending }) {
				return useSavedFormState({
					report: write,
					landed: false,
					changed: (element) => edited(element),
					busy,
					pending
				});
			}
		`;
		expect(directMounts(source)).toEqual([]);
	});

	it('is what the screens do', () => {
		expect(acrossTheScreens(screens)).toEqual([]);
	});

	it('has one module that does mount a form, which is the seam', () => {
		// the floor under the sweep above: an empty finding is what this file wants of every screen
		// and is also what a broken matcher returns. this is the one reading that cannot be empty.
		const seam = readFileSync(SEAM, 'utf8');
		expect(directMounts(seam)).toEqual(["useForm from '@conform-to/react'"]);
		expect(seam).toMatch(/\bparseWithZod\b/);
	});
});
