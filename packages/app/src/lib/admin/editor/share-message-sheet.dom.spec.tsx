import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ShareMessageSheet } from './share-message-sheet';

// the page's share message as its sheet takes and hands back one: seeded from the Organisation's or
// the page's own, the pick and the words handed back together by Done — the page's own trimmed, the
// Organisation's as none of its own — and a refused message said at its box with the caret moved
// there. what the route posts for each is ./page-settings.tsx's.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = 'Every coat keeps a child warm for a whole winter.';
const OWN = 'Help us keep 400 children warm this winter.';

function mountable(tree: ReactNode): { root: HTMLElement; redraw: (next: ReactNode) => void } {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, redraw: (next) => act(() => mounted.render(next)) };
}

function sheet(
	own: string | null,
	onDone: (own: string | null) => void,
	error?: string
): ReactNode {
	return (
		<ShareMessageSheet
			orgMessage={ORG}
			own={own}
			onDone={onDone}
			applying={false}
			error={error}
			onDismiss={() => {}}
		/>
	);
}

function choice(root: HTMLElement, value: 'org' | 'own'): HTMLInputElement {
	const found = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
	if (found === null) throw new Error(`no ${value} choice`);
	return found;
}

const box = (root: HTMLElement) => root.querySelector('textarea');

function typeInto(root: HTMLElement, text: string): void {
	const found = box(root);
	if (found === null) throw new Error('no message box');
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(found, text);
		found.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function done(root: HTMLElement): void {
	const found = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
	if (found === undefined) throw new Error('no Done');
	act(() => found.click());
}

describe('the share message', () => {
	it('opens on the Organisation’s, stated under its choice, while the page has none of its own', () => {
		const { root } = mountable(sheet(null, () => {}));
		expect(choice(root, 'org').checked).toBe(true);
		expect(choice(root, 'org').closest('label')?.textContent).toContain(ORG);
		expect(box(root)).toBeNull();
	});

	it('opens on the page’s own words when it has some', () => {
		const { root } = mountable(sheet(OWN, () => {}));
		expect(choice(root, 'own').checked).toBe(true);
		expect(box(root)?.value).toBe(OWN);
	});

	it('hands back words written for the page, trimmed', () => {
		const onDone = vi.fn();
		const { root } = mountable(sheet(null, onDone));
		act(() => choice(root, 'own').click());
		typeInto(root, `  ${OWN}\n`);

		done(root);

		expect(onDone.mock.calls).toEqual([[OWN]]);
	});

	it('hands back none of the page’s own when the Organisation’s is picked', () => {
		const onDone = vi.fn();
		const { root } = mountable(sheet(OWN, onDone));
		act(() => choice(root, 'org').click());

		done(root);

		expect(onDone.mock.calls).toEqual([[null]]);
	});

	it('refuses an empty message of the page’s own at its box, handing nothing back', () => {
		const onDone = vi.fn();
		const { root } = mountable(sheet(null, onDone));
		act(() => choice(root, 'own').click());
		typeInto(root, '   ');

		done(root);

		expect(onDone).not.toHaveBeenCalled();
		expect(box(root)?.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(box(root));
	});

	it('says a refused message at its box and moves the caret there', () => {
		const said = 'a share message holds at most 280 characters';
		const { root, redraw } = mountable(sheet(OWN, () => {}));
		act(() => choice(root, 'own').focus());

		redraw(sheet(OWN, () => {}, said));

		const refused = box(root);
		expect(refused?.getAttribute('aria-invalid')).toBe('true');
		const described = (refused?.getAttribute('aria-describedby') ?? '').split(' ');
		expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(said);
		expect(document.activeElement).toBe(refused);
	});
});
