import type { ZodError } from 'zod';

// the one walk from a refused parse to the map a form renders, for every surface that renders one.
//
// **it is in this package because the rules it reads issues from are.** the deployment's three
// parsers each name their form fields in a tuple whose members are their schema's own keys
// (`packages/app/src/lib/server/contacts/contact-input.ts`, `.../org/org-input.ts`,
// `.../forms/form-input.ts`), so the walk is the same in all three and only the tuple differs — and
// a console fold running the promoted rules in ./console/org-rules.ts in front of a press has to
// key its sentences the same way. one module is what makes both ends agree: an issue filed under
// one key by the deployment and another by the console is one schema and two answers about which
// box a sentence lands under, which renders as a sentence under nothing.
//
// `packages/app/src/lib/server/donations/quote-input.ts` is not one of its callers and must not
// become one: `/api/v1` reports a single refusal rather than a map, and its `firstReported` is that
// shape deliberately.
//
// named for what it reads rather than for what it returns. this package is a leaf and imports
// nothing of the app's — a type off `zod` is the whole of what this reaches for.

/**
 * the field a zod issue is about, when it is one this form has a box for.
 *
 * an issue can be raised at the root, where `path` is empty, and a schema can carry a key no
 * tuple lists. either keyed straight into the map would be a message under a name nothing on the
 * screen is listening for, which renders as no message at all.
 */
function isField<F extends string>(value: unknown, fields: readonly F[]): value is F {
	return typeof value === 'string' && (fields as readonly string[]).includes(value);
}

/**
 * turns a rejected parse into the map a form renders, keyed by the field that failed.
 *
 * the key is `issue.path[0]`, which is the same key zod's own `flattenError` files `fieldErrors`
 * under. what differs is the shape a form wants: a key no tuple lists is dropped rather than
 * carried ({@link isField}), and a second issue on a field replaces the first, so an operator is
 * given one thing to fix per input rather than a list under one label.
 */
export function fieldErrorsFrom<F extends string>(
	error: ZodError,
	fields: readonly F[]
): Partial<Record<F, string>> {
	const errors: Partial<Record<F, string>> = {};
	for (const issue of error.issues) {
		const field = issue.path[0];
		if (isField(field, fields)) errors[field] = issue.message;
	}
	return errors;
}
