import { DatePicker, parseDate } from '@ark-ui/react/date-picker';
import { useMemo, useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: every describing block on this control is
 * named from it, so one without an id hands the browser a description nothing points at. it is
 * also the id the label points at and the id the box is found by when a refusal moves focus.
 *
 * `label` is stated rather than optional, which is what a box whose label stands inside it makes
 * necessary: the words in the box are the name, so a box drawn without them is a box with no name
 * and nothing in it saying what it is for.
 *
 * @typedef {object} DateFieldOwnProps
 * @property {string} id
 * @property {string} name what the chosen day is submitted under.
 * @property {ReactNode} label
 * @property {ReactNode} [hint] the sentence read before typing, drawn where ./Field.jsx draws its
 *   own: over the box, in the quiet register.
 * @property {ReactNode} [error] what the last press answered with.
 * @property {ReactNode} [needed] what marks the field as wanted by something elsewhere on the page,
 *   exactly as ./Field.jsx's does.
 * @property {string | undefined} [defaultValue] the day the box opens holding, as `YYYY-MM-DD`.
 *   anything else is read as no day at all — see the header.
 * @property {boolean | undefined} [disabled]
 * @property {string | undefined} [className] added to the box's own class list.
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached, for
 *   ./Field.jsx's reason. unavailable is not one of them for its reason either: the sheet draws
 *   `.adm-datebox[data-disabled]` with no twin beside it, so a box that cannot be used takes the
 *   `disabled` above through the machine.
 */

/**
 * the two a caller states as the platform's attributes rather than as props of this field's.
 * `aria-invalid` marks the box refused by a rule that belongs to something larger than one box, and
 * `aria-describedby` replaces the description this field composes, exactly as it does on
 * ./Field.jsx — `boxProps` in packages/app/src/lib/admin/use-admin-form.ts composes the refusal's
 * id into its own before handing it over. both are written as an intersection because a hyphenated
 * name is not a JSDoc `@property`.
 *
 * @typedef {DateFieldOwnProps & {
 *   'aria-invalid'?: boolean | 'true' | 'false' | undefined,
 *   'aria-describedby'?: string | undefined
 * }} DateFieldProps
 */

/** nothing chosen, as one value: a new empty array every render would be a new choice every render. */
const NONE = /** @type {import('@ark-ui/react/date-picker').DateValue[]} */ ([]);

/**
 * the locale the machine formats, parses and punctuates by, pinned rather than read.
 *
 * it is the one locale whose own date format is `YYYY-MM-DD`: the box then shows the string that is
 * submitted, the separator the machine will accept from the keyboard is `-`, and the order the
 * machine parses in is year, month, day. picking it up from the reader's browser instead would put
 * a different string on the screen after hydration than the server drew, and would leave `01/02`
 * meaning January the 2nd on one deployment and the 1st of February on another — which on a range
 * whose two ends decide what is in an accounting export is a wrong answer nobody can see is wrong.
 */
const LOCALE = 'en-CA';

/**
 * the day a string names, and nothing where it names none.
 *
 * the seed reaches this component off an address an operator can edit
 * (`readJournalRange` in packages/app/src/lib/ledger/journal-range.ts reads the same text), so a
 * string that is not a day is a real arrival and not a defect. it is read as an empty box: the
 * refusal the screen came back with is still under it saying what was wrong, and the box is ready
 * to be typed into rather than holding something the machine cannot represent.
 *
 * @param {string} text
 */
function day(text) {
	if (text === '') return undefined;
	try {
		return parseDate(text);
	} catch {
		return undefined;
	}
}

/** the same string back where it names a day, and the empty string where it does not. */
const settled = (/** @type {string} */ text) => day(text)?.toString() ?? '';

/**
 * the line over a calendar's grid: a step back, what is on the grid, and a step forward.
 *
 * one function over all three views rather than three copies of it, and the machine is what makes
 * that work: every part here reads the view it is standing in off the context ark's own
 * `DatePicker.View` puts it in, so the step knows whether it is moving by a month, a year or a
 * decade and the press in the middle knows which view it climbs to.
 */
function CalendarHead() {
	return (
		<DatePicker.ViewControl className="adm-cal__head">
			<DatePicker.PrevTrigger className="adm-cal__step">
				<Mark name="chevron-left" />
			</DatePicker.PrevTrigger>
			<DatePicker.ViewTrigger className="adm-cal__span">
				<DatePicker.RangeText />
			</DatePicker.ViewTrigger>
			<DatePicker.NextTrigger className="adm-cal__step">
				<Mark name="chevron-right" />
			</DatePicker.NextTrigger>
		</DatePicker.ViewControl>
	);
}

/*
 * a day typed into a box whose label stands inside it and rises onto its top edge.
 *
 * **the construction is for a date box inside a named group of boxes** — a range under a legend
 * naming the range, which is what packages/app/src/routes/_app.admin.donations.export.tsx draws
 * its pair of these in. a label over each box in a group like that would read as a second row of
 * names under the legend that has already named them, so the two words go inside the boxes and say
 * which end of the range each one is. a single date box on a screen is not that group and keeps
 * its label above it, which is what ./Field.jsx draws.
 *
 * **the label floats here and nowhere else on either operator surface.** ./Field.jsx's header says
 * "label above the box, always" and that rule still holds for every other box in this system; this
 * component is the one exception and is a component beside that one rather than a flag on it. a
 * native `<input type="date">` cannot carry a floating label at all — the browser draws `mm/dd/yyyy`
 * inside it, so the box is never visually empty and a resting label would stand on top of the
 * product's own text — which is why the box here is ark's date picker, whose control is a plain
 * text input that really is empty until a day is in it.
 *
 * **the submitted value is `YYYY-MM-DD` and nothing else**, and two readers outside this package
 * are why. `reversedRangeRule` in packages/app/src/routes/_app.admin.donations.export.tsx compares
 * the two ends of a range as text, on the reasoning that for `YYYY-MM-DD` the lexical order is the
 * calendar order; `readJournalRange` in packages/app/src/lib/ledger/journal-range.ts reads the same
 * text off an address. so the value the form carries is a box of this component's own, as
 * ./CoinPicker.jsx's chosen code is, and never the box the operator types in: a browser submits
 * what is in a box at the moment of the press, and what is in that one halfway through typing is
 * half a date.
 *
 * that carrier is then made to say it changed, for ./CoinPicker.jsx's reason: a value react wrote
 * fires no event, and both layers that read these forms are counting the events their boxes fire.
 *
 * **the carrier is hidden by the sheet and not by `type="hidden"`, and that is the difference that
 * matters.** conform reports a refusal by walking `form.elements` for the name it holds an error
 * for and calling `focus()` on what it finds (`report` in @conform-to/dom's form.js) — and a
 * `type="hidden"` input cannot take focus, so the caret would stay wherever the press left it and
 * nobody would be told which box was refused. so it is a real text box wearing `.adm-vh`
 * (../../styles/base.css), which stays focusable on purpose, and the focus it is handed it hands
 * straight on to the box the operator types in. it is out of the tab order and out of the
 * accessibility tree, so the form still has one stop and one control per date.
 *
 * **the box the operator types in carries no `name`**, which is what keeps the carrier the only
 * element on this control under that name — `elements.namedItem(name)` then finds one control and
 * the body carries one value.
 *
 * the machine is ark's date picker and everything it already answers for is left to it: the grid
 * roles, the arrow keys, Escape, the dismissal, the announcements, and the parsing and formatting
 * of what is typed. what is stated here is the locale, above, and the float.
 */
/** @param {DateFieldProps} props */
export function DateField({
	id,
	name,
	label,
	hint,
	error,
	needed,
	defaultValue = '',
	disabled,
	className,
	state,
	'aria-invalid': stated,
	'aria-describedby': described
}) {
	// refused by the message this field holds, or by a rule that belongs to something larger than
	// one box: a fieldset draws a pair's message once and marks both boxes from out here, since
	// either box fixes the pair and neither one is the wrong one.
	const refused = error ? true : stated === true || stated === 'true';

	const posted = useRef(/** @type {HTMLInputElement | null} */ (null));
	/* the box the operator types in, held so that the carrier can hand a refusal's focus on to it. */
	const typed = useRef(/** @type {HTMLInputElement | null} */ (null));
	const [chosen, setChosen] = useState(() => settled(defaultValue));
	/* the seed the control was last drawn against, as ./CoinPicker.jsx keeps one: a form redrawn
	   from a new reading has to move the box to it rather than leave it standing at whatever was
	   chosen against the reading before. */
	const [seed, setSeed] = useState(defaultValue);
	if (seed !== defaultValue) {
		setSeed(defaultValue);
		setChosen(settled(defaultValue));
	}

	/* the machine is held to this component's own value rather than left to keep its own, which is
	   what lets the two above move it. `chosen` is only ever a day this module settled, so the
	   parse below cannot fail. */
	const value = useMemo(() => {
		const held = day(chosen);
		return held === undefined ? NONE : [held];
	}, [chosen]);

	/* where the caret is, and it is this component's because the float is drawn from it: a box
	   holding nothing floats its label while it is being typed into and lets it back down when the
	   caret leaves with nothing in it. the machine puts the typed text back to the day it parsed —
	   or to nothing — as focus leaves, so a box that is unfocused and empty is really empty. */
	const [focused, setFocused] = useState(false);
	const floated = focused || chosen !== '';

	const describedBy =
		[hint ? `${id}-hint` : null, error ? `${id}-err` : null, needed ? `${id}-need` : null]
			.filter(Boolean)
			.join(' ') || undefined;

	return (
		<div className="adm-field">
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<DatePicker.Root
				className="adm-datefield"
				id={`${id}-picker`}
				ids={{ input: () => id }}
				locale={LOCALE}
				disabled={disabled}
				value={value}
				positioning={{ placement: 'bottom-start' }}
				onValueChange={(details) => {
					const next = details.valueAsString[0] ?? '';
					const element = posted.current;
					if (element !== null) {
						element.value = next;
						element.dispatchEvent(new Event('input', { bubbles: true }));
					}
					setChosen(next);
				}}
			>
				<DatePicker.Control
					className={['adm-datebox', state ? `is-${state}` : '', className]
						.filter(Boolean)
						.join(' ')}
					data-floated={floated ? '' : undefined}
					data-invalid={refused ? '' : undefined}
				>
					<span className="adm-datebox__words">
						<DatePicker.Label className="adm-datefield__label">{label}</DatePicker.Label>
						{/* the placeholder is the machine's own `yyyy-mm-dd` and is withheld until the
						    label is out of the way: a resting label and a placeholder occupy the same
						    line, and two strings in one box is the state a floating label exists to
						    avoid. it is spread rather than passed as `undefined`, so that not stating
						    it is really not stating it and the machine's own reaches the element. */}
						<DatePicker.Input
							className="adm-datebox__input"
							ref={typed}
							{...(floated ? {} : { placeholder: '' })}
							aria-invalid={refused ? 'true' : undefined}
							aria-describedby={described ?? describedBy}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
						/>
					</span>
					<DatePicker.Trigger className="adm-datebox__open">
						<Mark name="calendar" />
					</DatePicker.Trigger>
				</DatePicker.Control>
				<DatePicker.Positioner>
					<DatePicker.Content className="adm-cal">
						<DatePicker.View view="day">
							<DatePicker.Context>
								{(cal) => (
									<>
										<CalendarHead />
										<DatePicker.Table className="adm-cal__grid">
											<DatePicker.TableHead>
												<DatePicker.TableRow>
													{cal.weekDays.map((weekday) => (
														<DatePicker.TableHeader
															className="adm-cal__weekday"
															key={weekday.long}
															aria-label={weekday.long}
														>
															{weekday.narrow}
														</DatePicker.TableHeader>
													))}
												</DatePicker.TableRow>
											</DatePicker.TableHead>
											<DatePicker.TableBody>
												{cal.weeks.map((week) => (
													<DatePicker.TableRow key={week[0]?.toString()}>
														{week.map((date) => (
															<DatePicker.TableCell
																className="adm-cal__cell"
																key={date.toString()}
																value={date}
															>
																<DatePicker.TableCellTrigger className="adm-cal__pick">
																	{date.day}
																</DatePicker.TableCellTrigger>
															</DatePicker.TableCell>
														))}
													</DatePicker.TableRow>
												))}
											</DatePicker.TableBody>
										</DatePicker.Table>
									</>
								)}
							</DatePicker.Context>
						</DatePicker.View>
						{/* the month and the year, reached by the press in the middle of the head above.
						    they are what stops a day two years back being twenty-four presses of the
						    step beside it, and the machine draws them out of the same cell and trigger
						    parts the days are drawn from, so the sheet dresses one cell three times. */}
						<DatePicker.View view="month">
							<DatePicker.Context>
								{(cal) => (
									<>
										<CalendarHead />
										<DatePicker.Table className="adm-cal__grid" columns={4}>
											<DatePicker.TableBody>
												{cal.getMonthsGrid({ columns: 4, format: 'short' }).map((row) => (
													<DatePicker.TableRow key={row[0]?.value}>
														{row.map((month) => (
															<DatePicker.TableCell
																className="adm-cal__cell"
																key={month.value}
																value={month.value}
															>
																<DatePicker.TableCellTrigger className="adm-cal__pick">
																	{month.label}
																</DatePicker.TableCellTrigger>
															</DatePicker.TableCell>
														))}
													</DatePicker.TableRow>
												))}
											</DatePicker.TableBody>
										</DatePicker.Table>
									</>
								)}
							</DatePicker.Context>
						</DatePicker.View>
						<DatePicker.View view="year">
							<DatePicker.Context>
								{(cal) => (
									<>
										<CalendarHead />
										<DatePicker.Table className="adm-cal__grid" columns={4}>
											<DatePicker.TableBody>
												{cal.getYearsGrid({ columns: 4 }).map((row) => (
													<DatePicker.TableRow key={row[0]?.value}>
														{row.map((year) => (
															<DatePicker.TableCell
																className="adm-cal__cell"
																key={year.value}
																value={year.value}
															>
																<DatePicker.TableCellTrigger className="adm-cal__pick">
																	{year.label}
																</DatePicker.TableCellTrigger>
															</DatePicker.TableCell>
														))}
													</DatePicker.TableRow>
												))}
											</DatePicker.TableBody>
										</DatePicker.Table>
									</>
								)}
							</DatePicker.Context>
						</DatePicker.View>
					</DatePicker.Content>
				</DatePicker.Positioner>
			</DatePicker.Root>
			{/* the value the form carries, and the element a refusal reaches this field by. the
			    header argues why it is a text box off the screen rather than a `type="hidden"` one;
			    everything here is what keeps it from being a second box on the form. `readOnly`
			    because nothing types into it — what is in it is settled by the machine above —
			    `tabIndex` because an operator tabbing the form meets one stop per date, `aria-hidden`
			    because a reader meets one control per date, and `autoComplete` because a text box
			    holding a date is something a browser will otherwise offer to fill.

			    it stands after the box rather than before it, and that is placement rather than
			    order of thought: `.adm-field > * + *` in ../../styles/adm.css puts the step between
			    two parts on the second of them, so a carrier drawn first would be the part the field
			    starts with and the box would take a step above it that nothing on the screen is
			    stepping away from. the box the caret goes into is then also the first input in the
			    field, which is what anything walking this markup meets first.

			    it is disabled with the control, which is what a box an operator cannot answer does by
			    itself: the press is refused as blank rather than submitting a day nobody picked. */}
			<input
				className="adm-vh"
				type="text"
				name={name}
				value={chosen}
				readOnly
				disabled={disabled}
				tabIndex={-1}
				aria-hidden="true"
				autoComplete="off"
				ref={posted}
				onFocus={() => typed.current?.focus()}
			/>
			{/* both rows are ./FieldMessage.jsx's, which is where the refusal being the one live region
			    on the control is argued: it is what a press answered with, and the standing sentence
			    below it is a condition rather than an event. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
			{needed ? (
				<FieldMessage tone="needed" id={`${id}-need`}>
					{needed}
				</FieldMessage>
			) : null}
		</div>
	);
}
