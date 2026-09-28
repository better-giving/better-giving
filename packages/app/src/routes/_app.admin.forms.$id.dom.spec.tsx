import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, redirect } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import DonationForm from './_app.admin.forms.$id';

// a donation form's record, pressed through the redirect every write on it answers with.
//
// what it covers: the four group saves and the archive stay held for the whole navigation a press
// started, and not only its `submitting` half. every one of those writes redirects back onto this
// record, and the router spends the redirect's `loading` phase reading it again with the pressed
// control still on the screen. a press that re-armed there sends a second body carrying the version
// the first one moved past — refused as stale, and that refusal cuts off the landing's revalidation
// — or archives a form already archived. neither is visible to the workers spec beside this file,
// which drives the action and renders nothing.
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

const FORM_ID = 'frm_redirectphase1';
const RECORD = `/admin/forms/${FORM_ID}`;

type Loaded = Parameters<typeof DonationForm>[0]['loaderData'];

/** a draft form on a deployment ready to publish it, with nothing just landed. */
function record(confirmArchive: boolean): Loaded {
	const values = {
		name: 'Spring appeal',
		status: 'draft',
		program_mode: 'none',
		program_id: '',
		min_minor: '5',
		max_minor: '100',
		suggested_amounts: ['25'],
		allowed_origins: ['https://example.org']
	};
	return {
		id: FORM_ID,
		name: values.name,
		status: 'draft',
		currency: 'USD',
		archived: false,
		editor: {
			nameBoxes: { name: values.name, status: 'draft' },
			programBoxes: { program_mode: 'none', program_id: '' },
			givingBoxes: { min_minor: '5', max_minor: '100', suggested_amounts: ['25'] },
			originsBoxes: { allowed_origins: ['https://example.org'] }
		},
		values,
		snippet: '<script src="https://example.org/embed.js"></script>',
		readiness: null,
		sites: ['https://example.org'],
		programs: [],
		retiredProgram: null,
		programMode: 'none',
		pinnedProgram: null,
		liveOffered: true,
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
			path: '/admin/forms/:id',
			loader: () => new Promise<never>(() => {}),
			Component: () =>
				createElement(DonationForm as never, {
					loaderData: record(confirmArchive),
					actionData: undefined,
					params: { id: FORM_ID },
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
 * types into a box the way a keystroke does, which is what makes its group's save pressable: a
 * group holding nothing to save draws its button closed.
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

it('holds the pressed save through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen();
	type(root, 'name', 'Spring appeal 2026');
	const save = buttonReading(root, 'Save name and status');

	await press(save);
	expect(posted).toEqual(['form-edit-name']);
	// the action has answered and the record is being read again: the press is still this one's.
	expect(save.getAttribute('aria-disabled')).toBe('true');

	await press(save);
	expect(posted).toEqual(['form-edit-name']);
});

it('holds every other group’s save through that loading too', async () => {
	const { root, posted } = screen();
	type(root, 'name', 'Spring appeal 2026');
	type(root, 'max_minor', '200');

	await press(buttonReading(root, 'Save name and status'));
	const giving = buttonReading(root, 'Save what a donor may give');
	expect(giving.getAttribute('aria-disabled')).toBe('true');

	// the body carries the version the name save has just moved past, so it is refused as stale.
	await press(giving);
	expect(posted).toEqual(['form-edit-name']);
});

it('holds the archive through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen({ confirmArchive: true });
	const archive = buttonReading(root, 'Yes, archive this form');

	await press(archive);
	expect(posted).toEqual(['form-archive']);
	expect(archive.getAttribute('aria-disabled')).toBe('true');

	// a second archive is refused as already archived, over a form still drawn as editable.
	await press(archive);
	expect(posted).toEqual(['form-archive']);
});
