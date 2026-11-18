import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import type { OrgInfo } from './sections/types';

// the foot of every donor page: the registry's compact site footer
// (packages/operator/src/registry/styles/site-footer-css.usage.md). its line is who the gift is
// made to, as the organisation's legal details state it — the legal name, the EIN and the postal
// address, joined by a middle dot so a screen reader and a copied selection meet each apart — and
// its links are the ways to reach the organisation: the email, then the social links in the
// console's order. each detail is drawn only where the organisation has set it.
//
// the list ends with one link to the dashboard, on every page that draws the footer and whether or
// not the organisation has set anything above it: `/` is the deployment's public home page, so a
// fresh deployment's owner who opens it still finds the way into the console. it reads "Staff sign
// in" for every visitor rather than "Dashboard" for a signed-in one, because telling the two apart
// would cost a session read the donor pages do not make (`staffGate` in
// $lib/server/auth/gate.ts reads the signing key and the session, two reads on every view), and
// `/admin` forwards a signed-in member to the dashboard anyway.

/** where the footer's staff link goes: the dashboard, which the gate answers with the sign-in. */
const STAFF_PATH = '/admin';

export type SiteFooterInfo = Omit<OrgInfo, 'legalName'> & {
	/** null where none is set, which leaves the name out of the line. */
	readonly legalName: string | null;
};

export function SiteFooter({ info }: { readonly info: SiteFooterInfo }) {
	const line = [
		info.legalName,
		info.ein === null ? null : `EIN ${info.ein}`,
		info.addressLines.length === 0 ? null : info.addressLines.join(', ')
	]
		.filter((part) => part !== null)
		.join(' · ');
	return (
		<footer className="ds-site-footer-compact">
			<div className="ds-site-footer-compact-row">
				{line === '' ? null : <p>{line}</p>}
				<nav aria-label="Footer">
					<ul>
						{info.email === null ? null : (
							<li>
								<a href={`mailto:${info.email}`}>{info.email}</a>
							</li>
						)}
						{info.socialLinks.map((link) => {
							const platform = SOCIAL_PLATFORM_NAMES[link.platform];
							return (
								<li key={link.href}>
									<a
										href={link.href}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={`${platform}, opens in a new tab`}
									>
										{platform}
									</a>
								</li>
							);
						})}
						<li>
							<a href={STAFF_PATH}>Staff sign in</a>
						</li>
					</ul>
				</nav>
			</div>
		</footer>
	);
}
