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
	const contact =
		info.addressLines.length > 0 || info.email !== null || info.socialLinks.length > 0;
	return (
		<div className="page-org">
			<ul className="page-org-list">
				<li className="page-org-name">{info.legalName}</li>
				{info.ein === null ? null : <li>EIN {info.ein}</li>}
			</ul>
			{contact ? (
				<address className="page-org-contact">
					<ul className="page-org-list">
						{info.addressLines.length === 0 ? null : <li>{info.addressLines.join(', ')}</li>}
						{info.email === null ? null : (
							<li>
								<a href={`mailto:${info.email}`}>{info.email}</a>
							</li>
						)}
						{info.socialLinks.length === 0 ? null : (
							<li className="page-org-links">
								{info.socialLinks.map((link) => (
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
			) : null}
		</div>
	);
}
