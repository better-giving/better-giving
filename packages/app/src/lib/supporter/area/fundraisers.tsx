import { StateCard } from './cards';
import { type PageState, pageState, statusBadge } from './copy';
import { Mark } from './glyph';
import { Raised, type RaisedFigures } from './raised';
import { type SupporterAccount, SupporterShell, type SupporterOrg } from './shell';

// /fundraise/pages: the signed-in supporter's own pages, newest first, one plane each — its title
// opening Manage, its state, its address, what it has raised, and the way on. a hidden page says
// visitors cannot see it and offers no View page; an ended one has nothing left to do but read, so
// Manage steps down to the secondary press. View page stands wherever the address opens a page:
// live, and ended, which shows its final total.

/** one of the supporter's pages, as `listOwnFundraisers` reads it, with its two addresses. */
export type FundraiserSummary = RaisedFigures & {
	readonly id: string;
	readonly title: string;
	readonly status: 'pending' | 'live' | 'ended';
	readonly hidden: boolean;
	/** the page's public path, `/f/…`, shown in mono and opened by View page. */
	readonly address: string;
	/** when the page ended, ISO 8601; null while it has not. */
	readonly endedAt: string | null;
	readonly manageHref: string;
};

export type YourFundraisersProps = {
	readonly org: SupporterOrg;
	readonly account: SupporterAccount;
	/** newest first. */
	readonly pages: readonly FundraiserSummary[];
	/** Start another and the empty card's press, absent while the organisation takes no new pages. */
	readonly startHref: string | null;
};

export function YourFundraisers({ org, account, pages, startHref }: YourFundraisersProps) {
	return (
		<SupporterShell org={org} account={account}>
			<div className="sa-list">
				<div className="sa-head">
					<h1 className="sa-h1">Your fundraisers</h1>
					{startHref === null || pages.length === 0 ? null : (
						<a className="ds-btn ds-btn-secondary" href={startHref}>
							<Mark name="plus" />
							Start another
						</a>
					)}
				</div>
				{pages.length === 0 ? (
					<StateCard
						title="You haven’t started a fundraiser"
						action={
							startHref === null ? undefined : (
								<a className="ds-btn ds-btn-primary" href={startHref}>
									Start a fundraiser
								</a>
							)
						}
					>
						Start a page with your story and a goal, then share it with friends and family.
					</StateCard>
				) : (
					<ul className="sa-cards" aria-label="Your fundraisers">
						{pages.map((page) => (
							<FundraiserCard key={page.id} page={page} orgName={org.name} />
						))}
					</ul>
				)}
			</div>
		</SupporterShell>
	);
}

function FundraiserCard({
	page,
	orgName
}: {
	readonly page: FundraiserSummary;
	readonly orgName: string;
}) {
	const state: PageState = pageState(page.status, page.hidden);
	const badge = statusBadge(state, orgName);
	return (
		<li className="sa-plane sa-card">
			<div className="sa-card-top">
				<h2 className="sa-card-title">
					<a href={page.manageHref}>{page.title}</a>
				</h2>
				<span className={`ds-badge ds-badge-${badge.tone}`}>{badge.word}</span>
			</div>
			<p className="sa-address">{page.address}</p>
			<Raised figures={page} endedAt={page.endedAt} />
			{state === 'hidden' ? (
				<p className="sa-note">Visitors can’t see this page, and it isn’t taking gifts.</p>
			) : null}
			<div className="sa-row">
				<a
					className={`ds-btn ${state === 'ended' ? 'ds-btn-secondary' : 'ds-btn-primary'}`}
					href={page.manageHref}
					aria-label={`Manage ${page.title}`}
				>
					Manage
				</a>
				{state === 'live' || state === 'ended' ? (
					<a
						className="ds-btn ds-btn-ghost"
						href={page.address}
						aria-label={`View page: ${page.title}`}
					>
						View page
						<Mark name="external-link" />
					</a>
				) : null}
			</div>
		</li>
	);
}
