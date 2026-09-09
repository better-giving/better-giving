import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// the console's gate over a fold that seeds its boxes through the form layer and never puts them
// back.
//
// **conform reads a seed at the mount and at a reset, and at no other moment.** `onUpdate` in
// @conform-to/dom keeps a changed `defaultValue` against the next reset and rebuilds nothing from
// it, so the boxes on the screen go on holding what the mount was drawn with however many readings
// land behind them. the put-back is a real `form.reset()` — `useSavedFormState` in
// packages/operator/src/saved-form-state.react.ts — and what says when it runs is `spent`.
//
// **the reading that ends a press commits after the answer that reports it**, which is the whole of
// why `spent` is a fold's own statement rather than the answer's: react router publishes a press's
// answer as the re-read it sets off begins, and this page's readings are promises the loader hands
// back unresolved (./lib/reseed.ts). a fold that let `spent` fall back to `landed` puts its boxes
// back to the reading its own press was made against, and every reading after that reaches neither
// the boxes nor the metadata behind them. what the operator sees is a fold whose own row counts a
// value it draws no box for, with reloading the page the only way to it.
//
// **the rule is read off `defaultValue` because that is the seed conform owns**, and every fold on
// this console hands it one: the seed is also what its button is armed against (./lib/use-console-
// form.ts). what a fold says is which moment puts the boxes back — the identity and notification
// folds seed from the press's own answer (`storedOrg` in ./lib/org-form.ts), which is already what
// the deployment holds when that answer arrives, so they state the answer itself; the three seeded
// from a reading state the reading.
//
// **what this does not reach is whether `spent` is the right reading.** a fold stating `spent:
// false` satisfies it and never puts its boxes back. what the rule holds is that the moment is
// decided in the fold rather than left to a default that is wrong for every seed the deployment
// answers with — which is exactly the shape the sites fold had. the reading itself is
// ./lib/reseed.spec.ts's, and the emptying it asks for is
// packages/operator/src/saved-form-state.react.dom.spec.ts's: this package pins one node pool and
// no dom (../vite.config.ts).
//
// the shape is ./forms-mounted-through-the-seam.spec.ts's and ./closed-while-writing.spec.ts's:
// findings come back as a list so one failure names every offender at once, the source is parsed
// rather than scanned — these calls run to thirty lines and carry comments and nested objects — and
// the case counting what the sweep reached is here for the reason written beside those, that a
// sweep reaching nothing passes loudest.

/** the one way a console fold mounts a form (./lib/use-console-form.ts). */
const SEAM = 'useConsoleForm';

/** what conform seeds the boxes from, which is the seed that goes stale. */
const SEED = 'defaultValue';

/** what says the boxes go back, which is the statement this file is over. */
const PUT_BACK = 'spent';

/** every mount of the seam in one source, as the options each states, placed. */
function mounts(file: string, source: string): { where: string; stated: Set<string> }[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found: { where: string; stated: Set<string> }[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === SEAM
		) {
			const options = node.arguments[1];
			const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
			const stated = new Set<string>();
			if (options !== undefined && ts.isObjectLiteralExpression(options)) {
				for (const property of options.properties) {
					const name = property.name;
					if (name !== undefined) stated.add(name.getText(parsed));
				}
			}
			found.push({ where: `${file}:${line}`, stated });
		}
		ts.forEachChild(node, visit);
	};
	visit(parsed);
	return found;
}

/** every mount that seeds through the form layer and leaves the put-back to a default. */
function seededWithoutAPutBack(file: string, source: string): string[] {
	return mounts(file, source)
		.filter((mount) => mount.stated.has(SEED) && !mount.stated.has(PUT_BACK))
		.map((mount) => `${mount.where}: seeds \`${SEED}\` and states no \`${PUT_BACK}\``);
}

/** the same over the tree. */
const acrossTheFolds = (files: readonly string[]): string[] =>
	files.flatMap((file) => seededWithoutAPutBack(file, readFileSync(file, 'utf8')));

describe('a fold seeding its boxes through the form layer says when they go back', () => {
	const folds = globSync('src/**/*.tsx');

	it('finds the folds it is meant to be guarding', () => {
		const mounted = folds.filter((file) => mounts(file, readFileSync(file, 'utf8')).length > 0);
		expect(mounted).toContain('src/lib/sites-fold.tsx');
		expect(mounted).toContain('src/lib/payments-fold.tsx');
		expect(mounted).toContain('src/lib/smtp-fold.tsx');
	});

	it('reports a fold that seeds from a reading and leaves the put-back to the default', () => {
		// the sites fold's own shape before the boxes went back at all: the seed changes under a
		// mounted form, and nothing reads it again.
		const source = `
			export function SitesFold({ sites, list, busy, pending }) {
				const form = useConsoleForm(SITES_FORM, {
					report: list,
					landed: list?.written.kind === 'saved',
					defaultValue: { site: sites.length === 0 ? [''] : [...sites] },
					busy,
					pending
				});
				return form;
			}
		`;
		expect(seededWithoutAPutBack('src/lib/sites-fold.tsx', source)).toEqual([
			'src/lib/sites-fold.tsx:3: seeds `defaultValue` and states no `spent`'
		]);
	});

	it('leaves a fold that says when its boxes go back alone', () => {
		// the identity fold's own shape: it seeds from the press's own answer, so the moment it names
		// is that answer rather than the reading behind it — a statement either way, which is the
		// whole of what this rule asks for.
		const source = `
			export function OrgFold({ stored, write, busy, pending }) {
				const landed = write?.kind === 'saved';
				return useConsoleForm(ORG_FORM, {
					report: write,
					landed,
					defaultValue: seedFor(ORG_FORM, stored),
					spent: landed,
					busy,
					pending
				});
			}
		`;
		expect(seededWithoutAPutBack('src/lib/org-fold.tsx', source)).toEqual([]);
	});

	it('is what the folds do', () => {
		expect(acrossTheFolds(folds)).toEqual([]);
	});
});
