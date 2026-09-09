import { CodeChip, CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';

/*
 * the slab's four heads, the two lengths it has to survive, and its one-line form.
 *
 * the head is where the states are. `label` and `copyable` are independent and each may be absent,
 * so there are four heads and one of them is empty — a band with nothing in it, held open by the
 * `min-block-size` packages/operator/src/styles/adm.css puts on `.adm-slabhead`. that is the
 * specimen worth the line: a slab with neither a caption nor a control still reserves the row, and
 * whether that reads as deliberate or as a missing element is only visible here.
 *
 * `record` changes two things a page cannot see and a reader can hear, and both are exercised. it
 * takes the box out of the landmark list — `region` becomes `group`, so twenty slabs are not twenty
 * sections called snippet — and it names the copy control for the record it takes. the pair matters
 * because the control is only renamed when there is a label to name it with
 * (packages/operator/src/components/data/CodeSlab.jsx): a slab handed a record and no label is a
 * group with no accessible name whose control is one more button called Copy, which is the state
 * the fourth specimen holds. it is also the head holding one child, and the control still stands
 * at the trailing edge: at the leading one it would sit where every caption above it sits.
 *
 * the copy control's own three states are not reachable from here — they are set inside
 * packages/operator/src/components/controls/CopyControl.jsx from what the clipboard did, and
 * src/previews/controls-copy-control.tsx says so.
 *
 * the long specimens are the point of the element: the block of code scrolls sideways rather than
 * wrapping, so a one-line snippet longer than the page is what says the block takes focus and a
 * keyboard can reach the end of it. it is also the one specimen where the head standing still is
 * visible — the caption and the copy control keep the width of the box while the line moves under
 * them, and a control carried off past the right edge is a control nobody presses. the multi-line
 * one is the `<pre>` newline trap that component's header argues — the content must begin on the
 * first line and not below it.
 *
 * the one-line form is the head's absence and the fade's presence, and both are only legible on a
 * value that overflows: the code and the control share one band, the line scrolls under the control
 * standing over its trailing end, and what runs off dissolves into the slab's ground rather than
 * ending at the control's edge. the long specimen is the one that shows it — and it is also where
 * the end padding
 * packages/operator/src/styles/adm.css puts on the block is visible as the thing that lets the last
 * glyph of a value be scrolled clear of the fade. the short one is the same form with nothing to
 * fade, which is what says the fade is drawn from the end of the box and not from the end of the
 * text. the third has no control, and no fade with it: the fade is the control's, so a one-line
 * slab that offers nothing to press runs its line to the edge the way `.adm-cmd--oneline` does.
 *
 * a caption is not among the one-line states, and its absence is structural rather than unexercised:
 * the form draws no head, and packages/operator/src/components/data/CodeSlab.jsx's type refuses the
 * prop outright.
 *
 * the module's other two exports are the same face in its two roles, and they are drawn together
 * because the difference between them is only visible side by side. `InlineCode` stands in a
 * sentence and the sentence closes over it, so the specimen below ends one on a comma, one on an
 * apostrophe and one on a full stop: those are the marks a chip with inline padding pushes away
 * from, and the gap then reads as a space somebody typed. `CodeChip` stands on its own with
 * nothing abutting it, where that same padding is what makes it a box — so the list under the
 * sentence is where too little of it would read as cramped. neither is legible as a defect from
 * either sheet alone.
 */
export default function DataCodeSlabPreview() {
	return (
		<div className="adm-stack">
			<CodeSlab content="https://give.riverside-shelter.org/embed.js" />
			<CodeSlab
				label="snippet"
				copyable
				content={`<script src="https://give.riverside-shelter.org/embed.js" defer></script>\n<bg-donate-form form="winter-appeal"></bg-donate-form>`}
			/>
			<CodeSlab
				label="snippet"
				record="the winter appeal form"
				copyable
				content={`<script src="https://give.riverside-shelter.org/embed.js" defer></script>\n<bg-donate-form form="winter-appeal"></bg-donate-form>`}
			/>
			<CodeSlab
				record="the winter appeal form"
				copyable
				content={'<bg-donate-form form="winter-appeal"></bg-donate-form>'}
			/>
			<CodeSlab label="snippet" content={'<bg-donate-form form="winter-appeal">'} />
			<CodeSlab
				label="webhook endpoint"
				copyable
				content="https://give.riverside-shelter.org/api/v1/stripe/webhook?deployment=riverside-shelter-production&attempt=1"
			/>
			<CodeSlab
				label="receipt template"
				copyable
				content={`Thank you for your gift to Riverside Shelter.\n\nAmount: £45.00\nReceived: 4 February 2026\nReference: dn_4Kq2Rt\n\nRiverside Shelter is a registered charity, number 1104567. This receipt is\nevidence of your gift for tax purposes; keep it with your records.`}
			/>
			<CodeSlab
				oneline
				copyable
				content="https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=54d11594-84e4-41aa-b438-e81b8fa78ee7&redirect_uri=http%3A%2F%2Flocalhost%3A8976%2Foauth%2Fcallback&scope=account%3Aread+d1%3Awrite+workers_scripts%3Awrite&state=Xn7Kq2Rt9vLm"
			/>
			<CodeSlab oneline copyable content="http://localhost:8976/oauth/callback" />
			<CodeSlab oneline content="http://localhost:8976/oauth/callback" />
			<p>
				The embed reads its form from the <InlineCode>form</InlineCode> attribute, and the id it
				names is the one on the form&rsquo;s own screen.
			</p>
			<p>
				A donor coming back from their bank carries{' '}
				<InlineCode>
					?bg_donate_form=winter-appeal&amp;payment_intent=pi_3QxLpR2eZvKYlo2C1gFJa8Xz
				</InlineCode>{' '}
				on the address, and the form on that page resumes their gift from it.
			</p>
			{/* three sentences rather than one, because a line the formatter breaks between a chip and
			    the mark after it is a line jsx renders with a space in it — which is the defect these
			    specimens exist to show. each one is short enough to stay on its own line. */}
			<p>
				A site is written the way a browser shows it: <InlineCode>https://example.org</InlineCode>,
				with no page on the end.
			</p>
			<p>
				The order a deploy runs in is <InlineCode>package.json</InlineCode>&rsquo;s.
			</p>
			<p>
				The door a deploy goes through is <InlineCode>wrangler deploy</InlineCode>.
			</p>
			<ul className="adm-list">
				<li>
					<CodeChip>0000_initial_schema.sql</CodeChip>
				</li>
				<li>
					<CodeChip>meta/_journal.json</CodeChip>
				</li>
			</ul>
		</div>
	);
}
