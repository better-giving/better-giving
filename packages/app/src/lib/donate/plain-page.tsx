import formLayout from '@better-giving/form/styles/layout.css?url';
import formMotion from '@better-giving/form/styles/motion.css?url';
import formParts from '@better-giving/form/styles/parts.css?url';
import formTokens from '@better-giving/form/styles/tokens.css?url';
import { part } from '@better-giving/form/parts';
import type { FormConfig } from '@better-giving/form/v1';
import type { ReactNode } from 'react';
import { DonateCard } from './card';
import * as copy from './copy';
import pageChrome from './page.css?url';
import { PageRoot } from './page-root';
import { Masthead, type PageLogo, type PageLook } from './page-view';

// what every donor page route shares beyond the renderer: its stylesheets, and the plain page drawn
// where the stored page cannot be — the donation box alone, the notice where there is no box, and
// an ended campaign's screen.

/**
 * the form's four sheets and the page's own chrome, in that order, for a donor page's `links`.
 *
 * the four are in the order `sheetsFor` in packages/form/src/element.ts adopts them, which is
 * cascade order for the equal-specificity rules they are almost entirely made of. none of them is
 * hoisted with a `precedence`: a donor page's whole document is these five, so there is nothing for
 * a precedence to order them against.
 */
export function donorPageLinks() {
	return [formTokens, formParts, formLayout, formMotion, pageChrome].map((href) => ({
		rel: 'stylesheet' as const,
		href
	}));
}

/** the form's own look — its grey, light, soft — for a page with no look to read. */
export const FORM_LOOK: PageLook = { brandColour: null, shade: 'light', corner: 'soft' };

/** a page root on `plain` in one column, holding `children` and nothing else. */
export function PlainPage({
	look,
	children
}: {
	readonly look: PageLook;
	readonly children: ReactNode;
}) {
	return (
		<PageRoot
			brandColour={look.brandColour}
			shade={look.shade}
			corner={look.corner}
			palette="plain"
			layout="column"
		>
			<main className="stage">{children}</main>
		</PageRoot>
	);
}

/**
 * a page whose stored document is missing or fails the read rule: its donation box alone, in the
 * organisation's look, so a gift can still be made while the page is repaired.
 */
export function PlainDonationPage({
	config,
	look
}: {
	readonly config: FormConfig;
	readonly look: PageLook;
}) {
	return (
		<PlainPage look={look}>
			<DonateCard config={config} />
		</PlainPage>
	);
}

/**
 * an ended campaign's address: the organisation's name over the page as /donate draws it, then the
 * campaign's name, that it has ended, and the way on to /donate — at the page's reading measure,
 * in the organisation's look, with no donation box. a deployment with no organisation name yet
 * draws no masthead, logo or not.
 */
export function EndedCampaignPage({
	name,
	orgName,
	logo,
	look
}: {
	readonly name: string;
	readonly orgName: string | null;
	/** the organisation's logo, in the masthead; null or absent where it has none. */
	readonly logo?: PageLogo | null | undefined;
	readonly look: PageLook;
}) {
	return (
		<PageRoot
			brandColour={look.brandColour}
			shade={look.shade}
			corner={look.corner}
			palette="plain"
			layout="column"
		>
			{orgName === null ? null : <Masthead name={orgName} logo={logo ?? null} />}
			<main className="stage ended">
				<h1>{copy.campaignEnded(name)}</h1>
				<p>{copy.CAMPAIGN_ENDED_THANKS}</p>
				<a part={part('action')} href="/donate">
					{copy.donateTo(orgName)}
				</a>
			</main>
		</PageRoot>
	);
}
