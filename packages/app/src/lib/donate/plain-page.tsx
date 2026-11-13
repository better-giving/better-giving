import registryButton from '@better-giving/form/registry/styles/button-css.css?url';
import registryCheckbox from '@better-giving/form/registry/styles/checkbox-css.css?url';
import registryField from '@better-giving/form/registry/styles/field-css.css?url';
import formLayout from '@better-giving/form/styles/layout.css?url';
import formMotion from '@better-giving/form/styles/motion.css?url';
import formParts from '@better-giving/form/styles/parts.css?url';
import formTokens from '@better-giving/form/styles/tokens.css?url';
import hostedFaces from '@better-giving/operator/styles/fonts.css?url';
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
 * the form's sheets, the self-hosted faces, and the page's own chrome, in that order, for a donor
 * page's `links`.
 *
 * the form's are in the order `sheetsFor` in packages/form/src/element.ts adopts them, which is
 * cascade order for the equal-specificity rules they are almost entirely made of: its tokens, the
 * registry's button, text box and tick box the card's controls carry the classes of
 * (`REGISTRY_CLASS` in packages/form/src/parts.ts), then its parts, layout and motion. the faces sit
 * after them and before the page, and their place orders nothing: the sheet
 * (packages/operator/src/styles/fonts.css) registers the files and re-points the registry's three
 * `--font-*` roles, which the form's token sheet declares unlayered, from inside a layer with
 * `!important`, which outranks them wherever it is linked. ./page.css reads those roles. none of
 * them is hoisted with a `precedence`: a donor page's whole document is these, so there is nothing
 * for a precedence to order them against. the embed links none of these.
 */
export function donorPageLinks() {
	return [
		formTokens,
		registryButton,
		registryField,
		registryCheckbox,
		formParts,
		formLayout,
		formMotion,
		hostedFaces,
		pageChrome
	].map((href) => ({
		rel: 'stylesheet' as const,
		href
	}));
}

/** the registry's default accent, for a page with no brand colour to read. */
export const FORM_LOOK: PageLook = { brandColour: null };

/** a page root in one plain column, holding `children` and nothing else. */
export function PlainPage({
	look,
	children
}: {
	readonly look: PageLook;
	readonly children: ReactNode;
}) {
	return (
		<PageRoot brandColour={look.brandColour} layout="plain">
			<main className="stage">{children}</main>
		</PageRoot>
	);
}

/**
 * a page whose stored document is missing or fails the read rule: its donation box alone, in the
 * organisation's brand colour, so a gift can still be made while the page is repaired.
 */
export function PlainDonationPage({
	config,
	look,
	resuming = false
}: {
	readonly config: FormConfig;
	readonly look: PageLook;
	/** whether the address carries this box's resume stamp, the card's own `resuming`. */
	readonly resuming?: boolean;
}) {
	return (
		<PlainPage look={look}>
			<DonateCard config={config} resuming={resuming} />
		</PlainPage>
	);
}

/**
 * an ended campaign's address, and an ended supporter fundraiser's: the organisation's name over
 * the page as /donate draws it, then the campaign's name, that it has ended, what the caller states
 * under that, and the way on to /donate — at the page's reading measure,
 * in the campaign's own published look (`donorLook` in $lib/server/pages/view.ts), with no
 * donation box. a deployment with no organisation name yet draws no masthead, logo or not.
 */
export function EndedCampaignPage({
	name,
	orgName,
	logo,
	look,
	children
}: {
	readonly name: string;
	readonly orgName: string | null;
	/** the organisation's logo, in the masthead; null or absent where it has none. */
	readonly logo?: PageLogo | null | undefined;
	readonly look: PageLook;
	/** what the page states under the thanks and over the way on: an ended fundraiser's total. */
	readonly children?: ReactNode;
}) {
	return (
		<PageRoot brandColour={look.brandColour} layout="plain">
			{orgName === null ? null : <Masthead name={orgName} logo={logo ?? null} />}
			<main className="stage ended">
				<h1>{copy.campaignEnded(name)}</h1>
				<p>{copy.CAMPAIGN_ENDED_THANKS}</p>
				{children}
				<a part={part('action')} href="/donate">
					{copy.donateTo(orgName)}
				</a>
			</main>
		</PageRoot>
	);
}
