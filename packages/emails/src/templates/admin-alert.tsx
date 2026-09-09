import { Fragment, type CSSProperties } from 'react';
import { BLOCK_BG, box, EDGE, FONT_MONO, INK, LH_CODE, SPACE_6, TEXT_CODE } from '../tokens';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';

// operational mail to the people who run this deployment — a webhook that stopped arriving,
// a send that failed, the "does email work" test from the console, and a gift that
// reached the books.
//
// the last of those is not a fault, and the shape holds for it because nothing here assumes
// one: `action` is nullable, and the message that reports good news passes null rather than
// inventing something for the reader to do. what makes it the same template as the others is
// the audience and the address — it goes where they go, in the same voice, and a second
// template would be a second set of rules about both.
//
// pure, the same as the receipt: a model in, a subject and a body out, no database and no clock.
//
// it never refuses to render, and that asymmetry with the receipt is the point of the file.
// a receipt refuses when `org_profile` is incomplete because it is a document a donor files
// with a tax authority. this one is a message to the operator who has not filled that form
// in yet — the first thing it will ever be used for is the send-test on a fresh deployment —
// so a version of it that could refuse for want of an organisation's legal name would be
// unable to report the very state it exists to report. it prints what it was given.
//
// it goes to `org_profile.notification_email`, which is not a from address. that column is
// documented as operational mail only and explicitly not donor-facing; the From address is
// `MAIL_FROM`, a deploy-time secret, because it is authorised by the same third party that
// issued the SMTP credential. the two are never interchangeable.

/** one labelled value — a donation id, an event id, an HTTP status. */
export interface AlertFact {
	readonly label: string;
	readonly value: string;
}

export interface AdminAlertData {
	/** one line, and also the subject. write it as the thing that happened. */
	readonly headline: string;
	/** a short paragraph a person reads: what happened, and what it means for the books. */
	readonly body: string;
	/**
	 * the machine-readable half, pass `[]` for none. required rather than optional, so that
	 * "there is nothing to show" is something a caller said instead of something it forgot.
	 */
	readonly facts: readonly AlertFact[];
	/** what to do about it, or `null` when there is nothing to do. */
	readonly action: string | null;
}

/**
 * an operational alert.
 *
 * the subject is the headline verbatim — no `[Donations]` prefix. the From address already
 * identifies the deployment, and a bracketed prefix is the first thing a spam filter scores
 * and the first thing a person stops reading.
 */
export function template(data: AdminAlertData): EmailTemplate {
	return {
		subject: data.headline,
		node: (
			<Layout title={data.headline}>
				<Heading>{data.headline}</Heading>
				<Paragraph>{data.body}</Paragraph>
				{data.facts.length === 0 ? null : <Facts facts={data.facts} />}
				{data.action === null ? null : (
					<p style={ACTION_STYLE}>
						<strong>What to do:</strong> {data.action}
					</p>
				)}
				<Divider />
				<SmallPrint>{FOOTER}</SmallPrint>
			</Layout>
		)
	};
}

/** what the address is for, said on every message that arrives at it. */
const FOOTER = 'Sent by your donations app. This address receives operational mail only.';

/** `label: value`, one per line, in both arms. */
function factLines(facts: readonly AlertFact[]): string[] {
	return facts.map((fact) => `${fact.label}: ${fact.value}`);
}

/**
 * the machine-readable half, set in monospace so an id can be read character by character and
 * compared against the one on a dashboard.
 *
 * one paragraph broken by `<br>` rather than a list: a client that drops the styling still leaves
 * one fact per line, and a `<ul>` would add a bullet to a value somebody is about to copy.
 */
function Facts({ facts }: { readonly facts: readonly AlertFact[] }) {
	return (
		<p style={FACTS_STYLE}>
			{factLines(facts).map((line, index) => (
				<Fragment key={line}>
					{index === 0 ? null : <br />}
					{line}
				</Fragment>
			))}
		</p>
	);
}

const FACTS_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	fontFamily: FONT_MONO,
	fontSize: TEXT_CODE,
	lineHeight: LH_CODE
};

/** the one instruction on the page, set apart by a rule down its side. */
const ACTION_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	padding: SPACE_6,
	borderLeft: `${EDGE}px solid ${INK}`,
	background: BLOCK_BG
};
