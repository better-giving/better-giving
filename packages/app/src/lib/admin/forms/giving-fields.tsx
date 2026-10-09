import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { RangeSlider } from '@better-giving/operator/components/forms/RangeSlider';
import {
	RepeatingRows,
	type RowControl
} from '@better-giving/operator/components/forms/RepeatingRows';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { formatMinorBrief, minorUnitDigits } from '$lib/donations/money';
import {
	MAX_SUGGESTED_AMOUNTS,
	majorEntry,
	readAmount,
	SUGGESTED_AMOUNTS_HELD,
	suggestedEntries
} from '$lib/forms/amounts';
import { FORM_FIELD_LABELS } from '$lib/forms/fields';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type Box, boxErrorId, boxProps } from '../use-admin-form';

// what a donor may give: the currency the figures are in, the two bounds, and the amounts a donor
// is offered as buttons.
//
// one of the four group components — see ./name-fields.tsx for why they are four and why each
// takes its own boxes rather than a form.
//
// the three fields are one group because the rules between them are: the floor under the smallest
// gift, the two bounds being the right way round, and a suggestion being inside them are all
// comparisons, so a screen that saved one of the three on its own would be saving against a bound
// it had not read. `parseFormGiving` in `$lib/server/forms/form-input.ts` is the same grouping on
// the other side of the wire.
//
// the amounts are a repeating row editor and not one box holding a list. each row carries its own
// indexed name — `suggested_amounts[0]` — which is the one bracket a submitted body may hold and
// the reason `$lib/server/conform.ts` bounds the index rather than refusing it. adding and removing
// a row are the form's own controls, handed in as button props by the screen that holds the form,
// so this group states no intent of its own and neither screen states the arithmetic twice.
//
// the rows are the library's `RepeatingRows`
// (packages/operator/src/components/forms/RepeatingRows.jsx), handed those two controls as they
// are, and each row the `key` the form minted for it: a row's id is its position, so the key is
// what keeps a half-typed figure on its own row as rows are removed above it. where focus lands
// after either press is that component's too.
//
// a row is a box with a name of its own, so it is refused under itself. `suggestedAmountsRule` in
// `$lib/forms/input-schema.ts` keys an offending amount to `suggested_amounts[1]`, which is the
// second row's input, and that row draws the sentence under its own box. the one sentence keyed to
// the bare group name is the cap on how many amounts there may be, because a list holding too many
// is a fact about no one row — so this group draws it under the rows, describes the group by it,
// and marks no row with it, which is why it is not handed to `RepeatingRows` as the group's `error`.
//
// the one control that sentence is about is Add, so Add is described by it too, and Add is where
// the cap is kept: once the screen has hydrated, a press while the boxes hold
// `MAX_SUGGESTED_AMOUNTS` different amounts adds nothing and draws `SUGGESTED_AMOUNTS_HELD` until
// the rows change. the count is `suggestedEntries`, the one the save takes, read off the boxes at
// the press — so neither a blank box nor a second box holding an amount already counted, however
// it is written, holds Add, as neither adds a tile to what the save would store. every press on a
// held Add says the sentence again. before hydration Add is the plain intent submit and the row is
// added, and the save is what refuses the list. a save refused by the cap is answered at Add as
// well — the bare name is on no box, so conform's failed-submit walk focuses nothing (`report` in
// @conform-to/dom's form.js matches a box's `name` and never a button), and the group moves focus
// to Add itself, unless the walk has already moved it to a box some other rule refused.
//
// the bounds carry a slider over their two boxes, and it is the one control here that is not a
// box: it moves along `BOUND_STOPS` below, writes the stop a thumb lands on into that thumb's box,
// and follows a box as it is typed in and as the form is reset. it submits nothing, so the boxes
// stay the whole of what the group posts and every rule above reads them exactly as before.
//
// each bound draws its own message, under its own box: `parseFormGiving` keys every sentence to the
// box whose label it names, the two bounds being the right way round included. every box in this
// group is bound the same way, the amounts' rows included.

/**
 * the stops the bounds slider moves along, in major units, lowest first.
 *
 * round amounts rather than an even scale: a thumb one step from $25 is $50 and not $26, because
 * the slider is for finding the size of a bound and the box under it is for the exact figure — and
 * for anything past the last stop, which the slider cannot reach and the box takes as typed.
 */
const BOUND_STOPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** `BOUND_STOPS` in `currency`'s minor units. */
function ladderFor(currency: string): number[] {
	return BOUND_STOPS.map((major) => major * 10 ** minorUnitDigits(currency));
}

/** the stop nearest `minor` by distance; a tie goes to the lower stop, and past the last is the last. */
function nearestStop(ladder: readonly number[], minor: number): number {
	let nearest = 0;
	for (const [index, stop] of ladder.entries()) {
		if (Math.abs(stop - minor) < Math.abs((ladder[nearest] ?? 0) - minor)) nearest = index;
	}
	return nearest;
}

/**
 * where a thumb stands, and the figure its box holds — which is the stop's own figure unless the box
 * was typed between two stops or past the last.
 */
type Mark = { readonly stop: number; readonly minor: number };

/** the mark a box's text stands for, or `held` where the text is not an amount. */
function markOf(text: string, ladder: readonly number[], currency: string, held: Mark): Mark {
	const { minor } = readAmount(text, currency);
	return minor === null ? held : { stop: nearestStop(ladder, minor), minor };
}

/** both marks read off the two boxes' text, the lower never standing past the upper. */
function marksOf(
	texts: readonly [string, string],
	ladder: readonly number[],
	currency: string,
	held: readonly [Mark, Mark]
): [Mark, Mark] {
	const upper = markOf(texts[1], ladder, currency, held[1]);
	const lower = markOf(texts[0], ladder, currency, held[0]);
	return [{ ...lower, stop: Math.min(lower.stop, upper.stop) }, upper];
}

/** the text in the box `name` inside `within`, or `''` where no such box is there. */
function textIn(within: HTMLFormElement | HTMLFieldSetElement | null, name: string): string {
	const box = within?.elements.namedItem(name);
	return box instanceof HTMLInputElement ? box.value : '';
}

/**
 * writes `text` into a box the way typing would, so every listener on it hears it.
 *
 * the value goes through the platform's own setter rather than `box.value =`, because react keeps
 * its own copy of an input's last value and an assignment updates that copy too — react would then
 * see no change and the box's `onChange` would never fire. conform and the save button's dirty
 * reading (`useSavedFormState` in packages/operator/src/saved-form-state.react.ts) both count the
 * bubbling `input`.
 */
function typeInto(box: HTMLInputElement, text: string): void {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
	box.dispatchEvent(new Event('input', { bubbles: true }));
}

/** one amount box, plus the identity the form minted for its row when the row appeared. */
type AmountRow = Box & {
	readonly key: string | undefined;
};

type AmountRows = {
	/** the group's own id, which the message under it is named from. */
	readonly id: string;
	/**
	 * the cap on how many amounts there may be, where the last save was refused by it. a fact about
	 * the group and never about a row: every other refusal is keyed to the row that carries the
	 * figure and travels in that row's own `errors`.
	 */
	readonly errors?: string[] | undefined;
	/** one box per amount, in the order a donor sees them. */
	readonly rows: readonly AmountRow[];
	/**
	 * the control that adds an empty row at the end, as the form states it — and the press it is
	 * withheld on, `insertWhenValid` in ../use-admin-form.ts. a press at the cap is held here, ahead
	 * of it.
	 */
	readonly add: RowControl;
	/** the control that drops one row, as the form states it for that position. */
	readonly remove: (index: number) => RowControl;
};

type FormGivingFieldsProps = {
	/** the two bound boxes, as conform's metadata describes them. */
	readonly boxes: {
		readonly min_minor: Box;
		readonly max_minor: Box;
	};
	/** the amounts group, which is a list of boxes rather than one. */
	readonly amounts: AmountRows;
	/** the currency the form charges in. stated, never editable — v0 is USD-only. */
	readonly currency: string;
	/**
	 * the group's own submit, at the foot of the group it saves. absent on the create screen, which
	 * has one submit for all four groups.
	 */
	readonly footer?: ReactNode;
};

export function FormGivingFields({ boxes, amounts, currency, footer }: FormGivingFieldsProps) {
	// the rows a press was held over at the cap. the sentence stands while they are the rows on
	// screen, and goes the moment one is added or dropped. it is the answer to the latest press, so
	// it stands over a save's refusal of the same group.
	const identities = amounts.rows.map((row) => row.key ?? row.id).join('\n');
	const [heldOver, setHeldOver] = useState<string | null>(null);
	const capError = heldOver === identities ? SUGGESTED_AMOUNTS_HELD : amounts.errors?.[0];

	// the presses held at the cap, which key the message. it is an alert, and an alert handed the
	// words it is holding is announced by nobody, while one inserted with them is announced — so each
	// press inserts its own, and the line on screen never goes blank between two.
	const [heldPresses, setHeldPresses] = useState(0);

	const capErrorId = boxErrorId(amounts.id);
	const addId = `${amounts.id}-add`;
	const add = {
		...amounts.add,
		id: addId,
		...(capError ? { 'aria-describedby': capErrorId } : {}),
		onClick(event: MouseEvent<HTMLButtonElement>) {
			const form = event.currentTarget.form;
			const texts = amounts.rows.map((row) => textIn(form, row.name));
			if (suggestedEntries(texts).length >= MAX_SUGGESTED_AMOUNTS) {
				event.preventDefault();
				setHeldPresses((at) => at + 1);
				setHeldOver(identities);
				return;
			}
			amounts.add.onClick?.(event);
		}
	};
	const suggestedHintId = `${amounts.id}-hint`;

	// every figure drawn here goes through `$lib/forms/amounts.ts`, the module the save is parsed
	// by: the boxes take money the way a fundraiser writes it and the row stores integers.
	//
	// one tile a fundraiser would plausibly offer, written the way a box takes it. one and not three,
	// because there is one box per amount — a placeholder listing three would read as three amounts
	// to type into one box. `majorEntry` and not the padded `majorText`, so the ghost figure is the
	// keystrokes an operator would actually make: `50`, not `50.00`.
	const suggestedExample = majorEntry(5000, currency);

	const ladder = ladderFor(currency);
	const stops = ladder.map((minor) => formatMinorBrief(minor, currency));
	const last = ladder.length - 1;

	const bounds = useRef<HTMLFieldSetElement>(null);
	const [marks, setMarks] = useState<[Mark, Mark]>(() =>
		marksOf(
			[boxes.min_minor.defaultValue ?? '', boxes.max_minor.defaultValue ?? ''],
			ladder,
			currency,
			[
				{ stop: 0, minor: ladder[0] ?? 0 },
				{ stop: last, minor: ladder[last] ?? 0 }
			]
		)
	);

	// set from the form's reset until the boxes hold what it put back. the slider's own machine
	// answers a reset by moving the thumbs to where they were at mount, and that is not a thumb an
	// operator moved, so nothing is written into a box for it.
	const resetting = useRef(false);

	// a reset puts each box back on its default — the new seed, where ../use-admin-form.ts reset the
	// form onto one — and fires no `input`, so the thumbs are read off the boxes again once it has.
	// a browser fires `reset` before it puts the boxes back, so they are read on the task after.
	// the listener is the document's, in the capture phase, so it runs ahead of the machine's own
	// listener on the form.
	useEffect(() => {
		const form = bounds.current?.form;
		if (!form) return;
		const ladder = ladderFor(currency);
		let settling: ReturnType<typeof setTimeout> | undefined;
		const reset = (event: Event) => {
			if (event.target !== form) return;
			resetting.current = true;
			clearTimeout(settling);
			settling = setTimeout(() => {
				resetting.current = false;
				const texts = [
					textIn(form, boxes.min_minor.name),
					textIn(form, boxes.max_minor.name)
				] as const;
				setMarks((held) => marksOf(texts, ladder, currency, held));
			}, 0);
		};
		document.addEventListener('reset', reset, true);
		return () => {
			document.removeEventListener('reset', reset, true);
			clearTimeout(settling);
		};
	}, [boxes.min_minor.name, boxes.max_minor.name, currency]);

	// whether the form's errors carry the cap, as of the last commit. read on the task after a
	// save rather than on a commit: conform re-renders only when the errors change, so a save refused
	// exactly as the last one was commits nothing at all.
	const refusedByCap = useRef(false);
	useEffect(() => {
		refusedByCap.current = amounts.errors?.[0] !== undefined;
	});

	// a save refused by the cap leaves focus where it was, because the bare name is on no box for
	// conform's walk to find. every intent conform submits — Add, Remove, the revalidation each
	// keystroke runs after the first save, `form.validate` — goes under the intent's own name and is
	// no save. focus that moved off where it stood at the submit is the walk's, on a box some other
	// rule refused, and stays there.
	const intentName = amounts.add.name;
	useEffect(() => {
		const form = bounds.current?.form;
		if (!form) return;
		let settling: ReturnType<typeof setTimeout> | undefined;
		const submitted = (event: SubmitEvent) => {
			if (event.target !== form || event.submitter?.getAttribute('name') === intentName) return;
			const standing = document.activeElement;
			clearTimeout(settling);
			settling = setTimeout(() => {
				if (!event.defaultPrevented || !refusedByCap.current) return;
				if (document.activeElement !== standing) return;
				document.getElementById(addId)?.focus();
			}, 0);
		};
		form.addEventListener('submit', submitted);
		return () => {
			form.removeEventListener('submit', submitted);
			clearTimeout(settling);
		};
	}, [intentName, addId]);

	// a thumb that moved writes its stop into its own box, as the operator would have typed it. only
	// the thumb whose stop changed writes: the other box may hold a figure between two stops, and
	// the stop it sits nearest is not what was typed there.
	//
	// a thumb run up against the other stands on the stop the other box's figure is nearest, which
	// may be past that figure — $25 for a box holding $23. what it writes is capped at the other
	// box's figure, so a thumb never writes a smallest gift above the largest or the other way.
	const step = (
		mark: Mark,
		stop: number,
		own: string,
		other: string,
		cap: (reached: number, held: number) => number
	): Mark => {
		const box = bounds.current?.elements.namedItem(own);
		if (stop === mark.stop || !(box instanceof HTMLInputElement)) return mark;
		const held = readAmount(textIn(bounds.current, other), currency).minor;
		const reached = ladder[stop] ?? 0;
		const minor = held === null ? reached : cap(reached, held);
		typeInto(box, majorEntry(minor, currency));
		return { stop, minor };
	};
	const moved = ([lower, upper]: [number, number]) => {
		if (resetting.current) return;
		const { min_minor: min, max_minor: max } = boxes;
		setMarks([
			step(marks[0], lower, min.name, max.name, Math.min),
			step(marks[1], upper, max.name, min.name, Math.max)
		]);
	};

	// a box being typed in moves its thumb to the nearest stop, and never past the other thumb.
	// text that is not an amount leaves the thumb where it is: the box's own message says what is
	// wrong with it when the group is saved.
	const typedLower = (text: string) =>
		setMarks(([lower, upper]) => {
			const mark = markOf(text, ladder, currency, lower);
			return [{ ...mark, stop: Math.min(mark.stop, upper.stop) }, upper];
		});
	const typedUpper = (text: string) =>
		setMarks(([lower, upper]) => {
			const mark = markOf(text, ladder, currency, upper);
			return [lower, { ...mark, stop: Math.max(mark.stop, lower.stop) }];
		});

	return (
		<>
			<h2>What a donor may give</h2>

			<div className="adm-stack">
				{/* a value that is stated and never editable. it is not a disabled box: disabled reads
				    as "unavailable for now, probably by mistake", which is the opposite of "fixed for
				    this deployment". */}
				<StatedValue label="Currency" value={currency}>
					Every form on this deployment takes gifts in this currency.
				</StatedValue>

				{/* a fieldset in every state, and never only when something is wrong: the two bounds
				    are one decision and the legend is what names it, and a group that appeared on a
				    failed save would be a page re-arranging itself around a mistake. */}
				<fieldset className="adm-fieldset" ref={bounds}>
					<legend className="adm-fieldset__legend">Gift bounds</legend>

					{/* each thumb is named by its box's own label and read out as its box's figure, so
					    a screen reader hears the thumbs and the boxes as the same two bounds — $30 and
					    not the $25 stop a box holding $30 stands its thumb on. */}
					<RangeSlider
						stops={stops}
						value={[marks[0].stop, marks[1].stop]}
						readings={[
							formatMinorBrief(marks[0].minor, currency),
							formatMinorBrief(marks[1].minor, currency)
						]}
						onValueChange={moved}
						thumbLabels={[FORM_FIELD_LABELS.min_minor, FORM_FIELD_LABELS.max_minor]}
					/>

					{/* the two bounds are one decision read together, so they sit side by side once
					    there is room for them to. the pair layout without a fieldset, because a
					    fieldset needs a legend and this pair already stands inside one. */}
					<div className="adm-pair adm-pair--side">
						{/* both bounds are text and never a number box, which is what the two staying
						    `z.string()` in `$lib/forms/input-schema.ts` buys: what fails is the app's
						    own rule about how an amount is written, naming what to write instead. the
						    text is also what keeps the value exact — the integer stored is arrived at
						    by moving the digits, never by multiplying a float
						    (`$lib/forms/amounts.ts`).

						    `decimal` rather than `numeric`, because the boxes take a decimal point and
						    `numeric` is the keypad that does not offer one.

						    the message is handed over as a node rather than as the string, so a sentence
						    that marks a value with backticks is drawn as code rather than shown with the
						    marks in it (`@better-giving/operator/code-spans`). `Field` hands whatever it
						    is given to `@better-giving/operator/components/forms/FieldMessage`, which
						    wraps it whole. */}
						<Field
							label={FORM_FIELD_LABELS.min_minor}
							className="adm-num"
							inputMode="decimal"
							required
							{...boxProps(boxes.min_minor)}
							onInput={(event) => typedLower(event.currentTarget.value)}
							error={
								boxes.min_minor.errors?.[0] === undefined ? undefined : (
									<MarkedText text={boxes.min_minor.errors[0]} />
								)
							}
						/>
						<Field
							label={FORM_FIELD_LABELS.max_minor}
							className="adm-num"
							inputMode="decimal"
							required
							{...boxProps(boxes.max_minor)}
							onInput={(event) => typedUpper(event.currentTarget.value)}
							error={
								boxes.max_minor.errors?.[0] === undefined ? undefined : (
									<MarkedText text={boxes.max_minor.errors[0]} />
								)
							}
						/>
					</div>
				</fieldset>

				{/* the legend names the group in the plural and each row is one amount, so a row and
				    its Remove are named by `rowLabel` rather than the legend.

				    each one is a button on a card a donor reads on a phone. neither the unit nor how an
				    amount is written is stated here: one box takes one amount and the placeholder
				    shows the shape, and `amountRule` in `$lib/forms/amounts.ts` ends every sentence
				    one of these boxes is refused with. */}
				<RepeatingRows
					id={amounts.id}
					legend={FORM_FIELD_LABELS.suggested_amounts}
					rowLabel="suggested amount"
					hint="A donor sees these in the order you write them, and can still give any amount within the bounds."
					describedBy={capError ? capErrorId : undefined}
					placeholder={suggestedExample}
					addLabel="Add an amount"
					add={add}
					rows={amounts.rows.map((row, index) => ({
						// bound the way every other box on these screens is: the message under a row is
						// that row's own, and the standing hint is composed in beside it rather than
						// replacing the message's id (../use-admin-form.ts). the sentence goes over as a
						// node for the reason the bounds' do.
						...boxProps(row, { describedBy: suggestedHintId }),
						key: row.key,
						className: 'adm-num',
						inputMode: 'decimal',
						error: row.errors?.[0] === undefined ? undefined : <MarkedText text={row.errors[0]} />,
						// a lone row draws no Remove: with one box left there is nothing to choose
						// between, and a control that would leave the group empty is one the group has
						// no state for. it comes back on every row the moment there are two.
						remove: amounts.rows.length > 1 ? amounts.remove(index) : undefined
					}))}
				/>

				{capError ? (
					<FieldMessage key={heldPresses} id={capErrorId}>
						<MarkedText text={capError} />
					</FieldMessage>
				) : null}
			</div>

			{footer ? <div className="adm-actions">{footer}</div> : null}
		</>
	);
}
