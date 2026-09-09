import { render } from '@react-email/render';
import type { EmailTemplate } from './template';

// the seam between a template and a transport: jsx in, two arms and a subject out.
//
// both arms are produced here and neither is optional, because the message goes out as
// multipart/alternative and the text arm is not a courtesy — a receipt is a tax record that gets
// forwarded to an accountant, printed, and read in clients that never render html.
//
// a template may hand its own text arm and most do not. the default is `render`'s stripper, which
// is the right answer for a message whose text is its markup with the tags taken off. it is the
// wrong answer for a receipt: that document's text layout is deliberate — a block ruled off in a
// character chosen to match the disclosure's, labels padded to a column so the values line up when
// somebody pastes it into a spreadsheet — and a stripper produces none of it. ./template.ts states
// the same rule from the type's side.

/** subject line and both body arms — what a template produces, before it has a recipient. */
export interface RenderedEmail {
	readonly subject: string;
	readonly text: string;
	readonly html: string;
}

/**
 * what the stripper is told, for every template that leaves its text arm to it.
 *
 * a heading keeps the case it was written in. html-to-text shouts every `<h1>` by default, and
 * this package has already settled which line in a text arm may be in capitals:
 * ./templates/receipt.tsx sets the statutory disclosure heading that way and argues that the
 * treatment is that block's alone, the way the border around it is in the other arm.
 */
const HEADING_CASE = { selectors: [{ selector: 'h1', options: { uppercase: false } }] };

/** renders both arms of a template. */
export async function renderEmail(template: EmailTemplate): Promise<RenderedEmail> {
	const html = await render(template.node);
	const text =
		template.text ??
		(await render(template.node, { plainText: true, htmlToTextOptions: HEADING_CASE }));
	return { subject: template.subject, text, html };
}
