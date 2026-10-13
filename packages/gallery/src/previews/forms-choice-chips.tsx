import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';

/*
 * the chips as the editor's questions draw them: one of a few short answers, several of them, each
 * chip's tick box saying so, and the Other chip with its box — open in the third specimen, which is
 * the state a press reaches and a page at rest never shows. then the cards New campaign draws its
 * kinds as, one taken and one pinned under the pointer, and the same cards refused.
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
			<ChoiceChips
				id="forms-chips-kind"
				name="kind"
				legend="What kind of campaign?"
				cards
				options={[
					{
						value: 'year_end',
						label: 'Year-end appeal',
						description: 'The giving-season ask'
					},
					{
						value: 'emergency',
						label: 'Emergency response',
						description: 'A crisis, right now',
						defaultChecked: true
					},
					{
						value: 'building',
						label: 'Building fund',
						description: 'A place, a roof, a van',
						state: 'hover'
					},
					{
						value: 'event',
						label: 'Event or fundraiser',
						description: 'A run, a gala, a bake sale',
						state: 'focus'
					}
				]}
			/>
			<ChoiceChips
				id="forms-chips-kind-refused"
				name="kind-refused"
				legend="What kind of campaign?"
				cards
				error="required"
				options={[
					{
						value: 'tribute',
						label: 'In memory or honour',
						description: 'Gifts in someone’s name'
					},
					{ value: 'monthly', label: 'Monthly giving drive', description: 'Grow regular donors' }
				]}
			/>
		</div>
	);
}
