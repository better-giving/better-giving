import { Field } from '@better-giving/operator/components/forms/Field';

/*
 * every combination of the four blocks a field draws around its box — label, hint, error, needed —
 * plus the box types, the two pointer states, and the box with a control on its own row.
 *
 * `beside` is drawn three times because the row is where the two heights meet: the press takes the
 * field's height rather than the control's, so a specimen of it at rest says nothing on its own —
 * what is worth looking at is the same row under a refusal and under a standing sentence, where the
 * block underneath is the field's and the pair above it has to still be a line.
 *
 * the pairs are the point. `error` and `needed` are reachable together and neither replaces the
 * other, so a field holding both is a real state an operator meets and the one that says whether
 * two message rows stack legibly. a field with a hint AND an error has two blocks the box points
 * at through one `aria-describedby`, which is the only place the order they are read in is
 * visible.
 *
 * `aria-invalid` with no message is the pair's case seen from one box: something larger than this
 * field marked it refused and holds the sentence itself, so the box draws the border and says
 * nothing.
 *
 * the two pointer states are the whole of what a box pins: packages/operator/src/styles/adm.css
 * gives `.adm-input` a hover twin and packages/operator/src/styles/base.css draws every
 * `.is-focus`. unavailable is not pinned at all — the sheet draws `:disabled` with no twin beside
 * it — so the specimen for it is the real attribute the field passes through.
 *
 * the masked boxes open with one standing directly above a plain box, because the width of the two
 * against each other is the whole reason the press is inside the box rather than on the row beside
 * it. the rest are what sharing the box's own end can go wrong at: a refusal, whose border reaches
 * that end too; the box closed, where the press is closed with it; a value long enough to run under
 * the press if the box reserved it no room; and the wrapper standing on a row a caller also put a
 * control on.
 *
 * the last field's label and hint are long on purpose: string length is a layout constraint, and
 * a label that wraps is what puts the box at a different distance from the one above it.
 */
export default function FormsFieldPreview() {
	return (
		<div className="adm-stack">
			<Field id="forms-field-plain" label="Organisation name" defaultValue="Riverside Shelter" />
			<Field
				id="forms-field-optional"
				label="Reply-to address"
				optional
				placeholder="hello@riverside-shelter.org"
			/>
			<Field
				id="forms-field-hint"
				label="Receipt footer"
				hint="Printed at the bottom of every receipt. Your registered number belongs here."
			/>
			<Field
				id="forms-field-error"
				label="Minimum gift"
				defaultValue="0"
				error="A minimum gift must be at least 1."
			/>
			<Field
				id="forms-field-needed"
				label="Registered charity number"
				needed="A test send is waiting on this."
			/>
			<Field
				id="forms-field-hint-error"
				label="Allowed origin"
				hint="The scheme and host of the page the form is pasted into."
				error="An origin cannot end in a path."
				defaultValue="https://riverside-shelter.org/donate"
			/>
			<Field
				id="forms-field-error-needed"
				label="Sender address"
				error="That address is not on the verified sender list."
				needed="Receipts cannot be sent until this is set."
				defaultValue="receipts@riverside-shelter.org"
			/>
			<Field
				id="forms-field-all"
				label="Statement descriptor"
				hint="What a donor sees on their bank statement. 22 characters at most."
				error="A statement descriptor cannot contain a semicolon."
				needed="Stripe will not charge a card until this is set."
				defaultValue="RIVERSIDE SHELTER; INC"
			/>
			<Field
				id="forms-field-marked"
				label="Suggested amount"
				aria-invalid="true"
				defaultValue="500"
			/>
			<Field id="forms-field-code" label="Webhook endpoint id" code defaultValue="we_1QxLpR2eZv" />
			<Field
				id="forms-field-textarea"
				as="textarea"
				label="Thank-you message"
				hint="Sent with every receipt."
				defaultValue="Thank you. Your gift keeps the doors open tonight."
			/>
			<Field
				id="forms-field-textarea-error"
				as="textarea"
				label="Thank-you message"
				error="A thank-you message cannot be blank."
			/>
			<Field id="forms-field-email" type="email" label="Notification address" optional />
			<Field
				id="forms-field-beside"
				label="To"
				code
				defaultValue="alerts@riverside-shelter.org"
				beside={
					<button type="button" className="adm-btn">
						Send test email
					</button>
				}
			/>
			<Field
				id="forms-field-beside-refused"
				label="To"
				code
				defaultValue="alerts@riverside-shelter"
				error="That is not an address this deployment can send to. Nothing was sent."
				beside={
					<button type="button" className="adm-btn">
						Send test email
					</button>
				}
			/>
			<Field
				id="forms-field-beside-needed"
				label="To"
				code
				needed="Type an address to send the test to."
				beside={
					<button type="button" className="adm-btn" disabled>
						Send test email
					</button>
				}
			/>
			{/* a masked box directly above a plain one, which is the comparison this specimen is for:
			    the two are the same width, and a fold of them reads as one column. both hold a value,
			    because a console box is seeded with what the deployment is holding. the shown state is
			    a press away and is not drawn here: whether the value is showing is the field's own and
			    starts hidden at every mount. */}
			<Field
				id="forms-field-masked"
				label="Password"
				code
				masked
				defaultValue="re_8fJq2xVnW4tLp0Zd"
			/>
			<Field
				id="forms-field-masked-beside-plain"
				label="Mail host"
				code
				defaultValue="smtp.resend.com"
			/>
			{/* no specimen here is spelled in a processor's own key shape: github reads a push for
			    anything shaped like a live key and refuses the whole of it, and a made-up one in a
			    gallery file reads exactly like a real one to that. */}
			<Field
				id="forms-field-masked-refused"
				label="Secret key"
				code
				masked
				defaultValue="key_live_51NwQpR2eZvKYlo2C"
				error="Stripe turned that key down. Check it is the secret key and not a restricted one."
			/>
			<Field
				id="forms-field-masked-disabled"
				label="Password"
				code
				masked
				disabled
				defaultValue="re_8fJq2xVn"
			/>
			{/* a value long enough to run under the press if the box reserved no room for it. */}
			<Field
				id="forms-field-masked-long"
				label="Secret key"
				code
				masked
				defaultValue="key_live_51NwQpR2eZvKYlo2CEuIzT8kWqXn4bVdHfGm7RsYpAj3LcNo6"
			/>
			{/* the wrapper on the row with a control the caller put there: what stands on the row is
			    what the box is inside of, so the box still takes the line's remainder and the press
			    still stands in it. */}
			<Field
				id="forms-field-masked-beside"
				label="Password"
				code
				masked
				defaultValue="re_8fJq2xVn"
				beside={
					<button type="button" className="adm-btn">
						Send test email
					</button>
				}
			/>
			<Field id="forms-field-unlabelled" aria-label="Suggested amount 1" defaultValue="25" />
			<Field id="forms-field-hover" label="hover" state="hover" />
			<Field id="forms-field-focus" label="focus" state="focus" />
			<Field
				id="forms-field-really-disabled"
				label="disabled attribute"
				disabled
				defaultValue="EUR"
			/>
			<Field
				id="forms-field-long"
				label="Address the organisation is registered at for tax-deductibility purposes"
				hint="This is printed on every receipt and has to match the address on the registration, character for character, or a donor's claim can be refused."
				defaultValue="Unit 4, The Old Granary, 118–120 Wharfedale Riverside Way, Kirkstall, Leeds LS5 3BF"
			/>
		</div>
	);
}
