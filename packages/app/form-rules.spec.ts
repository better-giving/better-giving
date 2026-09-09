import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonc } from './src/lib/jsonc.testing';
import {
	bareFailureViolations,
	coercionViolations,
	conformImportViolations,
	FORM_SEAM,
	formIdViolations,
	formMountViolations,
	serverSchemaViolations
} from './form-rules';

// the form layer's rules, held against the tree that is supposed to keep them.
//
// src/lib/server/conform.ts states all of them in its header, and five are decidable from the
// source text alone rather than from a submission — which is what this file is for. the other
// three are held by src/lib/server/conform.spec.ts and src/lib/forms/definition.spec.ts, because a
// body that never carried a box, a schema that nests and a rejection that still claims to be valid
// are runtime shapes and nothing about them is written down in a file.
//
// each rule is checked twice: against a fixture that breaks it, and against the tree. the fixture
// half is the one worth having — most of these screens are still being written, so a sweep over
// today's tree can pass because there is nothing there yet, and a check nobody has seen fail is a
// check nobody knows the shape of.
//
// **a gate that sweeps `src/**` cannot live in `src/**`**, which is what puts these two files at
// the package root. the fixture half has to spell each violation to prove the check bites — a
// `z.coerce.boolean()`, a `data(…, { status: 409 })` — and under `src/` the sweep below would
// report its own fixtures and there would be nowhere left to write one.
//
// the checkers are in ./form-rules.ts rather than here so that the two halves read the same rule
// out of one place. they read text and never a syntax tree, which is stated on them: what they
// cost is a false reading of a rule spelled inside a string or a comment, and what they buy is a
// gate that runs in the same pool as everything else.

/** where a spec runs from: `vitest` sets the cwd to the package root. */
const ROOT = import.meta.dirname;

/** what this spec reads out of ./tsconfig.json. everything else in it is the compiler's. */
interface Tsconfig {
	readonly exclude?: readonly string[];
}

interface Manifest {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
}

const tsconfig = readJsonc(resolve(ROOT, 'tsconfig.json')) as Tsconfig;
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as Manifest;

/**
 * the workspace catalog, name to pinned range, read out of `pnpm-workspace.yaml`'s `catalog:`
 * block. line-matched rather than yaml-parsed: a comment line starts with `#` after the same
 * two-space indent an entry does, so it never matches, and pulling in a yaml parser to read one
 * flat block is a dependency this suite would carry alone.
 */
function readCatalog(path: string): Record<string, string> {
	const catalog: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const entry = /^ {2}'?([^':\s]+)'?:\s*(.+)$/.exec(line);
		if (entry) catalog[entry[1] as string] = (entry[2] as string).trim();
	}
	return catalog;
}

const catalog = readCatalog(resolve(ROOT, '..', '..', 'pnpm-workspace.yaml'));

/** the range a manifest entry actually pins, following `catalog:` out to the workspace catalog. */
function pinnedRange(
	name: string,
	range: string,
	source: Record<string, string> = catalog
): string {
	return range === 'catalog:' ? (source[name] ?? range) : range;
}

/**
 * every module this app compiles, which is the tree these rules are about.
 *
 * filtered through ./tsconfig.json's own `exclude` rather than swept unconditionally, so a future
 * exclusion there does not silently widen what this gate reports on.
 */
function compiled(): string[] {
	const retired = new Set(tsconfig.exclude ?? []);
	return globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
		.map((path) => path.split('\\').join('/'))
		.filter((path) => !retired.has(path));
}

const sources = compiled().map((path) => ({
	path,
	source: readFileSync(resolve(ROOT, path), 'utf8')
}));

/** every violation the tree holds, as `path: violation`, so a failure names where to go. */
function acrossTheTree(check: (source: string) => string[]): string[] {
	return sources.flatMap(({ path, source }) =>
		check(source).map((violation) => `${path}: ${violation}`)
	);
}

describe('the sweep', () => {
	// a glob that matches nothing passes every rule below it forever, which is the one way this
	// whole file can go quiet without anybody touching it.
	it('reads the tree this app compiles', () => {
		const swept = sources.map(({ path }) => path);

		expect(swept).toContain('src/lib/server/conform.ts');
	});
});

describe('conform is imported through its v4 subpath', () => {
	// the package root is written against zod 3 and this app is on zod 4, so a schema handed to the
	// root is parsed by a different library than the one that declared it — which is not a type
	// error and not a runtime one either, just a different answer.
	it('refuses the bare entry', () => {
		expect(conformImportViolations(`import { parseWithZod } from '@conform-to/zod';`)).toEqual([
			'@conform-to/zod'
		]);
	});

	it('refuses the package under the adapter, which is the seam being reached past', () => {
		expect(conformImportViolations(`import { parse } from '@conform-to/dom';`)).toEqual([
			'@conform-to/dom'
		]);
	});

	it('refuses the adapter’s future entry, which is where its own coercion is exported', () => {
		const source = `import { coerceFormValue } from '@conform-to/zod/v4/future';`;
		expect(conformImportViolations(source)).toEqual(['@conform-to/zod/v4/future']);
	});

	it('accepts the adapter’s v4 subpath, and the react package the browser half mounts through', () => {
		// v4 names the *zod* major, and only the zod adapter is split that way. `@conform-to/react`
		// publishes `.` and `./future` and no `/v4` at all, so a rule that asked for one would refuse
		// the only source of `useForm`.
		const source = `
			import { parseWithZod } from '@conform-to/zod/v4';
			import { useForm } from '@conform-to/react';
			import { useForm as useNextForm } from '@conform-to/react/future';
		`;
		expect(conformImportViolations(source)).toEqual([]);
	});

	it('is what the tree imports', () => {
		expect(acrossTheTree(conformImportViolations)).toEqual([]);
	});

	it('is pinned exactly, in whichever block declares it', () => {
		const declared = Object.entries({
			...manifest.dependencies,
			...manifest.devDependencies
		}).filter(([name]) => name.startsWith('@conform-to/'));

		expect(declared.map(([name]) => name).sort()).toEqual(['@conform-to/react', '@conform-to/zod']);
		expect(
			declared.filter(([name, range]) => !/^\d+\.\d+\.\d+$/.test(pinnedRange(name, range)))
		).toEqual([]);
	});

	it('does not let a catalog: entry launder a caret or tilde range as exact', () => {
		const loose = { '@fixture/pkg': '^1.2.3' };
		expect(/^\d+\.\d+\.\d+$/.test(pinnedRange('@fixture/pkg', 'catalog:', loose))).toBe(false);
	});

	it('is one version across both halves, which parse the same submission twice', () => {
		// the browser validates a body and the action validates the same body again, and a screen
		// only reports what one of them found. both point at the same `catalog:` entry, so they
		// cannot resolve to two versions — what this still catches is one of them bypassing the
		// catalog while the other declares it, which would let them drift independently again.
		const declared = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
			.filter(([name]) => name.startsWith('@conform-to/'))
			.map(([, range]) => range);

		expect(new Set(declared).size).toBe(1);
	});
});

describe('a form states its own id', () => {
	// a screen can carry more than one form, and each action's result has to reach the one it
	// belongs to. an id derived from the schema's shape makes two structurally identical forms one
	// form, and saving either then updates both.
	it('refuses a form handed to the parser without one', () => {
		const source = `const form = parseForm(body, { schema: DETAILS });`;
		expect(formIdViolations(source)).toEqual(['{ schema: DETAILS }']);
	});

	it('refuses a form the browser mounts without one', () => {
		const source = `const [form, fields] = useForm({ lastResult, onValidate });`;
		expect(formIdViolations(source)).toEqual(['{ lastResult, onValidate }']);
	});

	it('reads the id off a form declared under a name', () => {
		const source = `
			const DETAILS = { id: 'settings-details', schema: DETAILS_SCHEMA };
			const form = parseForm(body, DETAILS);
		`;
		expect(formIdViolations(source)).toEqual([]);
	});

	it('refuses a form declared under a name that states none', () => {
		const source = `
			const DETAILS = { schema: DETAILS_SCHEMA };
			const form = parseForm(body, DETAILS);
		`;
		expect(formIdViolations(source)).toEqual(['DETAILS']);
	});

	it('refuses a form with no id whose schema happens to name an id box', () => {
		// /admin/forms/[id] edits a record that has one, so a schema mentioning `id:` is the ordinary
		// case rather than a contrived one. the id being looked for is the form's own, which is a key
		// of the literal and not of anything inside it.
		const source = `const form = parseForm(body, { schema: z.object({ id: z.string() }) });`;
		expect(formIdViolations(source)).toEqual(['{ schema: z.object({ id: z.string() }) }']);
	});

	it('refuses a form stated without one', () => {
		expect(formIdViolations(`const DETAILS = defineForm({ schema: DETAILS_SCHEMA });`)).toEqual([
			'{ schema: DETAILS_SCHEMA }'
		]);
	});

	it('reads the id off a form declared through the factory', () => {
		// `defineForm` is what a screen states a form with, so the object the id has to be in sits
		// inside a call rather than straight after the `=`.
		const source = `
			const DETAILS = defineForm({ id: 'settings-details', schema: DETAILS_SCHEMA });
			const [form, fields] = useAdminForm(DETAILS, actionData);
		`;
		expect(formIdViolations(source)).toEqual([]);
	});

	it('reads the form the browser’s hook is handed, which is its first argument and not its last', () => {
		const source = `
			const DETAILS = defineForm({ schema: DETAILS_SCHEMA });
			const [form, fields] = useAdminForm(DETAILS, actionData);
		`;
		expect(formIdViolations(source)).toEqual(['{ schema: DETAILS_SCHEMA }', 'DETAILS']);
	});

	it('reads both forms on a screen that carries two', () => {
		// the case the whole rule is about: each action's result has to reach the one form it
		// belongs to, and two forms sharing an id — or one of them having none — is two forms
		// updating on one save.
		const screen = `
			const NAME = defineForm({ id: 'form-name', schema: NAME_SCHEMA });
			const GIVING = defineForm({ schema: GIVING_SCHEMA });
			export async function action({ request }) {
				const body = await request.formData();
				if (body.get('intent') === 'giving') return saveGiving(parseForm(body, GIVING));
				return saveName(parseForm(body, NAME));
			}
			export default function FormScreen({ actionData }) {
				const [name, nameFields] = useAdminForm(NAME, actionData);
				const [giving, givingFields] = useAdminForm(GIVING, actionData);
			}
		`;
		expect(formIdViolations(screen)).toEqual(['{ schema: GIVING_SCHEMA }', 'GIVING', 'GIVING']);
	});

	it('is what the tree states', () => {
		expect(acrossTheTree(formIdViolations)).toEqual([]);
	});
});

describe('a form is mounted through the seam', () => {
	// the second literal this closes: a screen calling conform's own hook writes the id again, and
	// nothing joins that copy to the one its action reads. `$lib/admin/use-admin-form.ts` takes the
	// form the screen stated and is the only module that may mount one.
	it('refuses a screen that mounts its own', () => {
		const source = `
			import { useForm } from '@conform-to/react';
			const [form, fields] = useForm({ id: 'settings-details', lastResult });
		`;
		expect(formMountViolations(source)).toEqual([`useForm from '@conform-to/react'`]);
	});

	it('refuses it through the future entry as well', () => {
		const source = `
			import { useForm } from '@conform-to/react/future';
			const [form] = useForm({ id: 'settings-details' });
		`;
		expect(formMountViolations(source)).toEqual([`useForm from '@conform-to/react/future'`]);
	});

	it('leaves the props helpers alone, which is what a screen binds its boxes with', () => {
		const source = `
			import { getFormProps, getInputProps } from '@conform-to/react';
			const [form, fields] = useAdminForm(DETAILS, actionData);
		`;
		expect(formMountViolations(source)).toEqual([]);
	});

	it('is where the tree mounts one', () => {
		const offenders = sources
			.filter(({ path }) => path !== FORM_SEAM)
			.flatMap(({ path, source }) =>
				formMountViolations(source).map((found) => `${path}: ${found}`)
			);

		expect(offenders).toEqual([]);
	});

	// a rule naming one file goes quiet the moment that file is renamed, and a seam nothing mounts
	// through is a seam nothing is held to.
	it('is a module that mounts one', () => {
		const seam = sources.find(({ path }) => path === FORM_SEAM);

		expect(formMountViolations(seam?.source ?? '')).toEqual([`useForm from '@conform-to/react'`]);
	});
});

describe('nothing coerces a submitted value', () => {
	// javascript coercion accepts exactly the values a form sends: the string `'false'` becomes
	// true and an empty box becomes 0. conform's own coercion is not that — it strips an empty box
	// to `undefined` and converts a checkbox only from the literal `'on'` — and is not what this
	// refuses.
	it('refuses zod’s coercing constructors', () => {
		expect(coercionViolations(`recurring: z.coerce.boolean(),`)).toEqual(['z.coerce.boolean']);
	});

	it('refuses conform’s own coercion being reached for by hand, under either of its names', () => {
		const source = `
			const v3 = unstable_coerceFormValue(DETAILS_SCHEMA);
			const v4 = coerceFormValue(DETAILS_SCHEMA);
			const rows = coerceStructure(DETAILS_SCHEMA);
			configureCoercion({ boolean: (text) => text === 'yes' });
		`;
		expect(coercionViolations(source)).toEqual([
			'unstable_coerceFormValue',
			'coerceFormValue',
			'coerceStructure',
			'configureCoercion'
		]);
	});

	it('is true of the tree', () => {
		expect(acrossTheTree(coercionViolations)).toEqual([]);
	});
});

describe('an action rejects through invalid()', () => {
	// the framework's own helper leaves the form's status alone, so a failure no rule expresses —
	// an archived row, a write that threw — reaches the browser as a 400 whose form still claims to
	// be fine, and the screen renders a clean form over it.
	const SEAM = `import { invalid, parseForm } from '$lib/server/conform';`;

	it('refuses the framework’s bare failure helper in a module that holds a form', () => {
		const source = `
			${SEAM}
			export async function action() {
				return data({ error: 'gone' }, { status: 409 });
			}
		`;
		expect(bareFailureViolations(source)).toEqual([`{ error: 'gone' }, { status: 409 }`]);
	});

	it('refuses a hand-built response carrying the same status', () => {
		const source = `
			${SEAM}
			export async function action() {
				return new Response('gone', { status: 409 });
			}
		`;
		expect(bareFailureViolations(source)).toEqual([`'gone', { status: 409 }`]);
	});

	it('refuses a status hoisted out of the call', () => {
		const source = `
			${SEAM}
			const REFUSED = { status: 409 };
			export async function action() {
				return data({ error: 'gone' }, REFUSED);
			}
		`;
		expect(bareFailureViolations(source)).toEqual([`{ error: 'gone' }, REFUSED`]);
	});

	it('reads a module that rejects without exporting an action of its own', () => {
		// a shared save helper is the shape that escapes a rule keyed to the export: it holds no
		// route and rejects for the three screens that call it.
		const source = `
			${SEAM}
			export function saved(row) {
				if (row === null) return data({ error: 'gone' }, { status: 404 });
			}
		`;
		expect(bareFailureViolations(source)).toEqual([`{ error: 'gone' }, { status: 404 }`]);
	});

	it('leaves a loader’s own headers alone', () => {
		const source = `
			${SEAM}
			export async function action() {
				return redirect('/admin/forms');
			}
			export async function loader() {
				return data({ saved }, { headers: { 'Set-Cookie': clear } });
			}
		`;
		expect(bareFailureViolations(source)).toEqual([]);
	});

	it('leaves an endpoint that holds no form alone', () => {
		// `/api/v1` answers a refusal with a status and no form at all, and CLAUDE.md is where that
		// is argued. the rule is about a form's rejection, so what makes a module subject to it is
		// that it reaches for the form seam.
		const source = `
			export async function action() {
				return new Response('That amount is outside this form’s bounds.', { status: 422 });
			}
		`;
		expect(bareFailureViolations(source)).toEqual([]);
	});

	it('is how the tree rejects', () => {
		expect(acrossTheTree(bareFailureViolations)).toEqual([]);
	});
});

describe('a schema the browser runs lives outside $lib/server', () => {
	// everything handed to `useForm` is evaluated in the browser, and a component cannot import
	// from `$lib/server/**` at all. the shared schema modules sit at `$lib/forms/`, `$lib/contacts/`
	// for that reason — as does `@better-giving/operator/console/org-rules`, one step further out
	// again because the console applies the same rules — and `$lib/forms/input-schema.ts` is where it
	// is argued.
	it('refuses a server schema handed to the browser’s validator', () => {
		const source = `
			import { DETAILS_SCHEMA } from '$lib/server/forms/form-input';
			const [form] = useForm({ id: 'details', onValidate: ({ formData }) => parseWithZod(formData, { schema: DETAILS_SCHEMA }) });
		`;
		expect(serverSchemaViolations(source)).toEqual(['DETAILS_SCHEMA']);
	});

	it('leaves a loader’s own server imports alone', () => {
		const source = `
			import { formsFor } from '$lib/server/forms/queries';
			import { DETAILS_SCHEMA } from '$lib/forms/input-schema';
			export async function loader() {
				return { forms: await formsFor(db) };
			}
			const [form] = useForm({ id: 'details', onValidate: ({ formData }) => parseWithZod(formData, { schema: DETAILS_SCHEMA }) });
		`;
		expect(serverSchemaViolations(source)).toEqual([]);
	});

	it('refuses a validator hoisted out of the call it is handed to', () => {
		// the escape from a rule that reads only the call's own text. what runs in the browser is the
		// validator, wherever it is written down.
		const source = `
			import { DETAILS_SCHEMA } from '$lib/server/forms/form-input';
			const validate = ({ formData }) => parseWithZod(formData, { schema: DETAILS_SCHEMA });
			const [form] = useForm({ id: 'details', onValidate: validate });
		`;
		expect(serverSchemaViolations(source)).toEqual(['DETAILS_SCHEMA']);
	});

	it('refuses a server schema stated as a form, which is what both halves then read', () => {
		// the shape the seam made ordinary: the schema reaches the browser through the form rather
		// than through the validator, so the statement is a call this has to read too.
		const source = `
			import { DETAILS_SCHEMA } from '$lib/server/forms/form-input';
			const DETAILS = defineForm({ id: 'details', schema: DETAILS_SCHEMA });
		`;
		expect(serverSchemaViolations(source)).toEqual(['DETAILS_SCHEMA']);
	});

	it('refuses a server value handed to the browser’s hook', () => {
		const source = `
			import { seededFrom } from '$lib/server/settings/queries';
			const [form, fields] = useAdminForm(DETAILS, actionData, { defaultValue: seededFrom(row) });
		`;
		expect(serverSchemaViolations(source)).toEqual(['seededFrom']);
	});

	it('is where the tree keeps them', () => {
		expect(acrossTheTree(serverSchemaViolations)).toEqual([]);
	});
});
