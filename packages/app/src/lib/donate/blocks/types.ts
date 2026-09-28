import type { Block } from '../../page/catalog';
import type { ShareChannel } from '../../page/share';
import type { RichTextDocument } from '../../rich-text/document';

// what the page's blocks are handed beside their own stored values: the organisation, its
// sharing, the campaign's goal and the programs, each read by the route and passed down.

/** one stored block of the named type. */
export type BlockOf<T extends Block['type']> = Extract<Block, { type: T }>;

/** the legal identity the org-info block states, already worded for a donor to read. */
export type OrgInfo = {
	readonly legalName: string;
	/** the EIN as printed, `12-3456789`; null draws no line for it. */
	readonly ein: string | null;
	/** the postal address, a line each, the country last. */
	readonly addressLines: readonly string[];
	readonly email: string | null;
	/** the organisation's social links, in the Organisation page's order. */
	readonly links: readonly { readonly label: string; readonly href: string }[];
};

export type PageOrg = {
	/** the name the masthead and the Donation page's title greet a donor with. */
	readonly name: string;
	readonly mission: RichTextDocument | null;
	readonly vision: RichTextDocument | null;
	readonly info: OrgInfo;
};

export type PageSharing = {
	/** the channels to offer, in the order the buttons stand. */
	readonly channels: readonly ShareChannel[];
	/** the page's own share message, or the organisation's; empty sends the address alone. */
	readonly message: string;
	/** the page's public address. */
	readonly url: string;
};

/** a campaign's goal and what has been given toward it, in the page's currency. */
export type PageGoal = {
	/** settled gifts through the campaign, net of refunds, recurring charges included. */
	readonly raisedMinor: number;
	readonly goalMinor: number;
	/** the last day, worded as the page states it ("December 31"); null for no end date. */
	readonly endsAt: string | null;
};

/** how the page states an amount: the page's form's locale and currency. */
export type PageMoney = { readonly locale: string; readonly currency: string };

export type PageProgram = {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
};
