import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';

/*
 * both tones of the row, drawn on their own rather than under a box. that is the console's use of
 * it — a press answers at the control that made it and there is no field for the row to hang off —
 * and it is also the only place the row's own line is visible: inside a `.adm-field` the grid rows
 * around it are what the eye reads.
 *
 * the specimens carrying an inline element are the point of the page. the standing row is a flex
 * line and its gap stands between the mark and the words, so a sentence handed over as more than one node
 * would take that gap between every one of its own parts — a marked value and the clause that
 * introduces it ending up a paragraph apart. the component wraps the sentence in one child, and
 * what proves it is a specimen where the code span and the words either side of it read as one
 * line.
 *
 * a link is drawn as well as a marked value, because it is the second inline element these
 * sentences reach for and the two are different elements to the layout.
 *
 * the last of each tone is long on purpose: the standing row's mark sits against the first line of
 * a sentence that wraps, and a one-line specimen never shows whether it does; the refusal, which
 * draws no mark, has to hold its weight across lines without one.
 */
export default function FormsFieldMessagePreview() {
	return (
		<div className="adm-stack">
			<FieldMessage>Give it a name.</FieldMessage>
			<FieldMessage tone="needed">A test send is waiting on this.</FieldMessage>
			<FieldMessage>
				This deployment answers on no address at all, so Stripe would have nowhere to deliver to.
				Turn its <InlineCode>workers.dev</InlineCode> address back on, then press again.
			</FieldMessage>
			<FieldMessage tone="needed">
				This deployment is older than the console. Update it with{' '}
				<InlineCode>pnpm run deploy</InlineCode>, then reload this page.
			</FieldMessage>
			<FieldMessage>
				Nothing was registered and nothing was stored. Turn the address back on, or attach a domain,
				at{' '}
				<a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">
					dash.cloudflare.com
				</a>{' '}
				&rarr; Compute (Workers), then press again.
			</FieldMessage>
			<FieldMessage>
				Nothing was saved — the profile is stored whole or not at all, so no part of this press
				landed. The registered address is longer than the receipt line it is printed on, and the
				name on the registration is not the name this deployment sends receipts under, so both would
				have to be settled before a donor could claim against either.
			</FieldMessage>
			<FieldMessage tone="needed">
				Stripe will not charge a card until a statement descriptor is set, so every gift this
				deployment takes today is one a donor cannot recognise on their bank statement and one your
				team will be answering the phone about.
			</FieldMessage>
		</div>
	);
}
