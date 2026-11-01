import { GLYPHS } from '@better-giving/form/glyph';
import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SHARE_CHANNEL_LABELS, SHARE_CHANNELS } from '../../page/share';
import { SETTLE_MS, Share } from './share';

// the share buttons, mounted: each is a mark alone, named for its channel and for the new tab a
// network opens in, and each network is drawn as its own official file and never as a letter or a
// lookalike standing in for one. Copy link reports what it did in its name alone, and settles back.

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

/** the file packages/operator draws for a network, which is the one the page has to draw. */
function fileOf(platform: Parameters<typeof BrandMark>[0]['platform']) {
	return mount(<BrandMark platform={platform} className="page-share-brand" />)
		.querySelector('img')
		?.getAttribute('src');
}

const sharing = {
	message: 'Help us get every kid a coat.',
	url: 'https://give.example.org/coats'
};

const NETWORKS = ['facebook', 'whatsapp'] as const;

const share = () => mount(<Share sharing={sharing} heading="Share this campaign" headingId="sh" />);

describe('share', () => {
	const presses = () => [...share().querySelectorAll<HTMLElement>('.page-share-button')];

	it('gives its heading the id the section it stands in is named by', () => {
		expect(share().querySelector('h2')?.id).toBe('sh');
	});

	it.each(NETWORKS)('draws %s as its own file, hidden from a screen reader', (network) => {
		const press = presses()[SHARE_CHANNELS.indexOf(network)];
		const mark = press?.querySelector('img');

		expect(mark?.getAttribute('src')).toBe(fileOf(network));
		expect(mark?.getAttribute('alt')).toBe('');
		expect(mark?.getAttribute('aria-hidden')).toBe('true');
		expect(mark?.getAttribute('class')).toBe('page-share-brand');
	});

	it('stands no lettered mark in for a channel', () => {
		for (const press of presses()) {
			expect(
				press.querySelector('.page-share-brand, .page-share-mark')?.tagName.toLowerCase()
			).toMatch(/^(img|svg)$/);
		}
	});

	it('names each press for its channel, with no words of its own', () => {
		const pressed = presses();
		expect(pressed.map((press) => press.getAttribute('title'))).toEqual(
			SHARE_CHANNELS.map((channel) => SHARE_CHANNEL_LABELS[channel])
		);
		for (const press of pressed) {
			expect(press.textContent).toBe('');
			expect(press.getAttribute('aria-label')).toContain(press.getAttribute('title'));
		}
	});

	it.each(NETWORKS)('names %s for the new tab it opens in', (network) => {
		const press = presses()[SHARE_CHANNELS.indexOf(network)];
		expect(press?.getAttribute('target')).toBe('_blank');
		expect(press?.getAttribute('aria-label')).toBe(
			`${SHARE_CHANNEL_LABELS[network]}, opens in a new tab`
		);
	});

	it('names Email and Copy link for their channel alone, opening no tab', () => {
		const pressed = presses();
		for (const channel of ['email', 'copy-link'] as const) {
			const press = pressed[SHARE_CHANNELS.indexOf(channel)];
			expect(press?.hasAttribute('target')).toBe(false);
			expect(press?.getAttribute('aria-label')).toBe(SHARE_CHANNEL_LABELS[channel]);
		}
	});

	it.each([
		['copied', async () => {}, 'Link copied'],
		[
			'refused',
			async () => {
				throw new Error('denied');
			},
			'Couldn’t copy'
		]
	] as const)('names Copy link for what it did once the copy is %s', async (_, writeText, name) => {
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const copy = presses()[SHARE_CHANNELS.indexOf('copy-link')];
		await act(async () => copy?.click());
		expect(copy?.getAttribute('aria-label')).toBe(name);
		expect(copy?.getAttribute('title')).toBe(name);
	});

	it('reports a copy in its name alone, with no status region saying it again', async () => {
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const host = share();
		const copy =
			host.querySelectorAll<HTMLElement>('.page-share-button')[SHARE_CHANNELS.indexOf('copy-link')];
		await act(async () => copy?.click());
		expect(copy?.getAttribute('aria-label')).toBe('Link copied');
		expect(host.querySelector('[role="status"], [aria-live]')).toBeNull();
	});

	it('settles Copy link back to its name and mark once the moment passes', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
			vi.useRealTimers();
		});
		const copy = presses()[SHARE_CHANNELS.indexOf('copy-link')];
		const resting = copy?.innerHTML;
		await act(async () => copy?.click());
		expect(copy?.innerHTML).not.toBe(resting);

		act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
		expect(copy?.getAttribute('aria-label')).toBe('Link copied');

		act(() => vi.advanceTimersByTime(1));
		expect(copy?.getAttribute('aria-label')).toBe('Copy link');
		expect(copy?.getAttribute('title')).toBe('Copy link');
		expect(copy?.innerHTML).toBe(resting);
	});

	describe('Copy link mark', () => {
		const marks = (copy: Element | undefined) =>
			[...(copy?.querySelectorAll('svg path') ?? [])].map((p) => p.getAttribute('d'));

		function copyWith(writeText: () => Promise<void>) {
			vi.useFakeTimers();
			vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
			onTestFinished(() => {
				vi.unstubAllGlobals();
				vi.useRealTimers();
			});
			return presses()[SHARE_CHANNELS.indexOf('copy-link')];
		}

		it('swaps the link glyph for the tick on a copy and back after the moment passes', async () => {
			const copy = copyWith(async () => {});
			expect(marks(copy)).toEqual(GLYPHS.link);
			await act(async () => copy?.click());
			expect(marks(copy)).toEqual(GLYPHS.tick);
			act(() => vi.advanceTimersByTime(SETTLE_MS));
			expect(marks(copy)).toEqual(GLYPHS.link);
		});

		it('shows no tick when the copy is refused', async () => {
			const copy = copyWith(async () => {
				throw new Error('denied');
			});
			await act(async () => copy?.click());
			expect(copy?.getAttribute('aria-label')).toBe('Couldn’t copy');
			expect(marks(copy)).toEqual(GLYPHS.link);
			expect(marks(copy)).not.toEqual(GLYPHS.tick);
		});
	});
});
