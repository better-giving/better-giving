import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { SHARE_CHANNELS } from '../../page/share';
import { ShareBlock } from './share';
import type { BlockOf } from './types';

// the share block's marks, mounted in both variants: each network is drawn as its own mark and
// never as a letter standing in for one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const block = (variant: 'buttons' | 'icons'): BlockOf<'share'> => ({
	id: `b-${variant}`,
	type: 'share',
	variant,
	background: 'none'
});

const sharing = {
	channels: SHARE_CHANNELS,
	message: 'Help us get every kid a coat.',
	url: 'https://give.example.org/coats'
};

const NETWORKS = ['facebook', 'whatsapp', 'linkedin', 'x'] as const;

describe.each(['buttons', 'icons'] as const)('share, %s', (variant) => {
	const presses = () => {
		const host = mount(
			<ShareBlock block={block(variant)} sharing={sharing} heading="Share this campaign" />
		);
		return [...host.querySelectorAll<HTMLElement>('.page-share-button')];
	};

	it.each(NETWORKS)('draws %s as its own mark, hidden from a screen reader', (network) => {
		const press = presses()[SHARE_CHANNELS.indexOf(network)];
		const mark = press?.querySelector('svg');

		expect(mark?.getAttribute('class')).toContain(`tabler-icon-brand-${network}`);
		expect(mark?.getAttribute('aria-hidden')).toBe('true');
	});

	it('stands no lettered mark in for a network', () => {
		for (const press of presses()) {
			expect(press.querySelector('.page-share-mark')?.tagName.toLowerCase()).toBe('svg');
		}
	});
});
