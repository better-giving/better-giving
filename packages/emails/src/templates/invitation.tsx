import type { CSSProperties } from 'react';
import { box, LINK, SPACE_6 } from '../tokens';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatDate } from '../format';
import type { EmailTemplate } from '../template';

// the mail that carries an invitation link to a colleague.
//
// pure, the same as the receipt and the alert: a model in, a subject and a body out, no database,
// no clock and no I/O. it is handed a link rather than an origin and a token, because a template
// that built the address would be a template that had to know which host this deployment answers
// on — that is the route's to know, and the app mints the token it carries.
//
// it never refuses to render, which is the alert's asymmetry with the receipt and not the
// receipt's: an organisation that has not filled its profile in still has colleagues to invite,
// and this is among the first things a fresh deployment sends. so `orgName` arrives already
// resolved — a deployment with no name saved falls back to the word every screen falls back to,
// and that fallback is the caller's, because this package imports nothing from the app.
//
// the link is printed as itself in both arms and is the only address in the message. there is no
// tracking parameter, no redirect through anything, and nothing else to click: what a recipient
// checks before typing a password is the host in the address, and every extra link is one more
// thing for them to check.

export interface InvitationData {
	/** `org_profile.legal_name`, or the app's own name where nobody has filled the profile in. */
	readonly orgName: string;
	/** the whole address the recipient opens, token and all. built by the route that sends this. */
	readonly link: string;
	/** when the link stops working — `auth_member_invitation.expires_at`. */
	readonly expiresAt: Date;
}

/**
 * an invitation to set a password and sign in.
 *
 * the subject names the organisation because that is what the recipient recognises: mail from a
 * deployment they have never heard of, about an app they have never used, is mail they delete.
 */
export function template(data: InvitationData): EmailTemplate {
	const subject = `Set up your ${data.orgName} account`;

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{openingLine(data.orgName)}</Paragraph>
				{/*
				 * the address is its own text as well as its href: a client that strips the anchor
				 * still leaves something the recipient can copy, and one that keeps it shows where it
				 * goes. `break-all` because a token is one unbreakable word wider than a phone.
				 */}
				<p style={LINK_STYLE}>
					<a href={data.link} style={ANCHOR_STYLE} target="_blank" rel="noopener">
						{data.link}
					</a>
				</p>
				<Paragraph>{expiryLine(data.expiresAt)}</Paragraph>
				<Divider />
				<SmallPrint>{CLOSING}</SmallPrint>
			</Layout>
		)
	};
}

const LINK_STYLE: CSSProperties = { margin: box(0, 0, SPACE_6), wordBreak: 'break-all' };

/** the anchor itself: coloured and undecorated, because a client that keeps neither still opens it. */
const ANCHOR_STYLE: CSSProperties = { color: LINK, textDecorationLine: 'none' };

/** what the message says about the link, in the one wording both arms use. */
function expiryLine(expiresAt: Date): string {
	return `This link works once, and expires on ${formatDate(expiresAt)}. If it has run out, ask whoever invited you to send another.`;
}

/** the invitation, and what it is for, in the one wording both arms use. */
function openingLine(org: string): string {
	return `You have been invited to help manage donations for ${org}. Open the link below to choose a password and sign in.`;
}

/**
 * the sentence under the rule, and the reason it is not "ignore this email".
 *
 * somebody who was not expecting this was named by a colleague who can reach their mailbox, so the
 * useful thing to do is ask that colleague rather than to wonder. the link expires either way.
 */
const CLOSING = 'If you were not expecting this, ask the person who invited you.';
