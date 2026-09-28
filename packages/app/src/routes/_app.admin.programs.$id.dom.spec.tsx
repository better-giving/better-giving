import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, redirect } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import Program from './_app.admin.programs.$id';

// a program's record, pressed through the redirect every write on it answers with.
//
// what it covers: the save and the archive stay held for the whole navigation a press started, and
// not only its `submitting` half. both redirect back onto this record, and the router spends the
// redirect's `loading` phase reading it again with the pressed control still on the screen. a save
// that re-armed there sends a second body carrying the version the first one moved past, refused as
// stale; an archive that re-armed archives a program already archived. neither is visible to the
// workers spec beside this file, which drives the action and renders nothing.
//
// mounted rather than rendered to a string, because the phase is the router's and exists only
// between a press and a landing. it is not the browser spec CLAUDE.md bans over a dashboard
// screen: nothing here reads a computed style or a class.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

const PROGRAM_ID = '019fb700-0000-7000-8000-000000000301';
const RECORD = `/admin/programs/${PROGRAM_ID}`;

type Loaded = Parameters<typeof Program>[0]['loaderData'];

/** an active program with nothing just landed. */
function record(confirmArchive: boolean): Loaded {
	return {
		id: PROGRAM_ID,
		name: 'Winter Shelter',
		description: 'Beds and a hot meal through the cold months.',
		status: 'active',
		archived: false,
		editor: {
			name: 'Winter Shelter',
			description: 'Beds and a hot meal through the cold months.'
		},
		saved: null,
		archivedJustNow: false,
		confirmArchive,
		version: 1_790_000_000_000
	} as unknown as Loaded;
}

/**
 * the record under a router whose action answers every press with a redirect back onto it, and
 * whose loader for it never settles — the `loading` phase a real write spends reading the record
 * again, held open. hydrated, so the first render reaches no loader.
 *
 * `posted` is the form each body named, in the order the action received them.
 */
function screen({ confirmArchive = false } = {}): { root: HTMLElement; posted: string[] } {
	const posted: string[] = [];
	const Stub = createRoutesStub([
		{
			id: 'record',
			path: '/admin/programs/:id',
			loader: () => new Promise<never>(() => {}),
			Component: () =>
				createElement(Program as never, {
					loaderData: record(confirmArchive),
					actionData: undefined,
					params: { id: PROGRAM_ID },
					matches: []
				}),
			action: async ({ request }) => {
				posted.push(String((await request.formData()).get(WHICH_FORM)));
				return redirect(RECORD);
			}
		}
	]);
	const root = mount(
		createElement(Stub, {
			initialEntries: [confirmArchive ? `${RECORD}?confirm=archive` : RECORD],
			hydrationData: { loaderData: { record: null } }
		})
	);
	return { root, posted };
}

/** the button reading `label`, found the way an operator finds it. */
function buttonReading(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
	if (found === undefined) throw new Error(`the screen drew no button reading "${label}"`);
	return found;
}

/**
 * types into a box the way a keystroke does, which is what makes the save pressable: a group
 * holding nothing to save draws its button closed.
 */
function type(root: HTMLElement, name: string, value: string): void {
	const box = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
	if (box === null) throw new Error(`the screen drew no box named "${name}"`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/** presses a control, then lets the router carry the press through its action and on. */
async function press(button: HTMLButtonElement): Promise<void> {
	await act(async () => button.click());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

it('holds the save through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen();
	type(root, 'name', 'Winter Shelter 2026');
	const save = buttonReading(root, 'Save program');

	await press(save);
	expect(posted).toEqual(['program-edit']);
	// the action has answered and the record is being read again: the press is still this one's.
	expect(save.getAttribute('aria-disabled')).toBe('true');

	// the body carries the version the first save has just moved past, so it is refused as stale.
	await press(save);
	expect(posted).toEqual(['program-edit']);
});

it('holds the archive through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen({ confirmArchive: true });
	const archive = buttonReading(root, 'Yes, archive this program');

	await press(archive);
	expect(posted).toEqual(['program-archive']);
	expect(archive.getAttribute('aria-disabled')).toBe('true');

	// a second archive is refused as already archived, over a program still drawn as editable.
	await press(archive);
	expect(posted).toEqual(['program-archive']);
});
