import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';
import type { Dedication } from './receipt';

// the notice sent to the person a donor asked us to tell about a gift given in someone's honor or
// memory.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and a body out, no
// database, no clock, no I/O. whether anybody is told at all is the caller's — it claims
// `donation.tribute_notified_at` before it renders, which is what stops a family being told twice.
//
// `legalName` arrives proven rather than nullable, and the refusal behind it is sharper here than
// on ./uncollected.tsx: this is the one mail this deployment sends to somebody who never gave it
// an address, about somebody they have lost, and an organisation that cannot name itself is
// indistinguishable from a stranger who found the name. a deployment with no registered name saved
// writes no notice, and the words for that gap are the app's.
//
// it carries no amount and no message, and neither may be added. the family is told that the gift
// happened and not what it cost — a figure turns a condolence into a statement of account, and the
// donor chose it for the organisation rather than for this reader. there is no message to carry
// either: `donation.note` is the donor's own words to the organisation and was never addressed
// here, which is the separation packages/app/src/lib/server/db/schema.ts draws at `tribute_kind`,
// and the form asks the donor for nothing to pass on.

export interface TributeData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** `donation.tribute_notify_name` — who this is addressed to. */
	readonly notifyName: string;
	/** the donor's display name, or `null` where the gift names nobody to say it was from. */
	readonly donorName: string | null;
	/** what the gift was given for — the value ./receipt.tsx prints on its dedication row. */
	readonly tribute: Dedication;
}

/** the notice, as a subject and a body. */
export function template(data: TributeData): EmailTemplate {
	// one dedication, used by the subject and by the sentence, so the two cannot name the honoree
	// differently on a message somebody reads once and keeps.
	const dedication = `${midSentence(data.tribute.label)} ${data.tribute.honoree}`;
	const subject = `A gift was made ${dedication}`;
	const greeting = `Dear ${data.notifyName},`;
	const said =
		`A gift ${dedication} was made to ${data.legalName} by ${data.donorName ?? 'the donor'}, ` +
		'who asked that you be told.';
	const closed = 'There is nothing you need to do.';

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Paragraph>{closed}</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}

/**
 * the dedication's phrase, moved into the middle of a sentence.
 *
 * the phrase arrives worded for the head of a receipt row — "In memory of" — and every use of it
 * here is inside a sentence. the case comes down and no word changes: which two words a dedication
 * uses is the caller's, for the reason `Dedication` in ./receipt.tsx states, and this is the one
 * thing done to them.
 */
function midSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}
