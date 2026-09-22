import { RangeSlider } from '@better-giving/operator/components/forms/RangeSlider';
import { useState } from 'react';

/*
 * two thumbs along a ladder of round amounts, in the positions a pair of bounds is found in.
 *
 * each specimen holds its own positions, because the slider holds none: a caller keeps them, and a
 * specimen that did not would be a slider nobody can move. the ladder is the dashboard's gift-bounds
 * one, written out as the stops read.
 *
 * the second is the two thumbs on one stop, which the slider allows — whether two equal bounds may
 * be saved is the form's rule. the third is the two at the ends of the scale, which is where the
 * thumbs meet the end labels and where a thumb drawn past the track would show.
 */
const STOPS = [
	'$1',
	'$2',
	'$5',
	'$10',
	'$20',
	'$25',
	'$50',
	'$100',
	'$200',
	'$250',
	'$500',
	'$1,000',
	'$2,000',
	'$2,500',
	'$5,000',
	'$10,000'
];

function Specimen({ start }: { start: [number, number] }) {
	const [value, setValue] = useState(start);
	return (
		<RangeSlider
			stops={STOPS}
			value={value}
			onValueChange={setValue}
			thumbLabels={['Smallest gift', 'Largest gift']}
		/>
	);
}

export default function FormsRangeSliderPreview() {
	return (
		<div className="adm-stack">
			<Specimen start={[2, 10]} />
			<Specimen start={[5, 5]} />
			<Specimen start={[0, 15]} />
		</div>
	);
}
