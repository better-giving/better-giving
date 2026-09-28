// the share channels a donor page can offer, what each is called on a button, and where each sends
// a donor. the organisation's Sharing picks some of these and orders them; the page's share block
// draws them in that order ($lib/donate/blocks/share.tsx).
//
// pure and not under `$lib/server/**`, for the reason ./keys.ts gives: the rule that refuses an
// off-list channel and the block that draws one read the same list.

export const SHARE_CHANNELS = [
	'facebook',
	'whatsapp',
	'email',
	'copy-link',
	'linkedin',
	'x'
] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const SHARE_CHANNEL_LABELS: Record<ShareChannel, string> = {
	facebook: 'Facebook',
	whatsapp: 'WhatsApp',
	email: 'Email',
	'copy-link': 'Copy link',
	linkedin: 'LinkedIn',
	x: 'X'
};

/** what a channel is handed: the page's own address and the message said with it. */
export type ShareOffer = { readonly url: string; readonly message: string };

const q = encodeURIComponent;

/**
 * the address a channel's button opens. copying the link is a press on the page itself and opens
 * nothing, so it has none. an empty message sends the address alone.
 */
export function shareHref(
	channel: Exclude<ShareChannel, 'copy-link'>,
	{ url, message }: ShareOffer
) {
	const said = message === '' ? url : `${message} ${url}`;
	switch (channel) {
		case 'facebook':
			return `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`;
		case 'whatsapp':
			return `https://wa.me/?text=${q(said)}`;
		case 'email':
			return `mailto:?body=${q(said)}`;
		case 'linkedin':
			return `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`;
		case 'x':
			return message === ''
				? `https://x.com/intent/post?url=${q(url)}`
				: `https://x.com/intent/post?text=${q(message)}&url=${q(url)}`;
	}
}
