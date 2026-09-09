import { act, createElement, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSavedFormState } from './saved-form-state.react';

// what ./saved-form-state.react.ts does once it is on a screen, which is the whole of what it is.
//
// mounted rather than called, because every claim here is about the effects: a form element really
// reset, a submit really stopped. a hook has no answers outside a render, so react-dom is what a
// spec about one costs — and this package is the only place either operator surface's hook can be
// mounted at all, which is what ../vitest.config.ts's dom pool is for.
//
// **the boxes are not here, and that is the split this module is on the save-state side of.** what a
// box is called, whether it may hold what it holds, which one a refusal is about and where focus
// goes when a press is turned down are a form library's answers, composed once per surface at that
// surface's own seam (packages/console-ui/src/lib/use-console-form.ts) — so this spec names no
// message and no box, and the reading that holds a press back arrives already taken.
//
// the cases are the things a caller would otherwise have to get right twice.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Facts = Parameters<typeof useSavedFormState>[0];

/**
 * the hook mounted onto a form with two boxes in it, and the button it draws.
 *
 * two rather than one, because a form's reading of itself is over the whole of it: a keystroke in
 * either box is the same keystroke to this module, and the difference between them is the caller's.
 *
 * `seed` is what the boxes arrive holding, which is the difference between the two kinds of form
 * this serves: a credential is typed into an empty box, and a stored value that can be read back is
 * already in there.
 */
function mounted(facts: Facts, seed = '') {
	const container = document.createElement('div');
	document.body.append(container);

	/* the seed as of the render being made, because a form drawn from a reading is redrawn whenever
	   that reading lands again — and what the boxes are put back to is whatever they were last
	   rendered with. */
	let held = seed;

	/* what a router's own `Form` does with the submit: it reads whether the handler stopped it, and
	   submits only where nothing did. stated here rather than asserted through a router, because
	   this package binds none — the reading is the one react-router's `<Form>` takes. */
	let sent = 0;

	let state = '';
	function Screen({ given }: { given: Facts }) {
		const form = useSavedFormState(given);
		state = form.state;
		return createElement(
			'form',
			{
				ref: form.form,
				onInput: form.onInput,
				onSubmit: (event: FormEvent<HTMLFormElement>) => {
					form.onSubmit(event);
					if (event.defaultPrevented) return;
					event.preventDefault();
					sent += 1;
				}
			},
			createElement('input', { id: 'box-NAME', name: 'NAME', defaultValue: held }),
			createElement('input', { id: 'box-OTHER', name: 'OTHER', defaultValue: held }),
			createElement('button', { type: 'submit', disabled: form.state === 'disabled' })
		);
	}

	const root = createRoot(container);
	act(() => root.render(createElement(Screen, { given: facts })));

	const boxes = () => [...container.querySelectorAll('input')] as HTMLInputElement[];

	return {
		box: () => boxes()[0] as HTMLInputElement,
		state: () => state,
		sent: () => sent,
		type: (value: string, id = 'box-NAME') =>
			act(() => {
				const box = boxes().find((each) => each.id === id) as HTMLInputElement;
				box.value = value;
				box.dispatchEvent(new Event('input', { bubbles: true }));
			}),
		press: () =>
			act(() => {
				(container.querySelector('form') as HTMLFormElement).dispatchEvent(
					new Event('submit', { bubbles: true, cancelable: true })
				);
			}),
		answer: (next: Facts, seeded = held) =>
			act(() => {
				held = seeded;
				root.render(createElement(Screen, { given: next }));
			}),
		wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
		stop: () => {
			act(() => root.unmount());
			container.remove();
		}
	};
}

/**
 * a form at rest, and the reading a form of empty boxes hands in: any box holding something.
 *
 * it is the caller's here as it is everywhere — this module has none of its own — and it is the
 * shape a form over a value nothing can read back states
 * (`secret-group-form.tsx` in packages/console-ui/src/lib).
 */
const IDLE: Facts = {
	report: null,
	landed: false,
	busy: false,
	pending: false,
	changed: (form) => [...form.querySelectorAll('input')].some((box) => box.value !== '')
};

let screen: ReturnType<typeof mounted> | null = null;
afterEach(() => {
	screen?.stop();
	screen = null;
	vi.useRealTimers();
});

describe('useSavedFormState', () => {
	/**
	 * the boxes are emptied by the write that landed, which over a value that can never be read back
	 * is the whole of what keeps a stored one off the screen.
	 */
	it('empties the boxes when an answer says the write landed', () => {
		screen = mounted(IDLE);
		screen.type('sk_test_51abc');
		expect(screen.box().value).toBe('sk_test_51abc');

		screen.answer({ ...IDLE, report: { done: true }, landed: true });
		expect(screen.box().value).toBe('');
	});

	/**
	 * the boxes are put back to the seed the form is holding at that moment, and never to the one
	 * they were pressed with: they are uncontrolled, so what the reset restores is whatever each was
	 * last rendered with — react writes a changed `defaultValue` to the attribute and leaves what is
	 * on the screen alone.
	 *
	 * it is the whole reason a caller whose seeds come from a re-read holds `spent` back until that
	 * read has landed (`reseeded` in packages/console-ui/src/lib/reseed.ts). put back a render
	 * earlier, this form goes back to the reading its press was made against, and the reading the
	 * write landed in never reaches a box at all — a stored value nobody can see without reloading
	 * the page.
	 */
	it('puts the boxes back to the seed it is holding, not the one they were pressed with', () => {
		screen = mounted(IDLE, '');
		screen.type('shhh');

		const answered: Facts = { ...IDLE, report: { done: true }, landed: true };
		// the answer, arriving while the form still holds the reading its press was made against.
		screen.answer({ ...answered, spent: false, pending: true });
		expect(screen.box().value).toBe('shhh');

		// and the re-read that press set off: what it reports back for a value nothing can hand back
		// is the mark a surface draws over one, which is what the box is put back to.
		screen.answer({ ...answered, pending: false }, '••••••••');
		expect(screen.box().value).toBe('••••••••');
	});

	/**
	 * a form seeded from a stored value has to answer "changed" against that value rather than
	 * against emptiness: every box arrives holding something, so a form nobody has touched would
	 * otherwise offer a press with nothing in it to save.
	 */
	it('reads changed the way the caller states it', () => {
		const seeded: Facts = {
			...IDLE,
			changed: (form) =>
				[...form.querySelectorAll('input')].some((box) => box.value !== box.defaultValue)
		};
		screen = mounted(seeded, 'Hope Foundation');
		expect(screen.state()).toBe('disabled');

		screen.type('Hope Foundation Ltd');
		expect(screen.state()).toBe('idle');

		// back to what is stored, in a box that is not empty: the reading the caller stated is the
		// only thing that can tell this from an edit.
		screen.type('Hope Foundation');
		expect(screen.state()).toBe('disabled');
	});

	/**
	 * and a caller whose form layer already keeps the answer states it outright, which is the shape
	 * both operator surfaces use: conform's own `dirty` against the values it was seeded with
	 * (packages/console-ui/src/lib/use-console-form.ts).
	 *
	 * the case that decides it is the second one: the button arms on a render where nothing was
	 * typed at all. a row added or dropped by a list intent changes the payload and fires no input
	 * event, so a reading sampled at a keystroke never sees it and the button rests closed over an
	 * edit the operator has just made.
	 */
	it('takes the answer from a caller that states it, with no keystroke to read at', () => {
		screen = mounted({ ...IDLE, changed: false }, 'Hope Foundation');
		// a box holding something and the caller saying there is nothing to send: what the boxes hold
		// is not read at all where the answer is stated.
		expect(screen.state()).toBe('disabled');

		screen.answer({ ...IDLE, changed: true });
		expect(screen.state()).toBe('idle');

		screen.answer({ ...IDLE, changed: false });
		expect(screen.state()).toBe('disabled');
	});

	/**
	 * the four seconds a confirmation stands are counted from the button drawing it
	 * (./save-state.ts), and this hook is where that press is known: it hands its own `pending` down
	 * rather than reading it beside what came back. the console's answers commit before the reads
	 * they set off return, so a form whose round trip outlasts four seconds is drawing its dots for
	 * the whole window and would report a stored write to nobody.
	 */
	it('holds the confirmation until its own write has stopped drawing pending', () => {
		vi.useFakeTimers();
		screen = mounted(IDLE);
		screen.type('sk_test_51abc');

		const answered: Facts = { ...IDLE, report: { done: true }, landed: true, pending: true };
		screen.answer(answered);
		expect(screen.state()).toBe('pending');

		screen.wait(11000);
		screen.answer({ ...answered, pending: false });
		expect(screen.state()).toBe('done');

		screen.wait(4000);
		expect(screen.state()).toBe('disabled');
	});

	/**
	 * `spent` is the caller's answer where a press that landed is not one that emptied the form — a
	 * press whose slow half stopped is worth making again, and a form emptied under it would have
	 * the operator type everything a second time.
	 */
	it('keeps the boxes when the caller says the press is not spent', () => {
		screen = mounted(IDLE);
		screen.type('sk_test_51abc');

		screen.answer({ ...IDLE, report: { half: true }, landed: true, spent: false });
		expect(screen.box().value).toBe('sk_test_51abc');
	});

	/**
	 * a press the caller can already tell is refused reaches nothing.
	 *
	 * what the reading looked at is the caller's and is nowhere here — the boxes belong to the form
	 * layer. it is stopped at the form and not at the button, so it holds back whichever control
	 * submits, the one inside a confirm card included, and nothing starts: the button never draws its
	 * dots over a press whose answer is already on the screen.
	 */
	it('holds back a press the caller’s own reading turns down, and sends the next one', () => {
		let refuses = true;
		screen = mounted({ ...IDLE, press: () => !refuses });
		screen.type('12-123234');

		screen.press();
		expect(screen.sent()).toBe(0);

		// the reading is taken at every press rather than remembered, so the press after the caller
		// has changed its mind is the one that goes.
		refuses = false;
		screen.press();
		expect(screen.sent()).toBe(1);
	});

	/** a form that hands in no reading of its own is stopped by nothing at all. */
	it('sends a press where the caller states no reading', () => {
		screen = mounted(IDLE);
		screen.type('sk_test_51abc');

		screen.press();
		expect(screen.sent()).toBe(1);
	});
});
