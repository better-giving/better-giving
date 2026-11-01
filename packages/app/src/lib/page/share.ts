// the share buttons every donor page offers, in the order they stand, what each is called, and where
// each sends a donor. the set is fixed: no page chooses its own ($lib/donate/sections/share.tsx).
//
// pure and not under `$lib/server/**`: the page draws the buttons and its specs read the same list.

export const SHARE_CHANNELS = ['copy-link', 'email', 'facebook', 'whatsapp'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const SHARE_CHANNEL_LABELS: Record<ShareChannel, string> = {
	facebook: 'Facebook',
	whatsapp: 'WhatsApp',
	email: 'Email',
	'copy-link': 'Copy link'
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
	}
}
