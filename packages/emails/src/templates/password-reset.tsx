import type { CSSProperties } from 'react';
import { box, LINK, SPACE_6 } from '../tokens';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';

// the mail that carries a password-reset link to a member who asked for one from the sign-in page.
//
// pure, the same as the invitation: a model in, a subject and a body out, no database, no clock and
// no I/O. it is handed a link rather than an origin and a token, because a template that built the
// address would be a template that had to know which host this deployment answers on — that is the
// route's to know, and the app mints the token it carries.
//
// it never refuses to render. `orgName` arrives already resolved, and a deployment with no name
// saved falls back to the word every screen falls back to — that fallback is the caller's, because
// this package imports nothing from the app.
//
// the link is printed as itself in both arms and is the only address in the message. there is no
// tracking parameter, no redirect through anything, and nothing else to click: what a recipient
// checks before typing a password is the host in the address, and every extra link is one more
// thing for them to check.
//
// the hour the wording states is `PASSWORD_RESET_LIFETIME_SECONDS` in
// packages/app/src/lib/server/auth/index.ts, which this package cannot import — the two change together.

export interface PasswordResetData {
	/** `org_profile.legal_name`, or the app's own name where nobody has filled the profile in. */
	readonly orgName: string;
	/** the whole address the recipient opens, token and all. built by the route that sends this. */
	readonly link: string;
}

/**
 * a link to choose a new password.
 *
 * the subject names the organisation because that is what the recipient recognises: mail from a
 * deployment they have never heard of, about an app they have never used, is mail they delete.
 */
export function template(data: PasswordResetData): EmailTemplate {
	const subject = `Reset your ${data.orgName} password`;

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
				<Paragraph>{EXPIRY}</Paragraph>
				<Divider />
				<SmallPrint>{CLOSING}</SmallPrint>
			</Layout>
		)
	};
}

const LINK_STYLE: CSSProperties = { margin: box(0, 0, SPACE_6), wordBreak: 'break-all' };

/** the anchor itself: coloured and undecorated, because a client that keeps neither still opens it. */
const ANCHOR_STYLE: CSSProperties = { color: LINK, textDecorationLine: 'none' };

/**
 * what the message says about the link, in the one wording both arms use.
 *
 * the hour is stated in words rather than as a date: a link this short-lived is opened in the same
 * sitting it was asked for, and a timestamp would be read as a deadline to diarise.
 */
const EXPIRY =
	'This link works once, and expires an hour after it was sent. If it has run out, ask for another from the sign-in page.';

/** why the mail arrived, and what to do with the link, in the one wording both arms use. */
function openingLine(org: string): string {
	return `Somebody asked to reset the password for your ${org} account. Open the link below to choose a new one.`;
}

/**
 * the sentence under the rule, and the reason it is not "ignore this email".
 *
 * anyone who can type an address can cause this mail to be sent, so the recipient's question is
 * whether their account has already changed under them. it has not, and until the link is opened
 * nothing about the account has moved.
 */
const CLOSING = 'If you did not ask for this, you can ignore it. Your password has not changed.';
