import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { GiftNote, PublicMessagesLink } from './gift-note';

// the gifts list's word under a note, and its way to Public messages.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const NOTE = 'Keep up the good work.';

describe('a note in the gifts list', () => {
	it('carries no word where its donor kept it private', () => {
		const host = mount(<GiftNote note={NOTE} standing="private" />);
		expect(host.textContent).toBe(NOTE);
		expect(host.querySelector('.ds-badge')).toBeNull();
	});

	it('says "On the page" under a note the donate page shows', () => {
		const host = mount(<GiftNote note={NOTE} standing="shown" />);
		const word = host.querySelector('.adm-cell__under .ds-badge');
		expect(word?.textContent).toBe('On the page');
		expect(word?.classList.contains('adm-state--note')).toBe(false);
		expect(host.querySelector('.adm-cell__quiet')).toBeNull();
	});

	it('says "Hidden" without a ground under a hidden note, in the quiet ink', () => {
		const host = mount(<GiftNote note={NOTE} standing="hidden" />);
		const word = host.querySelector('.adm-cell__under .ds-badge');
		expect(word?.textContent).toBe('Hidden');
		expect(word?.classList.contains('adm-state--note')).toBe(true);
		expect(host.querySelector('.adm-cell__quiet')?.textContent).toBe(NOTE);
	});
});

describe('the way to Public messages', () => {
	it('is a quiet link to the screen', () => {
		const link = mount(<PublicMessagesLink />).querySelector('a');
		expect(link?.textContent).toBe('Public messages');
		expect(link?.getAttribute('href')).toBe('/admin/donations/messages');
		expect(link?.classList.contains('ds-btn-ghost')).toBe(true);
	});
});
