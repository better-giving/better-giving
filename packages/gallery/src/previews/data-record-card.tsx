import { Press } from '@better-giving/operator/components/data/Press';
import { RecordCard } from '@better-giving/operator/components/data/RecordCard';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';

/*
 * a card per state its status word can take, and a card per length its origins list can be.
 *
 * the word is a `StatusWord` the card passes `register`, `secondary` and `tone` through to, so
 * every reading a record can carry is drawn: the untoned pill, the quieter one for the value a
 * reader scanning a list is not looking for, one card per tone — which is what a real list of
 * records looks like, since a record's own lifecycle status is the one word meant to carry one —
 * and the momentary one, which is the odd pairing worth seeing. a momentary word reports what just
 * happened on the control that caused it, and a record card has no control; the specimen is here to
 * show that the register is reachable through this part and reads wrong in it.
 *
 * `state` absent is the state beside them: the head keeps its two tracks and the trailing one is
 * empty, so a list of records where one has no word is a list with a hole in it rather than a list
 * of shorter rows.
 *
 * the origins list is the closed part of this card. many, one and none — the empty one carrying the
 * sentence that says so in words, which the card states rather than defaults: a labelled value drawn
 * blank reads as a screen that failed to load something rather than as a record no site may use yet.
 *
 * lengths are exercised on purpose. a record's name is an operator's own string and wraps, and an
 * origin is a host that can be longer than the card — `.adm-record__origins` is a flex row, so what
 * a long identifier does to it is only visible with one in it.
 *
 * `titleAs` is stated on every card and never defaulted, because which level a record takes is the
 * screen's to say. two levels are drawn here to show that the type role does not move with it.
 *
 * `emptyOrigins` is stated on every card for the same rule and draws on only one of them: a card
 * holding origins today is a card whose list can be emptied, and the sentence has to be ready before
 * that happens rather than written the day it does.
 *
 * the cards at the foot of this page are the two things a card can carry that the ones above do not.
 *
 * `mark` is the first: a glyph at the leading edge, for a list whose records are all one kind of
 * thing. the head turns into three tracks where the head above it holds two ends apart, and the
 * marked card is drawn directly under an unmarked one so the difference is the thing on the screen
 * rather than something to take on trust. the mark is out of the accessibility tree — twenty records
 * carrying the same glyph is a reader told nothing twenty times.
 *
 * the marked card with a name long enough to wrap is the specimen that alignment exists for, and it
 * is the one to look hardest at: the tile and the status word sit on the line the name starts on,
 * which is what a row centred on its own block loses the moment a second line arrives. a record's
 * name is an operator's own string, so that is not a rare reading of this card.
 *
 * the foot is the second, and it is the other reading of the same origins: taken rather than named
 * and read. there is no label and no empty sentence in that reading, and stating either alongside
 * `foot` is a type error rather than a branch the card chooses at runtime. one press and several are
 * both drawn, because what a run of them does at the foot of a card is only visible with a run
 * there — and the single one is what a form with one site looks like, which is most of them.
 */
export default function DataRecordCardPreview() {
	return (
		<div className="adm-stack">
			<RecordCard
				titleAs="h3"
				title="Winter appeal"
				href="#winter-appeal"
				state="Live"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={[
					'https://riverside-shelter.org',
					'https://www.riverside-shelter.org',
					'https://give.riverside-shelter.org'
				]}
			/>
			<RecordCard
				titleAs="h3"
				title="Kitchen fund"
				href="#kitchen-fund"
				state="Draft"
				secondary
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Winter appeal"
				href="#winter-appeal-done"
				state="Live"
				tone="done"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://give.riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Kitchen fund"
				href="#kitchen-fund-attention"
				state="Draft"
				tone="attention"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Monthly gift from Alice Nakamura"
				href="#monthly-blocker"
				state="Payment failed"
				tone="blocker"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://give.riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Emergency response"
				href="#emergency-note"
				state="Archived"
				tone="note"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Emergency bed fund"
				href="#bed-fund"
				state="Saved"
				register="momentary"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Summer appeal"
				href="#summer-appeal"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Legacy giving"
				href="#legacy"
				state="Draft"
				secondary
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
			/>
			<RecordCard
				titleAs="h4"
				title="The Wharfedale Riverside Community Kitchen and Night Shelter winter emergency appeal"
				href="#long-record"
				state="Live"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={[
					'https://donate.riverside-shelter-and-community-kitchen.example.org.uk',
					'https://www.riverside-shelter-and-community-kitchen.example.org.uk',
					'https://give.riverside-shelter.org',
					'https://riverside-shelter.org',
					'https://shelter-winter-appeal.example.org'
				]}
			/>
			{/* the same card twice, unmarked then marked: the head goes from two things on a baseline to
			    three tracks centred on one row. */}
			<RecordCard
				titleAs="h3"
				title="Clean water"
				href="#clean-water"
				state="Active"
				tone="done"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			<RecordCard
				titleAs="h3"
				title="Clean water"
				href="#clean-water-marked"
				mark="folder-heart"
				state="Active"
				tone="done"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			{/* the name that wraps, marked: the specimen the head's alignment exists for. the mark sits
			    on the line the name starts on rather than between its two lines, and the status word
			    stays on that first line with it — a row centred instead would hang both in the middle
			    of the block. */}
			<RecordCard
				titleAs="h3"
				title="The Wharfedale Riverside Community Kitchen and Night Shelter winter emergency appeal"
				href="#long-marked"
				mark="form"
				state="Live"
				tone="done"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://riverside-shelter.org']}
			/>
			{/* the other reading of the origins, at one press and at several. the words press is the
			    form's own page and navigates, so it is an anchor; the sites open what each can be set
			    to and are buttons. src/previews/data-press.tsx draws both in every state. */}
			<RecordCard
				titleAs="h3"
				title="General giving"
				href="#general-giving"
				mark="form"
				state="Draft"
				tone="attention"
				foot={
					<Press as="a" href="#general-giving-page" words>
						form page
					</Press>
				}
			/>
			<RecordCard
				titleAs="h3"
				title="Year-end appeal"
				href="#year-end-appeal"
				mark="form"
				state="Live"
				tone="done"
				foot={
					<>
						<Press as="a" href="#year-end-page" words>
							form page
						</Press>
						<Press>riverside-shelter.org</Press>
						<Press>www.riverside-shelter.org</Press>
						<Press>give.riverside-shelter.org</Press>
						<Press>donate.riverside-shelter-and-community-kitchen.example.org.uk</Press>
					</>
				}
			/>
			{/* a card with rows attached under the origins: the setting rows drop their own rule inside
			    a card, so the card's border is the only line. */}
			<RecordCard
				titleAs="h3"
				title="Winter appeal"
				href="#winter-appeal-detail"
				state="Live"
				originsLabel="Allowed on"
				emptyOrigins="No sites yet, so this form is refused everywhere."
				origins={['https://give.riverside-shelter.org']}
			>
				<SettingRow label="Raised" value="£12,480.00" />
				<SettingRow label="Gifts" value="214" />
				<SettingRow label="Minimum gift" reading="unset" />
			</RecordCard>
		</div>
	);
}
