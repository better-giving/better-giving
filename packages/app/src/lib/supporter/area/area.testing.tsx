import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { onTestFinished } from 'vitest';
import type { SupporterAccount, SupporterOrg } from './shell';

// what every supporter screen's dom spec mounts it in: a document that lasts the case, under a
// router whose one route is the screen and whose action keeps what was posted to it.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ORG: SupporterOrg = { name: 'Harbor Light', logo: null, brandColour: null };

export const ACCOUNT: SupporterAccount = {
	email: 'maya@example.org',
	signOutAction: '/fundraise/sign-out'
};

/** the screen at `/here`, and every body a form on it posted, each answered with `answer`'s. */
export function mountScreen(
	screen: () => ReactNode,
	answer: (posted: FormData) => unknown = () => null
): {
	readonly root: HTMLElement;
	readonly posted: FormData[];
} {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			path: '/here',
			Component: screen,
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				return answer(body);
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<Stub initialEntries={['/here']} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, posted };
}

/** the one element `selector` finds, or a failure naming it. */
export function one<E extends Element = HTMLElement>(root: ParentNode, selector: string): E {
	const found = root.querySelector<E>(selector);
	if (found === null) throw new Error(`nothing matches ${selector}`);
	return found;
}

/** the box a label names, by the label's words. */
export function boxLabelled(root: HTMLElement, words: string): HTMLInputElement {
	const label = [...root.querySelectorAll('label')].find(
		(found) => found.textContent?.trim() === words
	);
	if (label === undefined) throw new Error(`no label reads ${words}`);
	return one<HTMLInputElement>(root, `#${CSS.escape(label.htmlFor)}`);
}

/** the button whose words are `words`. */
export function button(root: ParentNode, words: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find(
		(candidate) => candidate.textContent?.trim() === words
	);
	if (found === undefined) throw new Error(`no button reads ${words}`);
	return found;
}

/** a press on the form's submit, the way a browser sends one, flushed. */
export async function submit(form: HTMLFormElement): Promise<void> {
	await act(async () => {
		form.requestSubmit(one<HTMLButtonElement>(form, 'button[type="submit"]'));
	});
}
