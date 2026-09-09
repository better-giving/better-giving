import { AnchoredPanel } from '@better-giving/operator/behaviour/AnchoredPanel';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import {
	StatusLedger,
	StatusLine,
	StatusStep
} from '@better-giving/operator/components/status/StatusLine';

/*
 * the operator surfaces' signature register, and the one component here with enough state to need
 * four ledgers rather than one run.
 *
 * the first ledger walks the six tones. four of them are the shared set and two are this
 * component's own: `resolved` is a line that was a blocker and is not any more, which keeps its
 * place so the ledger's outline does not change shape, and `running` is the only line in the system
 * drawn moving. `dim` is not a seventh tone and is drawn as what it is — a modifier over a tone the
 * line already carries, so the pair of blocker lines with one dimmed is the specimen, not a dim
 * line on its own.
 *
 * `fixHref` lands in two different places and both are drawn: it rides the end of the sentence
 * where there is one, and stands in a block of its own where there is not. that second case is the
 * one a screen forgets — a line that is done and has nothing left to say can still be the way to
 * the screen that did it. `fixLabel` absent gives `Fix this`, which reads as an instruction on a
 * line needing no repair, so the done line states its own word.
 *
 * `wordOnMark` is drawn beside the two done lines that state their word in the usual place, which
 * is the only way to see what it does: the specimen has a tick, a label and no text after it, and
 * the word it states is on the mark as its accessible name. that name is invisible on the page in
 * exactly the way the `id` specimen's description is, so the line says so in its own sentence.
 *
 * `mark` overriding the tone's own is drawn once. it is the only way a line's mark and its ink
 * disagree, and a screen reaching for it should be able to see what that looks like first.
 *
 * `id` turns the label into a focus target described by the word and the sentence beside it. that
 * is invisible on the page and reachable only by reading the line out, so the specimen carrying one
 * is marked in its own copy.
 *
 * the second ledger is the same lines with blocks attached. one `adm-status__attach` joins its
 * block to the sentence and every one after it stands apart from its peer, so a line with two of
 * them is the only place that difference is visible — a single attachment cannot show it. the steps
 * run is beside them: `done`, `running` and `waiting`, which is what a line reports about a subject
 * being made, and it is drawn in the line's own two tracks rather than inset.
 *
 * the two lines after it are what a running line does when it has no run to open into. one is
 * handed nothing and one is handed a single step, and both draw the same thing — no list, and the
 * working step's own loader on the line's own mark. the single-step specimen is the whole of how
 * the fold is seen: what it was handed is written under it, and what it drew is the line above.
 *
 * the third ledger is `sections`, which is the reading a ledger takes when its entries open. both
 * the shut and the open specimen are there — a collapsible is worth nothing shut — and the open one
 * is the only place `.adm-status__panel` and the turned caret are drawn. `open` here is the
 * `details` element's initial state and nothing controls it afterwards, so pressing one of these is
 * how the reveal itself is seen.
 *
 * the fourth ledger is the state no screen in this repository draws. a line whose label states its
 * own state in words — `Registering your hostnames` while that is happening, `Your hostnames are
 * registered` once it is not — has nothing left for a word beside the label to add, so it puts that
 * word on the mark whatever tone it is in; the first and the last are the same subject before and
 * after, which is the only way to see that what qualifies a line for `wordOnMark` is its label and
 * not its being finished.
 *
 * the two running lines are where the `aside` slot is drawn in a plain head. it is the caller's own
 * element, standing last on the head so that it begins on the label's inline edge and set by
 * whatever class that caller wears — this system holds none of its own for it — and the two
 * specimens are the two shapes that reach it: a caption, which has a baseline of its own, and a
 * press carrying a mark and no word, which has none. the press stands on a label long enough to
 * wrap the moment the window is narrow, which is what shows where each of them goes: the mark and
 * the press are placed off the label's first line and never off the head, and the head being a
 * wrapping row is what then puts the press under a label that has taken the whole of one.
 *
 * the fifth ledger is `aligned`, the reading a run takes when its rows are read down rather than
 * across: the mark, the label, the status word and the aside each hold one column for the whole
 * run. it is the one specimen here that needs more than one line to show anything at all — a row
 * cannot be out of line with itself — so it is six rows with four of them carrying an aside, three
 * captions and the press the console draws there, two of them putting their word on the mark and
 * leaving that column standing empty, and one carrying a sentence, which is where the sentence
 * taking the whole row under the head rather than the label's own column is visible. below the
 * floor packages/operator/src/styles/adm.css states, the run falls back to the wrapping head every
 * ledger above it draws, so narrowing the window is how that half is seen.
 *
 * two things are stated rather than drawn. a line is an `li` and is nothing outside a ledger, so
 * every specimen here stands in one — mounted alone it is a list item with no list and neither the
 * sheet nor any gate reports it. and `onToggle` is what a line tells a screen with an expand-all
 * control over the whole ledger; nothing here holds that state, so no specimen passes one.
 */
export default function StatusStatusLinePreview() {
	return (
		<div className="adm-stack">
			<StatusLedger>
				<StatusLine
					labelAs="span"
					label="Card payments"
					word="Refused"
					tone="blocker"
					note="No Stripe secret key is set, so nothing can be charged."
					fixHref="#payments"
				/>
				<StatusLine
					labelAs="span"
					label="Receipts"
					word="Not sending"
					tone="attention"
					note="The sender address has not been verified with your mail provider."
					fixHref="#receipts"
					fixLabel="Verify the sender"
				/>
				<StatusLine
					labelAs="span"
					label="Bot protection"
					word="Off"
					note="Turnstile is not configured. Donations still work."
				/>
				<StatusLine
					labelAs="span"
					label="Database"
					word="Ready"
					tone="done"
					fixHref="#database"
					fixLabel="Open the database"
				/>
				<StatusLine labelAs="span" label="Recurring gifts" word="Can be collected" tone="done" />
				<StatusLine
					labelAs="span"
					label="Apple Pay"
					word="Approved"
					wordOnMark
					tone="done"
					note="A finished line with its word on the mark: nothing is drawn beside the label, and the tick carries Approved as its name for anyone who cannot see the shape."
				/>
				<StatusLine
					labelAs="span"
					label="Allowed origins"
					word="Repaired"
					tone="resolved"
					note="This sentence is drawn to show that a resolved line still carries one."
				/>
				<StatusLine
					labelAs="span"
					label="Schema"
					word="Migrating"
					tone="running"
					note="Three migrations are being applied to the production database."
				/>
				<StatusLine
					labelAs="span"
					label="Webhook endpoint"
					word="Refused"
					tone="blocker"
					note="The signing secret is not set, so every call from Stripe is turned away."
				/>
				<StatusLine
					labelAs="span"
					label="Webhook endpoint"
					word="Refused"
					tone="blocker"
					dim
					note="The same line dimmed: the endpoint does not exist yet, so the tone is what it will read as once it does."
					fixHref="#webhook"
				/>
				<StatusLine
					labelAs="span"
					label={<a href="#worker">Worker</a>}
					word="Not deployed"
					tone="attention"
					dim
					note="A dimmed line whose label is a link: the resting link goes muted with the rest of the row and stays operable."
				/>
				<StatusLine
					labelAs="span"
					label="Console token"
					word="Expires soon"
					tone="attention"
					mark="clock"
					note="The tone's own mark is overridden here, so the mark and the ink disagree on purpose."
				/>
				<StatusLine
					labelAs="span"
					id="status-line-focus-target"
					label="Sender address"
					word="Unverified"
					tone="attention"
					note="This line carries an id, so its label is a focus target described by the word and this sentence. Nothing on the screen shows it."
				/>
				<StatusLine
					labelAs="span"
					label="Tax-deductibility statement printed at the foot of every receipt this deployment sends"
					word="Not set"
					tone="blocker"
					note="A receipt without it is not evidence of a gift, so a donor cannot claim against it. The wording has to match the registration exactly, character for character, and nothing here can check that for you."
					fixHref="#deductibility"
				/>
				<StatusLine labelAs="span" />
			</StatusLedger>

			<StatusLedger>
				<StatusLine
					labelAs="h3"
					label="Embed snippet"
					word="Ready"
					tone="done"
					note="Paste this into every page the form should appear on."
				>
					<div className="adm-status__attach">
						<CodeSlab
							label="snippet"
							copyable
							content={`<script src="https://give.riverside-shelter.org/embed.js" defer></script>\n<bg-donate-form form="winter-appeal"></bg-donate-form>`}
						/>
					</div>
				</StatusLine>
				<StatusLine
					labelAs="h3"
					label="Stripe keys"
					word="One is missing"
					tone="blocker"
					note="The publishable key is set and the secret key is not."
				>
					<div className="adm-status__attach">
						<p>The first block joins the sentence above it.</p>
					</div>
					<div className="adm-status__attach">
						<p>
							The second stands apart from its peer, which is the only difference this pair shows.
						</p>
					</div>
				</StatusLine>
				<StatusLine
					labelAs="h3"
					label="Deployment"
					word="Working"
					tone="running"
					note="The worker is going up. Nothing is being asked of you."
					steps={
						<>
							<StatusStep state="done">The build finished and the embed was staged.</StatusStep>
							<StatusStep state="done">Preflight passed.</StatusStep>
							<StatusStep state="running">
								Applying three migrations to the production database.
							</StatusStep>
							<StatusStep state="waiting">Uploading the worker.</StatusStep>
							<StatusStep state="waiting">
								Checking that the deployed worker answers, which is the last thing this does and the
								only one that can still fail after the migration has gone through.
							</StatusStep>
						</>
					}
				/>
				<StatusLine
					labelAs="h3"
					label="Donation page"
					word="Working"
					tone="running"
					note="It has no steps of its own, so the line is what moves."
				/>
				<StatusLine
					labelAs="h3"
					label="Database"
					word="Working"
					tone="running"
					note="It was handed one step, which is folded into this line and never drawn."
					steps={<StatusStep state="running">Making it in your Cloudflare account.</StatusStep>}
				/>
			</StatusLedger>

			<StatusLedger sections>
				<StatusLine
					labelAs="h3"
					label="Card payments"
					word="Refused"
					tone="blocker"
					note="No Stripe secret key is set, so nothing can be charged."
					beneath={
						<p>
							Set the key with a command in the repository and deploy. It is never a row in the
							database.
						</p>
					}
				/>
				<StatusLine
					labelAs="h3"
					label="Receipts"
					word="Not sending"
					tone="attention"
					open
					note="The sender address has not been verified with your mail provider."
					beneath={
						<>
							<p>
								Receipts go out over SMTP. Verify the address with whoever carries your mail, then
								send yourself a test.
							</p>
							<CodeSlab label="sender" copyable content="receipts@riverside-shelter.org" />
						</>
					}
				/>
				<StatusLine
					labelAs="h3"
					label="Bot protection"
					word="Off"
					open
					beneath={<p>A section whose line has no sentence over it.</p>}
				/>
			</StatusLedger>

			<StatusLedger>
				<StatusLine
					labelAs="span"
					label="Registering your hostnames with Stripe"
					word="Working"
					wordOnMark
					tone="running"
					aside={<span className="adm-caption">3 of 8</span>}
				/>
				<StatusLine
					labelAs="span"
					label="Registering every hostname the sites you listed serve the form on, which Stripe takes one at a time"
					word="Working"
					wordOnMark
					tone="running"
					aside={
						<AnchoredPanel mark="info" label="Where these hostnames come from">
							<p className="adm-prose">
								The aside as a press with no word in it, on a label long enough to wrap. The mark
								and the press both stand on the label's first line.
							</p>
						</AnchoredPanel>
					}
				/>
				<StatusLine
					labelAs="span"
					label="Your hostnames are registered"
					word="Done"
					wordOnMark
					tone="done"
				/>
			</StatusLedger>

			<StatusLedger aligned>
				<StatusLine
					labelAs="span"
					label="Card"
					word="Approved"
					wordOnMark
					tone="done"
					aside={<span className="adm-caption">3 sites</span>}
				/>
				<StatusLine labelAs="span" label="Bank account" word="Not approved" tone="attention" />
				<StatusLine
					labelAs="span"
					label="Apple Pay"
					word="Approved"
					wordOnMark
					tone="done"
					aside={<span className="adm-caption">3 sites</span>}
				/>
				<StatusLine
					labelAs="span"
					label="Google Pay"
					word="Not showing everywhere"
					tone="attention"
					aside={<span className="adm-caption">1 of 3</span>}
				/>
				<StatusLine
					labelAs="span"
					label="Cash App Pay"
					word="Not showing everywhere"
					tone="attention"
					aside={
						<AnchoredPanel mark="info" label="Where Cash App Pay shows">
							<p className="adm-prose">
								The press in the aside column, which is what the console draws there.
							</p>
						</AnchoredPanel>
					}
				/>
				<StatusLine
					labelAs="span"
					label="Link"
					word="Not showing everywhere"
					tone="attention"
					note="The one row here carrying a sentence, which takes the whole of the row under the head rather than the label's own column."
				/>
			</StatusLedger>
		</div>
	);
}
