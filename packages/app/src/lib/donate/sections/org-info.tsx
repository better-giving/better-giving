import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import type { OrgInfo as OrgInfoValues } from './types';

// who the gift is made to, as the organisation's legal details state it, closing every page as one
// line: the name, the EIN, the address joined, the email and the social links, each drawn only where
// the organisation has set it. each social link is its platform's mark alone, opening in a new tab,
// and its name says both.

export function OrgInfo({ info }: { readonly info: OrgInfoValues }) {
	return (
		<address className="page-org">
			<span className="page-org-name">{info.legalName}</span>
			{info.ein === null ? null : <span>EIN {info.ein}</span>}
			{info.addressLines.length === 0 ? null : <span>{info.addressLines.join(', ')}</span>}
			{info.email === null ? null : <a href={`mailto:${info.email}`}>{info.email}</a>}
			{info.socialLinks.length === 0 ? null : (
				<span className="page-org-links">
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
				</span>
			)}
		</address>
	);
}
