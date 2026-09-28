import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import NewDestination from './_app.admin.integrations.webhooks.new';

// what the add screen does with a press: a refusal said at its box, and the caret put there. the
// server half is ./_app.admin.integrations.webhooks.new.workers.spec.ts; what is asserted here is
// words, focus and which element is refused, never a class.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN = '/admin/integrations/webhooks/new';

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

/** the screen over an action standing in for the route's own, which answers `answer`. */
async function flow(answer: () => unknown): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{ path: SCREEN, Component: NewDestination as never, action: answer },
		{ path: '/admin/integrations/webhooks', Component: () => null }
	]);
	const root = mount(createElement(Stub, { initialEntries: [SCREEN] }));
	await settle();
	return root;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
}

function urlBox(root: HTMLElement): HTMLInputElement {
	const box = root.querySelector<HTMLInputElement>('input[name="url"]');
	if (!box) throw new Error('the page drew no URL box');
	return box;
}

function type(box: HTMLInputElement, value: string): void {
	act(() => {
		box.focus();
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function press(root: HTMLElement, words: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((b) => b.textContent === words);
	if (!found) throw new Error(`nothing reading ${words} to press`);
	return found;
}

it('lists the nine events under Gifts, Donors and Recurring gifts, none ticked', async () => {
	const root = await flow(() => null);

	const groups = [...root.querySelectorAll('fieldset fieldset')].map((group) => [
		group.querySelector('legend')?.textContent,
		[...group.querySelectorAll('label')].map((label) => label.textContent)
	]);
	expect(groups).toEqual([
		['Gifts', ['Made', 'Refunded', 'Dispute opened']],
		['Donors', ['Added', 'Updated']],
		['Recurring gifts', ['Started', 'Updated', 'Charge failed', 'Ended']]
	]);
	expect(root.querySelectorAll('input[name="events"]:checked')).toHaveLength(0);
});

it('refuses a destination listening to nothing on the question, and puts the caret on its first box', async () => {
	const root = await flow(() => null);
	type(urlBox(root), 'https://hooks.riverbanktrust.org/giving');

	act(() => press(root, 'Add destination').focus());
	act(() => press(root, 'Add destination').click());

	const question = root.querySelector('fieldset');
	expect(question?.getAttribute('aria-invalid')).toBe('true');
	expect(question?.textContent).toContain('choose at least one');
	expect(document.activeElement).toBe(root.querySelector('input[name="events"]'));
});

it('says under the URL box why the address was refused, and puts the caret there', async () => {
	const root = await flow(() =>
		data(
			{
				form: {
					id: 'webhook-destination-add',
					result: {
						status: 'error',
						initialValue: { url: 'http://crm.example.net/hook', events: ['gift.made'] },
						error: { url: ['must start with https://'] }
					}
				}
			},
			{ status: 400 }
		)
	);
	type(urlBox(root), 'http://crm.example.net/hook');
	act(() => root.querySelector<HTMLInputElement>('input[value="gift.made"]')?.click());

	act(() => press(root, 'Add destination').focus());
	await act(async () => press(root, 'Add destination').click());
	await settle();

	expect(urlBox(root).getAttribute('aria-invalid')).toBe('true');
	expect(root.querySelector(`#${urlBox(root).id}-err`)?.textContent).toBe(
		'must start with https://'
	);
	expect(document.activeElement).toBe(urlBox(root));
});
