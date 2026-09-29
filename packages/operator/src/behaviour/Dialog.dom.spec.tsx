import { act, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../components/shell/Dialog.jsx';
import { render } from '../components/render.testing';
import { Modal } from './Dialog';

// the shell over ../components/shell/Dialog.jsx, and the two things it is: one interior, and the
// two answers it hands back.
//
// **what `showModal()` already does is not re-asserted here, because it is not built here.** the
// browser's top layer keeps the tab ring inside the card and the page behind it inert, moves focus
// in on the call, and turns Escape into a `cancel` event before it is a dismissal. none of that is
// this package's code, and none of it exists in happy-dom either — it implements `showModal()` as a
// flag and a `close()`, with no top layer, no focus move and no key handling — so a case claiming
// to have watched focus be trapped here would be watching a stand-in agree with itself. what is
// left is what this file actually writes: the upgrade, and the two answers.
//
// focus returning to what opened the dialog **is** written here, because the return is written in
// ./Dialog.tsx rather than left to the browser: the element is unmounted while it is still in the
// top layer, so the restoration `close()` would have done never runs. a dialog arriving open in the
// server's markup has no opener to go back to and that case asserts nothing; the one below is the
// other kind, a card a control on the page put up — packages/console-ui/src/lib/smtp-fold.tsx's
// confirm, and packages/console-ui/src/routes/_index.tsx's close confirm.

/** the element the shell put on the page. */
function dialogIn(root: HTMLElement): HTMLDialogElement {
	const found = root.querySelector('dialog');
	if (found === null) throw new Error('the shell drew no dialog');
	return found;
}

describe('the shell over the dialog', () => {
	it('lifts the element the server sent into the top layer', () => {
		const root = render(Modal, { title: 'Confirm', onDismiss: () => {} });

		// the modifier is the observable end of the upgrade: it is what the server sent, and the
		// effect drops it at the moment the same element is shown modally.
		expect(dialogIn(root).className).toBe('adm-dialog');
		expect(dialogIn(root).open).toBe(true);
	});

	it('draws no interior of its own', () => {
		// the one-interior rule, as a case rather than as a promise: the shell renders
		// ../components/shell/Dialog.jsx and adds an effect, so a second copy of the markup cannot
		// be introduced on either side without this failing. the id is stated on both, because a
		// minted one differs per render and would make two identical interiors compare unequal.
		const props = {
			title: 'Rotate the signing secret?',
			titleId: 'compared',
			children: 'The old secret stops working the moment this is done.',
			danger: 'Rotate it',
			cancel: 'Keep it'
		};

		const interior = dialogIn(render(Dialog, props));
		const shell = dialogIn(render(Modal, { ...props, onDismiss: () => {} }));

		expect(shell.innerHTML).toBe(interior.innerHTML);
	});

	it('hands Escape to the caller and leaves the element open', () => {
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Confirm', onDismiss });
		const dialog = dialogIn(root);

		// what the browser sends a shown modal when Escape is pressed. dispatched rather than typed
		// because happy-dom does not turn the key into this event — the translation is the
		// platform's, and what this file is answerable for is the answer.
		const cancel = new Event('cancel', { bubbles: false, cancelable: true });
		dialog.dispatchEvent(cancel);

		expect(onDismiss).toHaveBeenCalledTimes(1);
		// refused, so the element does not take itself off a screen still holding it.
		expect(cancel.defaultPrevented).toBe(true);
		expect(dialog.open).toBe(true);
	});

	/** a whole press: down at one point, and the click it ends in at another. */
	function press(dialog: HTMLDialogElement, down: [number, number], up: [number, number]) {
		const at = ([clientX, clientY]: [number, number]) => ({ bubbles: true, clientX, clientY });
		dialog.dispatchEvent(new PointerEvent('pointerdown', at(down)));
		dialog.dispatchEvent(new MouseEvent('click', at(up)));
	}

	it('hands a press on the ground to the caller', () => {
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Confirm', onDismiss });
		const dialog = dialogIn(root);

		// the ground is the element's own `::backdrop`, so a press on it arrives with the element
		// itself as the target and a point outside the element's box.
		press(dialog, [400, 400], [400, 400]);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('does not read a press that went down before the card was lifted as one on the ground', () => {
		// a question drawn in the server's markup stands in the page until the lift, and then
		// somewhere else: the press aimed at it went down on the page, and only its click reaches the
		// element once it is lifted.
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Delete this destination?', onDismiss });

		dialogIn(root).dispatchEvent(
			new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 400 })
		);

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('does not read a press that went down inside the card and ended outside it as one on the ground', () => {
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Confirm', onDismiss });

		press(dialogIn(root), [0, 0], [400, 400]);

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('does not read a press inside the card as a press on the ground', () => {
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Confirm', exit: 'Done', onDismiss });
		const button = root.querySelector('button');
		if (button === null) throw new Error('the dialog drew no control');

		// the point is outside the card and the press still is not one on the ground: what it landed
		// on is a control. the two conditions answer different presses and this is the one only the
		// target can settle, so it is stated as a press that would pass the other.
		button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 400 }));

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("does not read a press on the card's own padding as a press on the ground", () => {
		const onDismiss = vi.fn();
		const root = render(Modal, { title: 'Confirm', onDismiss });
		const dialog = dialogIn(root);

		// the padding is inside the card and targets the element exactly as the ground does, so the
		// point is the whole of what separates them. a press at the element's own origin is inside
		// any box it has.
		press(dialog, [0, 0], [0, 0]);

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('puts the focus on the card and not on the control that does the damage', () => {
		const root = render(Modal, {
			title: 'Rotate the signing secret?',
			children: 'The old secret stops working the moment this is done.',
			danger: 'Rotate it',
			cancel: 'Keep it',
			onDismiss: () => {}
		});

		// the card, and the reader meets the question before any answer to it. the actions row draws
		// `danger` first (../components/shell/Dialog.jsx), so the control the platform's own dialog
		// focusing steps would reach is the one that does the damage.
		expect(document.activeElement).toBe(dialogIn(root));
	});

	/**
	 * a card a control on the page put up and either dismissal takes away again, which is what every
	 * confirm on the console is: the press is what mounts the dialog, and answering it unmounts the
	 * same element rather than closing it.
	 */
	function Confirming() {
		const [up, setUp] = useState(false);
		return (
			<>
				<button type="button" onClick={() => setUp(true)}>
					Store these
				</button>
				{up ? (
					<Modal
						title="Store these changes?"
						cancel="Go back"
						cancelProps={{ type: 'button', onClick: () => setUp(false) }}
						onDismiss={() => setUp(false)}
					/>
				) : null}
			</>
		);
	}

	/** the control that puts the card up, with the reader on it. */
	function opened(root: HTMLElement): HTMLButtonElement {
		const opener = root.querySelector('button');
		if (opener === null) throw new Error('no control to open the dialog with');
		opener.focus();
		act(() => opener.click());
		// the card took the focus off the opener, so what the cases below read is a move back rather
		// than a focus that never left.
		expect(document.activeElement).toBe(dialogIn(root));
		return opener;
	}

	it('puts the focus back on the control that opened it when Escape dismisses it', () => {
		const root = render(Confirming, {});
		const opener = opened(root);

		act(() => dialogIn(root).dispatchEvent(new Event('cancel', { cancelable: true })));

		expect(root.querySelector('dialog')).toBe(null);
		expect(document.activeElement).toBe(opener);
	});

	it('puts the focus back on the control that opened it when the dismiss control is pressed', () => {
		const root = render(Confirming, {});
		const opener = opened(root);

		const cancel = [...dialogIn(root).querySelectorAll('button')].find(
			(control) => control.textContent === 'Go back'
		);
		if (cancel === undefined) throw new Error('the dialog drew no way out');
		act(() => cancel.click());

		expect(root.querySelector('dialog')).toBe(null);
		expect(document.activeElement).toBe(opener);
	});

	/**
	 * a card whose answer takes its own opener off the page — a revoke confirm, where the row that
	 * held the Revoke goes with the record — and the box the screen names to land on instead.
	 */
	function Revoking({ named }: { readonly named: boolean }) {
		const [row, setRow] = useState(true);
		const [up, setUp] = useState(false);
		const box = useRef<HTMLInputElement>(null);
		return (
			// the shell's page, focusable for its skip link and so the box a pointer press lands focus
			// on in safari (./Dialog.tsx's header).
			<main tabIndex={-1}>
				<input ref={box} aria-label="Name" />
				{row ? (
					<button type="button" onClick={() => setUp(true)}>
						Revoke
					</button>
				) : null}
				{up ? (
					<Modal
						title="Revoke Reporting sheet?"
						danger="Yes, revoke"
						dangerProps={{
							type: 'button',
							onClick: () => {
								setRow(false);
								setUp(false);
							}
						}}
						cancel="Cancel"
						cancelProps={{ type: 'button', onClick: () => setUp(false) }}
						onDismiss={() => setUp(false)}
						fallbackFocus={named ? box : undefined}
					/>
				) : null}
			</main>
		);
	}

	function pressed(root: HTMLElement, name: string): void {
		const control = [...dialogIn(root).querySelectorAll('button')].find(
			(c) => c.textContent === name
		);
		if (control === undefined) throw new Error(`the dialog drew no ${name}`);
		act(() => control.click());
	}

	it('puts the focus on the target the screen named when the answer took the opener away', () => {
		const root = render(Revoking, { named: true });
		opened(root);

		pressed(root, 'Yes, revoke');

		expect(root.querySelector('dialog')).toBe(null);
		expect(document.activeElement).toBe(root.querySelector('input'));
	});

	it('still goes back to the control that opened it when it is on the page, whatever the screen named', () => {
		const root = render(Revoking, { named: true });
		const opener = opened(root);

		pressed(root, 'Cancel');

		expect(document.activeElement).toBe(opener);
	});

	it('reads a page that only held the focus as no opener, and lands where the screen named', () => {
		// what safari does with a pointer press on Revoke: the button is not focused, the page around
		// it is, and the press still puts the card up.
		const root = render(Revoking, { named: true });
		const page = root.querySelector('main');
		const revoke = root.querySelector('button');
		if (page === null || revoke === null) throw new Error('no page or no Revoke');
		page.focus();
		act(() => revoke.click());

		pressed(root, 'Cancel');

		expect(document.activeElement).toBe(root.querySelector('input'));
	});

	it('leaves the focus on the body when the opener is gone and nothing was named', () => {
		const root = render(Revoking, { named: false });
		opened(root);

		pressed(root, 'Yes, revoke');

		expect(document.activeElement).toBe(document.body);
	});
});
