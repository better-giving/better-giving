import type { SubmissionResult } from '@conform-to/zod/v4';
import type { z } from 'zod';
import type { $ZodType } from 'zod/v4/core';

// what a form is, in the one place a server action and a browser component may both import from.
//
// not under `$lib/server/**`, for the reason ./input-schema.ts and ./fields.ts are not: these
// three shapes describe the wire between an action and the screen that submitted to it, so both
// ends hold them, and a component cannot import from `$lib/server/**` at all. nothing at build
// time refuses that import, so a shape stated on the server side is a shape a component reaches
// for and pulls the parser into the browser bundle behind it.
//
// vocabulary, and the one statement that mints a form out of it. `$lib/server/conform.ts` is the
// seam that reads a body against one of these, states every rule the layer keeps, and is the only
// module that may build a rejection; `defineForm` at the foot of this file is what a screen writes
// once so that its action and its component read one statement rather than two literals.
//
// the dependency runs server -> shared and never back: the seam imports this, and nothing here
// imports from `$lib/server/**`. the one package it names is conform's own result type, which is
// erased before anything runs.

/**
 * what a rejection may answer with.
 *
 * a list rather than a range, because typescript spells a range as six hundred members and
 * because a code not on this list is a decision somebody should be making out loud.
 *
 * 429 is on it for one form, the sign-in — a rate limit is the only refusal in this app answered
 * before a body is read, and the screen renders it as a banner like any other rejection rather
 * than as a status nobody sees (`src/routes/login.tsx`).
 */
export type RejectionStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

/**
 * what one box may hold, which is the whole of what a body can carry.
 *
 * a repeating row editor submits its rows under one name, so a list of these is a box too. nothing
 * else is: an object here is a nested field, and conform assembles one out of a dotted name that
 * no markup in this app writes.
 */
type BoxValue = string | number | boolean | Date | null | undefined;

/** a form's values as a body can carry them — every box flat, and a list where there are rows. */
type FlatValues = Record<string, BoxValue | readonly BoxValue[]>;

/** the boxes a form has, as names. */
type FieldName<S extends z.ZodObject> = Extract<keyof z.output<S>, string>;

/**
 * box names whose value is a credential, wherever one turns up.
 *
 * a list rather than a heuristic: what makes a box a credential is what the deployment does with
 * it, and the names below are the ones this app's screens use for one. a form whose schema names
 * any of them must say so — see `withheld`.
 *
 * a value as well as a type, because the type closes the two arms a compiler can see — the box
 * omitted and the box misspelled — and `defineForm` below closes the third at runtime: a required
 * property is satisfied by an empty list.
 */
export const CREDENTIAL_FIELDS = [
	'password',
	'new_password',
	'current_password',
	'secret',
	'token'
] as const;

type Credential = (typeof CREDENTIAL_FIELDS)[number];

/**
 * `withheld` is optional on a form holding no credential and required on one that does.
 *
 * the requirement is the point: "the staff password is never echoed back" was a rule somebody had
 * to remember on each rejection arm, and stating it once at the form is only an improvement if
 * forgetting to state it does not compile.
 */
type Withheld<S extends z.ZodObject> = [Extract<FieldName<S>, Credential>] extends [never]
	? {
			/**
			 * boxes whose value never travels back on a rejection.
			 *
			 * every rejection sends the submitted values back so the boxes keep what was typed, which
			 * is what a name here opts out of.
			 */
			readonly withheld?: readonly FieldName<S>[];
		}
	: { readonly withheld: readonly FieldName<S>[] };

/** a form as the screen that owns it states it. */
export type FormDefinition<S extends z.ZodObject> = {
	/**
	 * this form's own name, a literal and never derived from the schema.
	 *
	 * it is what a screen with more than one form matches a result against, so two forms sharing an
	 * id is two forms updating on one save.
	 */
	readonly id: string;
	/**
	 * the rules, flat.
	 *
	 * the `_zod` intersection is what refuses a nested one, and it refuses it here rather than at
	 * the first submission: a schema is a module-scope constant, so its shape is a fact at the type
	 * check and a request-time throw would be a blank 500 in production instead.
	 */
	readonly schema: S & { readonly _zod: { readonly output: FlatValues } };
} & Withheld<S>;

/** a refused submission, on its way to `invalid()`. */
export type FormRejection = {
	readonly id: string;
	readonly result: SubmissionResult;
};

/**
 * a form as `defineForm` states it: what the screen wrote, plus what its shape decides.
 *
 * the seam takes one of these rather than a `FormDefinition`, which is how a form reaches the
 * parser only by having been stated — a hand-written literal is missing `mustArrive` and does not
 * compile.
 */
export type StatedForm<S extends z.ZodObject> = FormDefinition<S> & {
	/**
	 * the boxes whose absence in a submitted body is a refusal.
	 *
	 * a list and array boxes are not on it: an emptied row editor and an unticked checkbox each
	 * submit no key, and for both the absence is the value rather than the lack of one. every other
	 * box is, because what an absent key becomes is whatever the schema would fill in — and for an
	 * enum that is a member nobody chose.
	 */
	readonly mustArrive: readonly string[];
};

/**
 * the node at the bottom of a field, past whatever wraps it.
 *
 * `.default()`, `.prefault()` and `.optional()` are exactly the wrappers that decide what an absent
 * key becomes, so the questions asked of a box — is it a list, does it hold a value inside itself —
 * have to be asked of what they wrap rather than of them.
 */
function core(schema: $ZodType): $ZodType {
	const def = schema._zod.def as {
		type: string;
		innerType?: $ZodType;
		in?: $ZodType;
		out?: $ZodType;
	};
	switch (def.type) {
		case 'optional':
		case 'nonoptional':
		case 'default':
		case 'prefault':
		case 'catch':
		case 'nullable':
		case 'readonly':
			return def.innerType ?? schema;
		case 'pipe':
			// a pipe's input side is what a body is measured against, except where that side is a
			// transform — then the shape a submission has to have is the one on the far end.
			if (def.in && def.in._zod.def.type !== 'transform') return core(def.in);
			return def.out ? core(def.out) : schema;
		default:
			return schema;
	}
}

/**
 * the kinds a body cannot carry as one box, because each is assembled out of a name reaching
 * inside another.
 *
 * a union is not among them: two literals in a union is an ordinary box, and a union of objects is
 * refused by the type above rather than here.
 */
const NESTED_KINDS = new Set(['object', 'record', 'tuple', 'map', 'set']);

/** the kind that holds a value inside `field`, or `null` where it holds none. */
function nesting(field: $ZodType): string | null {
	const bottom = core(field);
	const kind = bottom._zod.def.type;
	if (kind === 'array') {
		const element = (bottom._zod.def as { element?: $ZodType }).element;
		return element ? nesting(element) : null;
	}
	return NESTED_KINDS.has(kind) ? kind : null;
}

/**
 * state a form: the one statement an action and the component that submits to it both read.
 *
 * a screen writes this once at module scope and hands it to `parseForm` on the server side and to
 * `$lib/admin/use-admin-form.ts` on the browser side, so the id, the schema and what the form
 * withholds are one fact rather than two literals with nothing joining them.
 *
 * it is also where the shape is read, once. the two things a submission is measured against — which
 * boxes must arrive, and whether any of them holds a value inside itself — are facts about the form
 * rather than about the body, and the seam used to re-derive both on every request. a module-scope
 * call means a form that cannot be parsed cannot be loaded, which is a stack trace at boot rather
 * than a blank 500 on somebody's save.
 *
 * both throws below are arms the type check cannot close — a schema arriving through a cast, and a
 * required property satisfied by an empty list — and both are stated in
 * `$lib/server/conform.ts`'s header, which is where the whole layer's rules are argued.
 */
export function defineForm<S extends z.ZodObject>(form: FormDefinition<S>): StatedForm<S> {
	const withheld = new Set<string>(form.withheld ?? []);
	const mustArrive: string[] = [];

	for (const [name, field] of Object.entries(form.schema.shape as Record<string, $ZodType>)) {
		const nested = nesting(field);
		if (nested !== null) {
			throw new Error(
				`\`${form.id}\` states \`${name}\` as a ${nested}; this form's fields are flat.`
			);
		}
		if ((CREDENTIAL_FIELDS as readonly string[]).includes(name) && !withheld.has(name)) {
			throw new Error(
				`\`${form.id}\` names \`${name}\` and does not withhold it; a credential is never echoed back.`
			);
		}
		const kind = core(field)._zod.def.type;
		if (kind !== 'array' && kind !== 'boolean') mustArrive.push(name);
	}

	return { ...form, mustArrive };
}

/**
 * the box a submitted body names the form it came from under.
 *
 * a screen may carry more than one form and a route has exactly one `action` — /admin/forms/[id]
 * carries four and the console will carry more — so the body has to say which of them was
 * submitted. it says it by carrying the id that form already states, which is the same literal
 * `resultFor` in `$lib/admin/use-admin-form.ts` matches the rejection back by: the way in and the
 * way out are then one fact rather than two that can drift.
 *
 * a box in the body rather than a query on the address, and the address is the one this screen
 * already spends on something else: the archive confirmation is `?confirm=archive`, and a form
 * posting to `?save=name` would replace it — so a refused save would close the panel it was not
 * about. a `<Form>` with no `action` posts to the address the operator is standing on and leaves
 * it alone.
 *
 * the `__…__` shape says what conform's own `__intent__` and `__state__` say about themselves:
 * this is not a box and no schema states it. the name is this app's because conform reserves
 * exactly those two and no third — a body carrying one of theirs is refused by the parse rather
 * than read, which `$lib/server/conform.ts`'s header is where that is argued.
 */
export const WHICH_FORM = '__form_id__';
