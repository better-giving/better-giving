import { RecordCard } from '@better-giving/operator/components/data/RecordCard';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';

/*
 * a card per state its status word can take, and a card per length its origins list can be.
 *
 * the word is a `StatusWord` the card passes `register` and `secondary` through to, so the three
 * readings a record can carry are drawn: the plain descriptive word, the quieter one for the value
 * a reader scanning a list is not looking for, and the momentary one — which is the odd pairing
 * worth seeing. a momentary word reports what just happened on the control that caused it, and a
 * record card has no control; the specimen is here to show that the register is reachable through
 * this part and reads wrong in it.
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
