import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { boxErrorId } from '../use-admin-form';
import { ProgramFields } from './fields';

// what a program's two boxes are bound to, and where a refusal about one of them is said.
//
// in the dom pool because every claim is a relationship in the tree: the name a body carries a box
// under, which element a sentence is in, and which control an `aria-invalid` sits on.
//
// nothing here reads a class or asks how any of it looks, which is what keeps it clear of
// CLAUDE.md's ban on a browser spec over a dashboard screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const NAME = 'program-edit-name';
const DESCRIPTION = 'program-edit-description';

/** the group as the screen that makes a program and the screen that edits one both mount it. */
function group(errors: { name?: string[]; description?: string[] } = {}): HTMLElement {
	return mount(
		createElement(
			'form',
			null,
			createElement(ProgramFields, {
				boxes: {
					name: {
						id: NAME,
						name: 'name',
						defaultValue: 'Clean water',
						...(errors.name === undefined ? {} : { errors: errors.name })
					},
					description: {
						id: DESCRIPTION,
						name: 'description',
						defaultValue: 'Wells and filters in the eastern districts.',
						...(errors.description === undefined ? {} : { errors: errors.description })
					}
				}
			})
		)
	);
}

function box(root: HTMLElement, id: string): HTMLElement {
	const found = root.querySelector(`[id="${id}"]`);
	if (!(found instanceof HTMLElement)) throw new Error(`no box for ${id}`);
	return found;
}

/** what the browser would send, as the pairs a form posts. */
function submitted(root: HTMLElement): [string, string][] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => [name, String(value)]);
}

it('binds both boxes by the name a body carries them under, holding what was typed', () => {
	const root = group();

	expect(submitted(root)).toEqual([
		['name', 'Clean water'],
		['description', 'Wells and filters in the eastern districts.']
	]);
});

it('takes the description in a box a sentence fits in', () => {
	// a single line hides every word but the last few typed, and what goes in this box is a
	// sentence.
	expect(box(group(), DESCRIPTION).tagName).toBe('TEXTAREA');
	expect(box(group(), NAME).tagName).toBe('INPUT');
});

it('says which of the two boxes a donor reads', () => {
	const root = group();

	// the one fact neither label nor box can carry: it is about a donation form on somebody else's
	// site, so there is nothing on this screen that could demonstrate it.
	const described = box(root, DESCRIPTION).getAttribute('aria-describedby');
	expect(described).toBe(`${DESCRIPTION}-hint`);
	expect(root.querySelector(`[id="${DESCRIPTION}-hint"]`)?.textContent).toBe(
		'For your team. Donors see only the name.'
	);
});

it('says a refusal under the box it belongs to, and marks that box alone', () => {
	const root = group({ name: ['is required'] });

	expect(root.querySelector(`[id="${boxErrorId(NAME)}"]`)?.textContent).toBe('is required');
	expect(box(root, NAME).getAttribute('aria-invalid')).toBe('true');
	// and the box nobody was refused about reads as fine: no mark, and no message element of its
	// own for a description to name.
	expect(box(root, DESCRIPTION).getAttribute('aria-invalid')).toBeNull();
	expect(root.querySelector(`[id="${boxErrorId(DESCRIPTION)}"]`)).toBeNull();
});

it('keeps the standing sentence beside a refusal rather than instead of it', () => {
	const root = group({ description: ['cannot be blank'] });

	// both are reachable from the box at once: the refusal says what the last press answered with
	// and the hint says what the box is for, and the one that would disappear is the second.
	expect(box(root, DESCRIPTION).getAttribute('aria-describedby')).toBe(
		`${DESCRIPTION}-hint ${boxErrorId(DESCRIPTION)}`
	);
});

it('draws a marked value in a refusal as code rather than showing the marks', () => {
	const root = group({ name: ['`Clean water` is already a program'] });

	const said = root.querySelector(`[id="${boxErrorId(NAME)}"]`);
	expect(said?.textContent).not.toContain('`');
	expect(said?.querySelector('code')?.textContent).toBe('Clean water');
});
