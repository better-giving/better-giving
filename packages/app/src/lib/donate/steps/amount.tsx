import { currencySymbol, formatOffer, parseMinor } from '@better-giving/form/money';
import { part, partWhen } from '@better-giving/form/parts';
import type { AmountDecision } from '@better-giving/form/value';
import type { FormConfig } from '@better-giving/form/v1';
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import * as copy from '../copy';
import type { ReactApi } from '../normalize';

// the first numbered step: what the gift is, and everything the donor says about it.
//
// every choice on this screen is read off the projection. which cadences the deployment offers,
// which amounts it suggests, which causes it leaves to the donor, whether a press would be refused
// and for what — each is a predicate `connect` in @better-giving/form/connect already answers, and
// re-answering one here would be that predicate held twice, on the screen that decides the money.
//
// what is this file's own is the drawn state the flow has no opinion about: which of the two ways
// into an amount the donor is using, and where the chip on the cadence track stands.

/** where a refused press on this step can put the caret, one per decision that has a control. */
export type AmountRefs = {
	readonly entry: RefObject<HTMLInputElement | null>;
	readonly note: RefObject<HTMLTextAreaElement | null>;
	readonly honoree: RefObject<HTMLInputElement | null>;
	readonly notifyName: RefObject<HTMLInputElement | null>;
	readonly notifyEmail: RefObject<HTMLInputElement | null>;
};

export type AmountStepProps = {
	readonly api: ReactApi;
	readonly config: FormConfig;
	/** the heading and its marks, built by the card so focus can be put on one place. */
	readonly head: ReactNode;
	readonly hidden: boolean;
	/** the decisions this step is reporting, empty until a press has asked for one. */
	readonly missing: readonly AmountDecision[];
	readonly amountProblem: string;
	/** the free entry's own text, which is the view's answer rather than the flow's. */
	readonly entry: string;
	readonly onEntry: (text: string) => void;
	readonly onPreset: (amountMinor: number) => void;
	readonly onOther: () => void;
	/** whether the way past the presets is the one holding the amount. */
	readonly otherChosen: boolean;
	readonly onNoteToggle: () => void;
	readonly onTributeToggle: () => void;
	readonly notifyOpen: boolean;
	readonly onNotify: () => void;
	readonly onContinue: () => void;
	/** whether Enter on this screen reaches this step's own Continue. */
	readonly submits: boolean;
	readonly refs: AmountRefs;
};

/**
 * the measurement pass, before paint where there is one to be before.
 *
 * the chip's position and the tray's column count are both read off laid-out boxes and written back
 * into style, so doing it after paint is a visible jump. this route renders on the server too,
 * where there is no layout to read and `useLayoutEffect` would only warn.
 */
const useMeasure = typeof document === 'undefined' ? useEffect : useLayoutEffect;

export function AmountStep({
	api,
	config,
	head,
	hidden,
	missing,
	amountProblem,
	entry,
	onEntry,
	onPreset,
	onOther,
	otherChosen,
	onNoteToggle,
	onTributeToggle,
	notifyOpen,
	onNotify,
	onContinue,
	submits,
	refs
}: AmountStepProps) {
	const { locale, currency } = config;
	const offer = (minor: number) => formatOffer(minor, locale, currency);

	const busy = api.continueButton['aria-busy'];
	const missingAmount = missing.includes('amount');
	const missingNote = missing.includes('note');

	// a deployment offering one cadence draws no control: one option is not a choice, and a track
	// holding it asks a donor to decide something already decided. what a control would have sent is
	// seeded on the draft instead, so the gift still carries a cadence.
	const chooses = api.frequencyGroup.options.length > 1;
	// one suggestion is no choice either: a tray with one tile and an Other tile beside it offers a
	// press that changes nothing, so a form suggesting one amount draws the box alone.
	const tiled = api.amountGroup.options.length > 1;
	const typed = parseMinor(entry, locale, currency) !== null;
	// a figure the flow holds that no preset equals is the other way already taken — a resume, or a
	// donor coming back to this step — so the box holding it is not closed over it.
	const presetMatch = api.amountGroup.options.some((option) => option.checked);
	const otherHolds = tiled && (otherChosen || (typed && !presetMatch));

	// where the gift goes, drawn only where the organisation left that to the donor. the projection
	// carries the option that picks none on every form, so a list of one is a form with nothing to
	// ask — which is the configuration's answer already made, read here rather than made again.
	const choosesProgram = api.programSelect.options.length > 1;

	// two marks, one at each end of the box: the symbol in front of the figure and the code behind
	// it. the leading one is conditional and the trailing one is not — `en-US` writes `CHF` as `CHF`,
	// and a card drawing that at both ends states the currency twice.
	const symbol = currencySymbol(locale, currency);
	const code = currency.toUpperCase();

	const track = useRef<HTMLDivElement | null>(null);
	const chips = useRef<(HTMLLabelElement | null)[]>([]);
	const tiles = useRef<HTMLDivElement | null>(null);
	const tileLabels = useRef<(HTMLLabelElement | null)[]>([]);
	/** where the chip stood after the last pass, so a move along a row is told from a move across a wrap. */
	const chipAt = useRef<{ x: number; y: number } | null>(null);

	useMeasure(() => {
		/**
		 * the chip put where the chosen cadence stands, and told whether it travelled there.
		 *
		 * the geometry is read off the option's own used box rather than computed from a count: the
		 * track wraps, how many cadences it holds is the deployment's, and how much width it was given
		 * is the viewport's. a chip crossing rows would travel diagonally over two other options on
		 * its way, so that move is written with the transition off.
		 */
		const placeThumb = (jump: boolean): void => {
			const node = track.current;
			if (node === null) return;
			const at = api.frequencyGroup.options.findIndex((option) => option.checked);
			const chosen = at === -1 ? null : (chips.current[at] ?? null);
			if (chosen === null) {
				node.removeAttribute('data-thumb');
				node.removeAttribute('data-sliding');
				chipAt.current = null;
				return;
			}
			const x = chosen.offsetLeft;
			const y = chosen.offsetTop;
			const travels = !jump && chipAt.current?.y === y && chipAt.current.x !== x;
			if (travels) node.setAttribute('data-sliding', '');
			else node.removeAttribute('data-sliding');
			node.style.setProperty('--_thumb-x', `${x}px`);
			node.style.setProperty('--_thumb-y', `${y}px`);
			node.style.setProperty('--_thumb-w', `${chosen.offsetWidth}px`);
			node.style.setProperty('--_thumb-h', `${chosen.offsetHeight}px`);
			node.setAttribute('data-thumb', '');
			chipAt.current = { x, y };
		};

		/**
		 * which tile opens a row of the grid, and how many columns it came out with.
		 *
		 * where the grid wraps is the engine's answer and no stylesheet can ask it, so both are read
		 * off the tiles' own boxes: a tile whose top differs from the one before it opens a row, and
		 * the tiles sharing the first top are the columns the tray's verticals repeat at.
		 */
		const markRows = (): void => {
			const tray = tiles.current;
			if (tray === null || tray.offsetParent === null) return;
			const labels = tileLabels.current.filter((label) => label !== null);
			const first = labels[0]?.offsetTop;
			let above: number | null = null;
			let cols = 0;
			for (const label of labels) {
				if (label.offsetTop !== above) label.setAttribute('data-row-start', '');
				else label.removeAttribute('data-row-start');
				if (label.offsetTop === first) cols += 1;
				above = label.offsetTop;
			}
			if (cols === 0) tray.style.removeProperty('--_cols');
			else tray.style.setProperty('--_cols', String(cols));
		};

		if (chooses) placeThumb(false);
		markRows();

		// the window changing size is the one rewrap this card can hear, and the overwhelming majority
		// of what rewraps one in the wild. answered on the next paint rather than in the handler: a
		// resize fires at the frame rate of a drag and this reads layout and writes back into it.
		//
		// a `ResizeObserver` on the track would close the remaining hole — a container resized while
		// the window holds still — and may not be used: the track is inside the card's own
		// container-query container, and observing anything in one makes chromium report
		// "ResizeObserver loop completed with undelivered notifications".
		let frame = 0;
		const rewrapped = (): void => {
			if (frame !== 0) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				if (chooses) placeThumb(true);
				markRows();
			});
		};
		window.addEventListener('resize', rewrapped);
		return () => {
			window.removeEventListener('resize', rewrapped);
			if (frame !== 0) window.cancelAnimationFrame(frame);
		};
	});

	return (
		<section className="step" hidden={hidden}>
			{head}

			{chooses ? (
				<fieldset className="group">
					<legend part={part('label')}>{copy.HOW_OFTEN}</legend>
					<div className="segment" ref={track}>
						{api.frequencyGroup.options.map((option, at) => (
							<label
								key={String(option.value)}
								ref={(node) => {
									chips.current[at] = node;
								}}
								part={partWhen('frequency-option', { selected: option.checked })}
							>
								<input
									type="radio"
									name={api.frequencyGroup.name}
									value={String(option.value)}
									checked={option.checked}
									onChange={option.onChange}
								/>
								<span>{option.label ?? String(option.value)}</span>
							</label>
						))}
					</div>
				</fieldset>
			) : null}

			{/*
			 * no `radiogroup` role, and the difference is the free entry: this group holds a text box
			 * beside its radios, which is not what that role describes. the invalid state is carried by
			 * the box itself, where the role does support it, and the sentence reaches the group through
			 * `aria-describedby`, which is global and works on the role a fieldset already has.
			 */}
			<fieldset className="group" aria-describedby={missingAmount ? 'amount-problem' : undefined}>
				<legend part={part('label')}>{copy.HOW_MUCH}</legend>
				<div className={tiled ? 'tiles' : 'tiles bare'} ref={tiles}>
					{tiled
						? api.amountGroup.options.map((option, at) => (
								<label
									key={String(option.value)}
									ref={(node) => {
										tileLabels.current[at] = node;
									}}
									part={partWhen('amount-option', {
										selected: option.checked && !otherHolds,
										invalid: missingAmount
									})}
								>
									<input
										type="radio"
										name={api.amountGroup.name}
										value={String(option.value)}
										checked={option.checked && !otherHolds}
										onChange={() => {
											// the amount is one decision, so the press writes its own figure into the
											// box below: the tiles and the box are two views of one number.
											onPreset(Number(option.value));
											option.onChange();
										}}
									/>
									<span>{offer(Number(option.value))}</span>
								</label>
							))
						: null}
					{tiled ? (
						<label
							className="other"
							ref={(node) => {
								tileLabels.current[api.amountGroup.options.length] = node;
							}}
							part={partWhen('amount-option', { selected: otherHolds, invalid: missingAmount })}
						>
							<input
								type="radio"
								name={api.amountGroup.name}
								value=""
								checked={otherHolds}
								onChange={onOther}
							/>
							<span>{copy.OTHER}</span>
						</label>
					) : null}
					<div
						className="tile entry"
						hidden={tiled && !otherHolds}
						part={partWhen('amount-input', {
							selected: typed && (!tiled || otherHolds),
							invalid: missingAmount
						})}
					>
						{symbol === code ? null : (
							<span className="adorn-lead" aria-hidden="true">
								{symbol}
							</span>
						)}
						{/*
						 * a numeric keypad with a decimal separator on it rather than `type="number"`, whose
						 * spinner and scroll-wheel stepping both change a gift by accident. it is described
						 * by nothing: a description written here would be read whether the sentence is on
						 * screen or not, which tells every donor their amount is wrong before they type one.
						 */}
						<input
							id="amount-entry"
							ref={refs.entry}
							type="text"
							inputMode="decimal"
							autoComplete="off"
							placeholder={copy.AMOUNT}
							value={entry}
							aria-invalid={missingAmount ? true : undefined}
							onChange={(event) => onEntry(event.currentTarget.value)}
						/>
						<span className="adorn-trail" aria-hidden="true">
							{code}
						</span>
					</div>
				</div>
				<label part={part('label')} className="vh" htmlFor="amount-entry">
					{copy.AMOUNT}
				</label>
				<p className="message" id="amount-problem" hidden={!missingAmount}>
					{amountProblem}
				</p>
			</fieldset>

			{choosesProgram ? (
				<div className="field-row program">
					<label part={part('label')} htmlFor="program">
						{copy.PROGRAM}
					</label>
					<select part={part('field')} id="program" {...api.programSelect.box}>
						{api.programSelect.options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			) : null}

			{/*
			 * the note says it is optional, and it is the only control on the card that says anything
			 * about whether it has to be filled in. that is the convention the details step's required
			 * fields then read against — an unmarked field is one the form needs.
			 */}
			<div className="disclosure note">
				<label className="check-row">
					<input
						part={part('checkbox')}
						type="checkbox"
						checked={api.noteToggle.pressed === true}
						onChange={onNoteToggle}
					/>
					<span>
						{copy.ADD_A_NOTE}
						<span className="optional">{copy.OPTIONAL}</span>
					</span>
				</label>
				<div className="disclosure-body" hidden={api.noteToggle.pressed !== true}>
					<div className="disclosure-inner">
						<label part={part('label')} className="vh" htmlFor="note">
							{copy.YOUR_NOTE}
						</label>
						<textarea
							{...api.noteField.box}
							id="note"
							ref={refs.note}
							rows={3}
							part={partWhen('field', { invalid: missingNote })}
							aria-invalid={missingNote ? true : undefined}
							aria-describedby={missingNote ? 'note-problem' : undefined}
						/>
						<p className="message" id="note-problem" hidden={!missingNote}>
							{copy.NOTE_PROBLEM}
						</p>
					</div>
				</div>
			</div>

			{/*
			 * a gift given for somebody else, and the second disclosure on this step. it is here rather
			 * than on the details step because a tribute is a fact about the gift and not about the
			 * payer, and the note is its established neighbour.
			 */}
			<div className="disclosure tribute">
				<label className="check-row">
					<input
						part={part('checkbox')}
						type="checkbox"
						checked={api.tributeToggle.pressed === true}
						onChange={onTributeToggle}
					/>
					<span>
						{copy.DEDICATE}
						<span className="optional">{copy.OPTIONAL}</span>
					</span>
				</label>
				<div className="disclosure-body" hidden={api.tributeToggle.pressed !== true}>
					<div className="disclosure-inner">
						{/*
						 * the kind and the name on one line, which is what makes them read as the sentence
						 * they are: `In honor of` starts it and the name finishes it. flat rather than two
						 * wrapped rows, so the honoree's sentence is a grid item of its own and can span the
						 * pair.
						 */}
						<div className="dedication">
							<label part={part('label')} className="vh" htmlFor="tribute-kind">
								{copy.TRIBUTE_KIND_LABEL}
							</label>
							<select part={part('field')} id="tribute-kind" {...api.tributeKindSelect.box}>
								{api.tributeKindSelect.options.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<TributeBox
								id="tribute-honoree"
								label={copy.TRIBUTE_HONOREE_LABEL}
								placeholder={copy.TRIBUTE_HONOREE_PLACEHOLDER}
								sentence={copy.TRIBUTE_HONOREE_PROBLEM}
								field={api.tributeHonoreeField}
								wrong={missing.includes('tribute-honoree')}
								inputRef={refs.honoree}
							/>
						</div>

						<div className="field-row">
							{/*
							 * the way in, the way back out, and the words over the pair while it is open — one
							 * control in all three, so what a donor pressed is what they are then looking at.
							 * it is not a label for the boxes under it: each carries a hidden label naming its
							 * own person, and this names the pair.
							 */}
							<button
								part={part('action-quiet')}
								type="button"
								aria-expanded={notifyOpen}
								aria-controls="tribute-notify"
								onClick={onNotify}
							>
								{notifyOpen ? copy.NOTIFY_OPEN : copy.NOTIFY_SHUT}
							</button>
							<div className="names" id="tribute-notify" hidden={!notifyOpen}>
								<div className="field-row">
									<TributeBox
										id="tribute-notify-name"
										label={copy.NOTIFY_NAME_LABEL}
										placeholder={copy.NOTIFY_NAME_PLACEHOLDER}
										sentence={copy.NOTIFY_NAME_PROBLEM}
										field={api.tributeNotifyNameField}
										wrong={missing.includes('tribute-notify-name')}
										inputRef={refs.notifyName}
									/>
								</div>
								<div className="field-row">
									<TributeBox
										id="tribute-notify-email"
										label={copy.NOTIFY_EMAIL_LABEL}
										placeholder={copy.NOTIFY_EMAIL_PLACEHOLDER}
										sentence={copy.NOTIFY_EMAIL_PROBLEM}
										field={api.tributeNotifyEmailField}
										wrong={missing.includes('tribute-notify-email')}
										inputRef={refs.notifyEmail}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<button
				part={partWhen('action', { busy })}
				type={submits ? 'submit' : 'button'}
				aria-busy={busy}
				onClick={onContinue}
			>
				<span className="action-label">{copy.CONTINUE}</span>
				<span className="spinner" aria-hidden="true" />
			</button>
		</section>
	);
}

/**
 * one tribute box, with the sentence that says what is wrong with it directly under it.
 *
 * the three nodes rather than a row, because the two places they are laid out want different
 * shapes: the honoree shares a line with the select and its sentence has to span both columns,
 * where a wrapper would stack it six lines deep at 375px.
 *
 * the label is hidden the way the amount entry's own is: what the box is for is written on the box,
 * and a visible label over each of these turns a four-control block into eight rows. so the words
 * here are the whole of what a screen reader is given, and each names its own person.
 *
 * `autocomplete="off"` on all three. these are somebody else's name and somebody else's address, so
 * a browser offering the donor their own saved details would be offering the wrong person.
 */
function TributeBox({
	id,
	label,
	placeholder,
	sentence,
	field,
	wrong,
	inputRef
}: {
	readonly id: string;
	readonly label: string;
	readonly placeholder: string;
	readonly sentence: string;
	readonly field: ReactApi['tributeHonoreeField'];
	readonly wrong: boolean;
	readonly inputRef: RefObject<HTMLInputElement | null>;
}) {
	const problemId = `${id}-problem`;
	return (
		<>
			<label part={part('label')} className="vh" htmlFor={id}>
				{label}
			</label>
			<input
				{...field.box}
				id={id}
				ref={inputRef}
				placeholder={placeholder}
				autoComplete="off"
				part={partWhen('field', { invalid: wrong })}
				aria-invalid={wrong ? true : undefined}
				aria-describedby={wrong ? problemId : undefined}
			/>
			<p className="message" id={problemId} hidden={!wrong}>
				{sentence}
			</p>
		</>
	);
}
