import type { DonorMessages } from '../../donate/messages';
import type { PageLogo, PageLook } from '../../donate/page-view';
import type { OrgInfo, PageMoney, PageSharing } from '../../donate/sections/types';

// what the public pages at /f/<slug> are handed: plain values the route maps from
// `readPublicFundraiser` in $lib/server/supporters/view.ts and from the organisation's own reads.
// money is in minor units and dates are ISO 8601, so every prop crosses the loader as it is.

/** the organisation a supporter raises for, as the pages name it. */
export type FundraiserOrg = {
	/**
	 * the organisation's legal name; null where none is set, which draws no line naming who the gift
	 * goes to rather than a name that is not the organisation's.
	 */
	readonly name: string | null;
	/** the EIN as printed, `12-3456789`; null draws no EIN. */
	readonly taxId: string | null;
	/** null or absent where the organisation has none. */
	readonly logo?: PageLogo | null | undefined;
};

/** the figures every arm states: what was raised toward what, from how many gifts. */
export type FundraiserTotals = {
	readonly raisedMinor: number;
	/** above nothing: a fundraiser is published with a goal. */
	readonly goalMinor: number;
	readonly gifts: number;
};

/** a live fundraiser: `LiveFundraiser` with its dates as ISO strings and its form left to the box. */
export type LiveFundraiserView = FundraiserTotals & {
	readonly title: string;
	/** plain text, a blank line between paragraphs. */
	readonly story: string;
	/** the supporter's name as they gave it. */
	readonly name: string;
	/** when it went live, ISO 8601; null in staff's preview of a page not yet published. */
	readonly startedAt: string | null;
	readonly photoId: string | null;
	readonly goalReached: boolean;
	/** its shown messages, the first page of them; null where there are none. */
	readonly messages: DonorMessages | null;
};

export type FundraiserPageProps = {
	readonly fundraiser: LiveFundraiserView;
	readonly org: FundraiserOrg;
	/** the organisation's brand colour, which the page is drawn in. */
	readonly look: PageLook;
	/** the form's locale, and the fundraiser's currency. */
	readonly money: PageMoney;
	/** when the page was read, ISO 8601: "today" and every message's age count from it. */
	readonly now: string;
	readonly sharing: PageSharing;
	/** the ways to reach the organisation, the footer's line. */
	readonly contact: Pick<OrgInfo, 'addressLines' | 'email' | 'socialLinks'>;
	/** whether Supporter fundraisers is on (`supporterFundraisersEnabled`): draws "Start your own fundraiser". */
	readonly fundraiserEntry: boolean;
	/** the caller's placement of the page root. */
	readonly className?: string;
};

/** what staff's preview says of the page's standing, which a visitor's page never draws. */
export type FundraiserStaffNotice = {
	readonly hidden: boolean;
	/** its supporter has not opened the confirm link; a hidden page says it is hidden instead. */
	readonly pending?: boolean | undefined;
	/** the note staff left when hiding it, as typed; null where there is none. */
	readonly note: string | null;
};

export type EndedFundraiserView = FundraiserTotals & {
	readonly title: string;
	readonly name: string;
};

export type FundraiserEndedPageProps = {
	readonly fundraiser: EndedFundraiserView;
	readonly org: FundraiserOrg;
	readonly look: PageLook;
	readonly money: PageMoney;
};
