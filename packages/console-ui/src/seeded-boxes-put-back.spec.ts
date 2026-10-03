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
// **a block with no form layer calls the hook under the seam itself** and is held to the same
// statement: its boxes are seeded by its own markup, so there is no `defaultValue` to read, and the
// put-back is the same `form.reset()` with the same wrong default. the seam's own call hands its
// mounts' options on whole and is answered for by them.
//
// **and a block's `spent` is a reading it takes beside the call**: a name bound from `useReseeded`
// (./lib/reseed.ts) in the function making it, or `false` where a landed answer empties nothing. a
// block seeds from its own markup, which is always a reading, so a `spent` that is merely present —
// the answer itself, or a value handed in from somewhere this file does not sweep — is the default
// the rule exists against under another name. a mount of the seam is not held to this: the identity
// and notification folds seed from the answer and rightly state it.
//
// the shape is ./forms-mounted-through-the-seam.spec.ts's and ./closed-while-writing.spec.ts's:
// findings come back as a list so one failure names every offender at once, the source is parsed
// rather than scanned — these calls run to thirty lines and carry comments and nested objects — and
// the case counting what the sweep reached is here for the reason written beside those, that a
// sweep reaching nothing passes loudest.

/** the one way a console fold mounts a form (./lib/use-console-form.ts). */
const SEAM = 'useConsoleForm';

/**
 * the hook under the seam, which a block with no form layer calls itself
 * (packages/operator/src/saved-form-state.react.ts). its boxes are seeded by the block's own
 * markup rather than through a `defaultValue` this file can see, and the put-back is the same
 * `form.reset()` — so every direct call says when, whatever it seeds from.
 */
const UNDER = 'useSavedFormState';

/** the seam's own file, whose call hands its mounts' options on whole and is answered for by them. */
const SEAM_FILE = 'src/lib/use-console-form.ts';

/** what conform seeds the boxes from, which is the seed that goes stale. */
const SEED = 'defaultValue';

/** what says the boxes go back, which is the statement this file is over. */
const PUT_BACK = 'spent';

/** what reads the deployment again and says when the boxes go back (./lib/reseed.ts). */
const REREAD = 'useReseeded';

/**
 * one call, placed, with the options it states — and whether its `spent` is a reading this file can
 * see taken: an identifier bound from a `useReseeded` call in the function making this one, or
 * `false`, a block whose landed answer empties nothing (./lib/quickbooks-accounts.tsx).
 */
type Call = { where: string; stated: Set<string>; reread: boolean };

/** whether `property`, the `spent` of `call`, is a reading taken beside it, as {@link Call} says. */
function rereadBeside(call: ts.CallExpression, property: ts.ObjectLiteralElementLike): boolean {
	const value = ts.isShorthandPropertyAssignment(property)
		? property.name
		: ts.isPropertyAssignment(property)
			? property.initializer
			: null;
	if (value === null) return false;
	if (value.kind === ts.SyntaxKind.FalseKeyword) return true;
	if (!ts.isIdentifier(value)) return false;

	let scope: ts.Node | undefined = call.parent;
	while (scope !== undefined && !ts.isFunctionLike(scope)) scope = scope.parent;
	if (scope === undefined) return false;

	let bound = false;
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === value.text &&
			node.initializer !== undefined &&
			ts.isCallExpression(node.initializer) &&
			ts.isIdentifier(node.initializer.expression) &&
			node.initializer.expression.text === REREAD
		) {
			bound = true;
		}
		// a function inside this one binds its own names, which this call cannot read.
		if (node !== scope && ts.isFunctionLike(node)) return;
		ts.forEachChild(node, visit);
	};
	visit(scope);
	return bound;
}

/**
 * every call of `hook` in one source, as the options each states, placed. `at` is which argument
 * carries them, and a spread among them is recorded as `...`: options handed on whole are stated
 * by whoever handed them.
 */
function calls(hook: string, at: number, file: string, source: string): Call[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found: Call[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === hook
		) {
			const options = node.arguments[at];
			const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
			const stated = new Set<string>();
			let putBack: ts.ObjectLiteralElementLike | null = null;
			if (options !== undefined && ts.isObjectLiteralExpression(options)) {
				for (const property of options.properties) {
					if (ts.isSpreadAssignment(property)) stated.add('...');
					const name = property.name;
					if (name === undefined) continue;
					stated.add(name.getText(parsed));
					if (name.getText(parsed) === PUT_BACK) putBack = property;
				}
			}
			found.push({
				where: `${file}:${line}`,
				stated,
				reread: putBack !== null && rereadBeside(node, putBack)
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(parsed);
	return found;
}

/** every mount of the seam in one source. */
const mounts = (file: string, source: string) => calls(SEAM, 1, file, source);

/** every direct call of the hook under the seam in one source. */
const direct = (file: string, source: string) => calls(UNDER, 0, file, source);

/** every mount that seeds through the form layer and leaves the put-back to a default. */
function seededWithoutAPutBack(file: string, source: string): string[] {
	const seam = mounts(file, source)
		.filter((mount) => mount.stated.has(SEED) && !mount.stated.has(PUT_BACK))
		.map((mount) => `${mount.where}: seeds \`${SEED}\` and states no \`${PUT_BACK}\``);
	const under = direct(file, source)
		.filter((call) => !(file === SEAM_FILE && call.stated.has('...')))
		.flatMap((call) => {
			if (!call.stated.has(PUT_BACK))
				return [`${call.where}: calls \`${UNDER}\` and states no \`${PUT_BACK}\``];
			if (!call.reread)
				return [
					`${call.where}: calls \`${UNDER}\` with a \`${PUT_BACK}\` no \`${REREAD}\` call in the same function binds`
				];
			return [];
		});
	return [...seam, ...under];
}

/** the same over the tree. */
const acrossTheFolds = (files: readonly string[]): string[] =>
	files.flatMap((file) => seededWithoutAPutBack(file, readFileSync(file, 'utf8')));

describe('a fold seeding its boxes through the form layer says when they go back', () => {
	const folds = globSync('src/**/*.{ts,tsx}', { exclude: (file) => /\.spec\.tsx?$/.test(file) });

	it('finds the folds it is meant to be guarding', () => {
		const mounted = folds.filter((file) => mounts(file, readFileSync(file, 'utf8')).length > 0);
		expect(mounted).toContain('src/lib/sites-fold.tsx');
		expect(mounted).toContain('src/lib/stripe-section.tsx');
		expect(mounted).toContain('src/lib/smtp-fold.tsx');

		const calling = folds.filter((file) => direct(file, readFileSync(file, 'utf8')).length > 0);
		expect(calling).toContain('src/lib/secret-group-form.tsx');
		expect(calling).toContain('src/lib/answer-switch-block.tsx');
		expect(calling).toContain('src/lib/ai-model-section.tsx');
		expect(calling).toContain('src/lib/quickbooks-accounts.tsx');
		expect(calling).toContain('src/lib/use-console-form.ts');
	});

	it('reports a block calling the hook under the seam that leaves the put-back to the default', () => {
		// the charity switch's own shape: the box is ticked from the reading, and the answer that
		// arrives ahead of the re-read unticks it again under `Saved`.
		const source = `
			export function AnswerSwitchBlock({ written, on, busy, pending }) {
				const { form } = useSavedFormState({
					report: written,
					landed: written?.kind === 'set',
					changed: (element) => element.checked !== on,
					busy,
					pending
				});
				return form;
			}
		`;
		expect(seededWithoutAPutBack('src/lib/answer-switch-block.tsx', source)).toEqual([
			'src/lib/answer-switch-block.tsx:3: calls `useSavedFormState` and states no `spent`'
		]);
	});

	it('leaves the seam itself alone, which hands on what its mounts state', () => {
		const source = `
			export function useConsoleForm(definition, options) {
				return useSavedFormState({ ...options, changed: true, press });
			}
		`;
		expect(seededWithoutAPutBack(SEAM_FILE, source)).toEqual([]);
	});

	it('reports a block whose `spent` is anything but a reading taken in the same block', () => {
		// a statement that is only present: the answer itself, which arrives ahead of the re-read and
		// puts the boxes back to what the press replaced, or a reading taken somewhere this block
		// cannot answer for.
		const source = `
			export function AnswerSwitchBlock({ written, values, busy, pending, spent: given }) {
				const landed = written?.kind === 'set';
				const one = useSavedFormState({ report: written, landed, spent: landed, busy, pending });
				const two = useSavedFormState({ report: written, landed, spent: given, busy, pending });
				return [one, two];
			}
			function useElsewhere({ landed, pending, values }) {
				return useReseeded({ landed, pending, reading: values });
			}
		`;
		expect(seededWithoutAPutBack('src/lib/answer-switch-block.tsx', source)).toEqual([
			'src/lib/answer-switch-block.tsx:4: calls `useSavedFormState` with a `spent` no `useReseeded` call in the same function binds',
			'src/lib/answer-switch-block.tsx:5: calls `useSavedFormState` with a `spent` no `useReseeded` call in the same function binds'
		]);
	});

	it('leaves a block alone whose `spent` is a reading taken beside the call, or never', () => {
		// the secret groups' shape, and the account picks', whose landed answer empties nothing.
		const source = `
			export function SecretGroupForm({ written, values, busy, pending }) {
				const landed = written?.kind === 'set';
				const spent = useReseeded({ landed, pending, reading: values });
				const reread = useReseeded({ landed, pending, reading: values });
				const one = useSavedFormState({ report: written, landed, spent, busy, pending });
				const two = useSavedFormState({ report: written, landed, spent: reread, busy, pending });
				const three = useSavedFormState({ report: written, landed, spent: false, busy, pending });
				return [one, two, three];
			}
		`;
		expect(seededWithoutAPutBack('src/lib/secret-group-form.tsx', source)).toEqual([]);
	});

	it('reports a block anywhere else that hands the hook options it was given', () => {
		// a spread is a statement only where what it spreads is swept: the seam's mounts are, and a
		// block's own props are not.
		const source = `
			export function SwitchBlock(options) {
				return useSavedFormState({ ...options, changed: true });
			}
		`;
		expect(seededWithoutAPutBack('src/lib/switch-block.tsx', source)).toEqual([
			'src/lib/switch-block.tsx:3: calls `useSavedFormState` and states no `spent`'
		]);
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
