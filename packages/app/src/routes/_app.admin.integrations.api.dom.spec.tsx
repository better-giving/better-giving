import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, redirect } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Api from './_app.admin.integrations.api';

// what the API page does with the answers its action gives: the key shown once in the card, and a
// refused name reported at the box with the caret put there. the server half is
// ./_app.admin.integrations.api.workers.spec.ts; what is asserted here is words, focus and which
// element is on the page, never a class or a computed style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `appendChild` for the reason ./_app.admin.members.dom.spec.tsx gives. */
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

const KEY = 'bgk_7Qm2Xc9Lr4Tz8Vh1Nw6Pd3Ks5Yb0EjRaQm2Xc9L';

const LISTED = {
	id: 'key-1',
	name: 'Reporting sheet',
	madeAt: '2026-09-28T12:00:00.000Z',
	madeOn: '28 Sep 2026',
	lastUsedAt: null,
	lastUsedOn: 'Never'
};

function screen(over: { keys?: readonly object[]; actionData?: object } = {}): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/api',
			Component: () =>
				createElement(Api as never, {
					loaderData: { keys: over.keys ?? [LISTED], revoking: null, revoked: null },
					actionData: over.actionData,
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/integrations/api'] }));
}

/** the one dialog on the page, wherever the top layer put it. */
const card = () => document.querySelector('dialog');

it('shows the key it made once, titled for the key’s name', () => {
	screen({ actionData: { made: { name: 'Reporting sheet', key: KEY } } });

	expect(card()?.querySelector('h2')?.textContent).toBe('Copy the key for Reporting sheet');
	expect(card()?.textContent).toContain(KEY);
	expect(card()?.textContent).toContain('It won’t be shown again.');
});

it('keeps the card down once Done is pressed, though the page still holds the answer', () => {
	screen({ actionData: { made: { name: 'Reporting sheet', key: KEY } } });
	const doneButton = [...(card()?.querySelectorAll('button') ?? [])].find(
		(button) => button.textContent === 'Done'
	);
	if (!doneButton) throw new Error('the card drew no Done');

	act(() => doneButton.click());

	expect(card()).toBeNull();
	expect(document.body.textContent).not.toContain(KEY);
});

it('draws no card and no key where no key was made', () => {
	const root = screen();

	expect(card()).toBeNull();
	expect(root.textContent).toContain('Reporting sheet');
});

it('says there are no keys yet on an empty list', () => {
	expect(screen({ keys: [] }).textContent).toContain('No keys yet');
});

/**
 * the page over a loader and an action standing in for the route's own, so a press runs the whole
 * round: the make answers its key, and the revoke takes the row away and redirects to a load that
 * names it — which is what the route's server half does (the workers spec beside this one).
 */
async function flow(at: string): Promise<HTMLElement> {
	let keys = [LISTED];
	let revoked: string | null = null;
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: Api as never,
			loader: ({ request }) => {
				const asked = new URL(request.url).searchParams.get('confirm');
				const landed = revoked;
				revoked = null;
				return { keys, revoking: keys.find((key) => key.id === asked) ?? null, revoked: landed };
			},
			action: async ({ request }) => {
				const body = await request.formData();
				if (body.get('__form_id__') === 'api-key-revoke') {
					revoked = keys.find((key) => key.id === body.get('key_id'))?.name ?? null;
					keys = keys.filter((key) => key.id !== body.get('key_id'));
					return redirect(SCREEN);
				}
				return { made: { name: String(body.get('name')), key: KEY } };
			}
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: [at] }));
	await settle();
	return root;
}

const SCREEN = '/admin/integrations/api';

/** lets the stub's loader and action run and the router commit what they answered. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
}

function nameBox(root: HTMLElement): HTMLInputElement {
	const box = root.querySelector<HTMLInputElement>('input[name="name"]');
	if (!box) throw new Error('the page drew no name box');
	return box;
}

function button(within: Element | null | undefined, words: string): HTMLButtonElement {
	const found = [...(within?.querySelectorAll('button') ?? [])].find(
		(b) => b.textContent === words
	);
	if (!found) throw new Error(`nothing reading ${words} to press`);
	return found;
}

function type(box: HTMLInputElement, value: string): void {
	act(() => {
		box.focus();
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

it('puts the caret back in the Name box once the key it made is taken down', async () => {
	const root = await flow(SCREEN);
	type(nameBox(root), 'Reporting sheet');

	await act(async () => button(root, 'Make key').click());
	await settle();
	expect(card()?.textContent).toContain(KEY);

	act(() => button(card(), 'Done').click());

	expect(card()).toBeNull();
	expect(document.activeElement).toBe(nameBox(root));
});

it('asks to revoke the key by name in the title, and the press reads Yes, revoke', async () => {
	await flow(`${SCREEN}?confirm=key-1`);

	expect(card()?.querySelector('h2')?.textContent).toBe('Revoke Reporting sheet?');
	expect(button(card(), 'Yes, revoke').textContent).toBe('Yes, revoke');
});

it('says which key a confirmed revoke took, and puts the caret in the Name box', async () => {
	const root = await flow(`${SCREEN}?confirm=key-1`);
	const said = root.querySelector('[role="status"]');
	expect(said?.textContent).toBe('');

	await act(async () => button(card(), 'Yes, revoke').click());
	await settle();

	expect(card()).toBeNull();
	expect(root.querySelector('[role="status"]')).toBe(said);
	expect(said?.textContent).toBe('Revoked Reporting sheet.');
	expect(document.activeElement).toBe(nameBox(root));
});

it('reports an empty name at the box and puts the caret there, rather than doing nothing', async () => {
	const root = await flow(SCREEN);

	act(() => button(root, 'Make key').focus());
	act(() => button(root, 'Make key').click());

	expect(document.activeElement).toBe(nameBox(root));
	expect(nameBox(root).getAttribute('aria-invalid')).toBe('true');
	expect(root.textContent).toContain('required');
});

it('reports a blank name at the box and puts the caret there', () => {
	const root = screen();
	const box = root.querySelector<HTMLInputElement>('input[name="name"]');
	if (!box) throw new Error('the page drew no name box');
	const press = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Make key');
	if (!press) throw new Error('the page drew no Make key');

	// spaces arm the press — the box is no longer empty — and are still no name.
	act(() => {
		box.focus();
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
		setValue?.call(box, '   ');
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
	act(() => press.focus());
	act(() => press.click());

	expect(document.activeElement).toBe(box);
	expect(box.getAttribute('aria-invalid')).toBe('true');
	expect(root.textContent).toContain('required');
});
