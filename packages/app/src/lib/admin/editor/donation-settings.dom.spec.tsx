import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { SettingsSeed } from '$lib/page/settings-form';
import { DonationSettingsSheet } from './donation-settings';
import { DoneSheet } from './done-sheet';

// the Donation settings sheet with conform's form as the sheet's own: Done submits it through
// conform's `onSubmit`, the amounts' Add and Remove are conform's list intents inside it, and Enter
// in a box presses Done rather than the first of those.
//
// happy-dom does not submit a form on Enter, so `defaultButton` below finds the button the platform
// clicks for it (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission):
// the first submit button in tree order among the form's own elements. what the case holds is
// which button that is.
//
// nothing here reads a class or asks how any of it looks, which is what keeps it clear of
// CLAUDE.md's ban on a browser spec over a dashboard screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function seed(amounts: string[]): SettingsSeed {
	return {
		boxes: {
			program_mode: 'none',
			program_id: '',
			min_minor: '5',
			max_minor: '500',
			suggested_amounts: amounts
		},
		currency: 'USD',
		programs: [],
		retired: null,
		summary: '',
		switches: { open_on_monthly: false, dedication_on: false },
		monthlyOffered: true
	};
}

/** the sheet under the editor's route, whose action records every body posted to it. */
function sheet(amounts: string[]) {
	const posted: FormData[] = [];
	const onSaved = vi.fn();
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			Component: () => (
				<DonationSettingsSheet
					seed={seed(amounts)}
					version={3}
					onDismiss={() => {}}
					onSaved={onSaved}
				/>
			),
			action: async ({ request }) => {
				posted.push(await request.formData());
				return { saved: 'settings' };
			}
		}
	]);
	const root = mount(<Stub initialEntries={['/admin/donation-page']} />);
	return { root, posted, onSaved };
}

function button(root: Element, name: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
		(one) => (one.getAttribute('aria-label') ?? one.textContent?.trim()) === name
	);
	if (found === undefined) throw new Error(`no button named ${name}`);
	return found;
}

function box(root: Element, label: string): HTMLInputElement {
	const found = [...root.querySelectorAll('label')].find(
		(one) => one.textContent?.trim() === label
	);
	const control = found?.htmlFor ? root.ownerDocument.getElementById(found.htmlFor) : null;
	if (!(control instanceof HTMLInputElement)) throw new Error(`no box labelled ${label}`);
	return control;
}

function rows(root: Element): string[] {
	return [...root.querySelectorAll<HTMLInputElement>('input[name^="suggested_amounts["]')].map(
		(row) => row.value
	);
}

/** the landing of a fetcher's round trip, which settles over a few tasks. */
async function settle() {
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
}

async function press(control: HTMLElement) {
	await act(async () => {
		control.click();
	});
	await settle();
}

function isSubmitButton(element: Element): element is HTMLButtonElement | HTMLInputElement {
	if (element instanceof HTMLButtonElement) return element.type === 'submit';
	return element instanceof HTMLInputElement && ['submit', 'image'].includes(element.type);
}

/** the button Enter in `field` clicks: its form's default button. */
function defaultButton(field: HTMLInputElement) {
	const form = field.form;
	if (form === null) throw new Error('the box is in no form');
	return [...form.elements].find(isSubmitButton);
}

describe('the Donation settings sheet', () => {
	it('posts through conform when Done is pressed', async () => {
		const { root, posted, onSaved } = sheet(['25', '50']);

		await press(button(root, 'Done'));

		expect(posted).toHaveLength(1);
		const [body] = posted;
		expect([
			body?.get('min_minor'),
			body?.get('max_minor'),
			body?.get('suggested_amounts[0]'),
			body?.get('suggested_amounts[1]')
		]).toEqual(['5', '500', '25', '50']);
		expect(onSaved).toHaveBeenCalledOnce();
	});

	it('runs conform’s pass on Done, so a refused box posts nothing', async () => {
		const { root, posted } = sheet(['25']);
		const smallest = box(root, 'Smallest gift');
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(smallest, '');
			smallest.dispatchEvent(new Event('input', { bubbles: true }));
		});

		await press(button(root, 'Done'));

		expect(posted).toEqual([]);
		expect(smallest.getAttribute('aria-invalid')).toBe('true');
	});

	it('adds and removes an amount row in the sheet, posting nothing', async () => {
		const { root, posted } = sheet(['25', '50']);

		await press(button(root, 'Add an amount'));
		expect(rows(root)).toEqual(['25', '50', '']);

		await press(button(root, 'Remove suggested amount 1'));
		expect(rows(root)).toEqual(['50', '']);
		expect(posted).toEqual([]);
	});

	it('presses Done for Enter in the smallest gift, and not Add', async () => {
		const { root, posted } = sheet(['25', '50']);
		const pressed = defaultButton(box(root, 'Smallest gift'));

		expect(pressed).toBe(button(root, 'Done'));

		if (pressed) await press(pressed);
		expect(rows(root)).toEqual(['25', '50']);
		expect(posted).toHaveLength(1);
	});
});

describe('a sheet handed a form’s own props', () => {
	it('turns a press away while its apply is in flight', () => {
		const onSubmit = vi.fn();
		const root = mount(
			<DoneSheet
				title="Donation settings"
				onDismiss={() => {}}
				formProps={{ id: 'held', onSubmit }}
				applying
			>
				<input name="min_minor" defaultValue="5" />
			</DoneSheet>
		);

		act(() => button(root, 'Done').click());

		expect(onSubmit).not.toHaveBeenCalled();
	});
});
