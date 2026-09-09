/**
 * the form layer's rules, as far as source text can decide them.
 *
 * `src/lib/server/conform.ts` states every rule and is where each one is argued; these are the
 * five a file can be read for rather than a submission. six checks over those five: the id rule is
 * held from both ends, because a form stating one is no use while a screen may still mount a second
 * form of its own beside it. ./form-rules.spec.ts is what runs them — over a fixture that breaks
 * each rule, and over the tree.
 *
 * **they read text and never a syntax tree.** what that costs is a rule spelled inside a string or
 * a comment being read as code; what it buys is a gate with no parser in it, running in the same
 * pool as everything else. every one of them reports what it found rather than a count, so a
 * failure names the thing to go and fix.
 *
 * a module rather than a block inside the spec, because the fixture half and the tree half have to
 * be reading the same rule.
 */

/**
 * the argument text of every call to `name`, one entry per call site.
 *
 * parentheses are balanced, so a call holding a call is one entry and not two.
 */
function callSites(source: string, name: string): string[] {
	const sites: string[] = [];
	const calls = new RegExp(`\\b${name}\\s*\\(`, 'g');
	for (let found = calls.exec(source); found !== null; found = calls.exec(source)) {
		const open = found.index + found[0].length - 1;
		let depth = 0;
		for (let at = open; at < source.length; at++) {
			if (source[at] === '(') depth++;
			else if (source[at] === ')') {
				depth--;
				if (depth === 0) {
					sites.push(source.slice(open + 1, at).trim());
					break;
				}
			}
		}
	}
	return sites;
}

/**
 * the last argument of a call, which is where a form is passed to the parser and to `defineForm`.
 *
 * split at the commas belonging to this call rather than at every comma: an object literal and a
 * nested call each hold their own.
 */
function lastArgument(call: string): string {
	let depth = 0;
	let start = 0;
	for (let at = 0; at < call.length; at++) {
		const char = call[at];
		if (char === '(' || char === '{' || char === '[') depth++;
		else if (char === ')' || char === '}' || char === ']') depth--;
		else if (char === ',' && depth === 0) start = at + 1;
	}
	return call.slice(start).trim();
}

/**
 * the first argument of a call, which is where the form is passed to the browser's hook.
 *
 * the hook takes the form and then the action's result, in that order, because the form is what it
 * is about and the result is what it is answering.
 */
function firstArgument(call: string): string {
	let depth = 0;
	for (let at = 0; at < call.length; at++) {
		const char = call[at];
		if (char === '(' || char === '{' || char === '[') depth++;
		else if (char === ')' || char === '}' || char === ']') depth--;
		else if (char === ',' && depth === 0) return call.slice(0, at).trim();
	}
	return call.trim();
}

/**
 * the object literal a `const` is declared with, or nothing where the name is not declared here.
 *
 * through one call, because that is how a form is stated: `defineForm({ … })` reads the shape once
 * and hands back what both halves import, so the literal the id has to be in sits inside a call
 * rather than straight after the `=`.
 */
function declaredObject(source: string, name: string): string | null {
	const declaration = new RegExp(
		`\\bconst\\s+${name}\\s*(?::[^=]*)?=\\s*(?:[A-Za-z_$][\\w$]*\\s*\\(\\s*)?\\{`
	).exec(source);
	if (declaration === null) return null;
	const open = declaration.index + declaration[0].length - 1;
	let depth = 0;
	for (let at = open; at < source.length; at++) {
		if (source[at] === '{') depth++;
		else if (source[at] === '}') {
			depth--;
			if (depth === 0) return source.slice(open, at + 1);
		}
	}
	return null;
}

/**
 * a form stated inline, past the factory it was stated with.
 *
 * `parseForm(body, defineForm({ … }))` is one form and not two, and the literal the id has to be in
 * is the one inside the call.
 */
function statedForm(argument: string): string {
	const wrapped = /^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)$/.exec(argument.trim());
	return wrapped ? statedForm((wrapped[1] as string).trim()) : argument.trim();
}

/**
 * whether an object literal states a key of its own called `id`.
 *
 * at the literal's own depth and nowhere below it: a form's schema may perfectly well name an `id`
 * box — /admin/forms/[id] edits a record that has one — and a key inside the schema is not the
 * form stating a name for itself.
 */
function statesAnId(literal: string): boolean {
	for (const key of literal.matchAll(/(?:^|[{,\s])id\s*:/g)) {
		if (bracketDepthAt(literal, key.index) === 1) return true;
	}
	return false;
}

/** how many brackets of any kind are open at `index`. */
function bracketDepthAt(text: string, index: number): number {
	let depth = 0;
	for (let at = 0; at < index; at++) {
		const char = text[at];
		if (char === '{' || char === '(' || char === '[') depth++;
		else if (char === '}' || char === ')' || char === ']') depth--;
	}
	return depth;
}

/**
 * every conform specifier this app may not import.
 *
 * `v4` names the *zod* major and only the zod adapter is split that way, so the subpath rule is
 * that adapter's alone: its root is written against zod 3 while this app is on zod 4, and a schema
 * handed to the root parses against a different library than the one that declared it. its
 * `/v4/future` is refused too — that is where conform exports its own coercion, which this repo
 * turns on once at the seam and never at a screen.
 *
 * `@conform-to/react` publishes `.` and `./future` and no `/v4`, and it is the only source of
 * `useForm`. everything else under the scope is a package below the adapter and reaching for one
 * is reaching past the seam.
 */
const ALLOWED_CONFORM = ['@conform-to/zod/v4', '@conform-to/react', '@conform-to/react/future'];

export function conformImportViolations(source: string): string[] {
	const specifiers = source.matchAll(/['"](@conform-to\/[^'"]+)['"]/g);
	return [...specifiers]
		.map((found) => found[1] as string)
		.filter((specifier) => !ALLOWED_CONFORM.includes(specifier));
}

/**
 * every form stated, parsed or mounted without an id of its own.
 *
 * four call shapes and one question. `defineForm` is where a screen states a form and `parseForm`
 * is where the server reads a body against one, and in both the form is the last argument;
 * `useAdminForm` is where the browser mounts one and takes it first, ahead of the action's result;
 * conform's own `useForm` is the call the seam mounts through, and is refused to a screen outright
 * by `formMountViolations` below.
 *
 * where the form is a literal the id has to be in it; where it is a name, the object that name is
 * declared with has to state one — and a name declared somewhere this cannot read is reported
 * rather than assumed, because a form whose id no reader can find is the thing being refused.
 */
export function formIdViolations(source: string): string[] {
	const passed = [
		...callSites(source, 'defineForm').map(lastArgument),
		...callSites(source, 'parseForm').map(lastArgument),
		...callSites(source, 'useForm').map(lastArgument),
		...callSites(source, 'useAdminForm').map(firstArgument)
	];
	return passed.map(statedForm).filter((form) => {
		if (form.includes('{')) return !statesAnId(form);
		if (!/^[A-Za-z_$][\w$]*$/.test(form)) return true;
		const declared = declaredObject(source, form);
		return declared === null || !statesAnId(declared);
	});
}

/** the module that mounts an /admin form, and the only one that may. */
export const FORM_SEAM = 'src/lib/admin/use-admin-form.ts';

/**
 * every module that mounts a form itself instead of through the seam.
 *
 * conform's `useForm` takes the id as a literal, so a screen calling it writes the form's name a
 * second time with nothing joining that copy to the one its action reads — and it takes the
 * `lastResult` unmatched, so a screen carrying two forms feeds each the other's errors. the seam
 * takes the form the screen stated and answers both, which is worth having only if it is the one
 * way in.
 *
 * the props helpers are not this: `getFormProps` and `getInputProps` are what a screen binds its
 * boxes with, and they are handed metadata the seam already produced.
 */
export function formMountViolations(source: string): string[] {
	if (!/\buseForm\b/.test(source)) return [];
	const entries = source.matchAll(/from\s+'(@conform-to\/react(?:\/future)?)'/g);
	return [...entries].map((found) => `useForm from '${found[1] as string}'`);
}

/**
 * every coercion of a submitted value.
 *
 * zod's is javascript coercion, and the values it silently accepts are exactly the ones a form
 * sends. conform's is reached for by name, and the same objection holds: what the seam leaves on
 * is argued once, in `src/lib/server/conform.ts`, rather than turned on again at a screen.
 */
export function coercionViolations(source: string): string[] {
	const coerced = source.matchAll(
		/\bz\.coerce\.\w+|\b(?:unstable_)?coerceFormValue\b|\bcoerceStructure\b|\bconfigureCoercion\b/g
	);
	return [...coerced].map((found) => found[0]);
}

const FAILURE_STATUS = /status\s*:\s*[45]\d\d/;

/**
 * whether a call answers with a 4xx or a 5xx, wherever the status is written down.
 *
 * an init hoisted to a `const` is the same rejection spelled one line up, so a bare identifier
 * among the arguments is resolved to what it was declared with.
 */
function carriesFailureStatus(source: string, call: string): boolean {
	if (FAILURE_STATUS.test(call)) return true;
	const hoisted = call.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [];
	return hoisted.some((name) => {
		const declared = declaredObject(source, name);
		return declared !== null && FAILURE_STATUS.test(declared);
	});
}

/**
 * every rejection a module with a form makes without going through `invalid()`.
 *
 * a 4xx or 5xx status is what makes a `data()` or a hand-built `Response` a rejection; the same
 * helper carrying headers and no status is how a loader publishes one, and that is left alone.
 *
 * what makes a module subject is that it reaches for the form seam, rather than that it exports an
 * `action`. a shared save helper rejects for three screens and exports no route; `/api/v1` exports
 * an action and answers a refusal with a status and no form at all, which CLAUDE.md is where it is
 * argued.
 */
export function bareFailureViolations(source: string): string[] {
	if (!/from\s+'[^']*\/conform'/.test(source)) return [];
	return [...callSites(source, 'data'), ...callSites(source, 'Response')].filter((call) =>
		carriesFailureStatus(source, call)
	);
}

/**
 * every `$lib/server/**` binding the browser half of a form reaches for.
 *
 * everything handed to these calls is evaluated in the browser — the validator most of all — and a
 * component cannot import from `$lib/server/**` at all. a route module importing server code for
 * its own loader is not this, and is left alone.
 *
 * four calls, because a schema reaches the browser by more than one road: `useForm` and
 * `parseWithZod` are the seam's own, `defineForm` is where a screen names the schema both halves
 * read, and `useAdminForm` is where it seeds the boxes from a record.
 */
export function serverSchemaViolations(source: string): string[] {
	const imports = source.matchAll(/import\s+([^;]*?)\s+from\s+'\$lib\/server\/[^']*'/g);
	const bound = [...imports].flatMap((found) =>
		(found[1] as string)
			.replace(/[{}]/g, ' ')
			.split(',')
			.map(
				(clause) =>
					clause
						.trim()
						.split(/\s+as\s+/)
						.pop()
						?.trim() ?? ''
			)
			.filter((name) => name !== '' && name !== 'type' && /^[A-Za-z_$][\w$]*$/.test(name))
	);
	if (bound.length === 0) return [];

	// every call the browser side of a form is written as. hoisting the validator out of `useForm`
	// is the escape from reading only one call's own text, and what runs in the browser is the
	// validator wherever it is written down.
	const browserSide = [
		...callSites(source, 'useForm'),
		...callSites(source, 'useAdminForm'),
		...callSites(source, 'defineForm'),
		...callSites(source, 'parseWithZod')
	].join('\n');
	return bound.filter((name) => new RegExp(`\\b${name}\\b`).test(browserSide));
}
