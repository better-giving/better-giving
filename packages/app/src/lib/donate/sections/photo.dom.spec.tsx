import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { imageSrc } from '../../page/image-src';
import { Cover } from './cover';
import { Photos } from './photos';

// the cover and the photos beside it, mounted: each photo is drawn from the deployment's image
// route by its id and by nothing else, its alt text is the stored one or empty, and nothing captions
// it. how any of it looks is left to a person looking at it.

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

const ID = '0192a4c1-7d1e-7c3a-9f2b-4e5d6c7b8a90';
const ALT = 'Volunteers sorting winter coats by size at the Elm Street coat bank';

type Own = { readonly imageId?: string; readonly alt?: string | null };

const CASES: readonly { readonly name: string; readonly draw: (own?: Own) => ReactNode }[] = [
	{
		name: 'the cover',
		draw: (own = {}) => (
			<Cover cover={{ source: 'photo', imageId: ID, alt: ALT, ...own }} imageSrc={imageSrc} />
		)
	},
	...(['column', 'strip'] as const).map((shape) => ({
		name: `a photo beside it, ${shape}`,
		draw: (own: Own = {}) => (
			<Photos photos={[{ imageId: ID, alt: ALT, ...own }]} imageSrc={imageSrc} shape={shape} />
		)
	}))
];

const onlyPhoto = (host: HTMLElement) => {
	const photos = host.querySelectorAll('img');
	expect(photos).toHaveLength(1);
	return photos[0] as HTMLImageElement;
};

describe.each(CASES)('$name', ({ draw }) => {
	it('draws the photo from the image route by its id, with its alt text', () => {
		const photo = onlyPhoto(mount(draw()));
		expect(photo.getAttribute('src')).toBe(`/image/${ID}`);
		expect(photo.getAttribute('alt')).toBe(ALT);
	});

	it('keeps an id shaped like an address a path under the image route', () => {
		const photo = onlyPhoto(mount(draw({ imageId: 'https://elsewhere.example/a.png?x=1#y' })));
		expect(photo.getAttribute('src')).toBe(
			'/image/https%3A%2F%2Felsewhere.example%2Fa.png%3Fx%3D1%23y'
		);
		expect(photo.getAttribute('src')).toMatch(/^\/image\/[^/?#]+$/);
	});

	it('draws a photo with no alt text as decorative', () => {
		const photo = onlyPhoto(mount(draw({ alt: null })));
		expect(photo.hasAttribute('alt')).toBe(true);
		expect(photo.getAttribute('alt')).toBe('');
	});

	it('draws a plain photo and captions nothing', () => {
		const host = mount(draw());
		expect(host.querySelector('figure, figcaption')).toBeNull();
	});
});

describe('when each photo is fetched', () => {
	it('asks for the cover first', () => {
		const photo = onlyPhoto(mount(CASES[0]?.draw()));
		expect(photo.getAttribute('fetchpriority')).toBe('high');
		expect(photo.hasAttribute('loading')).toBe(false);
	});

	it('waits on a photo beside it until it nears the screen', () => {
		const photo = onlyPhoto(mount(CASES[1]?.draw()));
		expect(photo.getAttribute('loading')).toBe('lazy');
		expect(photo.hasAttribute('fetchpriority')).toBe(false);
	});
});

describe('the logo in the cover’s place', () => {
	it('draws the logo by its id, saying nothing of its own', () => {
		const host = mount(<Cover cover={{ source: 'logo', imageId: ID }} imageSrc={imageSrc} />);
		const logo = onlyPhoto(host);
		expect(logo.getAttribute('src')).toBe(`/image/${ID}`);
		expect(logo.getAttribute('alt')).toBe('');
	});
});
