import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import {
	BRAND_MARK_PLATFORMS,
	BrandMark
} from '@better-giving/operator/components/status/BrandMark';

/*
 * every network's mark, read off `BRAND_MARK_PLATFORMS` so a network added there arrives here
 * without a line in this file.
 *
 * each stands in `.adm-brand`, the box packages/operator/src/styles/base.css gives a company's own
 * mark on an operator screen: the box sets the height and the file sets the width, so YouTube's,
 * TikTok's and X's marks run to their own shapes beside the square ones. each is beside the
 * network's name, which is how a mark always stands — it is out of the tree, and the words are what
 * a reader is told.
 */

const NAMES = { ...SOCIAL_PLATFORM_NAMES, whatsapp: 'WhatsApp' };

export default function StatusBrandMarkPreview() {
	return (
		<div className="adm-stack">
			{BRAND_MARK_PLATFORMS.map((platform) => (
				<p key={platform}>
					<BrandMark platform={platform} className="adm-brand" /> {NAMES[platform]}
				</p>
			))}
		</div>
	);
}
