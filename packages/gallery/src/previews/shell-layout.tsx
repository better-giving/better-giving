import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import {
	Column,
	Group,
	List,
	Section,
	Stack,
	Steps
} from '@better-giving/operator/components/shell/Layout';

/*
 * the six arrangements every operator screen is built out of, each drawn at the one thing it
 * decides and nothing else.
 *
 * spacing is the whole of what five of these do, so every specimen holds at least two blocks: one
 * block in a `Stack` shows no gap, and a gap is the only thing there is to look at. the pairs are
 * drawn tight and loose beside each other for the same reason — a step is a step relative to
 * another step, and a single run of rows says nothing about which one it took.
 *
 * `Section` is the one arrangement whose rule is drawn by the element rather than written: two
 * adjacent sections take a rule between them and a lone section takes none
 * (`.adm-section + .adm-section` in packages/operator/src/styles/adm.css), so three in a row is the
 * least that shows both — the first has nothing above it and the two after it each draw one.
 *
 * `card` is the same division drawn as a box, and two of them are the least that shows what a card
 * settles: what stands between them is the stack's own step and no rule at all, so a run of them
 * reads as blocks that each end rather than as one page divided.
 *
 * `Column` is a measure and measures only read against content that would otherwise be wider, so
 * the narrow and wide columns each hold a line long enough to reach their own edge. `stack={false}`
 * is the column with its own gap taken off: the blocks inside it touch, which is what a screen gets
 * when it means to space them itself.
 *
 * `Group`'s `labelAs` is stated by every caller and defaulted by none, so all five levels are drawn
 * — they differ in the outline a reader navigates by and in nothing on the screen, which is exactly
 * why a specimen of each is here rather than one of `h3`. `label` has a default of its own, so the
 * last group is what a screen that forgot the prop actually draws.
 *
 * `Steps` is the one list in this system with markers, and the numerals only line up against a step
 * whose body wraps to a second line — so the loose run holds one.
 */
export default function ShellLayoutPreview() {
	return (
		<div className="adm-stack">
			<Column>
				<p>
					The narrow column is the measure prose, forms and ledgers are read at. This sentence is
					long enough to reach its edge and wrap, which is the only way a measure is visible at all.
				</p>
				<Field
					id="shell-layout-column"
					label="Reply-to address"
					defaultValue="hello@riverside-shelter.org"
				/>
			</Column>

			<Column wide>
				<p>
					The wide column is for a table plane and nothing else. It is wider than the one above by
					enough that the same sentence set in both wraps in one and not the other, which is what
					this line is for.
				</p>
				<p>A second block, so the column&rsquo;s own gap has something to gap.</p>
			</Column>

			<Column stack={false}>
				<p>The column with its own gap taken off. This block and the one under it touch.</p>
				<p>A screen writing this means to space its blocks itself.</p>
			</Column>

			<Stack>
				<p>The step between one block and the next.</p>
				<p>Loose, which is the default and the step a screen is read down.</p>
			</Stack>

			<Stack tight>
				<p>The closer run: a control and the sentence under it, or a run of rows.</p>
				<p>Never the default — a screen stacked tight throughout reads as one block.</p>
			</Stack>

			<div>
				<Section>
					<h2>Donations</h2>
					<p>The first section has nothing above it, so it draws no rule.</p>
				</Section>
				<Section>
					<h2>Receipts</h2>
					<p>The second draws the rule between itself and the first.</p>
				</Section>
				<Section>
					<h2>Recurring gifts</h2>
					<p>And the third draws its own, which is what makes the divider the section&rsquo;s.</p>
				</Section>
			</div>

			<div className="adm-stack">
				<Section card>
					<h2>Name and status</h2>
					<Field id="shell-layout-card-name" label="Form name" defaultValue="Winter appeal 2026" />
				</Section>
				<Section card>
					<h2>What a donor may give</h2>
					<Field id="shell-layout-card-min" label="Smallest gift" defaultValue="5.00" />
				</Section>
			</div>

			<List>
				<p>A run of records. Winter appeal &mdash; £12,480.00 raised from 214 gifts.</p>
				<p>Kitchen fund &mdash; nothing given yet.</p>
				<p>Emergency night shelter &mdash; £3,105.00 raised from 62 gifts.</p>
			</List>

			<List>
				<p>A run of one, which is the same arrangement with nothing to gap.</p>
			</List>

			<Steps>
				<li>Create a restricted key in the Stripe dashboard.</li>
				<li>
					Set it as a secret on this deployment, then deploy again &mdash; a secret set without a
					deploy after it reaches nothing, because the running worker holds the values it was
					started with.
				</li>
				<li>Send a test donation of £1 and refund it.</li>
			</Steps>

			<Steps tight>
				<li>The closer run, for steps that are each one line.</li>
				<li>Copy the endpoint address.</li>
				<li>Paste it into Stripe.</li>
			</Steps>

			<Group label="Corrections" labelAs="h2">
				<p>
					A correcting entry moves an amount between two accounts and says why. It is the level a
					group takes when it stands directly under the screen&rsquo;s own heading.
				</p>
			</Group>

			<Group label="Payment notifications" labelAs="h3">
				<p>
					Stripe calls this deployment when a card settles. Without the signing secret every call is
					refused.
				</p>
				<Button variant="primary">Set the signing secret</Button>
			</Group>

			<Group label="Receipts" labelAs="h4">
				<Field
					id="shell-layout-group-sender"
					label="Sender address"
					defaultValue="receipts@riverside-shelter.org"
				/>
				<Field id="shell-layout-group-footer" label="Receipt footer" optional />
			</Group>

			<Group label="Allowed origins" labelAs="h5">
				<p>Only these sites may load the donation form.</p>
			</Group>

			<Group
				label="What happens to a recurring gift when the Stripe secret key is replaced part-way through a month"
				labelAs="h6"
			>
				<p>
					Nothing stops. The commitment is held at Stripe and the new key reads the same account, so
					the next collection settles on the day it was always going to.
				</p>
			</Group>

			{/* `label` left off, which is the component's own default rather than a band with nothing in
			    it — `Group` in packages/operator/src/components/shell/Layout.jsx. */}
			<Group labelAs="h3">
				<p>
					The band takes the default label, so a group with nothing to name still names something.
				</p>
			</Group>
		</div>
	);
}
