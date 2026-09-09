import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../components/render.testing';
import { AnchoredPanel } from './AnchoredPanel';

// the shell over a panel of controls, and the two things it adds that no caller can add for
// itself: the press that opens it, and the positioner that writes the `--available-width`
// packages/operator/src/styles/adm.css caps the panel by.
//
// what is asserted is that the property is written on an ancestor of the panel that sheet caps.
// **the inheritance itself is not asserted and could not be**: a custom property reaching a
// descendant is CSS's, and happy-dom resolves no inherited custom property through
// `getComputedStyle` — a case reading one back would be reading the stand-in. what is this
// package's is the composition, that the panel is inside the element the property is written on.
//
// ./AnchoredCard.dom.spec.tsx is the same arrangement over the two mark-triggered cards, and the
// helpers below are written the way that file writes them.

/**
 * presses the trigger and waits until the positioner carries the `--available-width` every case
 * below reads off it. the positioner is in the document from mount, closed state included, so its
 * presence says nothing about placement: the property is what the machine writes when it places,
 * and a positioner with nothing written on it is the state `positioner()` would hand a case that
 * read too early.
 */
async function press(root: HTMLElement) {
	const trigger = root.querySelector('button');
	if (trigger === null) throw new Error('the shell drew no trigger');
	await act(async () => {
		trigger.click();
	});
	await act(async () => {
		await vi.waitFor(() => {
			const placed = document.querySelector<HTMLElement>('[data-part="positioner"]');
			if (placed === null) throw new Error('nothing was placed');
			if (placed.style.getPropertyValue('--available-width') === '')
				throw new Error('the positioner wrote no width');
		});
	});
	return trigger;
}

/** the positioner the machine placed, read off the document: the panel is portalled out of `root`. */
function positioner(): HTMLElement {
	const found = document.querySelector<HTMLElement>('[data-part="positioner"]');
	if (found === null) throw new Error('nothing was placed');
	return found;
}

/**
 * whether the panel is being offered, and `null` where there is no panel in the document to ask.
 *
 * the two closed states are not the same node. a panel that has never been opened is mounted and
 * `hidden` — out of the accessibility tree and painted nowhere, but still a node a query finds — and
 * one that has been dismissed is gone, which is `unmountOnExit`'s doing and the whole of what keeps
 * a box inside a dismissed panel from holding what was typed into it.
 */
function shown(): string | null {
	const content = document.querySelector('[data-part="content"]');
	return content === null ? null : content.getAttribute('data-state');
}

describe('the panel behind a labelled press', () => {
	it('opens its panel from the trigger', async () => {
		const root = render(AnchoredPanel, {
			label: 'Password',
			children: 'Storing a new one replaces it at once.'
		});

		expect(shown()).toBe('closed');
		const trigger = await press(root);

		expect(shown()).toBe('open');
		// the word is the whole of the trigger: there is no shape on this one to read it from.
		expect(trigger.textContent).toBe('Password');
		// the machine's own, not written here: it is what says there is something to open without
		// pointing at text that is hidden until it is.
		expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('.adm-anchored.adm-anchored--panel')?.textContent).toBe(
			'Storing a new one replaces it at once.'
		);
	});

	it('opens the same panel from a mark, and is still named by the word', async () => {
		// the press on the top bar is a shape rather than a word, and the word it would have drawn is
		// what names it. so the name has to survive the swap: a shape with nothing behind it is a
		// press a reader meets as an unnamed button.
		const root = render(AnchoredPanel, {
			label: 'Password',
			mark: 'settings',
			children: 'A box.'
		});

		const trigger = await press(root);

		expect(shown()).toBe('open');
		// the shape is out of the tree, so the attribute is the whole of the name and not half of it.
		expect(trigger.textContent).toBe('');
		expect(trigger.getAttribute('aria-label')).toBe('Password');
		expect(trigger.querySelector('.adm-mark')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('gives the open panel focus, so a keyboard is inside what it opened', async () => {
		// everything a dialog owes a keyboard follows from where focus is: left on the press,
		// dismissing is dead and a tab walks the whole surface before reaching a panel that is
		// portalled to the end of the document.
		const root = render(AnchoredPanel, { label: 'Password', children: 'A box.' });
		await press(root);

		const panel = document.querySelector('[data-part="content"]');
		expect(panel?.contains(document.activeElement) || panel === document.activeElement).toBe(true);
	});

	it('closes on escape and hands focus back to the press', async () => {
		const root = render(AnchoredPanel, { label: 'Password', children: 'A box.' });
		const trigger = await press(root);

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				if (document.querySelector('[data-part="content"]') !== null)
					throw new Error('the panel is still in the document');
			});
		});

		// gone rather than hidden: the panel is discarded on a dismiss.
		expect(shown()).toBe(null);
		// where a press that opened something leaves a keyboard when it is dismissed: back at the
		// press, and not at the top of the document.
		expect(document.activeElement).toBe(trigger);
	});

	it('discards what was typed into it when it is dismissed', async () => {
		// the panels this shell opens are acted through rather than read, and what is typed into one
		// is a credential. a panel left mounted keeps its boxes holding whatever was put in them and
		// hands it back in the clear at the next press — so a dismiss has to be the resting shape
		// again, and not the same panel shown a second time.
		const root = render(AnchoredPanel, {
			label: 'Password',
			children: <input aria-label="New password" defaultValue="" />
		});
		await press(root);

		const box = document.querySelector('input');
		if (box === null) throw new Error('the panel drew no box');
		await act(async () => {
			box.value = 'a password nobody may read back';
		});

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				if (document.querySelector('input') !== null)
					throw new Error('the box the panel drew is still in the document');
			});
		});

		expect(document.querySelector('input')).toBe(null);

		await press(root);
		expect(document.querySelector('input')?.value).toBe('');
	});

	it('names the panel with the word that opened it', async () => {
		// the panel is a `dialog`, and a dialog with no name is one a reader arrives inside with
		// nothing saying what they are in.
		const root = render(AnchoredPanel, { label: 'Password', children: 'A box.' });
		await press(root);

		expect(document.querySelector('[data-part="content"]')?.getAttribute('aria-label')).toBe(
			'Password'
		);
	});

	it('writes the width the sheet caps the panel by on an ancestor of it', async () => {
		const root = render(AnchoredPanel, { label: 'Password', children: 'A box.' });
		await press(root);

		const panel = document.querySelector('.adm-anchored.adm-anchored--panel');
		if (panel === null) throw new Error('the shell opened no panel');
		expect(positioner().style.getPropertyValue('--available-width')).not.toBe('');
		expect(positioner().contains(panel)).toBe(true);
	});
});
