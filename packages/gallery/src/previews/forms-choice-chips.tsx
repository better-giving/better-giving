import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';

/*
 * the chips as the editor's questions draw them: one of a few short answers, several of them, and
 * the Other chip with its box — open in the third specimen, which is the state a press reaches and
 * a page at rest never shows.
 *
 * the pointer states are pinned per chip: `hover` on the chip and `focus` on the control inside it,
 * whose ring the chip draws. the taken chip is the platform's own `checked`, set here with
 * `defaultChecked`, and pinned nowhere.
 */
export default function FormsChoiceChipsPreview() {
	return (
		<div className="adm-stack">
			<ChoiceChips
				id="forms-chips-who"
				name="who"
				legend="Who do your gifts mostly help?"
				options={[
					{ value: 'Local families', label: 'Local families', defaultChecked: true },
					{ value: 'Children', label: 'Children', state: 'hover' },
					{ value: 'Animals', label: 'Animals', state: 'focus' },
					{ value: 'The environment', label: 'The environment' }
				]}
				other={{ name: 'who:other', placeholder: 'In your words' }}
			/>
			<ChoiceChips
				id="forms-chips-ways"
				name="ways"
				type="checkbox"
				legend="Which ways to give should stand out?"
				hint="Pick any."
				options={[
					{ value: 'One-time', label: 'One-time' },
					{ value: 'Monthly', label: 'Monthly', defaultChecked: true },
					{ value: 'In someone’s honour', label: 'In someone’s honour', defaultChecked: true }
				]}
				other={{ name: 'ways:other' }}
			/>
			<ChoiceChips
				id="forms-chips-first"
				name="first"
				legend="What should donors see first?"
				options={[
					{ value: 'The story', label: 'The story' },
					{ value: 'A photo', label: 'A photo' },
					{ value: 'What a gift buys', label: 'What a gift buys' }
				]}
				other={{
					name: 'first:other',
					defaultChecked: true,
					defaultValue: 'A video of last winter’s handout'
				}}
			/>
		</div>
	);
}
