import { Field } from '@better-giving/operator/components/forms/Field';
import { getFormProps, getInputProps } from '@conform-to/react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { reachesServerTree } from '../../routes.testing';
import {
	boxProps,
	insertWhenValid,
	resultFor,
	useAdminForm,
	whichForm,
	type AdminActionData
} from './use-admin-form';

// the half of the browser seam a screen cannot get wrong once, and gets wrong once per form
// otherwise: which of an action's results belongs to which of a screen's forms.
//
// a two-form screen, because that is the case the match exists for — /admin/forms/[id] carries
// three. one form's rejection reaching the other is not a visible failure: the second form renders
// the first's messages under boxes that are fine, over values nobody submitted.
//
// the forms below are a fixture rather than one of the screens: a screen is its own slice and would
// be built without its design, and what is under test here is the routing rather than any screen's
// boxes.

const NAME = defineForm({ id: 'form-name', schema: z.object({ name: z.string() }) });
const GIVING = defineForm({ id: 'form-giving', schema: z.object({ minimum: z.string() }) });

/** what an action returns through `invalid()`, as the component is handed it. */
function refused(id: string) {
	return {
		form: { id, result: { status: 'error' as const, error: { name: ['Give it a name.'] } } }
	};
}

describe('an action’s result', () => {
	it('reaches the form that owns it', () => {
		expect(resultFor(NAME, refused('form-name'))?.error).toEqual({ name: ['Give it a name.'] });
	});

	it('does not reach the other form on the screen', () => {
		// the failure this exists for: the second form would render the first's messages under boxes
		// that are fine, over values nobody submitted into it.
		expect(resultFor(GIVING, refused('form-name'))).toBeUndefined();
	});

	it('is nothing before anything has been submitted', () => {
		expect(resultFor(NAME, undefined)).toBeUndefined();
	});

	it('is nothing where the action answered with no form at all', () => {
		// an action may answer a screen with something that is not a rejection — a redirect leaves
		// `actionData` undefined, and a row editor's own reply carries whatever that screen needs.
		expect(resultFor(NAME, { saved: 'form-name' } as never)).toBeUndefined();
	});

	it('rides alongside whatever else the action sent', () => {
		// `invalid()`'s third argument: a message belonging to a fieldset rather than to a box.
		const answered = { ...refused('form-name'), pair: 'Give a first name, a last name, or both.' };

		expect(resultFor(NAME, answered)?.status).toBe('error');
	});
});

describe('the seam and the browser bundle', () => {
	// the boundary react router keeps none of. everything this module is handed is evaluated in the
	// browser, so a reach into the server tree from here would put D1, the stripe client and this
	// deployment's secrets into the bundle a visitor downloads — and it would do it once for every
	// screen rather than once. asserted over the module graph rather than over a call's own text,
	// which is what ../../routes.spec.ts holds every route module to.
	it('reaches nothing under $lib/server', () => {
		expect(reachesServerTree('lib/admin/use-admin-form.ts')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// the other half a screen cannot get wrong once and gets wrong once per box: which of the two
// things computing an `aria-describedby` for a field is allowed to reach the control.
//
// the cases below render the real pair — `boxProps`'s output into the library's own `Field` — and
// read the markup back, because the failure is not an exception and not a type error. it is an
// attribute pointing at an element id that is nowhere on the page, which renders, hydrates and
// looks correct to everyone except the reader following it.
// ---------------------------------------------------------------------------

/** a two-box form, so "the first box that failed" is a claim rather than "the only box". */
const PAIR = defineForm({
	id: 'form-pair',
	schema: z.object({ first_name: z.string(), last_name: z.string() })
});

/** the markup the server sends, which is also what hydration starts from. */
function render(node: ReactElement): string {
	return renderToStaticMarkup(node);
}

/**
 * every `aria-describedby` token in the markup naming no element in it.
 *
 * the whole defect in one function, and it is a sweep rather than a match against an expected
 * string: what makes a description wrong is not its spelling but that nothing answers to it, and a
 * case asserting the spelling would go on passing after the library renamed the element.
 */
function dangling(html: string): string[] {
	const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((found) => found[1] as string));
	return [...html.matchAll(/\baria-describedby="([^"]*)"/g)]
		.flatMap((found) => (found[1] as string).split(/\s+/))
		.filter((token) => token !== '' && !ids.has(token));
}

/**
 * the box conform's own focus move lands on, run over the rendered markup.
 *
 * it is conform's algorithm and not a paraphrase of it: on a result carrying errors its form
 * controller walks `formElement.elements` and focuses the first field element whose `name` is a key
 * in the error map (`report` in @conform-to/dom's form.js). so what the move needs from a box is
 * its `name` and nothing else — not the props helper, which is what the spread was thought to be
 * for — and a seam that dropped the name would leave a failed submit with the reader at the button
 * and the message above them off screen.
 */
function focused(html: string, error: Record<string, string[]>): string | undefined {
	for (const control of html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
		const name = /\bname="([^"]*)"/.exec(control[0])?.[1];
		if (name !== undefined && error[name] !== undefined) return name;
	}
	return undefined;
}

/** a rejection of the pair form, keyed to whichever boxes a case is about. */
function pairRefused(error: Record<string, string[]>, typed: Record<string, string> = {}) {
	return {
		form: { id: PAIR.id, result: { status: 'error' as const, error, initialValue: typed } }
	};
}

/** one box, bound the way the seam says a box is bound, inside the form conform describes. */
function Screen({
	actionData,
	describedBy,
	refused
}: {
	readonly actionData: AdminActionData;
	readonly describedBy?: string;
	readonly refused?: boolean;
}) {
	const [form, fields] = useAdminForm(NAME, actionData);
	return createElement(
		'form',
		getFormProps(form),
		createElement(Field, {
			label: 'Name',
			...boxProps(fields.name, {
				...(describedBy === undefined ? {} : { describedBy }),
				...(refused === undefined ? {} : { refused })
			})
		}),
		describedBy === undefined
			? null
			: createElement('p', { id: describedBy }, 'Either one on its own is fine.')
	);
}

/** the same box bound the way a screen writes it when nobody has decided this once. */
function SpreadScreen({ actionData }: { readonly actionData: AdminActionData }) {
	const [form, fields] = useAdminForm(NAME, actionData);
	return createElement(
		'form',
		getFormProps(form),
		createElement(Field, {
			label: 'Name',
			error: fields.name.errors?.[0],
			...getInputProps(fields.name, { type: 'text' })
		})
	);
}

/** the pair form's two boxes, both bound through the seam. */
function PairScreen({ actionData }: { readonly actionData: AdminActionData }) {
	const [form, fields] = useAdminForm(PAIR, actionData);
	return createElement(
		'form',
		getFormProps(form),
		createElement(Field, { label: 'First name', ...boxProps(fields.first_name) }),
		createElement(Field, { label: 'Last name', ...boxProps(fields.last_name) })
	);
}

describe('the description on a box', () => {
	it('names only elements the field renders', () => {
		const html = render(createElement(Screen, { actionData: refused(NAME.id) }));

		// not vacuous: the box is described, and everything it names is on the page.
		expect(html).toContain('aria-describedby');
		expect(dangling(html)).toEqual([]);
	});

	it('is the library’s, so conform’s never reaches the control', () => {
		// the defect, rendered. conform composes a description from its own `errorId` and expects
		// the screen to have drawn that element; the library draws one of its own and names it from
		// the `id` it was handed. spread conform's props onto the field and conform's wins through
		// `...rest`, so the control points at an element nothing on the page answers to.
		const html = render(createElement(SpreadScreen, { actionData: refused(NAME.id) }));

		expect(dangling(html)).not.toEqual([]);
	});

	it('marks the box refused when the message is the group’s', () => {
		// the other half of the same fact: a box whose only failure belongs to the pair carries no
		// message of its own, so nothing inside the field knows it is refused. it still has to read
		// refused — either box fixes the pair and neither one is the wrong one.
		const group = 'name-group-error';
		const html = render(
			createElement(Screen, { actionData: undefined, describedBy: group, refused: true })
		);

		expect(html).toContain('aria-invalid="true"');
		expect(dangling(html)).toEqual([]);
	});

	it('takes in a message the field cannot see, rather than being replaced by it', () => {
		// the case the seam is for: a message belonging to a fieldset rather than to either box in
		// it. the box keeps its own message *and* names the group's, because a box carrying one
		// rule it broke and one the pair broke has two things said about it.
		const group = 'name-group-error';
		const html = render(
			createElement(Screen, { actionData: refused(NAME.id), describedBy: group })
		);
		const named = /aria-describedby="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];

		expect(named).toContain(group);
		expect(named.length).toBe(2);
		expect(dangling(html)).toEqual([]);
	});
});

describe('a failed submit’s focus', () => {
	it('lands on the first box that failed, not the first box', () => {
		const error = { last_name: ['Shorten this.'] };
		const html = render(createElement(PairScreen, { actionData: pairRefused(error) }));

		expect(focused(html, error)).toBe('last_name');
	});

	it('has a form element to be found in', () => {
		// conform looks the form up by id (`document.forms.namedItem(formId)`), so a screen that
		// did not put `getFormProps`' id on its `<form>` gets no focus move at all — silently,
		// since nothing throws and the errors still render.
		const html = render(
			createElement(PairScreen, { actionData: pairRefused({ first_name: ['x'] }) })
		);

		expect(html).toContain(`<form id="${PAIR.id}"`);
	});
});

describe('a rejected submission’s values', () => {
	it('come back in the boxes, so nothing has to be typed again', () => {
		const html = render(
			createElement(PairScreen, {
				actionData: pairRefused({ last_name: ['Shorten this.'] }, { first_name: 'Ada' })
			})
		);

		expect(html).toContain('value="Ada"');
	});
});

describe('the box that names which form was submitted', () => {
	it('is hidden, so it is a fact about the body rather than a control', () => {
		expect(whichForm(NAME.id)).toEqual({ type: 'hidden', name: WHICH_FORM, value: 'form-name' });
	});
});

describe('the Add button of a row editor', () => {
	/**
	 * a form with a list in it, as a screen states one.
	 *
	 * separate from the two fixtures above, which have no list to add a row to.
	 */
	const TILES = defineForm({
		id: 'form-tiles',
		schema: z.object({ tiles: z.array(z.string().default('')).prefault([]) })
	});

	it('is conform’s own intent, with the guard added rather than standing in for it', () => {
		// the four attributes are what makes the press an insert at all — drop one and the button
		// posts the form instead of moving a row. what the guard adds is a fifth thing, so the press
		// still carries the intent it always did on every list that is fine.
		let props: ReturnType<typeof insertWhenValid> | undefined;
		function Screen() {
			const [form, fields] = useAdminForm(TILES, undefined);
			props = insertWhenValid(form, TILES, fields.tiles.name);
			return createElement('form', getFormProps(form));
		}
		renderToStaticMarkup(createElement(Screen));

		expect(props?.name).toBe('__intent__');
		expect(props?.value).toContain('insert');
		expect(props?.value).toContain('tiles');
		expect(props?.form).toBe('form-tiles');
		expect(props?.formNoValidate).toBe(true);
		// whether the press goes through is decided against a live form, so it is asserted in the
		// dom pool — ./use-admin-form.dom.spec.tsx.
		expect(props?.onClick).toBeTypeOf('function');
	});
});
