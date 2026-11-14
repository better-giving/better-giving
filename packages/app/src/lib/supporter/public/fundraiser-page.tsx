import registryAvatar from '@better-giving/operator/registry/styles/avatar-css.css?url';
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
import areaSheet from '../area/area.css?url';
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
// live, it is drawn on the `plain` root ($lib/donate/page-root.tsx), which arranges nothing, and in
// the layout ./fundraiser.css gives it: who it is for, the title, the supporter's byline,
// the photo where there is one, and what has been raised, then the donation box and who the gift
// goes to, then the story and the messages from donors. on a phone they stand in that order; from
// 60rem the box and who it goes to are a column beside the rest. the donation box is the page's one
// primary. the share row and the footer close it as they close every donor page.
//
// ended, it is an ended campaign's screen with the final total under the thanks and no box. hidden,
// pending and unknown alike are the plain notice an unknown campaign address gets, so a visitor
// learns nothing of a page that is not public.

/** a donor page's sheets, then the registry's avatar, badge and goal bar, then this page's own. */
export function fundraiserPageLinks() {
	return [
		...donorPageLinks(),
		...[registryAvatar, registryBadge, registryProgress, fundraiserSheet].map((href) => ({
			rel: 'stylesheet' as const,
			href
		}))
	];
}

/**
 * the live page's sheets, then the registry's notice card, which staff's preview draws over it, and
 * the supporter area's sheet, whose `.sa-mark` rule sizes the card's glyph (`Mark` in
 * ../area/glyph.tsx draws an svg with no size of its own). every rule in that sheet is keyed to an
 * `sa-` class, so it paints nothing else on this page.
 */
export function fundraiserPreviewLinks() {
	return [
		...fundraiserPageLinks(),
		...[registryNoticeCard, areaSheet].map((href) => ({ rel: 'stylesheet' as const, href }))
	];
}

/** a title written ahead of a name: `Dr.`, `Mrs`. */
const HONORIFIC = /^(?:mr|mrs|ms|mx|miss|dr|prof|rev|fr|sir|dame)\.?$/i;

/** a lone letter, with or without its point: `J.`. */
const INITIAL = /^\p{L}\.?$/u;

/**
 * what the story's heading, the box's name and the recipient line call the supporter: the first word
 * of the name they gave, or the whole name where that word is a title or an initial ("Dr. Maya
 * Reyes", "J. Reyes"). the start form has one name box, so nothing makes its first word a given name.
 */
export function firstName(name: string): string {
	const whole = name.trim();
	const first = whole.split(/\s+/)[0] ?? whole;
	return HONORIFIC.test(first) || INITIAL.test(first) ? whole : first;
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
	 * page, with staff's note; not yet published, an info notice says so. its card is drawn by the
	 * sheet `fundraiserPreviewLinks` adds.
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
			layout="plain"
			className={className === undefined ? 'fundraiser-page' : `fundraiser-page ${className}`}
		>
			<main className="page-body">
				<div className="page-in page-layout fundraiser-layout">
					<div className="fundraiser-who" data-area="who">
						{props.staffNotice?.hidden ? (
							<HiddenNotice note={props.staffNotice.note} />
						) : props.staffNotice?.pending ? (
							<NoticeCard tone="info" title={copy.PENDING_TITLE}>
								<p>{copy.PENDING_BODY}</p>
							</NoticeCard>
						) : null}
						{org.name === null ? null : (
							<a className="fundraiser-for" href="/donate">
								<OrgLogo org={org} className="fundraiser-for-logo" />
								<span>
									{copy.FOR_LEAD}
									<span className="fundraiser-for-name">{org.name}</span>
								</span>
							</a>
						)}
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
						{props.donationBox === null ? null : (
							<section className="page-box" data-area="box" aria-label={copy.giveTo(first)}>
								<div>{props.donationBox}</div>
							</section>
						)}
						{org.name === null ? null : <Recipient org={org} name={org.name} first={first} />}
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
							<DonorMessages
								{...messages}
								initial={fundraiser.messages}
								locale={money.locale}
								shape="list"
							/>
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
							<a href={copy.START_HREF}>{copy.START_YOUR_OWN}</a>
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
			{/* beside the name it stands for, so out of the accessibility tree (avatar-css.usage.md). */}
			{letters === '' ? null : (
				<span className="ds-avatar ds-avatar-lg" aria-hidden="true">
					<span>{letters}</span>
				</span>
			)}
			<p className="fundraiser-by">
				<span className="fundraiser-by-name">{fundraiser.name}</span>
				{fundraiser.startedAt === null ? null : (
					<span className="fundraiser-by-when">
						{copy.startedOn(fundraiser.startedAt, now, locale)}
					</span>
				)}
			</p>
		</div>
	);
}

function Recipient({
	org,
	name,
	first
}: {
	readonly org: FundraiserOrg;
	readonly name: string;
	readonly first: string;
}) {
	const labelId = useId();
	return (
		<section className="fundraiser-recipient" aria-labelledby={labelId}>
			<p className="fundraiser-recipient-label" id={labelId}>
				{copy.GOES_TO}
			</p>
			<div className="fundraiser-recipient-org">
				<OrgLogo org={org} className="fundraiser-recipient-logo" />
				<div className="page-profile-names">
					<p className="fundraiser-recipient-name">{name}</p>
					{org.taxId === null ? null : (
						<p className="page-profile-ein">
							{copy.EIN} <span className="page-profile-ein-number">{org.taxId}</span>
						</p>
					)}
				</div>
			</div>
			<p className="fundraiser-recipient-note">{copy.goesToNotTo(name, first)}</p>
			<p>
				<a href="/donate">{copy.about(name)}</a>
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
	const total = copy.endedTotal(
		fundraiser.name,
		formatOffer(fundraiser.goalMinor, money.locale, money.currency),
		fundraiser.gifts,
		money.locale
	);
	return (
		<EndedCampaignPage
			name={fundraiser.title}
			orgName={org.name}
			logo={org.logo ?? null}
			look={look}
		>
			<p className="fundraiser-ended-total">
				{total.before}
				<b>{raised}</b>
				{total.after}
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
