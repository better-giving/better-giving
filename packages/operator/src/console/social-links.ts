import { SOCIAL_PLATFORMS, type SocialLink, type SocialPlatform } from './org';
import { MAX_SOCIAL_LINK } from './org-rules';

// which platform a typed web address is on, and the list of them an organisation keeps — the whole
// of both, in the one module every surface reads them from.
//
// it is here for ./org-rules.ts's reason: the deployment parses every list it is sent
// (`parseOrgProfile` in `packages/app/src/lib/server/org/org-input.ts`) and the console reads the
// same boxes in front of the person typing, so a copy at either end is a link one half takes and
// the other refuses. the deployment stays the authority. the donor pages name each platform off
// `SOCIAL_PLATFORM_NAMES` too, so a link reads the same wherever it is drawn.

/** each platform as a fundraiser writes it. */
export const SOCIAL_PLATFORM_NAMES: Readonly<Record<SocialPlatform, string>> = {
	facebook: 'Facebook',
	instagram: 'Instagram',
	youtube: 'YouTube',
	linkedin: 'LinkedIn',
	tiktok: 'TikTok',
	x: 'X'
};

/**
 * the hosts each platform answers on, and every subdomain of each — `www.`, `m.`, `uk.linkedin.com`,
 * `vm.tiktok.com` — matched at a dot, so `evilfacebook.com` and `facebook.com.evil.org` are no
 * platform's.
 */
const HOSTS: ReadonlyMap<string, SocialPlatform> = new Map([
	['facebook.com', 'facebook'],
	['fb.com', 'facebook'],
	['instagram.com', 'instagram'],
	['youtube.com', 'youtube'],
	['youtu.be', 'youtube'],
	['linkedin.com', 'linkedin'],
	['tiktok.com', 'tiktok'],
	['x.com', 'x'],
	['twitter.com', 'x']
]);

/** the six as a refusal lists them: `Facebook, …, TikTok or X`. */
const PLATFORMS_LISTED = (() => {
	const names = SOCIAL_PLATFORMS.map((platform) => SOCIAL_PLATFORM_NAMES[platform]);
	return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
})();

export type SocialLinkReading =
	| { readonly ok: true; readonly link: SocialLink }
	| { readonly ok: false; readonly error: string };

/**
 * one typed address read as a link on one of the six platforms, or the sentence refusing it.
 *
 * the scheme is added where the address carries none (`youtu.be/…` is a link anyone would paste),
 * so what is stored is always an http(s) address; one that names any other scheme is refused,
 * never rewritten.
 */
export function readSocialLink(typed: string): SocialLinkReading {
	const address = typed.trim();
	if (address.length > MAX_SOCIAL_LINK) {
		return {
			ok: false,
			error: `This address is ${address.length} characters, over the ${MAX_SOCIAL_LINK}-character limit.`
		};
	}
	const url = webAddress(address);
	const platform = url && platformOf(url.hostname);
	if (!url || !platform) {
		return { ok: false, error: `${address} is not a ${PLATFORMS_LISTED} address.` };
	}
	return { ok: true, link: { platform, href: url.href } };
}

function platformOf(hostname: string): SocialPlatform | undefined {
	for (const [host, platform] of HOSTS) {
		if (hostname === host || hostname.endsWith(`.${host}`)) return platform;
	}
	return undefined;
}

/** a scheme at the front of an address: a name and a colon that no port could be. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![0-9])/;

function webAddress(address: string): URL | null {
	try {
		const url = new URL(SCHEME.test(address) ? address : `https://${address}`);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
	} catch {
		return null;
	}
}

export type SocialLinksReading =
	| { readonly ok: true; readonly links: readonly SocialLink[] }
	| { readonly ok: false; readonly error: string };

/**
 * the boxes as typed read as the list stored: blank ones skipped, the rest in the order typed, at
 * most one per platform. the first box refused is the one the sentence names — one sentence, because
 * the list is one box to the deployment's error map (`social_links`).
 */
export function readSocialLinks(typed: readonly string[]): SocialLinksReading {
	const links: SocialLink[] = [];
	for (const box of typed) {
		if (box.trim() === '') continue;
		const read = readSocialLink(box);
		if (!read.ok) return read;
		const { platform } = read.link;
		if (links.some((link) => link.platform === platform)) {
			const name = SOCIAL_PLATFORM_NAMES[platform];
			return { ok: false, error: `${name} is listed twice. Keep one ${name} address.` };
		}
		links.push(read.link);
	}
	return { ok: true, links };
}
