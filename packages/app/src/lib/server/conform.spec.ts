import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineForm, WHICH_FORM } from '../forms/definition';
import { invalid, parseForm, submittedForm } from './conform';

// what the form seam refuses, which is the half of it no type check can state.
//
// every case here is a submission conform would otherwise report as valid: an absent box that a
// schema default fills in, an absent `<select>` that an enum stands in for, a value posted under a
// nested name. the schema below is deliberately the shape those failures need — a defaulted text
// box, a defaulted enum, a list — rather than a copy of any real form's.
//
// what a form's own shape decides is asked once when the form is stated rather than here, so the
// cases about a schema that nests and a credential a form must withhold are
// ../forms/definition.spec.ts's.

const SCHEMA = z.object({
	name: z.string().default(''),
	status: z.enum(['draft', 'live']).default('draft'),
	allowed_origins: z.array(z.string())
});

const FORM = defineForm({ id: 'a-form', schema: SCHEMA });

/** a body with every box the form states, so a case can take one away. */
function complete(): FormData {
	const body = new FormData();
	body.set('name', 'Spring appeal');
	body.set('status', 'live');
	body.append('allowed_origins', 'https://example.org');
	return body;
}

describe('a submitted form', () => {
	it('parses to the schema’s own output when every box it states arrived', () => {
		const form = parseForm(complete(), FORM);

		expect(form.ok && form.value).toEqual({
			name: 'Spring appeal',
			status: 'live',
			allowed_origins: ['https://example.org']
		});
	});

	it('is refused outright when the body is empty', () => {
		// the case the whole rule exists for. every field here has a default, so a parse of an empty
		// object succeeds and reports a form nobody filled in as valid — with `status` standing in as
		// its first member, which on a real screen unpublishes a live form nobody touched.
		const form = parseForm(new FormData(), FORM);

		expect(form.ok).toBe(false);
	});

	it('is refused when one box it states did not arrive, whatever the schema would have filled in', () => {
		const body = complete();
		body.delete('status');

		const form = parseForm(body, FORM);

		expect(form.ok).toBe(false);
	});

	it('reports the refusal against the form rather than against a box', () => {
		// an absent box is not something an operator can fix, so pinning it on a field would tell
		// them to edit something that is fine. the sentence names the one action that helps.
		const { result } = parseForm(new FormData(), FORM).reject();

		expect(result.status).toBe('error');
		expect(result.error?.['']).toEqual([
			'Reload the page and try again. Part of the form did not submit.'
		]);
	});

	it('accepts a list box that submitted no rows at all', () => {
		// a repeating row editor emptied of its rows submits no key, and that is a value rather than
		// an absence — so the rule that every stated box must arrive cannot be read over one.
		const body = complete();
		body.delete('allowed_origins');

		const form = parseForm(body, FORM);

		expect(form.ok && form.value.allowed_origins).toEqual([]);
	});

	it('is refused by the schema’s own rules once every box has arrived', () => {
		const body = complete();
		body.set('status', 'archived');

		const { result } = parseForm(body, FORM).reject();

		expect(result.error?.status).toHaveLength(1);
	});

	it('accepts a checkbox that was left unticked', () => {
		// an unticked checkbox submits no key, which is the browser's spelling of `false` exactly as
		// an emptied list is its spelling of `[]`. a boolean has two values and absence is one of
		// them, unlike an enum, which stands in as a member nobody chose.
		const withToggle = z.object({ name: z.string(), turnstile_added: z.boolean().default(false) });
		const body = new FormData();
		body.set('name', 'Spring appeal');

		const form = parseForm(body, defineForm({ id: 'a-toggle', schema: withToggle }));

		expect(form.ok).toBe(true);
		expect(form.ok && form.value.turnstile_added).toBe(false);
	});

	it('names the boxes that did not arrive where the operator cannot be told', () => {
		// the sentence an operator reads names nothing, because nothing they can do about it depends
		// on which box it was. the developer's half of that goes to the log, or a screen that fails
		// this way reports a reload and nothing to look at.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const body = complete();
		body.delete('status');

		parseForm(body, FORM);

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('a-form'), ['status']);
		warn.mockRestore();
	});

	it('refuses a row index past the bound on a body’s shape', async () => {
		// the index is the client's to choose and conform builds a sparse array up to it, so an
		// unbounded one is a worker's cpu spent assembling a rejection nobody asked for.
		const body = complete();
		body.append('allowed_origins[100000]', 'https://example.org');

		let thrown: unknown;
		try {
			parseForm(body, FORM);
		} catch (raised) {
			thrown = raised;
		}

		expect((thrown as Response).status).toBe(400);
		await expect((thrown as Response).text()).resolves.toContain('allowed_origins[100000]');
	});

	it('refuses a bracketed name that is not a row', async () => {
		const body = complete();
		body.set('giving[min]', '5');

		let thrown: unknown;
		try {
			parseForm(body, FORM);
		} catch (raised) {
			thrown = raised;
		}

		expect((thrown as Response).status).toBe(400);
		await expect((thrown as Response).text()).resolves.toContain('giving[min]');
	});

	it('refuses a body that names a value inside another', async () => {
		// conform reads `a.b` as a path and builds an object out of it. nothing this app renders
		// writes such a name, so a body carrying one is a client this app did not write — refused as
		// a bad request rather than parsed into a shape the schema would then ignore.
		const body = complete();
		body.set('giving.min', '5');

		let thrown: unknown;
		try {
			parseForm(body, FORM);
		} catch (raised) {
			thrown = raised;
		}

		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(400);
		// the offending name is in the body, because a 4xx nobody renders is read by whoever is
		// holding the request.
		await expect((thrown as Response).text()).resolves.toContain('giving.min');
	});
});

describe('a withheld box', () => {
	// the staff password. every rejection sends the submitted values back so the boxes keep what was
	// typed, so a form that carries a credential has to state it once at the form rather than empty
	// it on the arms that look risky — an arm added later that forgot would be a password rendered
	// into a `value=` attribute with nothing failing. what makes a form state it — the required
	// property, and the empty list that satisfies one — is `defineForm`'s, and
	// ../forms/definition.spec.ts holds it; these two are what a rejection does about it.
	const LOGIN = defineForm({
		id: 'login',
		schema: z.object({ password: z.string() }),
		withheld: ['password']
	});

	it('is not echoed back by a refusal the schema raised', () => {
		const strict = defineForm({
			id: 'login',
			schema: z.object({ password: z.string().min(20) }),
			withheld: ['password']
		});
		const body = new FormData();
		body.set('password', 'hunter2');

		const { result } = parseForm(body, strict).reject();

		expect(JSON.stringify(result)).not.toContain('hunter2');
	});

	it('is not echoed back by a refusal no rule expresses', () => {
		const body = new FormData();
		body.set('password', 'hunter2');
		const form = parseForm(body, LOGIN);

		const { result } = form.reject({ formErrors: ['That password is not this deployment’s.'] });

		expect(form.ok).toBe(true);
		expect(JSON.stringify(result)).not.toContain('hunter2');
	});
});

describe('a rejection', () => {
	it('carries the status and the form it belongs to', () => {
		const rejected = invalid(400, parseForm(new FormData(), FORM).reject());

		expect(rejected.init?.status).toBe(400);
		expect(rejected.data.form.id).toBe('a-form');
	});

	it('marks the form refused even where nothing in the schema did', () => {
		// the arm a parse reports as valid: a write that threw, a row that has gone, a rule no
		// schema states. `reply()` on a submission that parsed cleanly answers `success`, so the
		// status is written here rather than trusted — one call shape for both arms is what stops the
		// second being spelled as the first by a reader who only ever saw the first.
		const form = parseForm(complete(), FORM);

		const rejected = invalid(409, form.reject());

		expect(form.ok).toBe(true);
		expect(rejected.data.form.result.status).toBe('error');
	});

	it('carries anything else the screen needs beside the form', () => {
		// one caller today: the donor form's message about the first/last pair, which belongs to a
		// fieldset rather than to either box in it and so has no field to be keyed by.
		const rejected = invalid(400, parseForm(new FormData(), FORM).reject(), {
			pair: 'Give a first name, a last name, or both.'
		});

		expect(rejected.data.pair).toBe('Give a first name, a last name, or both.');
	});
});

// ---------------------------------------------------------------------------
// which of a screen's forms a body was submitted from, which is the half of the seam a route with
// one `action` and more than one form cannot do without.
//
// the failure it stands in front of is not an exception: a body that named no form, or named one
// this screen does not carry, would otherwise fall to whichever arm was written first and be
// parsed against a schema nobody submitted to.
// ---------------------------------------------------------------------------

/** the three ids a screen states, as an action lists them. */
const SCREEN = ['form-edit-name', 'form-edit-giving', 'form-archive'] as const;

/** a body naming one of a screen's forms, as `whichForm` writes the box. */
function from(id: string): FormData {
	const body = new FormData();
	body.set(WHICH_FORM, id);
	return body;
}

/** the status a refusal carries, off the response the seam throws. */
async function refusal(body: FormData): Promise<{ status: number; sentence: string }> {
	try {
		submittedForm(body, SCREEN);
	} catch (thrown) {
		if (!(thrown instanceof Response)) throw thrown;
		return { status: thrown.status, sentence: await thrown.text() };
	}
	throw new Error('expected the body to be refused');
}

describe('the form a body was submitted from', () => {
	it('is the one the body names', () => {
		expect(submittedForm(from('form-edit-giving'), SCREEN)).toBe('form-edit-giving');
	});

	it('is refused where the body names none, rather than falling to the first arm', async () => {
		// a hand-built body, or markup that forgot the box. the arms of an action are four different
		// writes, so guessing which one was meant is guessing which columns to replace.
		expect((await refusal(new FormData())).status).toBe(400);
	});

	it('is refused where the body names a form this screen does not carry', async () => {
		// a stale tab posting a group that has since been moved to another screen. the sentence names
		// the box, because a 4xx body in this app is read by an agent (CLAUDE.md).
		const { status, sentence } = await refusal(from('form-edit-origins'));

		expect(status).toBe(400);
		expect(sentence).toContain(WHICH_FORM);
	});

	it('reads the box a screen actually writes, so the two halves cannot drift', () => {
		// the browser half states the same constant, which is what keeps this from being a literal
		// spelled twice — `whichForm` in `$lib/admin/use-admin-form.ts`.
		expect(from('form-archive').get(WHICH_FORM)).toBe('form-archive');
	});
});
