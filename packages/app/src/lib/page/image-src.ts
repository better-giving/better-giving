// the one address a page's photo has: the deployment's own image route, by the photo's id
// (src/routes/image.$id.ts). a page's photo is held by id and never a URL, so nothing a draft
// carries can point a donor's browser at another host.
//
// pure and not under `$lib/server/**`: the route that renders a page and the editor's preview
// build the same address.
import type { Page } from './catalog';

/** where the deployment serves a stored image's bytes. */
export const imageSrc = (imageId: string) => `/image/${encodeURIComponent(imageId)}`;

/** the id of each photo the page places: its cover photo's, then each photo beside it. */
export function placedImageIds(page: Pick<Page, 'hero' | 'photos'>): string[] {
	return [
		...(page.hero === undefined ? [] : [page.hero.imageId]),
		...(page.photos ?? []).map((photo) => photo.imageId)
	];
}

/**
 * a page's share image: its cover photo, absolute against the page's own address, or null where it
 * has none. the cover photo is the share image; no other photo is.
 */
export function shareImage(page: Pick<Page, 'hero'>, pageUrl: string): string | null {
	return page.hero === undefined ? null : new URL(imageSrc(page.hero.imageId), pageUrl).href;
}
