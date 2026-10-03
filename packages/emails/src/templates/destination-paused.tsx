import type { CSSProperties, ReactNode } from 'react';
import {
	box,
	CODE_BG,
	CODE_INK,
	FONT_MONO,
	LINK,
	RADIUS,
	SPACE_1,
	SPACE_6,
	TEXT_CODE
} from '../tokens';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';
import { FOOTER } from './admin-alert';

// the mail that tells the people who run this deployment a webhook destination was paused.
//
// sent once per pause, to the same address as ./admin-alert.tsx and in the same voice.
//
// the destination is named by its URL in a code chip, never in quote marks: the operator pasted
// that address, and the chip is how an operator screen sets a literal off inside a sentence
// (`.adm-code` in packages/operator/src/styles/base.css). "destination" is the one word for it,
// in this mail as on every screen.
//
// pure, the same as the alert: a model in, a subject and a body out. the address of the
// destination's own page, where it is resumed, is handed in as a path and the origin it sits on,
// because only the sender knows whether this deployment's own address is known at all — a cron run
// has no request to read it off. with no origin the page is named by its path, since a relative
// href is broken in every inbox.

export type PauseCause =
	| { readonly reason: 'failing'; readonly days: number }
	| { readonly reason: 'gone' };

export interface DestinationPausedData {
	/** the destination's address, as the organisation gave it. */
	readonly url: string;
	/** why it was paused; `days` is how long every delivery to it failed first. */
	readonly cause: PauseCause;
	/** the destination's own dashboard page, where it is resumed, as a path on this deployment. */
	readonly destinationPath: string;
	/** where this deployment answers, or null where nothing states it. */
	readonly origin: string | null;
}

const SUBJECT = 'A webhook destination was paused';

/** a paused destination: which one, why, that nothing is lost, and how to resume it. */
export function template(data: DestinationPausedData): EmailTemplate {
	return {
		subject: SUBJECT,
		node: (
			<Layout title={SUBJECT}>
				<Heading>{SUBJECT}</Heading>
				<Paragraph>{why(data.cause, <code style={CODE_STYLE}>{data.url}</code>)}</Paragraph>
				<Paragraph>
					While it is paused nothing is sent to it. New events for it are held, not lost.
				</Paragraph>
				<Paragraph>
					Once it is working again, resume it from the destination’s page on your dashboard.
					Resuming it sends everything that was held, then carries on as before.
				</Paragraph>
				{data.origin === null ? (
					<Paragraph>
						That page is under Integrations, then Webhooks, at{' '}
						<code style={CODE_STYLE}>{data.destinationPath}</code> on your dashboard.
					</Paragraph>
				) : (
					<DestinationLink href={`${data.origin}${data.destinationPath}`} />
				)}
				<Divider />
				<SmallPrint>{FOOTER}</SmallPrint>
			</Layout>
		)
	};
}

function why(cause: PauseCause, destination: ReactNode): ReactNode {
	return cause.reason === 'failing' ? (
		<>
			Every delivery to {destination}
			{` has failed for ${cause.days} days, so the destination has been paused.`}
		</>
	) : (
		<>The destination {destination} answered that it no longer exists, so it has been paused.</>
	);
}

/** the address as its own text, as ./invitation.tsx prints its link, for the same reasons. */
function DestinationLink({ href }: { readonly href: string }) {
	return (
		<p style={LINK_STYLE}>
			<a href={href} style={ANCHOR_STYLE} target="_blank" rel="noopener">
				{href}
			</a>
		</p>
	);
}

/** `.adm-code`'s treatment, converted: the code face and ground, the system's corner. */
const CODE_STYLE: CSSProperties = {
	fontFamily: FONT_MONO,
	fontSize: TEXT_CODE,
	background: CODE_BG,
	color: CODE_INK,
	borderRadius: RADIUS,
	padding: box(SPACE_1, 0),
	wordBreak: 'break-all'
};

const LINK_STYLE: CSSProperties = { margin: box(0, 0, SPACE_6), wordBreak: 'break-all' };

const ANCHOR_STYLE: CSSProperties = { color: LINK, textDecorationLine: 'none' };
