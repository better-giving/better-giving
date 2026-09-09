import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { PROGRAM_MODE_NOTES } from '$lib/forms/program-modes';
import { boxErrorId } from '../use-admin-form';
import { FormProgramFields } from './program-fields';

// what the group does as the mode changes, and what the body carries while it does.
//
// in the dom pool because every claim here is about the tree rather than about a value: whether a
// box is still in the document while it is not on the screen, what a body would carry if the form
// were submitted right now, and which element a refusal is said in.
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

const MODE = 'form-edit-program-program_mode';
const PROGRAM = 'form-edit-program-program_id';

const PROGRAMS = [
	{ value: 'prg_water', label: 'Clean water' },
	{ value: 'prg_school', label: 'Scholarships' }
];

type Case = {
	mode?: string;
	programs?: { value: string; label: string }[];
	retired?: { value: string; label: string } | null;
	modeErrors?: string[];
	programErrors?: string[];
};

/**
 * the group as a form screen mounts it, inside the `<form>` that submits it.
 *
 * the form is what makes the body readable: `FormData` over it is what a browser would send, which
 * is the only way to ask whether a box nobody can see is still one of the values the parser is
 * owed.
 */
function group(state: Case = {}): HTMLElement {
	return mount(
		createElement(
			'form',
			null,
			createElement(FormProgramFields, {
				boxes: {
					program_mode: {
						id: MODE,
						name: 'program_mode',
						defaultValue: state.mode ?? 'none',
						...(state.modeErrors === undefined ? {} : { errors: state.modeErrors })
					},
					program_id: {
						id: PROGRAM,
						name: 'program_id',
						defaultValue: '',
						...(state.programErrors === undefined ? {} : { errors: state.programErrors })
					}
				},
				programs: state.programs ?? PROGRAMS,
				retired: state.retired ?? null
			})
		)
	);
}

function select(root: HTMLElement, id: string): HTMLSelectElement {
	const box = root.querySelector(`[id="${id}"]`);
	if (!(box instanceof HTMLSelectElement)) throw new Error(`no select for ${id}`);
	return box;
}

/** whether the program box is on the screen — hidden is a wrapper of the field's, not the field. */
function drawn(root: HTMLElement): boolean {
	return select(root, PROGRAM).closest('[hidden]') === null;
}

/** what the browser would send from where this stands, as the pairs a form posts. */
function submitted(root: HTMLElement): [string, string][] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => [name, String(value)]);
}

function choose(root: HTMLElement, mode: string): void {
	act(() => {
		select(root, MODE).value = mode;
		select(root, MODE).dispatchEvent(new Event('change', { bubbles: true }));
	});
}

it('opens with the heading its sibling groups open with', () => {
	// the group's place in the screen's outline, which the legend below it does not take: a legend
	// is not in the document outline, so a group whose only name was one would be a section a
	// reader moving by heading never lands on.
	expect(group().querySelector('h2')?.textContent).toBe('Program');
});

it('names the fieldset for its question rather than repeating the heading', () => {
	// the legend is what a reader hears the group called, and the heading's word again is the group
	// naming itself twice, one line under the other.
	const root = group();
	const legend = root.querySelector('legend')?.textContent;

	expect(legend).toBe('Where a gift goes');
	expect(legend).not.toBe(root.querySelector('h2')?.textContent);
});

it('keeps the program box in the body while the mode names no program', () => {
	const root = group({ mode: 'none' });

	// off the screen and still in the submission: every box a form states must arrive
	// (`$lib/server/conform.ts`), and the mode the parser reads is the one chosen here rather than
	// the one the record was loaded with.
	expect(drawn(root)).toBe(false);
	expect(submitted(root)).toEqual([
		['program_mode', 'none'],
		['program_id', '']
	]);
});

it('draws the program box for a pinned form, and takes it away again', () => {
	const root = group({ mode: 'none' });

	choose(root, 'pinned');
	expect(drawn(root)).toBe(true);

	// and back: the box a mode change put on the screen is a box the next change takes off it,
	// rather than one that stays because it has been drawn once.
	choose(root, 'none');
	expect(drawn(root)).toBe(false);
});

it('names the program box for what it asks rather than for the group holding it', () => {
	// the heading says `Program` and the legend asks where a gift goes; the box named for the group
	// again is a control announced twice over and a label that has told a reader nothing new.
	const root = group({ mode: 'pinned' });

	expect(root.querySelector(`label[for="${PROGRAM}"]`)?.textContent).toBe('Which program');
});

it('says a program is now being asked for, once the mode change asks for one', () => {
	const root = group({ mode: 'none' });
	const said = root.querySelector('[aria-live="polite"]');

	// empty on arrival: a screen that announced itself as it opened would say this to every
	// operator, including the one whose form names no program at all.
	expect(said?.textContent).toBe('');

	choose(root, 'pinned');
	expect(said?.textContent).toBe('Choose which program below.');

	// and taken back when the box goes: the sentence is a standing fact about the screen rather
	// than a record of what was pressed.
	choose(root, 'none');
	expect(said?.textContent).toBe('');
});

it('draws the program box on a form already pinned to one', () => {
	// seeded from the record rather than reached by a press, which is the state every edit screen
	// opens in.
	expect(drawn(group({ mode: 'pinned' }))).toBe(true);
});

it('says what the chosen mode does to a gift, and follows the choice', () => {
	const root = group({ mode: 'none' });

	// the sentence is the whole difference between the three labels, so a sentence left on the mode
	// the screen opened with is one describing something the operator is no longer choosing.
	expect(root.querySelector(`[id="${MODE}-hint"]`)?.textContent).toBe(PROGRAM_MODE_NOTES.none);

	choose(root, 'choice');
	expect(root.querySelector(`[id="${MODE}-hint"]`)?.textContent).toBe(PROGRAM_MODE_NOTES.choice);
	expect(root.textContent).not.toContain(PROGRAM_MODE_NOTES.none);
});

it('says the mode’s description in the quiet register, on every mode alike', () => {
	const root = group({ mode: 'none' });

	// the hint over the box rather than the standing row under it: every mode carries a
	// description, and the standing row draws a triangle beside its words — which would put a
	// warning against `No program`, the mode every form is saved in until somebody changes it.
	expect(select(root, MODE).getAttribute('aria-describedby')).toBe(`${MODE}-hint`);
	expect(root.querySelector(`[id="${MODE}-note"]`)).toBeNull();
});

it('offers the archived program a form is still pinned to, and says it is retired', () => {
	const root = group({
		mode: 'pinned',
		retired: { value: 'prg_gala', label: 'Gala appeal' }
	});

	const options = [...select(root, PROGRAM).options].map((option) => option.value);
	// last, after the active ones: it is the choice this form holds rather than one on offer.
	expect(options).toEqual(['', 'prg_water', 'prg_school', 'prg_gala']);
	expect([...select(root, PROGRAM).options].at(-1)?.textContent).toBe(
		'No longer offered: Gala appeal'
	);
});

it('says where a program is made when there is none to choose', () => {
	const root = group({ mode: 'pinned', programs: [] });

	// the list is the blank line alone, and the sentence is the errand rather than a refusal:
	// nothing has been pressed and a deployment with no causes is an ordinary state.
	expect([...select(root, PROGRAM).options].map((option) => option.value)).toEqual(['']);
	const described = select(root, PROGRAM).getAttribute('aria-describedby');
	expect(described).toBe(`${PROGRAM}-hint`);
	expect(root.querySelector(`[id="${PROGRAM}-hint"]`)?.textContent).toBe(
		'Add a program under Programs first.'
	);
});

it('says a refusal under the box it belongs to, and marks that box alone', () => {
	const root = group({ mode: 'pinned', programErrors: ['is required'] });

	expect(root.querySelector(`[id="${boxErrorId(PROGRAM)}"]`)?.textContent).toBe('is required');
	expect(select(root, PROGRAM).getAttribute('aria-invalid')).toBe('true');
	expect(select(root, MODE).getAttribute('aria-invalid')).toBeNull();
});

it('draws a marked value in a refusal as code rather than showing the marks', () => {
	const root = group({ modeErrors: ['must be one of `none`, `pinned` or `choice`'] });

	const said = root.querySelector(`[id="${boxErrorId(MODE)}"]`);
	expect(said?.textContent).not.toContain('`');
	expect([...(said?.querySelectorAll('code') ?? [])].map((code) => code.textContent)).toEqual([
		'none',
		'pinned',
		'choice'
	]);
});
