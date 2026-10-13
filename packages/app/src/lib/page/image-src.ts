// the one address a page's photo has: the deployment's own image route, by the photo's id
// (src/routes/image.$id.ts). a photo block is handed an id and never a URL, so nothing a draft or
// an AI reply carries can point a donor's browser at another host.
//
// pure and not under `$lib/server/**`: the route that renders a page and the editor's preview
// build the same address.
import type { Page } from './catalog';

/** where the deployment serves a stored image's bytes. */
export const imageSrc = (imageId: string) => `/image/${encodeURIComponent(imageId)}`;

/**
 * a page's share image: its first hero's photo, absolute against the page's own address, or null
 * where it has no hero or the hero no photo. the cover photo is the share image; no other field is.
 */
export function shareImage(page: Pick<Page, 'blocks'>, pageUrl: string): string | null {
	for (const block of page.blocks) {
		if (block.type !== 'hero') continue;
		return block.imageId === null ? null : new URL(imageSrc(block.imageId), pageUrl).href;
	}
	return null;
}
