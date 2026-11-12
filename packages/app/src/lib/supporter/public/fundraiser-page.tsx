import registryBadge from '@better-giving/operator/registry/styles/badge-css.css?url';
import registryNoticeCard from '@better-giving/operator/registry/styles/notice-card-css.css?url';
import registryProgress from '@better-giving/operator/registry/styles/progress-css.css?url';
import { formatOffer } from '@better-giving/form/money';
import type { FormConfig } from '@better-giving/form/v1';
import { type ReactNode, useId } from 'react';
import { DonateCard } from '../../donate/card';
import { DonateNotice } from '../../donate/notice';
import { PageRoot } from '../../donate/page-root';
import { initials } from '../../donate/page-view';
import { donorPageLinks, EndedCampaignPage, FORM_LOOK, PlainPage } from '../../donate/plain-page';
import { DonorMessages, type DonorMessagesWiring } from '../../donate/sections/messages';
import { OrgContact } from '../../donate/sections/org-info';
import { Share } from '../../donate/sections/share';
import { imageSrc } from '../../page/image-src';
import { NoticeCard } from '../area/cards';
import * as copy from './copy';
import fundraiserSheet from './fundraiser.css?url';
import { FundraiserRaised } from './raised';
import type {
	FundraiserEndedPageProps,
	FundraiserOrg,
	FundraiserPageProps,
	FundraiserStaffNotice,
	LiveFundraiserView
} from './types';

// a supporter's fundraiser at /f/<slug>, in the three answers `readPublicFundraiser`
// ($lib/server/supporters/view.ts) gives: live, ended, and not found.
//
// live, it is the Donation page's profile shell (`data-layout='profile'`, $lib/donate/page-root.tsx)
// with a layout of its own in ./fundraiser.css: who it is for, the title, the supporter's byline,
// the photo where there is one, and what has been raised, then the donation box and who the gift
// goes to, then the story and the messages from donors. on a phone they stand in that order; from
// 60rem the box and who it goes to are a column beside the rest. the donation box is the page's one
// primary. the share row and the footer close it as they close every donor page.
//
// ended, it is an ended campaign's screen with the final total under the thanks and no box. hidden,
// pending and unknown alike are the plain notice an unknown campaign address gets, so a visitor
// learns nothing of a page that is not public.

/** a donor page's sheets, then the registry's badge and goal bar, then this page's own. */
export function fundraiserPageLinks() {
	return [
		...donorPageLinks(),
		...[registryBadge, registryProgress, fundraiserSheet].map((href) => ({
			rel: 'stylesheet' as const,
			href
		}))
	];
}

/** the live page's sheets, then the registry's notice card, which staff's preview draws over it. */
export function fundraiserPreviewLinks() {
	return [...fundraiserPageLinks(), { rel: 'stylesheet' as const, href: registryNoticeCard }];
}

/** the first word of the supporter's name, which the story's heading and the box's name use. */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? name;
}

export type FundraiserPageViewProps = FundraiserPageProps & {
	/** the donation box, built by the caller: `FundraiserPageWithCard` builds the donation card. */
	readonly donationBox: ReactNode;
	/**
	 * what "Messages from donors" asks for six more with; absent, the section is not drawn whatever
	 * the fundraiser holds.
	 */
	readonly donorMessages?: DonorMessagesWiring | undefined;
	/**
	 * staff's preview only: hidden, a warning notice over the title says visitors do not see the
	 * page, with staff's note. its card is drawn by the sheet `fundraiserPreviewLinks` adds.
	 */
	readonly staffNotice?: FundraiserStaffNotice | undefined;
};

export function FundraiserPage(props: FundraiserPageViewProps) {
	const { fundraiser, org, money, look, className } = props;
	const shareHeading = useId();
	const storyHeading = useId();
	const first = firstName(fundraiser.name);
	const messages =
		fundraiser.messages !== null && fundraiser.messages.total > 0 ? props.donorMessages : undefined;
	return (
		<PageRoot
			brandColour={look.brandColour}
			layout="profile"
			className={className === undefined ? 'fundraiser-page' : `fundraiser-page ${className}`}
		>
			<main className="page-body">
				<div className="page-in page-layout fundraiser-layout">
					<div className="fundraiser-who" data-area="who">
						{props.staffNotice?.hidden ? <HiddenNotice note={props.staffNotice.note} /> : null}
						<a className="fundraiser-for" href="/donate">
							<OrgLogo org={org} className="fundraiser-for-logo" />
							<span>
								{copy.FOR_LEAD}
								<span className="fundraiser-for-name">{org.name}</span>
							</span>
						</a>
						<h1 className="fundraiser-title" data-area="title">
							{fundraiser.title}
						</h1>
						<Byline fundraiser={fundraiser} locale={money.locale} now={props.now} />
						{fundraiser.photoId === null ? null : (
							<div className="fundraiser-photo" data-area="photo">
								<img className="page-photo" src={imageSrc(fundraiser.photoId)} alt="" />
							</div>
						)}
						<FundraiserRaised
							totals={fundraiser}
							goalReached={fundraiser.goalReached}
							money={money}
						/>
					</div>
					<div className="fundraiser-side" data-area="side">
						<section className="page-box" data-area="box" aria-label={copy.giveTo(first)}>
							<div>{props.donationBox}</div>
						</section>
						<Recipient org={org} first={first} />
					</div>
					<div className="fundraiser-more" data-area="more">
						<section aria-labelledby={storyHeading} data-area="story">
							<h2 className="fundraiser-heading" id={storyHeading}>
								{copy.story(first)}
							</h2>
							<div className="fundraiser-story">
								{paragraphs(fundraiser.story).map((text, at) => (
									<p key={at}>{text}</p>
								))}
							</div>
						</section>
						{messages === undefined || fundraiser.messages === null ? null : (
							<DonorMessages {...messages} initial={fundraiser.messages} locale={money.locale} />
						)}
					</div>
				</div>
			</main>
			<section className="page-end" aria-labelledby={shareHeading} data-area="share">
				<div className="page-in">
					<Share headingId={shareHeading} sharing={props.sharing} heading={copy.SHARE_HEADING} />
				</div>
			</section>
			<footer className="page-foot">
				<div className="page-in page-org">
					<OrgContact contact={props.contact} />
					{props.fundraiserEntry ? (
						<p>
							<a className="fundraiser-start" href={copy.START_HREF}>
								{copy.START_YOUR_OWN}
							</a>
						</p>
					) : null}
				</div>
			</footer>
		</PageRoot>
	);
}

function HiddenNotice({ note }: { readonly note: string | null }) {
	return (
		<NoticeCard tone="warning" title={copy.HIDDEN_TITLE}>
			<p>{copy.HIDDEN_BODY}</p>
			{note === null ? null : (
				<p>
					{copy.HIDDEN_NOTE_LABEL} {note}
				</p>
			)}
		</NoticeCard>
	);
}

/** the story's paragraphs: plain text, a blank line between two, a single break kept inside one. */
function paragraphs(story: string): string[] {
	return story
		.split(/\n\s*\n/)
		.map((text) => text.trim())
		.filter((text) => text !== '');
}

/** the organisation's logo, beside its name and so saying nothing of its own; none without one. */
function OrgLogo({ org, className }: { readonly org: FundraiserOrg; readonly className: string }) {
	if (org.logo === null || org.logo === undefined) return null;
	return (
		<img
			className={className}
			src={imageSrc(org.logo.imageId)}
			alt=""
			width={org.logo.width}
			height={org.logo.height}
		/>
	);
}

function Byline({
	fundraiser,
	locale,
	now
}: {
	readonly fundraiser: LiveFundraiserView;
	readonly locale: string;
	readonly now: string;
}) {
	const letters = initials(fundraiser.name);
	return (
		<div className="fundraiser-byline">
			{/* registry gap: the registry has no avatar. the initials tile is drawn here on the page
			    logo's tile recipe, in ./fundraiser.css. */}
			{letters === '' ? null : (
				<div className="fundraiser-avatar" aria-hidden="true">
					{letters}
				</div>
			)}
			<p className="fundraiser-by">
				<span className="fundraiser-by-name">{fundraiser.name}</span>
				<span className="fundraiser-by-when">
					{copy.startedOn(fundraiser.startedAt, now, locale)}
				</span>
			</p>
		</div>
	);
}

function Recipient({ org, first }: { readonly org: FundraiserOrg; readonly first: string }) {
	const labelId = useId();
	return (
		<section className="fundraiser-recipient" aria-labelledby={labelId}>
			<p className="fundraiser-recipient-label" id={labelId}>
				{copy.GOES_TO}
			</p>
			<div className="fundraiser-recipient-org">
				<OrgLogo org={org} className="fundraiser-recipient-logo" />
				<div className="page-profile-names">
					<p className="fundraiser-recipient-name">{org.name}</p>
					{org.taxId === null ? null : (
						<p className="page-profile-ein">
							EIN <span className="page-profile-ein-number">{org.taxId}</span>
						</p>
					)}
				</div>
			</div>
			<p className="fundraiser-recipient-note">{copy.goesToNotTo(org.name, first)}</p>
			<p>
				<a className="fundraiser-about" href="/donate">
					{copy.about(org.name)}
				</a>
			</p>
		</section>
	);
}

/** the live page with the donation card in its box, as the Donation page mounts the card. */
export function FundraiserPageWithCard({
	config,
	resuming,
	...page
}: FundraiserPageProps & {
	/** the served configuration of the fundraiser's own form, as the card takes it. */
	readonly config: FormConfig;
	/** whether the address carries this box's resume stamp, the card's own `resuming`. */
	readonly resuming?: boolean;
	readonly donorMessages?: DonorMessagesWiring | undefined;
}) {
	return (
		<FundraiserPage
			{...page}
			donationBox={<DonateCard config={config} {...(resuming === undefined ? {} : { resuming })} />}
		/>
	);
}

/** an ended fundraiser: an ended campaign's screen, its total under the thanks, and no box. */
export function FundraiserEndedPage({ fundraiser, org, look, money }: FundraiserEndedPageProps) {
	const raised = formatOffer(fundraiser.raisedMinor, money.locale, money.currency);
	const goal = formatOffer(fundraiser.goalMinor, money.locale, money.currency);
	return (
		<EndedCampaignPage
			name={fundraiser.title}
			orgName={org.name}
			logo={org.logo ?? null}
			look={look}
		>
			<p className="fundraiser-ended-total">
				{fundraiser.name} raised <b>{raised}</b> of {goal} from{' '}
				{copy.giftCount(fundraiser.gifts, money.locale)}.
			</p>
		</EndedCampaignPage>
	);
}

/**
 * a fundraiser that is hidden, still pending, or at an address nobody holds: the same plain notice
 * an unknown campaign address gets, with no title, name or total.
 */
export function FundraiserNotFoundPage() {
	return (
		<PlainPage look={FORM_LOOK}>
			<DonateNotice />
		</PlainPage>
	);
}
