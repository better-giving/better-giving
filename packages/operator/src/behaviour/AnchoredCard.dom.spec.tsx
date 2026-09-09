import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../components/render.testing';
import { AnchoredNote } from './AnchoredCard';

// the shell over ../components/data/Disclosure.jsx, and the gap it closes: the card is capped on a
// `--available-width` (packages/operator/src/styles/adm.css) that a positioner writes per
// placement, and until there was a positioner nothing wrote it — so the cap was the fallback in
// every state and the card had no trigger to be opened from at all.
//
// what is asserted is that the property is written on an ancestor of the card the sheet caps.
// **the inheritance itself is not asserted and could not be**: a custom property reaching a
// descendant is CSS's, and happy-dom resolves no inherited custom property through
// `getComputedStyle` — a case reading one back would be reading the stand-in. what is this
// package's is the composition, that the card is inside the element the property is written on.

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

/** the positioner the machine placed, read off the document: the card is portalled out of `root`. */
function positioner(): HTMLElement {
	const found = document.querySelector<HTMLElement>('[data-part="positioner"]');
	if (found === null) throw new Error('nothing was placed');
	return found;
}

/**
 * whether the card is being offered, read off the machine's own state rather than off the card
 * being in the document: a closed card stays mounted and `hidden`, which is out of the
 * accessibility tree and painted nowhere but is still a node a query finds.
 */
function shown(): string | null {
	const content = document.querySelector('[data-part="content"]');
	if (content === null) throw new Error('the shell drew no card');
	return content.getAttribute('data-state');
}

describe('the note behind a mark', () => {
	it('opens its card from the trigger', async () => {
		const root = render(AnchoredNote, {
			mark: 'triangle-alert',
			label: 'Why Stripe secret key needs attention',
			children: 'Payments stay off until this is set.'
		});

		expect(shown()).toBe('closed');
		const trigger = await press(root);

		expect(shown()).toBe('open');
		expect(trigger.getAttribute('aria-label')).toBe('Why Stripe secret key needs attention');
		// the machine's own, not written here: the shape is out of the tree, so these are the whole
		// of what says the mark is a press with something behind it.
		expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('.adm-anchored')?.textContent).toBe(
			'Payments stay off until this is set.'
		);
	});

	it('is a button a tab reaches, and opens on the press and not on the arrival', async () => {
		// the whole of the keyboard path, and the mark is the only way to the note: reach the
		// trigger, press it, and the card is open. arriving is not pressing — a card that opened on
		// focus alone would be one the next press closes, which leaves no keystroke that opens it.
		const root = render(AnchoredNote, {
			mark: 'info',
			label: 'Why your donation page is always listed',
			children: 'It is served on this deployment and on no site row.'
		});

		const trigger = root.querySelector('button');
		if (trigger === null) throw new Error('the shell drew no trigger');
		expect(trigger.hasAttribute('disabled')).toBe(false);
		// a tab stop by being a button with nothing taking it out of the order.
		expect(trigger.getAttribute('tabindex')).toBe(null);

		await act(async () => {
			trigger.focus();
		});
		expect(document.activeElement).toBe(trigger);
		// long enough that an open on arrival would have landed by now, so this is an assertion
		// rather than a reading taken before anything could have happened.
		await act(async () => {
			await new Promise((settle) => setTimeout(settle, 800));
		});
		expect(shown()).toBe('closed');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');

		await press(root);
		expect(shown()).toBe('open');
	});

	it('gives the open card focus, so a keyboard is inside what it opened', async () => {
		// where focus is when the card opens is what makes dismissing it reachable at all: left on
		// the mark, escape is the shell's to hear and a tab walks the whole screen before reaching a
		// card that is portalled to the end of the document.
		const root = render(AnchoredNote, {
			mark: 'info',
			label: 'Why your donation page is always listed',
			children: 'It is served on this deployment and on no site row.'
		});
		await press(root);

		const card = document.querySelector('[data-part="content"]');
		expect(card?.contains(document.activeElement) || card === document.activeElement).toBe(true);
	});

	it('closes on escape and hands focus back to the mark', async () => {
		const root = render(AnchoredNote, {
			mark: 'info',
			label: 'Why your donation page is always listed',
			children: 'It is served on this deployment and on no site row.'
		});
		const trigger = await press(root);

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				if (shown() !== 'closed') throw new Error('the card is still being offered');
			});
		});

		// hidden rather than gone: a note holds text and no control, so there is nothing in it a
		// second press should find changed. ./AnchoredPanel.tsx is the one that discards.
		expect(document.querySelector('[data-part="content"]')?.hasAttribute('hidden')).toBe(true);
		// where a press that opened something leaves a keyboard when it is dismissed: back at the
		// press, and not at the top of the document.
		expect(document.activeElement).toBe(trigger);
	});

	it('writes the width the sheet caps the card by on an ancestor of it', async () => {
		const root = render(AnchoredNote, {
			mark: 'triangle-alert',
			label: 'Why Stripe secret key needs attention',
			children: 'Payments stay off until this is set.'
		});
		await press(root);

		const card = document.querySelector('.adm-anchored');
		if (card === null) throw new Error('the shell opened no card');
		expect(positioner().style.getPropertyValue('--available-width')).not.toBe('');
		expect(positioner().contains(card)).toBe(true);
	});
});
