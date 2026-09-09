import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineForm } from './definition';

// what a form's own shape decides, asked once when the form is stated rather than once per
// submission.
//
// `src/lib/server/conform.ts`'s header is where each of these rules is argued; the cases here are
// the two arms its type cannot close — a schema that nests, and a credential a form states an
// empty `withheld` for — plus the reading of the shape that `parseForm` used to redo on every
// body.

describe('a stated form', () => {
	it('names the boxes whose absence is a refusal, and leaves out the two whose absence is a value', () => {
		// an emptied row editor and an unticked checkbox both submit no key, and for both the
		// absence is the value. an enum absent is a member nobody chose, which is what the list is
		// for.
		const form = defineForm({
			id: 'a-form',
			schema: z.object({
				name: z.string().default(''),
				status: z.enum(['draft', 'live']).default('draft'),
				turnstile_added: z.boolean().default(false),
				allowed_origins: z.array(z.string())
			})
		});

		expect(form.mustArrive).toEqual(['name', 'status']);
	});

	it('reads the kind at the bottom of a box, past whatever wraps it', () => {
		// `.default()`, `.optional()` and a pipe are exactly the wrappers that decide what an absent
		// key becomes, so the question — is this box a list — is asked of what they wrap.
		const form = defineForm({
			id: 'wrapped',
			schema: z.object({
				rows: z.array(z.string()).optional(),
				note: z.string().optional()
			})
		});

		expect(form.mustArrive).toEqual(['note']);
	});

	it('carries what the screen stated, so both halves read one statement', () => {
		const schema = z.object({ name: z.string() });
		const form = defineForm({ id: 'a-form', schema });

		expect(form.id).toBe('a-form');
		expect(form.schema).toBe(schema);
	});
});

describe('a schema that holds a value inside another', () => {
	// refused by `tsc --noEmit` first, which gates the commit — the `@ts-expect-error` directives
	// are the assertion, and one that stopped being needed would itself fail the type check. the
	// throws below are the arm a cast walks past, and they happen when the form is stated rather
	// than when somebody submits to it.
	it('is refused at the statement rather than at a submission', () => {
		const nested = z.object({ giving: z.object({ min: z.string() }) });

		expect(() =>
			defineForm({
				id: 'nested',
				// @ts-expect-error a form's fields are flat, and a nested schema does not type-check
				schema: nested
			})
		).toThrow(/giving/);
	});

	it('is refused where the nesting is a row of a repeating editor', () => {
		const rows = z.object({ amounts: z.array(z.object({ value: z.string() })) });

		expect(() =>
			defineForm({
				id: 'rows',
				// @ts-expect-error a row of a repeating editor is a box, never an object
				schema: rows
			})
		).toThrow(/amounts/);
	});

	it('names the form and the box, because the thing to go and fix is one line of one screen', () => {
		const record = z.object({ labels: z.record(z.string(), z.string()) });

		expect(() =>
			defineForm({
				id: 'labels',
				// @ts-expect-error a record is an object a dotted name assembles
				schema: record
			})
		).toThrow(/`labels` states `labels`/);
	});
});

describe('a form whose schema names a credential', () => {
	it('has to state that it withholds it', () => {
		// omission and a typo are both compile errors: `withheld` is required once the schema names
		// a credential-shaped box, and its members are the schema's own keys.
		const omitted = () =>
			// @ts-expect-error a schema naming `password` has to state what it withholds
			defineForm({ id: 'login', schema: z.object({ password: z.string() }) });
		const misspelled = () =>
			defineForm({
				id: 'login',
				schema: z.object({ password: z.string() }),
				// @ts-expect-error `passwrod` is not a box this schema has
				withheld: ['passwrod']
			});

		expect(omitted).toBeTypeOf('function');
		expect(misspelled).toBeTypeOf('function');
	});

	it('is refused where it states a list the credential is not in', () => {
		// the one arm the type cannot close: an empty list satisfies a required property. a leaked
		// credential is worse than a form nobody can state, so this one throws.
		expect(() =>
			defineForm({ id: 'login', schema: z.object({ password: z.string() }), withheld: [] })
		).toThrow(/password/);
	});

	it('is stated where it withholds the box', () => {
		const login = defineForm({
			id: 'login',
			schema: z.object({ password: z.string() }),
			withheld: ['password']
		});

		expect(login.withheld).toEqual(['password']);
	});
});
