import { Select, createListCollection } from '@ark-ui/react/select';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * one line of the list. the value is what the browser submits and the label is what an operator
 * reads, and they are two things: a fund is chosen by name and recorded by id.
 *
 * the label is text rather than markup: the closed box draws it, the typeahead matches against it
 * and the form's own copy of the list carries it as an option's words.
 *
 * @typedef {object} Option
 * @property {string} value
 * @property {string} label
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: every describing block on this control is
 * named from it, so one without an id hands the browser a description nothing points at. it lands
 * on the box an operator presses, which is also what the label names and what a refusal's focus
 * move reaches.
 *
 * @typedef {object} SelectWithNoteProps
 * @property {string} id
 * @property {ReactNode} [label]
 * @property {string | undefined} [aria-label] the name of a box drawn with no `label` over it.
 * @property {ReactNode} [hint] the sentence read before choosing, drawn where ./Field.jsx draws
 *   its own: over the box, in the quiet register. it is what helps a choice be made, never what a
 *   press answered with and never why an option is missing.
 * @property {ReactNode} [note] the standing sentence — an option that should be here is missing and
 *   this says why. it is not a refusal and takes the same register ./Field.jsx's `needed` does.
 * @property {ReactNode} [error] what the last press answered with.
 * @property {readonly Option[] | undefined} [options]
 * @property {Option | undefined} [retired] an option no longer offered, kept until another is chosen.
 * @property {string | undefined} [name] what the choice is submitted under.
 * @property {string | undefined} [form] the id of a form the choice is submitted with, where the
 *   box is not inside it.
 * @property {boolean | undefined} [required]
 * @property {boolean | undefined} [disabled] a box that cannot be answered, which submits nothing.
 * @property {string | undefined} [defaultValue] the choice the box is first drawn holding.
 * @property {string | undefined} [value] the choice as its caller holds it, alongside
 *   `onValueChange`: the box then shows this and only this. it is never mapped onto
 *   `defaultValue` — that is a control that ignores every change its caller then makes to it,
 *   which is the defect ./Field.jsx carried until it took the attributes as written.
 * @property {((value: string) => void) | undefined} [onValueChange] an option was chosen.
 * @property {boolean | undefined} [defaultOpen] the list open on the first draw. a specimen's prop:
 *   a screen opens a list by the press an operator makes on it.
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached,
 *   for ./Field.jsx's reason, and unavailable is not one of them for its reason either: the
 *   sheet draws `.adm-select[data-disabled]` with no twin beside it, so a control that cannot be
 *   used takes `disabled` above.
 * @property {string | undefined} [className]
 * @property {string | undefined} [aria-describedby] the blocks the box is described by, where the
 *   caller names them itself. stated, it replaces the ones this control composes off its id.
 * @property {boolean | 'true' | 'false' | undefined} [aria-invalid] marks the control refused by a
 *   rule that belongs to something larger than this one box, alongside whatever message that
 *   larger thing holds.
 */

/** no options, as one value: a new empty array every render would be a new list every render. */
const NONE = /** @type {readonly Option[]} */ ([]);

/** nothing chosen, as one value, for the same reason. */
const NONE_CHOSEN = /** @type {string[]} */ ([]);

/** what a retired option's words start with. */
const RETIRED = 'No longer offered: ';

/**
 * the event that tells a form the choice changed, marked the way the machine marks the one it
 * dispatches itself. the machine's own listener on the element reads an unmarked `input` as a
 * choice arriving from outside and sets it again, which would be this handler again, forever.
 */
function choiceEvent() {
	const event = new Event('input', { bubbles: true });
	Object.defineProperty(event, Symbol.for('zag.changeEvent'), { value: true });
	return event;
}

/*
 * a list of choices a form submits, with two real situations a list alone cannot say: an option
 * that should be here is missing and the note says why; and an appended no-longer-offered option
 * that stays selected until another is chosen.
 *
 * the machine is ark's select, and everything it answers for is left to it: the listbox roles, the
 * arrow keys, typeahead, Escape and the dismissal. it is ./CoinPicker.jsx's family — the same box,
 * the same list over whatever follows it, the same highlighted row — without the search, because a
 * list this short is read rather than searched.
 *
 * **the choice is submitted by the machine's own hidden `<select>`, which is the one element here
 * carrying the name.** so `name`, `form`, `required` and `disabled` reach the payload the way they
 * reach a native select's, and a form reset puts it back to the choice it was first drawn with.
 * a refusal's focus move by name lands on that element, and the machine hands focus on to the box.
 *
 * that element is made to say it changed, which is what a native select did for free. the machine
 * dispatches `change` alone, and both layers reading these forms count `input` — the one that arms
 * the save button (`useSavedFormState` in packages/operator/src/saved-form-state.react.ts) and
 * conform's own listener under it — so a choice that stayed silent would be a stored value under a
 * button nothing could press, and a refused box nothing re-checks. the value is put on the element
 * before the event rather than waited for, because a listener reads the element it was handed and
 * react has not re-rendered yet.
 *
 * the box always holds an option, as a native select does: a choice the list does not carry — or no
 * choice at all — shows and submits the first line.
 */
/** @param {SelectWithNoteProps} props */
export function SelectWithNote({
	id,
	label,
	'aria-label': named,
	hint,
	note,
	error,
	options = NONE,
	retired,
	name,
	form,
	required,
	disabled,
	defaultValue = '',
	value,
	onValueChange,
	defaultOpen,
	state,
	className,
	'aria-describedby': described,
	'aria-invalid': stated
}) {
	const refused = error ? true : stated === true || stated === 'true';

	/* the marker leads and the name follows: the closed box shows one line at whatever width it has,
	   so a marker appended after an unbounded name is the half that truncates away, leaving the
	   option reading as an ordinary choice. */
	const lines = useMemo(
		() =>
			retired === undefined
				? options
				: [...options, { value: retired.value, label: `${RETIRED}${retired.label}` }],
		[options, retired]
	);
	const collection = useMemo(
		() =>
			createListCollection({
				items: lines,
				itemToValue: (line) => line.value,
				itemToString: (line) => line.label
			}),
		[lines]
	);

	const [held, setHeld] = useState(defaultValue);
	/* the seed the control was last drawn against. a form seeded from a reading is redrawn with a new
	   one whenever a write lands, and the choice on screen follows it there rather than standing as
	   whatever was picked against the reading before it — ./CoinPicker.jsx's rule. the machine is
	   drawn afresh with each seed as well, because what a form reset puts back is the choice the
	   machine was first drawn with, and that has to be the reading on screen rather than the one
	   the page opened on. */
	const [seed, setSeed] = useState(defaultValue);
	if (seed !== defaultValue) {
		setSeed(defaultValue);
		setHeld(defaultValue);
	}
	const wanted = value ?? held;
	/* a line rather than a string: `''` is a line's value as often as it is nothing chosen. */
	const chosen = lines.find((line) => line.value === wanted) ?? lines[0];

	const posted = useRef(/** @type {HTMLSelectElement | null} */ (null));
	/* the element follows what the box shows on every draw. the machine writes it only when its own
	   value moves, and a caller holding `value` that declines a choice leaves the machine where it was
	   and the element on the choice declined. */
	useLayoutEffect(() => {
		const element = posted.current;
		if (element !== null && chosen !== undefined && element.value !== chosen.value)
			element.value = chosen.value;
	});

	const describedBy =
		described ??
		([hint ? `${id}-hint` : null, error ? `${id}-err` : null, note ? `${id}-note` : null]
			.filter(Boolean)
			.join(' ') ||
			undefined);

	return (
		<div className="adm-field">
			{label ? (
				<label className="adm-field__label" htmlFor={id} id={`${id}-label`}>
					{label}
				</label>
			) : null}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<Select.Root
				key={seed}
				className="adm-selectwrap"
				collection={collection}
				ids={{ trigger: id, label: `${id}-label` }}
				name={name}
				form={form}
				required={required}
				disabled={disabled}
				invalid={refused}
				defaultOpen={defaultOpen}
				value={chosen === undefined ? NONE_CHOSEN : [chosen.value]}
				onValueChange={(details) => {
					const next = details.value[0] ?? '';
					const element = posted.current;
					if (element !== null) {
						element.value = next;
						element.dispatchEvent(choiceEvent());
					}
					setHeld(next);
					onValueChange?.(next);
				}}
			>
				<Select.Trigger
					className={['adm-select', state ? `is-${state}` : '', className]
						.filter(Boolean)
						.join(' ')}
					aria-label={named}
					aria-describedby={describedBy}
				>
					<Select.ValueText className="adm-select__value" />
					<Select.Indicator className="adm-select__caret">
						<Mark name="chevron-down" />
					</Select.Indicator>
				</Select.Trigger>
				{/* an empty list is not drawn at all: the box opening onto a bare surface over the note
				    that says why it is empty would be a second, emptier way of saying the same. */}
				{lines.length === 0 ? null : (
					<Select.Positioner>
						<Select.Content className="adm-selectlist">
							{lines.map((line) => (
								<Select.Item className="adm-selectrow" key={line.value} item={line}>
									<Select.ItemText>{line.label}</Select.ItemText>
									<Select.ItemIndicator className="adm-selectrow__tick">
										<Mark name="check" />
									</Select.ItemIndicator>
								</Select.Item>
							))}
						</Select.Content>
					</Select.Positioner>
				)}
				<Select.HiddenSelect ref={posted} />
			</Select.Root>
			{/* both rows are ./FieldMessage.jsx's, which is where the refusal being the one live region
			    on the control is argued: it is what a press answered with, and the standing sentence
			    below it is a condition rather than an event. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
			{note ? (
				<FieldMessage tone="needed" id={`${id}-note`}>
					{note}
				</FieldMessage>
			) : null}
		</div>
	);
}
