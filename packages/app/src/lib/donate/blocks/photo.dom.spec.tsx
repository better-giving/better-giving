import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { imageSrc } from '../../page/image-src';
import { HeroBlock, type HeroVariant } from './hero';
import { ImageBlock, type ImageVariant } from './image';
import type { PhotoBlockValues } from './photo';

// the hero and image blocks, mounted in every variant: each photo is drawn from the deployment's
// image route by its id and by nothing else, its alt text is the stored one or empty, and a block
// with no photo placed leaves itself out. how any of it looks is left to a person looking at it.

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

/** the two stored values a case varies. */
type Own = Partial<Pick<PhotoBlockValues<string>, 'imageId' | 'alt'>>;

const values = <V extends string>(variant: V, own: Own = {}): PhotoBlockValues<V> => ({
	id: `b-${variant}`,
	variant,
	background: 'none',
	imageId: ID,
	alt: ALT,
	...own
});

const HEROES: readonly HeroVariant[] = ['wide', 'framed'];
const IMAGES: readonly ImageVariant[] = ['column', 'wide'];

type Case = {
	readonly name: string;
	readonly draw: (own?: Own) => ReactNode;
};
const CASES: readonly Case[] = [
	...HEROES.map((variant) => ({
		name: `hero ${variant}`,
		draw: (own = {}) => <HeroBlock block={values(variant, own)} imageSrc={imageSrc} />
	})),
	{
		name: 'hero under the cover layout',
		draw: (own = {}) => (
			<HeroBlock
				block={values('wide', own)}
				imageSrc={imageSrc}
				over={<h1>Winter coat drive</h1>}
			/>
		)
	},
	...IMAGES.map((variant) => ({
		name: `image ${variant}`,
		draw: (own = {}) => <ImageBlock block={values(variant, own)} imageSrc={imageSrc} />
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

	it('leaves itself out until a photo is placed', () => {
		expect(mount(draw({ imageId: null })).childNodes).toHaveLength(0);
	});
});

describe('when each photo is fetched', () => {
	it.each(HEROES)('asks for the hero first, %s', (variant) => {
		const photo = onlyPhoto(mount(<HeroBlock block={values(variant)} imageSrc={imageSrc} />));
		expect(photo.getAttribute('fetchpriority')).toBe('high');
		expect(photo.hasAttribute('loading')).toBe(false);
	});

	it.each(IMAGES)('waits on an image until it nears the screen, %s', (variant) => {
		const photo = onlyPhoto(mount(<ImageBlock block={values(variant)} imageSrc={imageSrc} />));
		expect(photo.getAttribute('loading')).toBe('lazy');
		expect(photo.hasAttribute('fetchpriority')).toBe(false);
	});
});

describe('the cover', () => {
	it('lays the title over the photo, whatever the stored variant', () => {
		for (const variant of HEROES) {
			const host = mount(
				<HeroBlock block={values(variant)} imageSrc={imageSrc} over={<h1>Winter coat drive</h1>} />
			);
			const hero = host.querySelector('.page-hero');
			expect(hero?.getAttribute('data-variant')).toBe('cover');
			expect(hero?.querySelector('.page-hero-over h1')?.textContent).toBe('Winter coat drive');
		}
	});
});
