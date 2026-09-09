import { Layout, Paragraph } from '../components/layout';
import type { EmailTemplate } from '../template';

// the message that answers whether mail leaves this deployment at all, as one act the console
// presses.
//
// **it is a plain test and carries nothing else.** no gift, no receipt, no detail read off the
// organisation row — the question is whether this deployment can hand a message to a mail host and
// whether that host delivers it, and anything else on the page is something an operator has to
// read past to find that out. its arrival is the whole answer, so the body is one greeting and
// no explanation.
//
// it takes no data for the same reason. the destination arrives with the press and belongs to the
// caller, which sends this — a template decides what a message says and never who it goes to.

/** what the message says it is, in the one line a client shows before it is opened. */
const SUBJECT = 'Test email from your deployment';

/** the whole body. */
const LINE = 'Hi from your Better Giving deployment :)';

/** the test message, which is the same message every time. */
export function template(): EmailTemplate {
	return {
		subject: SUBJECT,
		node: (
			<Layout title={SUBJECT}>
				<Paragraph>{LINE}</Paragraph>
			</Layout>
		)
	};
}
