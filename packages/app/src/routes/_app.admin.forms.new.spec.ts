import { RouterContextProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { FormInputField } from '$lib/forms/fields';
import { action } from './_app.admin.forms.new';

// a node spec, not a workers one, and the split is CLAUDE.md's: what is asserted here is the half
// of the save that returns before the database is reached, so there is nothing for a real D1 to
// prove. the request context below is deliberately empty — a submission the parser rejects that
// still reached for a handle would be the bug this file catches, and reaching for one on an empty
// context throws. everything past the parser lives in `_app.admin.forms.new.workers.spec.ts` beside
// it.
//
// every case reads its refusal off one shape, reconciled once in `save` below. three of the four
// keys are a reading of conform's submission result and the fourth is a decision:
//
// `valid` — conform answers `status: 'error'` for every rejection `invalid()` builds, which is the
// rule that helper exists for (`$lib/server/conform.ts`).
//
// `errors` — one list per field, with the whole form's own sentences under the empty key rather
// than beside them, which is why they are separated out here.
//
// `message` — the banner over the form. this action attaches one on two arms: the write that failed,
// which answers 500, and the ledger's refusal, which answers 400 and is a workers case because it
// reads the deployment. the other sentence that can reach the empty key is the form layer's own
// "part of the form did not submit" — `parseForm`'s answer to a body that never carried the form —
// and it is not this action's banner, which is why the banner is read off the 500 arm alone here.
//
// `data` — what was typed, which conform carries as the submission's initial value. it is the
// submitted payload rather than the schema's output, so a key the form does not state comes back in
// it; nothing on the screen is named for one, so nothing renders it.

/**
 * a key a refusal may arrive under: a box, or one row of the amounts editor.
 *
 * a row is an `<input>` with an indexed name — `suggested_amounts[1]` — which is the key
 * `suggestedAmountsRule` in `$lib/forms/input-schema.ts` pushes its issue at and the one a screen's
 * `getFieldList()` row reads its errors from. it is not a `FormInputField`, because it is not a
 * field of the form: it is one box of one.
 */
type RefusedBox = FormInputField | `suggested_amounts[${number}]`;

/** what a rejected save hands back, as the four keys above read it. */
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
 * bracket a submitted body may hold (`$lib/server/conform.ts`) — and the sites are a checkbox group,
 * so each ticked box repeats one name. a value stated as an empty list is a box the browser did not
 * send at all, which is what an unticked group and a box with no control are.
 */
function bodyOf(fields: Record<string, string | string[]>): FormData {
	const body = new FormData();
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
 * posts a body at the action and returns what it handed back.
 *
 * a real `Request` rather than a stubbed `formData()`, because reading the body exactly once is one
 * of the things this route owes CLAUDE.md and a stub would let a second read pass.
 */
async function save(fields: Record<string, string | string[]>) {
	const request = new Request('http://localhost/admin/forms/new', {
		method: 'POST',
		body: bodyOf(fields)
	});

	const returned = (await action({
		request,
		context: new RouterContextProvider()
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

/** a submission that parses, so each case states only what it is about. */
function submission(
	over: Record<string, string | string[]> = {}
): Record<string, string | string[]> {
	return {
		name: 'Gala 2026',
		status: 'live',
		suggested_amounts: ['25.00', '50.00'],
		min_minor: '5.00',
		max_minor: '10000.00',
		allowed_origins: ['https://acme.org'],
		program_mode: 'none',
		program_id: '',
		...over
	};
}

/** the one message a box shows, which is the last of them. */
function under(data: SaveFailure, field: RefusedBox) {
	return data.form.errors[field]?.at(-1);
}

describe('/admin/forms/new save — what never reaches the database', () => {
	it('refuses a form with nothing filled in, naming every box at once', async () => {
		// the state the create screen opens in, submitted. one problem per round trip is how a form
		// takes as many submissions as it has fields, so every offending box comes back together —
		// and none of it reached a handle that is not there.
		const { status, data } = await save({});
		expect(status).toBe(400);
		expect(data.form.valid).toBe(false);
		// a write that failed is a banner, and there was no write.
		expect(data.form.message).toBeUndefined();
		// the sites are deliberately not on this list. a group with nothing ticked submits no key at
		// all and `.prefault([])` feeds that absence through the schema, which states nothing about an
		// empty list: a form on no site loads on this deployment's own donation page. the one
		// arrangement that is nowhere reads the env and is the action's, past the handle this file
		// does not have.
		expect(Object.keys(data.form.errors).sort()).toEqual([
			'max_minor',
			'min_minor',
			'name',
			'program_mode',
			'status'
		]);
	});

	/**
	 * the empty POST's one field that only "every stated box must arrive" refuses, and the reason
	 * that rule exists.
	 *
	 * without it the schema fills a key the request did not carry from its own type, and for an enum
	 * that is its *first member* — `status` starts at `draft` — so this body would arrive as a draft
	 * form nobody chose the status of and save. every other box on this form is refused either way,
	 * because a blank fails its own length rule; `status` is the whole of what the rule buys here,
	 * and it is enough.
	 */
	it('refuses a body carrying everything but the status, which a filled-in default would hide', async () => {
		const { status: httpStatus, data } = await save(submission({ status: [] }));
		expect(httpStatus).toBe(400);
		expect(data.form.valid).toBe(false);
		expect(under(data, 'status')).toBeTypeOf('string');
		// the write is what must not have happened, and its banner is how it would show.
		expect(data.form.message).toBeUndefined();
	});

	/**
	 * the rails are not a box on this form, so a body carrying them is carrying a key nothing reads.
	 *
	 * what a donor is offered is `OFFERED_PAYMENT_METHODS` in `$lib/forms/offered-rails.ts` and no
	 * submission moves it: the schema states no such box, so nothing it parses carries one, and the
	 * action reads the body only through the boxes the form states. the rejection echoes the whole
	 * submitted payload back — that is conform's contract rather than an oversight — and no control
	 * on the screen is named for it, so nothing renders it and nothing is keyed to it.
	 *
	 * the body is otherwise the empty one the first case here uses, so the save is refused before a
	 * database handle that is not there is reached.
	 */
	it('reports nothing about a rails field a body carries, and keys no box to it', async () => {
		const { data } = await save({ payment_methods: ['bitcoin'] });
		expect(Object.keys(data.form.errors)).not.toContain('payment_methods');
		expect(JSON.stringify(data.form.errors)).not.toContain('bitcoin');
	});

	it('sends back what was typed, so a rejected save does not clear the whole form', async () => {
		// re-typing nine fields because one amount had a third decimal place in it is how an operator
		// gives up on the page. the form layer carries it on the rejection, which is what the boxes on
		// the page are seeded from.
		const { data } = await save(submission({ min_minor: '25.005' }));
		expect(under(data, 'min_minor')).toBeTypeOf('string');
		expect(data.form.data).toMatchObject({
			name: 'Gala 2026',
			status: 'live',
			min_minor: '25.005',
			max_minor: '10000.00',
			suggested_amounts: ['25.00', '50.00']
		});
	});

	/**
	 * the rules that are not decidable from one submitted value, routed to the box each one is about.
	 *
	 * each rule pushes its own issue from inside the schema. the amounts' is an object-level check
	 * because every amount is measured against what the two bound boxes parsed to, which a rule on
	 * the key cannot see.
	 *
	 * this case is also what pins the two of them arriving *together*. zod skips an object check over
	 * a value one of whose fields aborted, and an issue pushed from a `.check()` aborts by default —
	 * so a bad origin would take the amounts message down with it unless the sites rule says
	 * `continue: true`, and an operator would be told the second thing only after fixing the first.
	 */
	it('routes a bad site to the sites box and an out-of-range amount to the amounts box', async () => {
		const { status, data } = await save(
			submission({ allowed_origins: 'https:', suggested_amounts: ['1.00'] })
		);
		expect(status).toBe(400);
		// a scheme with no address after it, which is the one thing `readRow` cannot repair.
		expect(under(data, 'allowed_origins')).toBe('invalid url');
		// below this form's own smallest gift of $5.00, which no rule about one box can know — under
		// the row holding the figure, because each row is an input with a name of its own.
		expect(under(data, 'suggested_amounts[0]')).toContain('$5');
	});

	it('says nothing about the amounts when a bound is the thing that cannot be read', async () => {
		// the other half of that flag, and the reason the two bound rules keep the abort every other
		// rule in the schema drops: the bounds are the ruler every amount is measured against, so an
		// operator who mistyped the largest gift must not also be told their amounts are out of a
		// range nobody set. the box they have to fix is the one that carries a sentence.
		//
		// it is also what `isTextField` in the action buys: the parser measures every amount whatever
		// the bounds did, and keying its list messages would put this sentence back.
		const { status, data } = await save(
			submission({ max_minor: 'lots', suggested_amounts: ['1.00'] })
		);
		expect(status).toBe(400);
		expect(under(data, 'max_minor')).toContain('must be an amount');
		expect(under(data, 'suggested_amounts[0]')).toBeUndefined();
		expect(under(data, 'suggested_amounts')).toBeUndefined();
	});

	it('sends back every amount box that was typed, so a rejected save does not collapse the group', async () => {
		// the amounts are a repeating row editor, so what has to survive a refusal is the rows and not
		// one string: a group that came back with three boxes as one is a group an operator has to
		// re-type.
		//
		// the refusal is the amounts' own rather than a blank box elsewhere on the form, and that is
		// not incidental: the form layer strips an empty box to `undefined`
		// (`$lib/server/conform.ts`), which fails the box's type check, and zod does not run an
		// object-level check over a value one of whose fields aborted — so a body with a blank name
		// *and* a mistyped amount is answered about the name alone. the group's rule is that
		// object-level check, so a case forcing the refusal from another box would be asserting a
		// sentence this form cannot produce.
		const { data } = await save(submission({ suggested_amounts: ['25.00', 'lots', '50.00'] }));
		expect(data.form.data.suggested_amounts).toEqual(['25.00', 'lots', '50.00']);
		expect(under(data, 'suggested_amounts[1]')).toContain('must be an amount');
	});

	it('accepts an amount row cleared to blank, which is a suggestion taken away', async () => {
		// a row the operator emptied rather than one the screen drew: `NEW_FORM` seeds three
		// suggestions, and a fundraiser who wants none clears them. the form layer
		// strips an empty box to `undefined`, so the row arrives as no value rather than as the empty
		// string — and a list rule that refused that would refuse this screen's own opening state,
		// under a per-row key the group draws no message for. the blank is not a value:
		// `readSuggestedAmounts` in `$lib/forms/amounts.ts` drops a row nobody typed into.
		//
		// what "it got that far" looks like on this screen: past the parse, the action reaches for the
		// handle this file's context deliberately does not hold, and reaching for one on an empty
		// context throws. a refusal would have come back as a 400 instead.
		await expect(save(submission({ suggested_amounts: [''] }))).rejects.toThrow();
	});

	it('says one thing per box, whichever of the schema and the parser refused it', async () => {
		// both stages state the rule about a name, so a value neither accepts must not come back as
		// the same sentence twice under one label.
		const { data } = await save(submission({ name: '' }));
		expect(data.form.errors.name).toHaveLength(1);
	});

	it('names no table or column in a message an operator can reach', async () => {
		// CLAUDE.md: schema vocabulary never reaches a screen. the field name is in the error key,
		// which is what a machine reads; the value is a sentence a person reads. `revenue_account` is
		// on the list although no box posts it: the column is still there and a message that named it
		// would be schema vocabulary either way.
		const { data } = await save({
			name: '',
			status: 'archived',
			min_minor: '25.005',
			max_minor: '',
			suggested_amounts: ['25.005'],
			frequencies: ['weekly'],
			allowed_origins: 'https:'
		});

		const identifiers = ['revenue_account', 'archived_at', 'allowed_origins', 'min_minor'];
		const messages = Object.keys(data.form.errors).map((field) => under(data, field as RefusedBox));
		expect(messages.length).toBeGreaterThan(0);
		for (const message of messages) {
			for (const identifier of identifiers) {
				expect(message, `a message leaked \`${identifier}\``).not.toContain(identifier);
			}
		}
	});
});
