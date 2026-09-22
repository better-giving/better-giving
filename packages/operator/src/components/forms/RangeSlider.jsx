import { Slider } from '@ark-ui/react/slider';

/**
 * `stops` is the whole scale, in order, as each stop reads: the slider's value is a position along
 * it and never a figure, so a scale that is not evenly spaced — a ladder of round amounts — moves a
 * thumb one stop per step all the same. the first and the last are drawn at the two ends.
 *
 * `value` is held by the caller, because what a thumb stands for usually lives somewhere else as
 * well — a box beside the slider that a thumb writes into and that moves the thumb back — and two
 * holders of one position are two positions.
 *
 * @typedef {object} RangeSliderProps
 * @property {readonly string[]} stops what each position reads as, lowest first. two at least.
 * @property {readonly [number, number]} value the two thumbs' positions in `stops`, lower first.
 * @property {(value: [number, number]) => void} onValueChange a thumb moved, by pointer or key.
 * @property {readonly [string, string]} thumbLabels each thumb's accessible name, lower first.
 */

/*
 * two thumbs along one scale, marking a lower and an upper bound.
 *
 * the machine is ark's slider, and everything it answers for is left to it: the `slider` role on
 * each thumb, the arrow, page, home and end keys, dragging, and the two thumbs never passing each
 * other (`thumbCollisionBehavior`'s default). the thumbs may meet: whether two equal bounds are
 * allowed is the rule of whatever the bounds belong to, never the slider's.
 *
 * **it submits nothing.** no `name` and no hidden input, so a form holding one posts exactly what it
 * posted without it. a bound that has to reach a payload is a box of the caller's, which the caller
 * keeps in step through `value` and `onValueChange`.
 *
 * a thumb is announced by its name and by what its stop reads as — `$25` rather than `7`, which is
 * only where the stop sits on the scale.
 */
/** @param {RangeSliderProps} props */
export function RangeSlider({ stops, value, onValueChange, thumbLabels }) {
	return (
		<Slider.Root
			className="adm-range"
			min={0}
			max={stops.length - 1}
			step={1}
			value={[...value]}
			onValueChange={(details) => {
				const [lower = value[0], upper = value[1]] = details.value;
				onValueChange([lower, upper]);
			}}
			aria-label={[...thumbLabels]}
			getAriaValueText={(details) => stops[details.value] ?? ''}
		>
			<Slider.Control className="adm-range__control">
				<Slider.Track className="adm-range__track">
					<Slider.Range className="adm-range__fill" />
				</Slider.Track>
				<Slider.Thumb index={0} className="adm-range__thumb" />
				<Slider.Thumb index={1} className="adm-range__thumb" />
			</Slider.Control>
			{/* the scale's two ends, for the eye. each thumb already says what its stop reads as, so
			    these are not read out a second time. */}
			<div className="adm-range__ends" aria-hidden="true">
				<span>{stops[0]}</span>
				<span>{stops[stops.length - 1]}</span>
			</div>
		</Slider.Root>
	);
}
