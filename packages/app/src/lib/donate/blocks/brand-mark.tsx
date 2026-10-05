import type { SocialPlatform } from '@better-giving/operator/console/org';
import {
	IconBrandFacebook,
	IconBrandInstagram,
	IconBrandLinkedin,
	IconBrandTiktok,
	IconBrandWhatsapp,
	IconBrandX,
	IconBrandYoutube
} from '@tabler/icons-react';

// a network's mark, from @tabler/icons-react's brand set, drawn in `currentColor` at its source's
// stroke. every brand a donor page names is mapped here and nowhere else: the organisation's
// platforms, `SOCIAL_PLATFORMS` (`@better-giving/operator/console/org`), and the share channels
// that are a network (./share.tsx). it always stands where something else names the network, so it
// is hidden from a screen reader.

export type Brand = SocialPlatform | 'whatsapp';

const MARKS: Record<Brand, typeof IconBrandX> = {
	facebook: IconBrandFacebook,
	instagram: IconBrandInstagram,
	youtube: IconBrandYoutube,
	linkedin: IconBrandLinkedin,
	tiktok: IconBrandTiktok,
	x: IconBrandX,
	whatsapp: IconBrandWhatsapp
};

export function BrandMark({
	brand,
	className
}: {
	readonly brand: Brand;
	readonly className: string;
}) {
	const Mark = MARKS[brand];
	return <Mark className={className} aria-hidden="true" focusable="false" />;
}
