import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import { useContext } from 'react';
import type { OrgInfo } from './sections/types';
import { StaffMarkerContext } from './staff-marker-context';

// the foot of every donor page: the registry's compact site footer
// (packages/operator/src/registry/styles/site-footer-css.usage.md). its line is who the gift is
// made to, as the organisation's legal details state it — the legal name, the EIN and the postal
// address, joined by a middle dot so a screen reader and a copied selection meet each apart — and
// its links are the ways to reach the organisation: the email, then the social links in the
// console's order. each detail is drawn only where the organisation has set it.
//
// the list ends with a quiet "Console" link to the dashboard only on a browser that has signed in
// as staff before (`StaffMarkerContext`, read off a cookie by ../../root.tsx): a donor is shown no
// staff link at all, and with no organisation details and no marker there is nothing to draw, so
// the footer draws nothing. the marker authorizes nothing, so the link is a convenience and
// `/admin` is behind the session gate regardless ($lib/server/auth/gate.ts).

/** where the footer's console link goes: the dashboard. */
const CONSOLE_PATH = '/admin';

export type SiteFooterInfo = Omit<OrgInfo, 'legalName'> & {
	/** null where none is set, which leaves the name out of the line. */
	readonly legalName: string | null;
};

/**
 * the footer of a page that names nobody, such as a refusal, which says nothing back about who it
 * would serve: it holds only the console link, and only for a browser that carries the marker.
 */
export const NAMELESS_FOOTER: SiteFooterInfo = {
	legalName: null,
	ein: null,
	addressLines: [],
	email: null,
	socialLinks: []
};

export function SiteFooter({ info }: { readonly info: SiteFooterInfo }) {
	const returningStaff = useContext(StaffMarkerContext);
	const line = [
		info.legalName,
		info.ein === null ? null : `EIN ${info.ein}`,
		info.addressLines.length === 0 ? null : info.addressLines.join(', ')
	]
		.filter((part) => part !== null)
		.join(' · ');
	const linked = info.email !== null || info.socialLinks.length > 0 || returningStaff;
	if (line === '' && !linked) return null;
	return (
		<footer className="ds-site-footer-compact">
			<div className="ds-site-footer-compact-row">
				{line === '' ? null : <p>{line}</p>}
				{linked ? (
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
							{returningStaff ? (
								<li>
									<a href={CONSOLE_PATH}>Console</a>
								</li>
							) : null}
						</ul>
					</nav>
				) : null}
			</div>
		</footer>
	);
}
