import { imageSrc } from '../page/image-src';
import type { PageLogo } from './page-view';
import type { OrgInfo, PageMoney, PageOrg } from './sections/types';

// what the Donation page's profile head draws at /donate: who the organisation is, what it has
// raised and how to reach it. the loader reads it with the rest of the page
// (`loadPageView` in ../server/pages/view.ts); a campaign at its own address is handed none.
//
// fields only: which layout the head takes, compact or profile, is the component's to pick from
// what is here.

/** a stored photo as the page draws it: the address it is served from, and its shape. */
export type ProfilePhoto = {
	readonly src: string;
	readonly width: number;
	readonly height: number;
};

export type DonateProfile = {
	readonly name: string;
	/** the EIN as printed, `12-3456789`; null where the organisation has stated none. */
	readonly taxId: string | null;
	/** the 4:1 banner; null where none is put on. */
	readonly banner: { readonly src: string } | null;
	readonly logo: ProfilePhoto | null;
	/** plain text, a blank line between paragraphs; null where the organisation has written none. */
	readonly mission: string | null;
	readonly vision: string | null;
	/**
	 * every settled gift through every page and form, net of refunds, in `money.currency`: a `SUM`
	 * read on this request (`organisationRaised` in ../server/pages/goal.ts). `gifts` counts each
	 * gift standing at more than nothing, each charge of a repeating gift as one.
	 */
	readonly raised: { readonly raisedMinor: number; readonly gifts: number };
	/** how `raised` is worded: the served config's locale and currency. */
	readonly money: PageMoney;
	readonly footer: Pick<OrgInfo, 'addressLines' | 'email' | 'socialLinks'>;
};

/** the profile head's fields, from the organisation, its photos and its raised figure as read. */
export function donateProfile({
	org,
	logo,
	bannerImageId,
	raised,
	money
}: {
	readonly org: PageOrg;
	readonly logo: PageLogo | null;
	readonly bannerImageId: string | null;
	readonly raised: DonateProfile['raised'];
	readonly money: PageMoney;
}): DonateProfile {
	const { ein, addressLines, email, socialLinks } = org.info;
	return {
		name: org.name,
		taxId: ein,
		banner: bannerImageId === null ? null : { src: imageSrc(bannerImageId) },
		logo:
			logo === null
				? null
				: { src: imageSrc(logo.imageId), width: logo.width, height: logo.height },
		mission: org.mission,
		vision: org.vision,
		raised,
		money,
		footer: { addressLines, email, socialLinks }
	};
}
