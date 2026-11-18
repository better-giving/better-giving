import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount, render } from '../render.testing';
import { SettingsLayout, SettingsSave, type SettingsSaveProps } from './SettingsLayout.jsx';

// a settings section's cards and its save row, through settings-layout-css's four states.

const save = (over: Partial<SettingsSaveProps> = {}): SettingsSaveProps => ({
	state: 'pristine',
	form: 'org',
	saveLabel: 'Save details',
	onDiscard: () => {},
	...over
});
const buttons = (root: HTMLElement) => [...root.querySelectorAll('.ds-settings-save > button')];

describe('the settings layout', () => {
	it('stacks the section’s cards and holds no nav', () => {
		const root = render(SettingsLayout, { children: <section className="ds-card">Card</section> });

		expect(root.querySelector('.ds-settings > .ds-card')?.textContent).toBe('Card');
		expect(root.querySelector('nav')).toBeNull();
	});

	// the class ../../styles/adm.css holds a card to the column and wraps its footer by
	// (../../styles/settings-card-fits.spec.ts).
	it('wears the operator class beside the registry’s grid', () => {
		const root = render(SettingsLayout, { children: <section className="ds-card">Card</section> });

		expect(root.querySelector('.ds-settings')?.classList.contains('adm-settings')).toBe(true);
	});
});

describe('the save row', () => {
	it('pristine: Discard and Save both say they are unavailable and keep focus', () => {
		const onDiscard = vi.fn();
		const root = render(SettingsSave, save({ onDiscard }));

		const [discard, submit] = buttons(root);
		expect(discard?.textContent).toBe('Discard');
		expect(discard?.getAttribute('aria-disabled')).toBe('true');
		expect(submit?.textContent).toBe('Save details');
		expect(submit?.getAttribute('aria-disabled')).toBe('true');
		expect(submit?.getAttribute('form')).toBe('org');
		expect(submit?.hasAttribute('disabled')).toBe(false);

		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		act(() => {
			submit?.dispatchEvent(click);
		});
		expect(click.defaultPrevented).toBe(true);
		act(() => (discard as HTMLButtonElement).click());
		expect(onDiscard).not.toHaveBeenCalled();
	});

	it('dirty: both open, and Discard makes the form pristine', () => {
		const onDiscard = vi.fn();
		const root = render(SettingsSave, save({ state: 'dirty', onDiscard }));

		const [discard, submit] = buttons(root);
		expect(discard?.hasAttribute('aria-disabled')).toBe(false);
		expect(submit?.hasAttribute('aria-disabled')).toBe(false);
		act(() => (discard as HTMLButtonElement).click());
		expect(onDiscard).toHaveBeenCalledOnce();
	});

	it('saving: Save busy with its spinner, Discard closed', () => {
		const root = render(SettingsSave, save({ state: 'saving' }));

		const [discard, submit] = buttons(root);
		expect(discard?.getAttribute('aria-disabled')).toBe('true');
		expect(submit?.getAttribute('aria-busy')).toBe('true');
		expect(submit?.getAttribute('aria-disabled')).toBe('true');
		expect(submit?.querySelector('.ds-spinner')).not.toBeNull();
		expect(submit?.textContent).toBe('Saving…');
	});

	it('saved: Save alone and done, the status saying so, focus moved off the Discard that left', () => {
		const row = mount(SettingsSave, save({ state: 'dirty' }));
		const [discard] = buttons(row.root);
		act(() => (discard as HTMLButtonElement).focus());

		row.again(save({ state: 'saved' }));

		const [only, ...rest] = buttons(row.root);
		expect(rest).toEqual([]);
		expect(only?.getAttribute('data-done')).toBe('true');
		expect(only?.textContent).toBe('Saved');
		expect(row.root.querySelector('[role="status"]')?.textContent).toBe('Saved');
		expect(document.activeElement).toBe(only);

		row.again(save({ state: 'pristine' }));
		expect(row.root.querySelector('[role="status"]')?.textContent).toBe('');
	});
});
