import { AnchoredCard } from '@better-giving/operator/components/data/Disclosure';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { Mark } from '@better-giving/operator/components/status/Mark';

/*
 * the four readings of the value cell, then the mark that stands after the label.
 *
 * the readings are the closed set: a not-set word, a stored word, a plain value and the same value
 * in the code face. `stored` and `unset` ignore `value` entirely — a row handed both prints the
 * word and drops the string, which is only visible with a row that hands it one. `value` with
 * nothing in it is the fourth corner and reads as the first: a label with an empty box beside it
 * would read as a screen that failed rather than as a setting nobody has set, so the row says so in
 * words instead. the specimen is the one that states no value at all.
 *
 * the mark is a slot rather than a flag, so a row carries one or does not, and both are drawn. it
 * follows the label, because the row is read and then the note saying it is the one at fault.
 * nothing stands after the value: the slot that held the mark opening a terminal command is gone
 * (packages/operator/src/components/data/SettingRow.jsx says why).
 *
 * a mark handed a `label` is the whole of what says which row is at fault to anyone not looking at
 * it, so every mark here carries one. the card it opens is the screen's own machine and not this
 * part's — nothing here presses anything, so the card is drawn beside the rows rather than from
 * them.
 *
 * lengths last: an operator's own string lands in the value and both halves wrap, which is what the
 * mark is aligned to the first line against.
 */
export default function DataSettingRowPreview() {
	return (
		<div>
			<SettingRow label="Organisation name" value="Riverside Shelter" />
			<SettingRow label="Registered charity number" reading="unset" />
			<SettingRow label="Stripe secret key" reading="stored" />
			<SettingRow label="Stripe secret key" reading="stored" value="sk_live_never_shown" />
			<SettingRow label="Receipt sender" reading="literal" value="receipts@riverside-shelter.org" />
			{/* the `value` reading with nothing to read, which draws the `unset` row above. */}
			<SettingRow label="Minimum gift" />
			<SettingRow
				label="Receipt sender"
				reading="unset"
				note={<Mark name="triangle-alert" label="This is what is stopping receipts" />}
			/>
			<SettingRow
				label="Address the organisation is registered at for tax-deductibility purposes"
				value="Unit 4, The Old Granary, 118–120 Wharfedale Riverside Way, Kirkstall, Leeds LS5 3BF"
				note={<Mark name="triangle-alert" label="This has to match the registration exactly" />}
			/>
			<SettingRow
				label="Allowed origins"
				reading="literal"
				value="https://donate.riverside-shelter-and-community-kitchen.example.org.uk:8443"
			/>
			<AnchoredCard>
				<p>Receipts are not sent until a verified sender address is set.</p>
			</AnchoredCard>
		</div>
	);
}
