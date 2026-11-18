import registryButton from '@better-giving/form/registry/styles/button-css.css?url';
import registryCheckbox from '@better-giving/form/registry/styles/checkbox-css.css?url';
import registryField from '@better-giving/form/registry/styles/field-css.css?url';
import formLayout from '@better-giving/form/styles/layout.css?url';
import formMotion from '@better-giving/form/styles/motion.css?url';
import formParts from '@better-giving/form/styles/parts.css?url';
import formTokens from '@better-giving/form/styles/tokens.css?url';
import registryLead from '@better-giving/operator/registry/styles/lead-css.css?url';
import registrySiteFooter from '@better-giving/operator/registry/styles/site-footer-css.css?url';
import registrySiteNav from '@better-giving/operator/registry/styles/site-nav-css.css?url';
import registrySpinner from '@better-giving/operator/registry/styles/spinner-css.css?url';
import hostedFaces from '@better-giving/operator/styles/fonts.css?url';
import { part } from '@better-giving/form/parts';
import type { FormConfig } from '@better-giving/form/v1';
import type { ReactNode } from 'react';
import { DonateCard } from './card';
import * as copy from './copy';
import pageChrome from './page.css?url';
import { PageRoot } from './page-root';
import type { PageLogo, PageLook } from './page-view';
import { SiteFooter, type SiteFooterInfo } from './site-footer';
import { MAIN_ID, SiteNav } from './site-nav';

// what every donor page route shares beyond the renderer: its stylesheets, and the plain page drawn
// where the stored page cannot be — the donation box alone, the notice where there is no box, and
// an ended campaign's screen.

/**
 * the form's sheets, the self-hosted faces, the registry's eyebrow, and the page's own chrome, in
 * that order, for a donor page's `links`.
 *
 * the form's are in the order `sheetsFor` in packages/form/src/element.ts adopts them, which is
 * cascade order for the equal-specificity rules they are almost entirely made of: its tokens, the
 * registry's button, text box and tick box the card's controls carry the classes of
 * (`REGISTRY_CLASS` in packages/form/src/parts.ts) and its busy ring, then its parts, layout and
 * motion. the busy ring is the operator package's copy of spinner-css, the same file as the form's,
 * because the form's `exports` map names no spinner sheet. the faces sit
 * after them and before the page, and their place orders nothing: the sheet
 * (packages/operator/src/styles/fonts.css) registers the files and re-points the registry's three
 * `--font-*` roles, which the form's token sheet declares unlayered, from inside a layer with
 * `!important`, which outranks them wherever it is linked. ./page.css reads those roles. none of
 * them is hoisted with a `precedence`: a donor page's whole document is these, so there is nothing
 * for a precedence to order them against. the registry's lead-css comes just before ./page.css,
 * which its usage note asks of a class worn beside `ds-eyebrow`. `registry` is a page's own further
 * registry sheets, linked after the eyebrow and before ./page.css for the same reason. the embed
 * links none of these.
 */
export function donorPageLinks(registry: readonly string[] = []) {
	return [
		formTokens,
		registryButton,
		registryField,
		registryCheckbox,
		registrySpinner,
		formParts,
		formLayout,
		formMotion,
		hostedFaces,
		registryLead,
		...registry,
		pageChrome
	].map((href) => ({
		rel: 'stylesheet' as const,
		href
	}));
}

/**
 * the registry's site nav and compact site footer, for `donorPageLinks` on a page that draws them
 * (./site-nav.tsx, ./site-footer.tsx). both read the registry's button sheet, which every donor
 * page links already, for the nav's menu button.
 */
export const SITE_CHROME_SHEETS: readonly string[] = [registrySiteNav, registrySiteFooter];

/** the registry's default accent, for a page with no brand colour to read. */
export const FORM_LOOK: PageLook = { brandColour: null };

/** a page root in one plain column holding `children`, with the site footer under it where given. */
export function PlainPage({
	look,
	footer,
	children
}: {
	readonly look: PageLook;
	/** the site footer under the column, for a page that draws one; none leaves the page bare. */
	readonly footer?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<PageRoot brandColour={look.brandColour} layout="plain" footer={footer}>
			<main className="stage">{children}</main>
		</PageRoot>
	);
}

/**
 * a page whose stored document is missing or fails the read rule: its donation box with none of the
 * page's content, in the organisation's brand colour, so a gift can still be made while the page is
 * repaired, and the site footer under it where given.
 */
export function PlainDonationPage({
	config,
	look,
	footer,
	resuming = false
}: {
	readonly config: FormConfig;
	readonly look: PageLook;
	/** the site footer under the box, as `PlainPage` draws it; none leaves the page bare. */
	readonly footer?: ReactNode;
	/** whether the address carries this box's resume stamp, the card's own `resuming`. */
	readonly resuming?: boolean;
}) {
	return (
		<PlainPage look={look} footer={footer}>
			<DonateCard config={config} resuming={resuming} />
		</PlainPage>
	);
}

/**
 * an ended campaign's address, and an ended supporter fundraiser's: the site nav as `/` draws
 * it, then the campaign's name, that it has ended, what the caller states under that, and the way
 * on to `/` — at the page's reading measure, in the campaign's own published look (`donorLook`
 * in $lib/server/pages/view.ts), with no donation box — and the compact site footer under it. a
 * deployment with no organisation name yet draws no home link in the nav, logo or not.
 */
export function EndedCampaignPage({
	name,
	orgName,
	logo,
	look,
	footer,
	children
}: {
	readonly name: string;
	readonly orgName: string | null;
	/** the organisation's logo, in the site nav; null or absent where it has none. */
	readonly logo?: PageLogo | null | undefined;
	readonly look: PageLook;
	/** what the site footer states. */
	readonly footer: SiteFooterInfo;
	/** what the page states under the thanks and over the way on: an ended fundraiser's total. */
	readonly children?: ReactNode;
}) {
	return (
		<PageRoot
			brandColour={look.brandColour}
			layout="plain"
			header={<SiteNav name={orgName} logo={logo ?? null} current={false} />}
			footer={<SiteFooter info={footer} />}
		>
			<main className="stage ended" id={MAIN_ID} tabIndex={-1}>
				<h1>{copy.campaignEnded(name)}</h1>
				<p>{copy.CAMPAIGN_ENDED_THANKS}</p>
				{children}
				<a part={part('action')} href="/">
					{copy.donateTo(orgName)}
				</a>
			</main>
		</PageRoot>
	);
}
