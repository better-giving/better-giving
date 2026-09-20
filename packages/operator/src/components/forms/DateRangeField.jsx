import { DateInput } from '@ark-ui/react/date-input';
import { DatePicker, parseDate } from '@ark-ui/react/date-picker';
import { useMemo, useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * one end of the range, as the screen binding it already composes one box.
 *
 * `id`, `name`, `defaultValue` and `error` are each this end's own — `boxProps` in
 * packages/app/src/lib/admin/use-admin-form.ts composes exactly those four per field, and a range
 * is two fields on the wire however many calendars are drawn for it. `label` is stated rather than
 * optional for ./DateField.jsx's reason: the words in the box are the name.
 *
 * @typedef {object} DateRangeEndOwnProps
 * @property {string} id
 * @property {string} name what this end of the range is submitted under.
 * @property {ReactNode} label
 * @property {string | undefined} [defaultValue] the day this box opens holding, as `YYYY-MM-DD`.
 *   anything else is read as no day at all — and `seeded` below is what a pair of these opens as.
 * @property {ReactNode} [error] what the last press answered with, under this end alone.
 */

/**
 * the two a caller states as the platform's attributes rather than as props, exactly as
 * ./DateField.jsx takes them: `aria-invalid` marks this end refused by a rule larger than one box,
 * and `aria-describedby` replaces the description this component composes for it. both are written
 * as an intersection because a hyphenated name is not a JSDoc `@property`.
 *
 * @typedef {DateRangeEndOwnProps & {
 *   'aria-invalid'?: boolean | 'true' | 'false' | undefined,
 *   'aria-describedby'?: string | undefined
 * }} DateRangeEnd
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: the group's hint and its standing sentence are
 * named from it, and a description nothing points at is one nobody reads.
 *
 * @typedef {object} DateRangeFieldProps
 * @property {string} id
 * @property {ReactNode} [legend] the name over both boxes. absent where the pair is already named
 *   by where it sits, as ./PairedFieldset.jsx's is.
 * @property {ReactNode} [hint] the sentence read before typing, over both boxes.
 * @property {ReactNode} [needed] what marks the range as wanted by something elsewhere on the page.
 * @property {boolean | undefined} [disabled] both ends at once: half a range is not answerable.
 * @property {DateRangeEnd} from
 * @property {DateRangeEnd} to
 */

/**
 * the locale the machines format, parse and punctuate by, pinned rather than read.
 *
 * ./DateField.jsx's `LOCALE` argues it in full and this is the same value for the same reasons: it
 * is the one locale whose own date format is `YYYY-MM-DD`, so the chunks run in the order the day
 * is submitted in and the first chunk cannot mean the year on one deployment and the day on
 * another.
 */
const LOCALE = 'en-CA';

/**
 * the day a string names, and nothing where it names none.
 *
 * the seed reaches this component off an address an operator can edit, so a string that is not a
 * day is a real arrival — ./DateField.jsx's `day` argues it.
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
 * the two seeds as the one range below opens holding them: each end as it was written, and nothing
 * where it names no day.
 *
 * **each end is read on its own.** the seed reaches this component off an address an operator can
 * edit, so either string may be nonsense — and the one beside it that does name a day is still a
 * day somebody asked for. dropping it because its neighbour could not be read answers a question
 * nobody asked, and the pair that is left is a state the boxes already draw.
 *
 * **a seed naming only the far end opens in the far box.** the machines hold the pair as a list
 * from index 0, so that is the list with a hole at the front — the `value` memo below is what
 * builds it, and an operator reaches the same state by writing the last day before the first.
 *
 * **a pair written backwards stands as it was written**, as it does everywhere else in this
 * component: the far end standing before the near one is refused by `RANGE_REVERSED` in
 * packages/app/src/lib/ledger/journal-range.ts, which is told to the far box — so the far box has
 * to be the one holding the day that refusal is about. it is also the seed a refused form is
 * redrawn from, `boxProps` in packages/app/src/lib/admin/use-admin-form.ts carrying back what was
 * submitted, and a pair quietly put in calendar order there would be a refusal nobody could act on.
 *
 * @param {string | undefined} near
 * @param {string | undefined} far
 * @returns {[string, string]}
 */
function seeded(near, far) {
	return [settled(near ?? ''), settled(far ?? '')];
}

/**
 * the day a press in the calendar chose, out of the range the machine answered with.
 *
 * the machine writes a range and this component writes one end of one, so what comes back is the
 * pair it would have made rather than the cell that was pressed: one day where the press started a
 * range over, two where it finished one, and in that second one the order is the machine's. the day
 * the range did not already hold is therefore the day pressed — and where the press landed on a day
 * the range was holding already there is nothing to tell apart and the last reading names it.
 *
 * @param {string[]} texts
 * @param {[string, string]} held the range as it stood before the press.
 */
function chosen(texts, held) {
	const days = texts.filter((text) => typeof text === 'string' && text !== '');
	const fresh = days.filter((text) => text !== held[0] && text !== held[1]);
	return fresh[fresh.length - 1] ?? days[days.length - 1] ?? '';
}

/**
 * the first chunk a caret can land in, inside `group`.
 *
 * ./DateField.jsx's `intoChunks` argues it: a separator is a chunk too and the machine withholds
 * the tab stop from it, so the one to move to is found by that stop rather than by position.
 *
 * @param {HTMLElement | null} group
 */
function intoChunks(group) {
	const chunk = /** @type {HTMLElement | null} */ (
		group?.querySelector('[data-part="segment"][tabindex]') ?? null
	);
	chunk?.focus();
}

/**
 * the line over a calendar's grid: a step back, what is on the grid, and a step forward.
 *
 * one function over all three views, for ./DateField.jsx's reason: every part reads the view it is
 * standing in off the context ark's own `DatePicker.View` puts it in.
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
 * the two ends of one range, as two boxes of chunks over one calendar.
 *
 * **it is a component beside ./DateField.jsx and never a mode on it.** everything a single day box
 * does is that component's and unchanged; what is different here is the one thing that cannot be
 * had from two of them — the machines know both ends, so the calendar marks the pair it has and
 * the far end is chosen against the near one rather than in ignorance of it.
 *
 * **every drawing decision is ./DateField.jsx's and is deliberately not re-argued here**: the day
 * written into chunks rather than into a run of text, the floating label and why the box is not a
 * native `<input type="date">`, the submitted value being `YYYY-MM-DD` off a carrier of this
 * component's own, why that carrier is a text box wearing `.adm-vh` instead of a `type="hidden"`
 * one, and why the chunks carry no `name`. all of it holds here twice over, once per end. that
 * header is the one to read.
 *
 * **two machines, and each one's own control part has to stand over both boxes.** the picker owns
 * the calendar and anchors it to its control, and the input owns the chunks and finds them by
 * querying its control for them — so both controls are above the pair rather than inside either
 * box, and `.adm-datebox` is drawn by an element of this component's own. the two attributes the
 * sheet reads off it, `data-disabled` and `data-invalid`, are therefore written here rather than
 * arriving from a machine. the scope wrapper the input's control is drawn as lays nothing out —
 * `.adm-datefield__scope` in ../../styles/adm.css.
 *
 * **`.adm-datefield` appears twice and both are load-bearing.** the outer one is the picker's root:
 * it is the positioned ancestor the calendar's positioner is placed against, and the wrapper the
 * sheet raises over what follows while the calendar is open. each inner one is a box's own row in
 * its field — `.adm-field > .adm-datefield` is what puts a date box on the third of the five rows
 * the two fields subgrid, which is what stands box beside box and message beside message.
 *
 * **the labels are plain `<label>` elements rather than the machine's label part.** ark's
 * `DateInput.Label` takes no index and names the first box whichever end it is drawn in, so the far
 * end would point at the near end's box. `for` here names the carrier that end submits through,
 * which is what the part would have done had it been told which end it was, and the id each label
 * carries is handed to the machine as that end's, so each group of chunks is still named by the
 * words over it.
 *
 * **both machines are held to this component's value**, which is what keeps the chunks, the
 * calendar and the two carriers saying one thing. the boxes and the two carriers keep the pair in
 * the order it arrived in, whether it was typed or seeded, and that is the point: the far end
 * standing before the near one is a range an operator can ask for and has to be able to see —
 * `RANGE_REVERSED` in packages/app/src/lib/ledger/journal-range.ts is the sentence they are refused
 * with, and a pair quietly put back in order would be a refusal nobody could act on. a seed that
 * moves is a fresh reading of the form and moves both boxes to it.
 *
 * the input machine leaves that pair alone, which is what makes the above hold. the picker sorts
 * the value it is handed, so over a backwards pair the calendar's marking, the head's range text
 * and the end it resumes at are all worked out in calendar order while the boxes stand as written.
 * nothing is drawn from those: the boxes are this component's and the panel is read while a day is
 * being chosen, not while a refusal is being acted on.
 *
 * **a press in the calendar writes the box whose own press opened it, and closes.** the two presses
 * stand at the end of two named boxes, so the calendar one of them opens is that box's calendar and
 * a press in it that moved the other box would be the press answering somewhere nobody pressed. the
 * range the machine wants to write instead is read back through `chosen` below and the end that was
 * not being written is put back as it stood — which is also what keeps the far end standing before
 * the near one where an operator asked for that, since the machine orders the pair it makes and this
 * component does not. pressing the other end's calendar while one is already open moves which end
 * the next press writes rather than closing it.
 */
/** @param {DateRangeFieldProps} props */
export function DateRangeField({ id, legend, hint, needed, disabled, from, to }) {
	const ends = [from, to];

	/* the two seeds as one string, which is what says a form was redrawn from a new reading rather
	   than re-rendered over the one it was mounted on. */
	const seed = `${from.defaultValue ?? ''}|${to.defaultValue ?? ''}`;
	const [drawn, setDrawn] = useState(seed);
	const [pair, setPair] = useState(() => seeded(from.defaultValue, to.defaultValue));
	if (drawn !== seed) {
		setDrawn(seed);
		setPair(seeded(from.defaultValue, to.defaultValue));
	}

	/* the pair as the machines hold it: a list from index 0, and a hole where an end is unwritten.
	   a range whose far end is held and whose near end is not is that list with nothing at the
	   front, which an operator reaches by writing the last day before the first. */
	const value = useMemo(() => {
		const held = /** @type {import('@ark-ui/react/date-picker').DateValue[]} */ ([]);
		const near = day(pair[0]);
		const far = day(pair[1]);
		if (near !== undefined) held[0] = near;
		if (far !== undefined) held[1] = far;
		return held;
	}, [pair]);

	const posted = useRef(/** @type {(HTMLInputElement | null)[]} */ ([null, null]));
	/* the chunks of each box, held as their groups so that a refusal's focus can be handed on to
	   the ones belonging to the carrier it landed on. */
	const chunks = useRef(/** @type {(HTMLDivElement | null)[]} */ ([null, null]));
	/* the press at the end of each box, held so that the one a calendar was opened from can be
	   handed the caret back when it closes. */
	const presses = useRef(/** @type {(HTMLButtonElement | null)[]} */ ([null, null]));

	/* which end holds the caret, or neither. the float is drawn from it per box, so an empty box
	   floats its label while it is being written in and lets it back down when the caret leaves
	   with nothing in it. it is read off the group rather than off a chunk, because the caret
	   moving from the month to the day never leaves the box. */
	const [focused, setFocused] = useState(/** @type {number} */ (-1));

	/* whether the calendar is showing, and which end's press opened it. the calendar is held open
	   here rather than by the machine because a press that writes one end leaves the machine holding
	   half a range, which is a state it stays open in — and the press was an answer.

	   the press outlives the panel it opened, and it has to: `dismiss` below is what hands the caret
	   back, and the closes the machine makes reach this component once the end being written is
	   already gone — an end forgotten on the way out would return an operator who dismissed the far
	   end's calendar to the near end's press. */
	const [open, setOpen] = useState(false);
	const [opener, setOpener] = useState(/** @type {number} */ (0));

	/* the end an open calendar writes, and none while it is down. it is read off the panel rather
	   than held beside it, so there is no close this has to be remembered to be cleared at — the
	   panel goes down by more than one route, and a stored end is latched by whichever of them
	   forgets to clear it. */
	const editing = open ? opener : -1;

	/* the end whose press the calendar answers to. the picker names one trigger — `ids.trigger` in
	   @zag-js/date-picker's `ElementIds` is one string, and its own range composition draws one
	   press over two boxes — while this component draws two, so the id it looks that one press up
	   by is pointed at the end the panel was opened from rather than left standing on whichever press
	   was drawn first. it is read off `opener` and not off `editing`, which is none once the panel
	   is down — the machine looks the press up after that.

	   the machine excludes that one press from what dismisses the panel, so the end that opened the
	   calendar is the end whose press shuts it again rather than the end drawn first — and it is the
	   press the machine reaches for on the closes it restores focus after itself. */
	const answering = opener === 1 ? to : from;

	/* the panel down and the caret back on the press it was opened from, on every close and whatever
	   made it. a close is not an answer to either box, so the press is the only place the caret can
	   go — the cell it was standing on is inside a panel that is no longer drawn, which leaves it on
	   nothing an operator can see and the top of the page as the way back.

	   one mechanism rather than this component's on some closes and the machine's on the rest: the
	   `TABLE.ESCAPE` branch @zag-js/date-picker's machine takes over a picker whose open state is
	   held out here moves the caret onto a cell and restores nothing after it. */
	const dismiss = () => {
		setOpen(false);
		presses.current[opener]?.focus();
	};

	/** the carriers and the pair moved to a written range, wherever it was written. */
	const commit = (/** @type {[string, string]} */ next) => {
		if (next[0] === pair[0] && next[1] === pair[1]) return;
		next.forEach((text, index) => {
			const element = posted.current[index] ?? null;
			if (element === null || element.value === text) return;
			element.value = text;
			element.dispatchEvent(new Event('input', { bubbles: true }));
		});
		setPair(next);
	};

	/** the chunks answering: both ends are the operator's own writing and are taken as written. */
	const typed = (/** @type {{ valueAsString: string[] }} */ details) =>
		commit([details.valueAsString[0] ?? '', details.valueAsString[1] ?? '']);

	/** the calendar answering: one end is written, the other stands, and the calendar closes. */
	const picked = (/** @type {{ valueAsString: string[] }} */ details) => {
		if (editing < 0) return typed(details);
		const other = pair[editing === 0 ? 1 : 0] ?? '';
		const landed = chosen(details.valueAsString, pair);
		/* the panel goes down on a press that answers one box, whatever the machine makes of the
		   other: the machine closes on a cell only where it reads the range as finished, and a press
		   this component takes as an answer is one it may still be holding half of. */
		dismiss();
		commit(editing === 0 ? [landed, other] : [other, landed]);
	};

	return (
		<fieldset className="adm-fieldset">
			{legend ? <legend className="adm-fieldset__legend">{legend}</legend> : null}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<DatePicker.Root
				className="adm-datefield"
				id={`${id}-picker`}
				ids={{ trigger: `${answering.id}-open` }}
				locale={LOCALE}
				selectionMode="range"
				disabled={disabled}
				value={value}
				positioning={{ placement: 'bottom-start' }}
				open={open}
				onOpenChange={(details) => (details.open ? setOpen(true) : dismiss())}
				onValueChange={picked}
			>
				<DateInput.Root
					className="adm-datefield__scope"
					id={`${id}-chunks`}
					/* each end's chunks are named by the words over that end, and submit through that
					   end's own carrier — which is the element its label points at. */
					ids={{
						label: (index) => `${ends[index]?.id}-label`,
						hiddenInput: (index) => `${ends[index]?.id}`
					}}
					locale={LOCALE}
					selectionMode="range"
					disabled={disabled}
					value={value}
					onValueChange={typed}
				>
					<DateInput.Control className="adm-datefield__scope">
						<DatePicker.Control className="adm-pair adm-pair--side">
							{ends.map((end, index) => {
								// refused by the message this end holds, or by a rule that belongs to something
								// larger than one box — a range read off an address is refused under its far end.
								const stated = end['aria-invalid'];
								const refused = end.error ? true : stated === true || stated === 'true';
								const floated = focused === index || pair[index] !== '';
								const describedBy =
									[
										hint ? `${id}-hint` : null,
										end.error ? `${end.id}-err` : null,
										needed ? `${id}-need` : null
									]
										.filter(Boolean)
										.join(' ') || undefined;

								return (
									<div className="adm-field" key={end.name}>
										<div className="adm-datefield">
											<div
												className="adm-datebox"
												data-floated={floated ? '' : undefined}
												data-invalid={refused ? '' : undefined}
												data-disabled={disabled ? '' : undefined}
											>
												{/* the whole cell is the field, for ./DateField.jsx's reason: a press on
												    the space beside this end's chunks puts the caret in them.
												    biome-ignore lint/a11y/noStaticElementInteractions: what this carries
												    is a pointer landing in the control it wraps, and the keyboard
												    reaches those chunks by the tab stops they already carry — a role
												    here would name a second control over the ones inside it. */}
												<div
													className="adm-datebox__words"
													onMouseDown={(event) => {
														event.preventDefault();
														intoChunks(chunks.current[index] ?? null);
													}}
												>
													<label
														className="adm-datefield__label"
														id={`${end.id}-label`}
														htmlFor={end.id}
													>
														{end.label}
													</label>
													<DateInput.SegmentGroup
														className="adm-datebox__chunks"
														index={index}
														ref={(element) => {
															chunks.current[index] = element;
														}}
														aria-invalid={refused ? 'true' : undefined}
														aria-describedby={end['aria-describedby'] ?? describedBy}
														onFocus={() => setFocused(index)}
														onBlur={(event) => {
															if (event.currentTarget.contains(event.relatedTarget)) return;
															setFocused((held) => (held === index ? -1 : held));
														}}
													>
														<DateInput.Context>
															{(chunked) =>
																chunked.getSegments({ index }).map((chunk, at) => (
																	/* the chunk is where the caret lands, so a refused end has to be
																	   refused on the chunks and not only on the group around them.
																	   ./DateField.jsx hands its machine `invalid` for this; one machine
																	   holds both ends here, so its own `invalid` would mark the end
																	   that was not refused too. */
																	<DateInput.Segment
																		className="adm-datebox__chunk"
																		key={`${chunk.type}-${at}`}
																		segment={chunk}
																		aria-invalid={refused ? 'true' : undefined}
																	/>
																))
															}
														</DateInput.Context>
													</DateInput.SegmentGroup>
												</div>
												{/* one press per box, so neither box is the only way in, and the press says
												    which box the calendar it opens will write. both ids are written here and
												    the machine is handed whichever one is answering — `answering` above. the
												    press is read in the capture phase because the machine's own handler is
												    merged ahead of anything passed here, and it would otherwise shut a
												    calendar the other end's press is taking over.

												    the name and the expanded state are each end's own. one machine draws both
												    presses, so left alone they carry one generic label and one `aria-expanded`
												    between them — the same button heard twice, and the near press announcing a
												    panel the far press opened. the words are taken from the label over the box
												    rather than written again here, so the one that is already on the screen is
												    the one that is read. */}
												<DatePicker.Trigger
													className="adm-datebox__open"
													id={`${end.id}-open`}
													ref={(element) => {
														presses.current[index] = element;
													}}
													aria-labelledby={`${end.id}-label ${end.id}-open-word`}
													aria-expanded={editing === index}
													onClickCapture={(event) => {
														if (open && editing !== index) event.preventDefault();
														setOpener(index);
													}}
												>
													<Mark name="calendar" />
													<span className="adm-vh" id={`${end.id}-open-word`}>
														Choose a day
													</span>
												</DatePicker.Trigger>
											</div>
										</div>
										{/* the value the form carries for this end, and the element a refusal reaches it
										    by. ./DateField.jsx's header argues every attribute on it; it stands after
										    the box for the placement reason stated there. */}
										<input
											className="adm-vh"
											type="text"
											id={end.id}
											name={end.name}
											value={pair[index]}
											readOnly
											disabled={disabled}
											tabIndex={-1}
											aria-hidden="true"
											autoComplete="off"
											ref={(element) => {
												posted.current[index] = element;
											}}
											onFocus={() => intoChunks(chunks.current[index] ?? null)}
										/>
										{end.error ? (
											<FieldMessage id={`${end.id}-err`}>{end.error}</FieldMessage>
										) : null}
									</div>
								);
							})}
						</DatePicker.Control>
					</DateInput.Control>
				</DateInput.Root>
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
						{/* the month and the year, reached by the press in the middle of the head above, for
						    ./DateField.jsx's reason: they are what stops a day two years back being
						    twenty-four presses of the step beside it. they are drawn whatever the range
						    holds, the one end and the hole at the front included: every cell either grid
						    marks reads the pair's two days for a day that is really there. */}
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
			{needed ? (
				<FieldMessage tone="needed" id={`${id}-need`}>
					{needed}
				</FieldMessage>
			) : null}
		</fieldset>
	);
}
