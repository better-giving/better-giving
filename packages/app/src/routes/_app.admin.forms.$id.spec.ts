import { RouterContextProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import type { FormInputField } from '$lib/forms/fields';
import { MAX_FORM_NAME } from '$lib/forms/input-schema';
import type { Db } from '$lib/server/db/client';
import { database } from '../context';
import { action } from './_app.admin.forms.$id';

// a node spec, not a workers one, and the split is CLAUDE.md's: what is asserted here is the half
// of a save that returns before the database is reached. everything past it lives in
// `_app.admin.forms.$id.workers.spec.ts` beside this file.
//
// the handle on the request context is deliberately absent — `NO_HANDLE` below — which does two
// things at once: a submission the parser rejects that still reached a query would be the bug this
// file catches, and the three cases that *are* about reaching one read the write's own failure as
// their assertion.
//
// the screen saves one group at a time, so each case names the form it is about. that is the
// property most of this file is for: a refusal reaches the group it came from and no other, which
// is what three `<form>` elements on one screen buy over one page-level save.
//
// every case reads its refusal off one shape, reconciled once in `post` below. no case empties a
// box to assert the emptied value comes back: conform normalizes an empty box out of the values it
// echoes, so a box somebody cleared comes back absent rather than blank and renders empty either
// way — the first case makes that claim with a name refused for its length instead.
//
// `message` is the banner over a group, and it is read off the 500 arm alone here for the reason
// the create screen's own spec gives: the other sentence that can reach the empty key is the form
// layer's "part of the form did not submit", which is `parseForm`'s answer to a body that never
// carried the form rather than anything this action said.

/** the ids the four forms on this screen answer to, as a body names the one it came from. */
const NAME_FORM = 'form-edit-name';
const GIVING_FORM = 'form-edit-giving';
const ORIGINS_FORM = 'form-edit-origins';

/**
 * the database handle a request in this file arrives with, which is none.
 *
 * a value rather than an unset context, because `context.get` throws for a context that never held
 * one — and a save refused by the parser must be able to run to its refusal without a query being
 * reached at all. what is seeded is a handle any query throws on.
 */
const NO_HANDLE = undefined as unknown as Db;

/**
 * a key a refusal may arrive under: a box, or one row of the amounts editor.
 *
 * a row is an `<input>` with an indexed name — `suggested_amounts[1]` — which is the key
 * `suggestedAmountsRule` in `$lib/forms/input-schema.ts` pushes its issue at and the one a screen's
 * `getFieldList()` row reads its errors from. it is not a `FormInputField`, because it is not a
 * field of the form: it is one box of one.
 */
type RefusedBox = FormInputField | `suggested_amounts[${number}]`;

/** what a rejected save hands back, as a case reads it. */
type SaveFailure = {
	form: {
		valid: boolean;
		message?: string;
		errors: Partial<Record<RefusedBox, string[]>>;
		data: Record<string, unknown>;
	};
};

/** what `invalid()` hands back: the payload and the status it answers with. */
type Rejection = {
	readonly data: {
		readonly form: {
			readonly result: {
				status?: string;
				error?: Record<string, string[]>;
				initialValue?: unknown;
			};
		};
	};
	readonly init: { readonly status: number };
};

/**
 * a body as this screen's markup writes it.
 *
 * the amounts are a repeating row editor, so each row carries its own indexed name — the one
 * bracket a submitted body may hold (`$lib/server/conform.ts`) — and the sites are a checkbox
 * group, so each ticked box repeats one name. a value stated as an empty list is a box the browser
 * did not send at all, which is what an unticked group is.
 *
 * every body names the form it was submitted from, because the screen's markup does: one `action`
 * serves four submissions and that box is what tells them apart.
 */
function bodyOf(form: string, fields: Record<string, string | string[]>): FormData {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	for (const [field, value] of Object.entries(fields)) {
		if (field === 'suggested_amounts') {
			const rows = typeof value === 'string' ? [value] : value;
			rows.forEach((row, index) => {
				body.append(`suggested_amounts[${index}]`, row);
			});
			continue;
		}
		for (const one of typeof value === 'string' ? [value] : value) body.append(field, one);
	}
	return body;
}

/**
 * posts a body at the action for one of this screen's groups, and returns what it handed back.
 *
 * a real `Request` rather than a stubbed `formData()`, because reading the body exactly once is one
 * of the things this route owes CLAUDE.md and a stub would let a second read pass.
 */
async function post(form: string, fields: Record<string, string | string[]>) {
	const request = new Request('http://localhost/admin/forms/frm_x', {
		method: 'POST',
		body: bodyOf(form, fields)
	});
	const context = new RouterContextProvider();
	context.set(database, NO_HANDLE);

	const returned = (await action({
		request,
		context,
		params: { id: 'frm_x' }
	} as never)) as unknown as Rejection;

	const keyed = returned.data.form.result.error ?? {};
	const banner = returned.init.status >= 500 ? keyed['']?.at(-1) : undefined;
	const errors = Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== ''));

	return {
		status: returned.init.status,
		data: {
			form: {
				valid: returned.data.form.result.status !== 'error',
				...(banner === undefined ? {} : { message: banner }),
				errors,
				data: (returned.data.form.result.initialValue ?? {}) as Record<string, unknown>
			}
		} as SaveFailure
	};
}

/** the one message a box shows, which is the last of them. */
function under(data: SaveFailure, field: RefusedBox) {
	return data.form.errors[field]?.at(-1);
}

describe('/admin/forms/[id] the name group — what never reaches the database', () => {
	it('sends back what was typed, so a rejected save does not clear the group', async () => {
		// an edit screen that empties itself on one bad value is one an operator stops using — and
		// unlike a create, what it would clear is a form that was already working. the form layer
		// carries it on the rejection, which is what the boxes on the page are seeded from.
		const typed = { name: 'x'.repeat(MAX_FORM_NAME + 1), status: 'live' };
		const { status, data } = await post(NAME_FORM, typed);
		expect(status).toBe(400);
		expect(under(data, 'name')).toBeTypeOf('string');
		// a write that failed is a banner, and there was no write.
		expect(data.form.message).toBeUndefined();
		expect(data.form.data).toMatchObject(typed);
	});

	it('refuses a status of `archived`, which is an action rather than a box', async () => {
		// `FORM_STATUSES` and `archived_at` are two representations of one fact, so a `<select>`
		// writing `archived` would leave a form that reads archived on a screen and live to the
		// forms list. the page offers draft and live only; this is the floor under that.
		const { status, data } = await post(NAME_FORM, { name: 'Gala 2026', status: 'archived' });
		expect(status).toBe(400);
		expect(under(data, 'status')).toBeTypeOf('string');
	});

	/**
	 * every stated box must arrive, and it matters more here than on the create beside it.
	 *
	 * without the rule the schema fills a key the request did not carry from its own type, and for
	 * an enum that is its *first member* — `draft`. on a create that would be a form nobody chose
	 * the status of; on an edit it is a live form quietly unpublished by a body that never mentioned
	 * its status, which is a change no operator asked for and nothing on the screen would report.
	 */
	it('refuses a body that never mentions the status, rather than quietly making it a draft', async () => {
		const { status, data } = await post(NAME_FORM, { name: 'Gala 2026' });
		expect(status).toBe(400);
		expect(data.form.valid).toBe(false);
		expect(under(data, 'status')).toBeTypeOf('string');
		// and it never reached the handle that is not there: a write that failed is a banner.
		expect(data.form.message).toBeUndefined();
	});

	it('says nothing about a box that belongs to another group', async () => {
		// the property three forms on one screen exist for. a refusal reaches the group that was
		// submitted and marks up nothing else — an operator fixing the name is not told the amounts
		// they never sent are missing, and the two groups they did not touch keep what is in them.
		const { data } = await post(NAME_FORM, { name: '', status: 'live' });
		expect(Object.keys(data.form.errors).sort()).toEqual(['name']);
	});
});

describe('/admin/forms/[id] the giving group — what never reaches the database', () => {
	it('answers for the rules that read more than one box', async () => {
		// the three fields are one group because the rules between them are: a suggestion is in
		// range or not according to the two bounds, and a screen that saved one of the three on its
		// own would be saving against a bound it had not read.
		const { status, data } = await post(GIVING_FORM, {
			min_minor: '2500.00',
			max_minor: '5.00',
			suggested_amounts: '25.00'
		});
		expect(status).toBe(400);
		// the two bounds the wrong way round, keyed to the largest — the box the sentence names.
		// neither figure is repeated: both are in their boxes, side by side, above the sentence.
		expect(under(data, 'max_minor')).toBe('must be larger than smallest gift');
		// and the tile that is outside them, under the box holding it.
		expect(under(data, 'suggested_amounts[0]')).toBeTypeOf('string');
	});

	it('carries each amount’s message to the box that holds it', async () => {
		// `suggested_amounts` is a repeating row editor — one `<input>` per amount, each with its own
		// indexed name — so every row is a field a message can be keyed to. `suggestedAmountsRule` in
		// `$lib/forms/input-schema.ts` pushes one issue per offending row from an object-level check,
		// and each lands under that row's own input name.
		const { status, data } = await post(GIVING_FORM, {
			min_minor: '5.00',
			max_minor: '10000.00',
			suggested_amounts: ['25.00', 'lots', '1.00']
		});
		expect(status).toBe(400);
		// every offending box at once, so a group somebody has filled in takes one round trip.
		expect(under(data, 'suggested_amounts[1]')).toContain('must be an amount');
		expect(under(data, 'suggested_amounts[2]')).toContain('must be more than smallest gift');
		// and nothing under the one that is fine.
		expect(under(data, 'suggested_amounts[0]')).toBeUndefined();
	});

	it('accepts a group whose only amount box was never typed into', async () => {
		// what Add leaves behind, and what a form offering no preset tiles is. a blank row is not a
		// value, so the group parses and the action goes on to write — which is where it meets the
		// database handle this spec deliberately does not have. that is the assertion, the same shape
		// the sites group's own case below is pinned against.
		const { status, data } = await post(GIVING_FORM, {
			min_minor: '5.00',
			max_minor: '10000.00',
			suggested_amounts: ['']
		});
		expect(status).toBe(500);
		expect(data.form.errors).toEqual({});
		expect(data.form.message).toBeTypeOf('string');
	});

	it('refuses more decimal places than the currency has, naming what to write', async () => {
		// `25.50` is a gift now rather than a mistake — what is still refused is precision the
		// currency does not have, and the sentence names the value and shows the shape rather than
		// rounding it into a bound nobody set.
		const { data } = await post(GIVING_FORM, {
			min_minor: '25.005',
			max_minor: '10000.00',
			suggested_amounts: ''
		});
		expect(under(data, 'min_minor')).toContain('must not be finer than $0.01');
		expect(under(data, 'min_minor')).toContain('write 25.00 for $25.00');
	});
});

describe('/admin/forms/[id] the sites group — what never reaches the database', () => {
	/**
	 * the message about the sites, which cannot come from the action and has to come from the
	 * schema.
	 *
	 * `allowed_origins` is one `<input type="checkbox">` per listed site, so there is no per-box
	 * field to key a message to: the rules push their own issue from inside `FORM_FIELD_RULES` and
	 * it lands under the group's own input name. an action that tried to attach it per box would
	 * find nothing to hang it on and the operator would meet a rejected save with nothing said,
	 * which is what these cases are pinned against.
	 */
	it('refuses a value there is no address in, and the sentence reaches the group', async () => {
		// unreachable from a drawn page — every box carries a listed value — so this is a stale tab
		// or a hand-built body, and the shape rule still turns it down.
		const { status, data } = await post(ORIGINS_FORM, { allowed_origins: ['https:'] });
		expect(status).toBe(400);
		expect(under(data, 'allowed_origins')).toBe('invalid url');
	});

	it('says each thing that is wrong with the list once, and names no address', async () => {
		// the boxes are on the screen holding what was ticked, so the sentence says what is wrong
		// rather than repeating a value the operator is looking at.
		const { data } = await post(ORIGINS_FORM, {
			allowed_origins: ['https:', 'http://a.example', 'https://ok.example']
		});
		const message = under(data, 'allowed_origins');
		expect(message).toBe('invalid url, https only');
	});

	it('carries a body that never mentions the sites past every rule the schema states', async () => {
		// a group with nothing ticked submits no key rather than an empty one, so this is the
		// submission a rendered page actually makes. `.prefault([])` in `$lib/forms/input-schema.ts`
		// feeds that absence through the rule, and the rule has nothing to say about it: a form on no
		// site loads on this deployment's own donation page. so the save goes on to the list read,
		// which is where it meets the handle this spec deliberately does not have — a 500 with no
		// field error is the shape of "it got that far".
		const { status, data } = await post(ORIGINS_FORM, {});
		expect(status).toBe(500);
		expect(data.form.errors).toEqual({});
		expect(data.form.message).toBeTypeOf('string');
	});

	it('reaches the deployment’s own list once every box is a usable site', async () => {
		// past every rule a schema can state, the save asks which sites this deployment has listed —
		// which is where it meets the database handle this spec deliberately does not have. a 500
		// with no field error is the shape of "it got that far"; a refused group is a 400 with a
		// sentence under the sites. what the read itself decides is
		// `_app.admin.forms.$id.workers.spec.ts`'.
		const { status, data } = await post(ORIGINS_FORM, {
			allowed_origins: ['https://acme.org']
		});
		expect(status).toBe(500);
		expect(data.form.errors).toEqual({});
		expect(data.form.message).toBeTypeOf('string');
	});
});

describe('/admin/forms/[id] a body that names no form on this screen', () => {
	it('is refused, rather than falling to whichever arm was written first', async () => {
		// the four arms of one `action` are four different writes. a body carrying no `WHICH_FORM`
		// box is a hand-built one or markup that lost it, and guessing which write it meant is
		// guessing which columns to replace.
		const request = new Request('http://localhost/admin/forms/frm_x', {
			method: 'POST',
			body: new FormData()
		});
		const context = new RouterContextProvider();
		context.set(database, NO_HANDLE);

		try {
			await action({ request, context, params: { id: 'frm_x' } } as never);
		} catch (thrown) {
			expect(thrown instanceof Response && thrown.status).toBe(400);
			return;
		}
		throw new Error('expected a body naming no form to be refused');
	});
});
