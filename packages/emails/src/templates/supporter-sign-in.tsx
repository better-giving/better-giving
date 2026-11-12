import type { CSSProperties } from 'react';
import { box, LINK, SPACE_6 } from '../tokens';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';

// the mail that carries a supporter's sign-in link: on a first fundraiser the link confirms the
// address and publishes the page, and after that it signs a returning supporter in to manage theirs.
//
// pure, the same as ./password-reset.tsx: a model in, a subject and a body out, no database, no
// clock and no I/O. it is handed the link and the sign-in page's address rather than an origin and a
// token, because which host this deployment answers on is the app's to know.
//
// the link is printed as itself in both arms and is the only anchor the message writes. the sign-in
// page's address is text on a line of its own, where to ask again once this link has run out: a
// client that linkifies it has no full stop beside it to fold into the address.

/** which mail this is: the first, which publishes a page, or a returning supporter's sign-in. */
export type SupporterSignInArm =
	| { readonly kind: 'first'; readonly pageTitle: string }
	| { readonly kind: 'returning' };

export interface SupporterSignInData {
	/** `org_profile.legal_name`, or the app's own name where nobody has filled the profile in. */
	readonly orgName: string;
	/** the whole address the recipient opens, token and all. built by the caller. */
	readonly link: string;
	/** the address of the page that sends a new link. built by the caller. */
	readonly signInUrl: string;
	/** how long the link works for, in milliseconds. the app's own lifetime, handed in by the sender. */
	readonly linkLifetimeMs: number;
	readonly arm: SupporterSignInArm;
}

export function template(data: SupporterSignInData): EmailTemplate {
	const words =
		data.arm.kind === 'first'
			? firstTime(data.orgName, data.arm.pageTitle)
			: returning(data.orgName);

	return {
		subject: words.subject,
		node: (
			<Layout title={words.subject}>
				<Heading>{words.subject}</Heading>
				<Paragraph>{words.opening}</Paragraph>
				{/*
				 * the address is its own text as well as its href: a client that strips the anchor
				 * still leaves something the recipient can copy. `break-all` because a token is one
				 * unbreakable word wider than a phone.
				 */}
				<p style={LINK_STYLE}>
					<a href={data.link} style={ANCHOR_STYLE} target="_blank" rel="noopener">
						{data.link}
					</a>
				</p>
				<Paragraph>{expiry(data.linkLifetimeMs)}</Paragraph>
				<Paragraph>{data.signInUrl}</Paragraph>
				<Divider />
				<SmallPrint>{words.closing}</SmallPrint>
			</Layout>
		)
	};
}

interface Words {
	readonly subject: string;
	readonly opening: string;
	readonly closing: string;
}

// each sentence is one string rather than jsx with holes in it: react writes a `<!-- -->` between
// adjacent text nodes, which splits the sentence in the HTML arm.

function firstTime(org: string, pageTitle: string): Words {
	return {
		subject: 'Confirm your email to publish your fundraiser',
		opening: `Open the link below to publish ${pageTitle}, your fundraiser for ${org}, and to manage it.`,
		// anyone who can type an address can cause this mail, so the recipient's question is whether
		// something went public in their name. it has not until the link is opened.
		closing:
			'If you didn’t start a fundraiser, ignore this message. Nothing is published until the link is opened.'
	};
}

function returning(org: string): Words {
	return {
		subject: `Your sign-in link for ${org} fundraisers`,
		opening: `Open the link below to manage your fundraisers for ${org}.`,
		closing: 'If you didn’t ask for this, ignore this message. Nobody can sign in without the link.'
	};
}

/**
 * stated in words rather than as a time: a link this short-lived is opened in the sitting it was
 * asked for. whole hours read as hours, anything else as minutes.
 */
function expiry(lifetimeMs: number): string {
	return `This link works once and expires in ${duration(lifetimeMs)}. If it has run out, ask for a new one at:`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function duration(ms: number): string {
	if (ms === HOUR_MS) return 'an hour';
	if (ms % HOUR_MS === 0) return `${ms / HOUR_MS} hours`;
	return `${Math.round(ms / MINUTE_MS)} minutes`;
}

const LINK_STYLE: CSSProperties = { margin: box(0, 0, SPACE_6), wordBreak: 'break-all' };

/** the anchor itself: coloured and undecorated, because a client that keeps neither still opens it. */
const ANCHOR_STYLE: CSSProperties = { color: LINK, textDecorationLine: 'none' };
