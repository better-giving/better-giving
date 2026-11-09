// the one address a page's photo or video poster has: the deployment's own image route, by the
// image's id (src/routes/image.$id.ts). each is held by id and never a URL, so nothing a draft
// carries can point a donor's browser at another host.
//
// pure and not under `$lib/server/**`: the route that renders a page and the editor's preview
// build the same address.
import type { Page } from './catalog';

/** where the deployment serves a stored image's bytes. */
export const imageSrc = (imageId: string) => `/image/${encodeURIComponent(imageId)}`;

/**
 * the id of each stored image the page places: its cover photo's, each photo beside it, then each
 * video's poster.
 */
export function placedImageIds(page: Pick<Page, 'hero' | 'photos' | 'videos'>): string[] {
	return [
		...(page.hero === undefined ? [] : [page.hero.imageId]),
		...(page.photos ?? []).map((photo) => photo.imageId),
		...(page.videos ?? []).map((video) => video.posterImageId)
	];
}

/**
 * a page's share image: its cover photo, absolute against the page's own address, or null where it
 * has none. the cover photo is the share image; no other photo is.
 */
export function shareImage(page: Pick<Page, 'hero'>, pageUrl: string): string | null {
	return page.hero === undefined ? null : new URL(imageSrc(page.hero.imageId), pageUrl).href;
}
