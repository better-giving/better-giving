import { href } from 'react-router';
import { imageSrc } from '../../page/image-src';
import type { OrgLogo } from '../org/queries';
import { supporterLinkOrigin } from './area';

// what a live supporter fundraiser is shared with when its address is pasted into a chat or a post:
// the tags `meta` in routes/f.$slug.tsx draws from it. every address is absolute on the origin
// `BETTER_AUTH_URL` pins (`supporterLinkOrigin` in ./area.ts) and never the request's, so a request
// naming another `Host` cannot put that host in a preview; where nothing is pinned there is no
// address and no image. the image is the stored photo as it is, nothing generated or resized.

/** the most characters a share description runs to, its ellipsis included. */
export const SHARE_DESCRIPTION_MAX = 160;

/**
 * a story as a share description: its whitespace run together, and where it is longer than
 * `SHARE_DESCRIPTION_MAX` characters, cut at the last whole word that leaves room for `…`. counted
 * in code points, so a cut never splits a character.
 */
export function shareDescription(story: string): string {
	const text = [...story.trim().replace(/\s+/g, ' ')];
	if (text.length <= SHARE_DESCRIPTION_MAX) return text.join('');
	const room = SHARE_DESCRIPTION_MAX - 1;
	const lastSpace = text.slice(0, room + 1).lastIndexOf(' ');
	const head = text.slice(0, lastSpace > 0 ? lastSpace : room).join('');
	return `${head}…`;
}

/** a live fundraiser's share tags' values; `url` and `image` null where there is none to name. */
export type FundraiserShare = {
	readonly title: string;
	readonly description: string;
	readonly url: string | null;
	readonly image: string | null;
};

/** the share values of the live fundraiser at `slug`: its photo, else the organisation's logo. */
export function fundraiserShare(
	env: Env,
	page: {
		readonly slug: string;
		readonly title: string;
		readonly story: string;
		readonly photoId: string | null;
	},
	logo: OrgLogo | null
): FundraiserShare {
	const pinned = supporterLinkOrigin(env);
	const imageId = page.photoId ?? logo?.imageId ?? null;
	return {
		title: page.title,
		description: shareDescription(page.story),
		url: pinned.ok ? `${pinned.origin}${href('/f/:slug', { slug: page.slug })}` : null,
		image: pinned.ok && imageId !== null ? `${pinned.origin}${imageSrc(imageId)}` : null
	};
}
