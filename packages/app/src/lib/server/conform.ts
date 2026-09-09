import { parseWithZod } from '@conform-to/zod/v4';
import { data } from 'react-router';
import type { z } from 'zod';
import {
	type FormRejection,
	type RejectionStatus,
	type StatedForm,
	WHICH_FORM
} from '../forms/definition';

// the one way an /admin action parses a submission and the one way it rejects one.
//
// conform is imported through `@conform-to/zod/v4` and never through the package root: the root
// entry is written against zod 3 and this app is on zod 4, so a schema handed to the root parses
// against a different library than the one that declared it.
//
// ---------------------------------------------------------------------------
// the rules every /admin action and every form-seeding `loader` is written to. they are stated
// here because this is the module all of them already import, and because each one names a
// failure a form library reports as a success: a parse that returned an object is a claim about
// the object the library assembled, never about what somebody typed.
//
// **every stated box must arrive.** an absent field is otherwise whatever the schema would put
// there — and the sharp one is an enum, which stands in as its first member, so a body that never
// mentioned `status` would quietly unpublish a live form on /admin/forms/[id] and one that never
// mentioned a contact kind would pick a kind nobody chose. `parseForm` refuses a body missing any
// key the schema names, before the schema is allowed to fill one in. two kinds are exempt and
// neither is a loophole: a repeating row editor emptied of its rows submits no key, and an
// unticked checkbox submits no key — for both, absence is the value rather than the lack of one,
// where an enum absent is a member nobody chose.
//
// **a form's fields stay flat, and a body that nests one is refused.** conform reads `a.b` and
// `a[b]` as paths and assembles an object out of either, so a nested name posted against a flat
// schema is discarded and the form still validates. nothing this app renders writes such a name,
// so a body carrying one is a client this app did not write and is answered as a bad request
// rather than parsed. a row index is the one bracket a body may carry and it is bounded: the index
// is the client's to choose and conform builds an array up to it, so an unbounded one is a
// worker's cpu spent assembling a rejection nobody asked for. the schema is held to the same shape
// by `$lib/forms/definition.ts`'s own type, so a nested one is refused by the type check rather
// than at the first submission — and by `defineForm` at module load, for the arm a cast walks
// past.
//
// **a form id is stated, never derived.** a screen can carry more than one form — the three
// groups on /admin/forms/[id] do — and each action's result has to reach the one form it belongs
// to. an id derived from the schema's shape makes two structurally identical forms one form, and
// the result of saving either then updates both. so the id is a literal on the form and travels
// back on every rejection.
//
// **a body says which form it was submitted from, under `WHICH_FORM`, and an action reads it
// before anything else.** a route has one `action` and a screen may carry several forms — the
// three groups on /admin/forms/[id] plus its archive — so the id that travels back on a rejection
// has to travel in as well, or the arms of one action are told apart by guessing. what a body
// naming none of them, or naming one this screen does not carry, gets is a refusal rather than the
// first arm: the four arms are four different writes, and picking one is picking which columns to
// replace. `submittedForm` below is that reading; `whichForm` in `$lib/admin/use-admin-form.ts`
// is the box, and `$lib/forms/definition.ts` is where the name is stated for both halves.
//
// **no `z.coerce.*` anywhere.** it is javascript coercion, and the values it silently accepts are
// exactly the ones a form sends: the string `'false'` coerces to true, an empty box to 0.
// conform's own coercion is not that and is left on — it strips an empty box to `undefined`,
// wraps a single value into a list where the schema wants one, and converts a checkbox only from
// the literal `'on'`, failing the type check on anything else rather than guessing.
//
// **a form seeded from a record reports no error until it is submitted.** a fresh deployment
// would otherwise open the dashboard already telling the operator to fill in a box they have
// never touched. conform gives it: errors reach a form only through the `lastResult` an action
// returned, and validation before the first submit is off unless a screen asks for it.
//
// **a repeated input's message is keyed by the input's own name.** a rejection here keys
// `allowed_origins` directly rather than a leaf beneath it: a key naming anything under the box —
// a row index, an `_errors` bucket — is a key nothing on the screen is listening for, and a
// message under one renders as no message at all.
//
// **a rejection returns through `invalid()`.** conform's `reply()` answers `success` for a
// submission that parsed cleanly, so a failure no rule expresses — an archived row, a write that
// threw — would otherwise reach the browser as a 400 whose form still
// claims to be fine, and the screen would render a clean form over it.
//
// **a withheld box is never echoed back.** every rejection sends the submitted values back so the
// boxes keep what was typed, and /login's box holds the staff password. it is stated once on the
// form rather than emptied on each arm: an arm added later that forgot would be a credential
// rendered into a `value=` attribute with nothing failing. stating it once is worth having only
// because forgetting to state it does not compile — a schema naming a credential-shaped box makes
// `withheld` a required property whose members are that schema's own keys — and because the one
// arm a required property cannot close, an empty list, is refused by `defineForm` when the form is
// stated.
//
// **a schema that runs in the browser cannot live under `src/lib/server/**`.** the same rules
// validate in the browser before a screen submits, and a component cannot import from here at
// all. the shared schema modules sit at `$lib/forms/` and `$lib/contacts/`, next to the vocabulary
// they already share; `$lib/forms/input-schema.ts` is where that is argued. the
// browser's half of this seam is `$lib/admin/use-admin-form.ts`, which mounts the form the screen
// stated and is the only module in this app that calls conform's `useForm`.
//
// `packages/app/form-rules.spec.ts` is what holds the tree to the five of these a gate can read
// off the source; the rest are held by ./conform.spec.ts, because a body that never carried a box
// and a rejection that still claims to be valid are shapes no file states.
// ---------------------------------------------------------------------------

/** what a rejection adds to what the submission already said. */
export type RejectionReasons = {
	readonly formErrors?: string[];
	readonly fieldErrors?: Record<string, string[]>;
};

/**
 * a parsed submission: the values where every rule passed, and a rejection either way.
 *
 * `reject` is on both arms deliberately. a failure the schema found and a failure only the
 * database knows about are the same thing to the screen, and one call shape for both is what
 * stops the second being spelled as the first by a reader who only ever saw the first.
 */
export type ParsedForm<T> =
	| { readonly ok: true; readonly value: T; readonly reject: Reject }
	| { readonly ok: false; readonly reject: Reject };

type Reject = (reasons?: RejectionReasons) => FormRejection;

/** what a body says when it did not carry the whole form. */
const INCOMPLETE = 'Reload the page and try again. Part of the form did not submit.';

/**
 * a name a body may carry: one box, or one row of a repeating editor.
 *
 * a dot and a bracketed word are conform's two ways of spelling a path into an object, so both are
 * outside this. `__intent__` and `__state__` are conform's own reserved names and match it, which
 * leaves an intent body to be refused by the parse rather than by its shape.
 */
const FLAT_NAME = /^[^.[\]]+(?:\[(\d+)\])?$/;

/**
 * the highest row index a body may name.
 *
 * a bound on the shape of a body and not a rule about how many rows a form may hold — the product
 * caps are `MAX_ALLOWED_ORIGINS` in `@better-giving/operator/origins` and `MAX_SUGGESTED_AMOUNTS`
 * in `$lib/forms/amounts.ts`, and this sits well above both. what it stops is an index nothing
 * rendered: conform builds an array up to whatever number arrives, so `origins[100000]` is a
 * hundred thousand entries assembled and then reported on.
 */
const MAX_ROW_INDEX = 100;

/**
 * which of a screen's forms this body was submitted from.
 *
 * read before the body is parsed against anything, because what to parse it against is what this
 * answers. the ids are passed in rather than discovered: they are the literals the screen already
 * states, so an arm added to an action without a form to go with it is a type error at the switch
 * rather than an arm nothing can reach.
 *
 * a refusal is a thrown `Response` and not a rejection, for the same reason a nested name is one:
 * there is no form to reject *from* yet, and nothing the operator typed is what went wrong. the
 * sentence names the box, because a 4xx body in this app is read by an agent (CLAUDE.md).
 */
export function submittedForm<Id extends string>(body: FormData, forms: readonly Id[]): Id {
	const named = body.get(WHICH_FORM);
	if (typeof named !== 'string' || !(forms as readonly string[]).includes(named)) {
		throw new Response(
			`\`${WHICH_FORM}\` names no form on this screen. it carries the id of the form the body was submitted from, which is one of: ${forms.join(', ')}.`,
			{ status: 400 }
		);
	}
	return named as Id;
}

/**
 * parse a submitted body against the form that states it.
 *
 * refuses before the schema runs where the body is not one this app's markup could have sent: a
 * name that reaches inside another value, a row index past the bound, or a box the form states and
 * the body does not carry.
 */
export function parseForm<S extends z.ZodObject>(
	body: FormData,
	form: StatedForm<S>
): ParsedForm<z.output<S>> {
	for (const key of body.keys()) {
		const shape = FLAT_NAME.exec(key);
		if (shape === null) {
			throw new Response(`\`${key}\` names a value inside another; this form's fields are flat.`, {
				status: 400
			});
		}
		if (shape[1] !== undefined && Number(shape[1]) >= MAX_ROW_INDEX) {
			throw new Response(`\`${key}\` is past the ${MAX_ROW_INDEX}-row bound on a submitted body.`, {
				status: 400
			});
		}
	}

	const absent = form.mustArrive.filter((key) => !body.has(key));

	// the operator is told to reload, which is the whole of what they can do; which boxes were
	// missing is the developer's half and has nowhere else to go.
	if (absent.length > 0) {
		console.warn(`\`${form.id}\`: a submitted body carried none of these boxes`, absent);
	}

	const submission = parseWithZod(body, { schema: form.schema });
	const reject: Reject = (reasons) => ({
		id: form.id,
		result: submission.reply({
			formErrors: [...(absent.length > 0 ? [INCOMPLETE] : []), ...(reasons?.formErrors ?? [])],
			...(reasons?.fieldErrors ? { fieldErrors: reasons.fieldErrors } : {}),
			hideFields: [...(form.withheld ?? [])]
		})
	});

	if (absent.length > 0 || submission.status !== 'success') return { ok: false, reject };
	return { ok: true, value: submission.value, reject };
}

/**
 * a rejection for a submission there is nothing to reply from.
 *
 * two callers, and one of them is the reason this exists rather than a convenience: the sign-in
 * limiter is charged ahead of `request.formData()` so that a refusal spends neither the parse nor
 * the hash it exists to save (`src/routes/login.tsx`), and there is no submission at that point.
 * the second is a form that states no box at all — the archive on
 * `src/routes/_app.admin.forms.$id.tsx`, whose body carries no value and whose refusal is a banner
 * with nowhere else to sit. what it carries is what both of them can carry: no values, no field
 * errors, and no box for a credential to come back in.
 *
 * `initialValue` is stated as empty rather than left off. conform reads it as the form's values,
 * so absent would leave the boxes holding whatever the last result put there, and this answer is
 * about the request rather than about anything in it.
 *
 * it goes through `invalid()` like every other rejection, which is what puts the status on it.
 */
export function unread<S extends z.ZodObject>(
	form: StatedForm<S>,
	sentence: string
): FormRejection {
	return { id: form.id, result: { initialValue: {}, error: { '': [sentence] } } };
}

/**
 * a rejected submission, with the form marked refused whatever made it so.
 *
 * the status is written rather than trusted: for a schema failure conform has already set it, and
 * for a business failure nothing has.
 */
export function invalid<E extends object = object>(
	status: RejectionStatus,
	rejection: FormRejection,
	/**
	 * anything else the page needs that is not a field error and not a banner.
	 *
	 * no caller today. what it is for is an answer belonging to no box — a sentence that sits over a
	 * fieldset rather than under either input in it, or a value that is not a message at all — and it
	 * rides alongside the form rather than inside it for the reason `./contacts/contact-input.ts`
	 * gives about growing the parser a second channel: the placement is the screen's, and the shape
	 * every other screen returns must not change to make room for it.
	 */
	extra?: E
) {
	return data(
		{
			...(extra as E),
			form: { id: rejection.id, result: { ...rejection.result, status: 'error' as const } }
		},
		{ status }
	);
}
