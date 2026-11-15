import type { CSSProperties } from 'react';
import { Paragraph } from '../components/layout';
import { LINK } from '../tokens';

// the sentence that ends on the donor's own gift page, shared by the receipt's match note, the
// match pack and its reminder so the three print the address one way.
//
// the address is the anchor's text as well as its href, the same as ./supporter-sign-in.tsx: a
// client that strips the anchor still leaves something the donor can copy. it closes the sentence
// with no full stop after it, so a client that linkifies the text arm folds nothing into it.

/** a sentence ending in the gift page's address, as one paragraph of the html arm. */
export function GiftPageSentence({
	lead,
	url
}: {
	/** the sentence up to its colon, without the trailing space. */
	readonly lead: string;
	readonly url: string;
}) {
	return (
		<Paragraph>
			{`${lead} `}
			<a href={url} style={ANCHOR_STYLE} target="_blank" rel="noopener">
				{url}
			</a>
		</Paragraph>
	);
}

/** the same sentence in the text arm. */
export function giftPageLine(lead: string, url: string): string {
	return `${lead} ${url}`;
}

/**
 * coloured and undecorated, as ./supporter-sign-in.tsx draws its link. `break-all` because a token
 * is one unbreakable word wider than a phone.
 */
const ANCHOR_STYLE: CSSProperties = {
	color: LINK,
	textDecorationLine: 'none',
	wordBreak: 'break-all'
};
