import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import type { OrgInfo as OrgInfoValues } from './types';

// who the gift is made to, as the organisation's legal details state it, closing every page as one
// line: the name, the EIN, the address joined, the email and the social links, each drawn only where
// the organisation has set it. each social link is its platform's mark alone, opening in a new tab,
// and its name says both.
//
// every detail is a list item, so a screen reader and a copied selection meet each one apart: the
// line's gaps are drawn, not text, and left to them an EIN's last digit runs into the street number.
// the legal name and EIN are who the organisation is; only the ways to reach it stand in `address`.

export function OrgInfo({ info }: { readonly info: OrgInfoValues }) {
	return (
		<div className="page-org">
			<ul className="page-org-list">
				<li className="page-org-name">{info.legalName}</li>
				{info.ein === null ? null : <li>EIN {info.ein}</li>}
			</ul>
			<OrgContact contact={info} />
		</div>
	);
}

/** whether the organisation has stated any way to reach it, which `OrgContact` draws. */
export function hasContact(contact: OrgContactValues): boolean {
	return (
		contact.addressLines.length > 0 || contact.email !== null || contact.socialLinks.length > 0
	);
}

type OrgContactValues = Pick<OrgInfoValues, 'addressLines' | 'email' | 'socialLinks'>;

/**
 * the ways to reach the organisation alone: the footer's second half, and the whole of the Donation
 * page's footer under its profile head, which names the organisation and its EIN already.
 */
export function OrgContact({ contact }: { readonly contact: OrgContactValues }) {
	if (!hasContact(contact)) return null;
	return (
		<address className="page-org-contact">
			<ul className="page-org-list">
				{contact.addressLines.length === 0 ? null : <li>{contact.addressLines.join(', ')}</li>}
				{contact.email === null ? null : (
					<li>
						<a href={`mailto:${contact.email}`}>{contact.email}</a>
					</li>
				)}
				{contact.socialLinks.length === 0 ? null : (
					<li className="page-org-links">
						{contact.socialLinks.map((link) => (
							<a
								key={link.href}
								className="page-org-social"
								href={link.href}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`${SOCIAL_PLATFORM_NAMES[link.platform]}, opens in a new tab`}
							>
								<BrandMark platform={link.platform} className="page-org-mark" />
							</a>
						))}
					</li>
				)}
			</ul>
		</address>
	);
}
