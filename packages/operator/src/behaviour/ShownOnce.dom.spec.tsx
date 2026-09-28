import { act, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, render } from '../components/render.testing';
import { ShownOnce, useShownOnce } from './ShownOnce';

// the card a made secret is shown in once, and the state a screen keeps so it stays shown once.
// what `showModal()` does is ./Dialog.dom.spec.tsx's and is not asserted again; what is here is what
// ./ShownOnce.tsx writes — the value on the card and on the clipboard, the one way out, and the
// dismissal keyed off the value that arrived.

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	writeText = vi.fn(() => Promise.resolve());
	// happy-dom has no clipboard, and the real one would be the browser's rather than the case's.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const SECRET = 'bgk_7Qm2Xc9Lr4Tz8Vh1Nw6Pd3Ks5Yb0EjRa';

function dialogIn(root: HTMLElement): HTMLDialogElement {
	const found = root.querySelector('dialog');
	if (found === null) throw new Error('no card was drawn');
	return found;
}

function buttonNamed(root: HTMLElement, name: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find(
		(b) => (b.getAttribute('aria-label') ?? b.textContent) === name
	);
	if (found === undefined) throw new Error(`no button named ${name}`);
	return found;
}

describe('a secret shown once', () => {
	it('draws the value whole on one line, named by the question over it', () => {
		const root = render(ShownOnce, {
			title: 'Copy the key for Reporting sheet',
			secret: SECRET,
			copyLabel: 'Copy the key',
			onDone: () => {}
		});
		const dialog = dialogIn(root);
		const slab = dialog.querySelector('.adm-slab--oneline');
		const heading = dialog.querySelector('h2');

		expect(slab?.querySelector('pre')?.textContent).toBe(SECRET);
		expect(heading?.id).toBeTruthy();
		expect(slab?.getAttribute('aria-labelledby')).toBe(heading?.id);
		expect(dialog.textContent).toContain('It won’t be shown again.');
	});

	it('reads what else the answer said as part of the card, after the value', () => {
		const root = render(ShownOnce, {
			title: 'Copy the key for Zapier',
			secret: SECRET,
			copyLabel: 'Copy the key',
			onDone: () => {},
			children: <p className="adm-prose">3 Zaps disconnected.</p>
		});
		const dialog = dialogIn(root);
		const body = root.ownerDocument.getElementById(dialog.getAttribute('aria-describedby') ?? '');

		expect(body?.textContent).toMatch(/It won’t be shown again\.3 Zaps disconnected\.$/);
	});

	it('puts exactly the value on the clipboard', async () => {
		const root = render(ShownOnce, {
			title: 'Copy the key',
			secret: SECRET,
			copyLabel: 'Copy the key',
			onDone: () => {}
		});

		await act(async () => {
			buttonNamed(root, 'Copy the key').click();
			await Promise.resolve();
		});

		expect(writeText).toHaveBeenCalledWith(SECRET);
	});

	it('has one way out, and Done and Escape both take it', () => {
		const onDone = vi.fn();
		const root = render(ShownOnce, {
			title: 'Copy the key',
			secret: SECRET,
			copyLabel: 'Copy the key',
			onDone
		});
		const dialog = dialogIn(root);
		const answers = dialog.querySelectorAll('.adm-dialog__actions > *');

		// no cancel and no close mark: a secret dismissed without being taken is gone, so nothing on
		// the card reads as a way back to it.
		expect(answers).toHaveLength(1);
		expect(answers[0]?.textContent).toBe('Done');

		(answers[0] as HTMLButtonElement).click();
		dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

		expect(onDone).toHaveBeenCalledTimes(2);
	});

	it('writes the value nowhere but the card', () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const before = window.location.href;

		render(ShownOnce, {
			title: 'Copy the key',
			secret: SECRET,
			copyLabel: 'Copy the key',
			onDone: () => {}
		});

		expect(setItem).not.toHaveBeenCalled();
		expect(window.location.href).toBe(before);
		expect(window.location.href).not.toContain(SECRET);
		setItem.mockRestore();
	});
});

/** a screen holding an action's answer, which is never cleared by the dismissal. */
function Screen({ secret }: { secret: string | undefined }) {
	const [shown, done] = useShownOnce(secret);
	return shown ? (
		<ShownOnce title="Copy the key" secret={shown} copyLabel="Copy the key" onDone={done} />
	) : (
		<p>no card</p>
	);
}

describe('the state a screen keeps for it', () => {
	it('keeps a dismissed secret down through a redraw still holding it', () => {
		const screen = mount(Screen, { secret: SECRET });
		act(() => buttonNamed(screen.root, 'Done').click());

		expect(screen.root.querySelector('dialog')).toBeNull();

		// the router redraws the route with the same answer on it — a revalidation, a sibling write.
		screen.again({ secret: SECRET });

		expect(screen.root.querySelector('dialog')).toBeNull();
	});

	it('puts a new secret up after an earlier one was dismissed', () => {
		const screen = mount(Screen, { secret: SECRET });
		act(() => buttonNamed(screen.root, 'Done').click());

		screen.again({ secret: 'bgk_4Hn8Wq2Zt6Rv1Lc9Mx3Py7Kb5Ds0FgTe' });

		expect(dialogIn(screen.root).querySelector('pre')?.textContent).toBe(
			'bgk_4Hn8Wq2Zt6Rv1Lc9Mx3Py7Kb5Ds0FgTe'
		);
	});

	it('draws nothing before any secret has arrived', () => {
		const root = render(Screen, { secret: undefined });

		expect(root.querySelector('dialog')).toBeNull();
	});
});

/**
 * a screen whose make form is remounted by the secret that arrived, so the press that made it is
 * gone by the time the card comes down, and the new form's box is where the screen sends the reader.
 */
function Making({ secret }: { secret: string | undefined }) {
	const [shown, done] = useShownOnce(secret);
	const box = useRef<HTMLInputElement>(null);
	return (
		<>
			<form key={secret ?? 'none'}>
				<input ref={box} aria-label="Name" />
				<button type="button">Make key</button>
			</form>
			{shown ? (
				<ShownOnce
					title="Copy the key"
					secret={shown}
					copyLabel="Copy the key"
					onDone={done}
					fallbackFocus={box}
				/>
			) : null}
		</>
	);
}

describe('where the reader lands once the card is down', () => {
	it('lands on the box the screen named when the make press has gone with its form', () => {
		const screen = mount<{ secret: string | undefined }>(Making, { secret: undefined });
		buttonNamed(screen.root, 'Make key').focus();

		screen.again({ secret: SECRET });
		act(() => buttonNamed(screen.root, 'Done').click());

		expect(screen.root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(screen.root.querySelector('input'));
	});
});
