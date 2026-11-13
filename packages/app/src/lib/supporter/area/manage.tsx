import { useRef, useState } from 'react';
import { SHARE_CHANNEL_LABELS, shareHref } from '$lib/page/share';
import { NoticeCard } from './cards';
import { giftCount, longDay, money, type PageState, pageState, statusBadge } from './copy';
import { CopyLink } from './copy-link';
import { END_CONSEQUENCE, EndDialog } from './end-dialog';
import { Gifts, type OwnGift } from './gifts';
import { Mark } from './glyph';
import { Raised } from './raised';
import { type SupporterAccount, SupporterShell, type SupporterOrg } from './shell';

// /fundraise/pages/:id: one of the supporter's pages, with what it has raised, the link to share,
// its gifts and the way to end it, in that order on a phone; wide, the total and the gifts stand in
// the main column and the share and the end beside them.
//
// a page staff have hidden keeps working for its supporter — the total, Edit and End — and says who
// hid it and staff's note word for word, with no Share and no View page, since its address answers
// nothing for visitors. an ended page keeps Share and View page, since its address still opens the
// ended page, and loses Edit and End. a page just opened from its confirm link leads with the
// notice that it is live.

/** one of the supporter's pages, as `readOwnFundraiser` reads it, with what the screen links to. */
export type ManagedPage = {
	readonly id: string;
	readonly title: string;
	readonly status: 'pending' | 'live' | 'ended';
	readonly hidden: boolean;
	/** the note staff left when they hid the page, passed on as written; null with none. */
	readonly hiddenNote: string | null;
	readonly goalMinor: number;
	readonly raisedMinor: number;
	readonly gifts: number;
	readonly currency: string;
	/** ISO 8601, while ended. */
	readonly endedAt: string | null;
	/** ISO 8601, once its confirm link was opened; null for a page the public has never seen. */
	readonly publishedAt: string | null;
	/** the page's public path, `/f/…`. */
	readonly address: string;
	/** the page's whole address, what Copy link and the share links carry. */
	readonly url: string;
	/** newest first, at most `OWN_GIFT_LIST_LIMIT`. */
	readonly giftList: readonly OwnGift[];
};

export type ManageFundraiserProps = {
	readonly org: SupporterOrg;
	readonly account: SupporterAccount;
	readonly page: ManagedPage;
	/** where to write about a hidden page; null leaves that sentence out. */
	readonly orgContactEmail: string | null;
	/** this visit is the one the confirm link opened. */
	readonly justPublished: boolean;
	readonly backHref: string;
	readonly editHref: string;
	/** the last `intent=end` was refused. */
	readonly endRefused: boolean;
	/** an `intent=end` post is in flight. */
	readonly ending: boolean;
};

export function ManageFundraiser({
	org,
	account,
	page,
	orgContactEmail,
	justPublished,
	backHref,
	editHref,
	endRefused,
	ending
}: ManageFundraiserProps) {
	const state: PageState = pageState(page.status, page.hidden);
	const badge = statusBadge(state, org.name);
	const canEnd = state !== 'ended';
	const shareable = (state === 'live' || state === 'ended') && page.publishedAt !== null;
	const [asking, setAsking] = useState(false);
	// a card no control opened goes back to End fundraiser; an end that lands takes that press away
	// with the card, so the reader goes to the notice saying the page has ended.
	const endedNotice = useRef<HTMLElement>(null);
	const endPress = useRef<HTMLButtonElement>(null);
	const raisedWords = `${money(page.raisedMinor, page.currency)} from ${giftCount(page.gifts)}`;

	return (
		<SupporterShell org={org} account={account}>
			<a className="sa-back" href={backHref}>
				<Mark name="back" />
				Your fundraisers
			</a>
			{justPublished && state === 'live' ? (
				<NoticeCard
					tone="success"
					title="Your page is live"
					actions={<CopyLink url={page.url} className="ds-btn ds-btn-primary" />}
				>
					Share the link with the people who know you best.
					<br />
					<span className="sa-address">{page.url}</span>
				</NoticeCard>
			) : null}
			{state === 'hidden' ? (
				<NoticeCard tone="warning" title={`${org.name} has hidden this page`}>
					Visitors can’t see it, and it isn’t taking gifts.
					{page.hiddenNote === null ? null : ` ${org.name}’s note: “${page.hiddenNote}”`} You can
					edit your page.
					{orgContactEmail === null ? null : (
						<>
							{' '}
							To ask about it, write to{' '}
							<a className="sa-link" href={`mailto:${orgContactEmail}`}>
								{orgContactEmail}
							</a>
							.
						</>
					)}
				</NoticeCard>
			) : null}
			{state === 'ended' && page.endedAt !== null ? (
				<NoticeCard tone="info" title="This fundraiser has ended" ref={endedNotice}>
					You ended it on {longDay(page.endedAt)}. Your page still shows the final total,{' '}
					{raisedWords}.
				</NoticeCard>
			) : null}

			<div className="sa-head">
				<div className="sa-title-block">
					<h1 className="sa-h1">{page.title}</h1>
					<p className="sa-row">
						<span className={`ds-badge ds-badge-${badge.tone}`}>{badge.word}</span>
						<span className="sa-address">{page.address}</span>
					</p>
				</div>
				<div className="sa-row">
					{shareable ? (
						<a className="ds-btn ds-btn-secondary" href={page.address}>
							View page
							<Mark name="external-link" />
						</a>
					) : null}
					{state === 'ended' ? null : (
						<a className="ds-btn ds-btn-secondary" href={editHref}>
							<Mark name="pencil" />
							Edit page
						</a>
					)}
				</div>
			</div>

			<div className="sa-manage">
				<section className="sa-plane sa-card sa-raised" aria-labelledby="manage-raised-heading">
					<h2 className="sa-h2" id="manage-raised-heading">
						{state === 'ended' ? 'Final total' : 'Raised so far'}
					</h2>
					<Raised figures={page} />
				</section>

				{shareable ? (
					<section className="sa-plane sa-card sa-share" aria-labelledby="manage-share-heading">
						<h2 className="sa-h2" id="manage-share-heading">
							Share your page
						</h2>
						<div className="ds-field">
							<label className="ds-label" htmlFor="manage-share-link">
								Link to your page
							</label>
							<div className="ds-field-row">
								<div className="ds-field-control">
									<input
										className="ds-field-input"
										id="manage-share-link"
										readOnly
										value={page.url}
									/>
								</div>
								<div className="ds-field-action">
									<CopyLink url={page.url} className="ds-btn ds-btn-secondary ds-btn-field" />
								</div>
							</div>
						</div>
						<div className="sa-row">
							{(['email', 'facebook', 'whatsapp'] as const).map((channel) => (
								<a
									key={channel}
									className="ds-btn ds-btn-secondary ds-btn-sm"
									href={shareHref(channel, { url: page.url, message: page.title })}
									{...(channel === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
								>
									{SHARE_CHANNEL_LABELS[channel]}
								</a>
							))}
						</div>
					</section>
				) : null}

				<section className="sa-gifts" aria-labelledby="manage-gifts-heading">
					<h2 className="sa-h2" id="manage-gifts-heading">
						Gifts
					</h2>
					<Gifts gifts={page.giftList} total={page.gifts} currency={page.currency} />
				</section>

				{canEnd ? (
					<section className="sa-plane sa-card sa-end" aria-labelledby="manage-end-heading">
						<h2 className="sa-h2" id="manage-end-heading">
							End this fundraiser
						</h2>
						<p className="sa-quiet">{END_CONSEQUENCE}</p>
						<button
							ref={endPress}
							type="button"
							className="ds-btn ds-btn-destructive-outline"
							onClick={() => setAsking(true)}
						>
							End fundraiser
						</button>
					</section>
				) : null}
			</div>

			{asking && canEnd ? (
				<EndDialog
					title={page.title}
					raised={raisedWords}
					refused={endRefused}
					sending={ending}
					onCancel={() => setAsking(false)}
					fallbackFocus={[endPress, endedNotice]}
				/>
			) : null}
		</SupporterShell>
	);
}
