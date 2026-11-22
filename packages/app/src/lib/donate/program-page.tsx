import registryAvatar from '@better-giving/operator/registry/styles/avatar-css.css?url';
import registryPageState from '@better-giving/operator/registry/styles/page-state-css.css?url';
import type { FormConfig } from '@better-giving/form/v1';
import { useId } from 'react';
import { imageSrc } from '../page/image-src';
import { DonateCard } from './card';
import * as copy from './copy';
import type { CheckoutMounts } from './machine';
import { PageRoot } from './page-root';
import { initials, type PageLogo, type PageLook, usePreviewStill } from './page-view';
import { donorPageLinks, SITE_CHROME_SHEETS } from './plain-page';
import { Paragraphs } from './sections/about-us';
import { Share } from './sections/share';
import type { PageOrg, PageSharing } from './sections/types';
import { SiteFooter } from './site-footer';
import { MAIN_ID, SiteNav } from './site-nav';

// one program's public page, and the screen an archived or unknown program gets in its place.
//
// the page, in source and tab order: the site nav, then in `main` the program — its photo where it
// has one, the eyebrow, the name, the description where it has one, and the organisation that runs
// it — then the donation card under "Give to {name}", then the share row and the site footer. on a
// phone that is one column; from 60rem (./page.css) the card stands in a column of its own beside
// the program, and the share row runs under both.
//
// the card is handed the route's config for this page, which carries no `program`, so it draws no
// Program select; the program goes to the flow as `pageProgramId` instead, which the server credits
// whatever the Donation page's own program setting says.
//
// the closed screen names no program, so an archived id and an id nobody holds read the same and a
// visitor learns nothing about which ids exist. it is the registry's page state (page-state-css)
// between the site nav and the footer, with the way on to `/`.

/**
 * a donor page's sheets with the site nav's and footer's, then the registry's avatar, for the
 * organisation's tile, and its page state, for the closed screen. both pages link the same ones.
 */
export function programPageLinks() {
	return donorPageLinks([...SITE_CHROME_SHEETS, registryAvatar, registryPageState]);
}

export type ProgramPageProgram = {
	readonly id: string;
	readonly name: string;
	/** plain text, a blank line between paragraphs; null where none is written. */
	readonly description: string | null;
	/** the program's photo as its stored image id, as the chooser's `programPhotos` holds it; null draws none. */
	readonly photoImageId: string | null;
};

/** the organisation as the donate page's loader reads it: the name and the footer's legal details. */
export type ProgramPageOrg = Pick<PageOrg, 'name' | 'info'>;

export type ProgramPageProps = {
	/** an active program; an archived or unknown one is `ProgramClosedPage`'s. */
	readonly program: ProgramPageProgram;
	readonly org: ProgramPageOrg;
	/** the organisation's logo, in the site nav and the tile; null where it has none. */
	readonly logo: PageLogo | null;
	readonly look: PageLook;
	/** the page's public address and the message the share row sends with it. */
	readonly sharing: PageSharing;
	/** the served configuration the card takes the gift against, built for this page with no `program`. */
	readonly config: FormConfig;
	/** whether the address carries this page's resume stamp, the card's own `resuming`. */
	readonly resuming?: boolean;
	/** the card's provider seams, which only a spec passes. */
	readonly seams?: CheckoutMounts['seams'];
	/** drawn as the editor's preview: the card inert and no other stop in the tab order. */
	readonly preview?: boolean;
	/** the caller's placement of the page root. */
	readonly className?: string;
};

export function ProgramPage({
	program,
	org,
	logo,
	look,
	sharing,
	config,
	resuming,
	seams,
	preview = false,
	className
}: ProgramPageProps) {
	usePreviewStill(preview);
	const boxHeading = useId();
	const shareHeading = useId();
	return (
		<PageRoot
			brandColour={look.brandColour}
			layout="plain"
			{...(className === undefined ? {} : { className })}
			header={<SiteNav name={org.name} logo={logo} current={false} />}
			footer={<SiteFooter info={org.info} />}
		>
			<main className="page-body page-program" id={MAIN_ID} tabIndex={-1}>
				<div className="page-in page-program-layout">
					<div>
						{program.photoImageId === null ? null : (
							<div className="page-program-photo" data-area="photo">
								<img
									className="page-photo"
									src={imageSrc(program.photoImageId)}
									alt={program.name}
								/>
							</div>
						)}
						<p className="page-label ds-eyebrow">{copy.PROGRAM_EYEBROW}</p>
						<h1 className="page-program-name">{program.name}</h1>
						{program.description === null ? null : (
							<div className="page-program-description" data-area="description">
								<Paragraphs text={program.description} />
							</div>
						)}
						<ProgramOrg org={org} logo={logo} />
					</div>
					<section className="page-box" aria-labelledby={boxHeading} data-area="box">
						<h2 className="page-profile-box-heading" id={boxHeading}>
							{copy.giveToProgram(program.name)}
						</h2>
						<div inert={preview}>
							<DonateCard
								config={config}
								pageProgramId={program.id}
								{...(seams === undefined ? {} : { seams })}
								{...(resuming === undefined ? {} : { resuming })}
							/>
						</div>
					</section>
				</div>
			</main>
			<section className="page-end" aria-labelledby={shareHeading} data-area="share">
				<div className="page-in">
					<Share headingId={shareHeading} sharing={sharing} heading={copy.PROGRAM_SHARE_HEADING} />
				</div>
			</section>
		</PageRoot>
	);
}

/**
 * who runs the program: the registry's square tile, the logo where there is one and the name's
 * initials otherwise, beside "A program of", the name and the EIN where one is stated. the tile
 * stands beside the name it stands for, so it is out of the reading (avatar-css.usage.md); a name
 * with no letter and no logo draws no tile.
 */
function ProgramOrg({
	org,
	logo
}: {
	readonly org: ProgramPageOrg;
	readonly logo: PageLogo | null;
}) {
	const letters = initials(org.name);
	const ein = org.info.ein;
	return (
		<div className="page-program-org" data-area="identity">
			{logo !== null ? (
				<span className="ds-avatar ds-avatar-lg ds-avatar-square ds-avatar-logo" aria-hidden="true">
					<span>{letters}</span>
					<img className="ds-avatar-img" src={imageSrc(logo.imageId)} alt="" />
				</span>
			) : letters === '' ? null : (
				<span className="ds-avatar ds-avatar-lg ds-avatar-square" aria-hidden="true">
					<span>{letters}</span>
				</span>
			)}
			<div>
				<p className="page-program-of">{copy.PROGRAM_OF}</p>
				<p className="page-program-org-name">{org.name}</p>
				{ein === null ? null : (
					<p className="page-profile-ein">
						{copy.PROGRAM_EIN} <span className="page-profile-ein-number">{ein}</span>
					</p>
				)}
			</div>
		</div>
	);
}

export type ProgramClosedPageProps = {
	readonly org: ProgramPageOrg;
	/** the organisation's logo, in the site nav; null where it has none. */
	readonly logo: PageLogo | null;
	readonly look: PageLook;
};

/** an archived program's address and an address no program holds alike: no program is named. */
export function ProgramClosedPage({ org, logo, look }: ProgramClosedPageProps) {
	return (
		<PageRoot
			brandColour={look.brandColour}
			layout="plain"
			header={<SiteNav name={org.name} logo={logo} current={false} />}
			footer={<SiteFooter info={org.info} />}
		>
			<main className="page-closed" id={MAIN_ID} tabIndex={-1}>
				<div className="ds-page-state">
					<h1 className="ds-page-state-title" tabIndex={-1}>
						{copy.PROGRAM_CLOSED_TITLE}
					</h1>
					<p className="ds-page-state-body">{copy.programClosedBody(org.name)}</p>
					<div className="ds-page-state-actions">
						<a className="ds-btn ds-btn-primary" href="/">
							{copy.PROGRAM_CLOSED_ACTION}
						</a>
					</div>
				</div>
			</main>
		</PageRoot>
	);
}
