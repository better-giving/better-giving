import { currencySymbol, formatOffer, parseMinor } from '@better-giving/form/money';
import { part, partWhen, REGISTRY_CLASS } from '@better-giving/form/parts';
import type { AmountDecision } from '@better-giving/form/value';
import type { UnitMark, UnitPill } from '@better-giving/form/unit';
import type { FormConfig } from '@better-giving/form/v1';
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
	type RefObject
} from 'react';
import { Choice } from '../choice';
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

/**
 * where a refused press on this step can put the caret, one per decision that has a control, and
 * the three nodes the unit panel stands against (../unit-panel.ts).
 */
export type AmountRefs = {
	readonly entry: RefObject<HTMLInputElement | null>;
	/** the one box a coin amount or a share count is typed in. */
	readonly quantity: RefObject<HTMLInputElement | null>;
	readonly pill: RefObject<HTMLButtonElement | null>;
	/** the How much line the pill stands at the end of. */
	readonly line: RefObject<HTMLDivElement | null>;
	readonly group: RefObject<HTMLFieldSetElement | null>;
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
	/**
	 * a coin gift's refusal as the quote answered it (`coinRefusalSentence` in
	 * @better-giving/form/unit), `''` where there is none. it stands where the bounds do and gives way
	 * to them: a figure outside the form's own bounds no coin takes.
	 */
	readonly refusal: string;
	/**
	 * a coin amount's failed price check (`COIN_PRICE_FAILED` in @better-giving/form/unit), `''` where
	 * there is none or where the bounds or a refusal outrank it. it stands in the same place.
	 */
	readonly unpriced: string;
	/** whether that refusal is of the amount, which marks the box the amount was typed in. */
	readonly refusedAmount: boolean;
	/** whether the unit panel is open, which the pill says. */
	readonly unitOpen: boolean;
	readonly onPill: () => void;
	/** the free entry's own text, which is the view's answer rather than the flow's. */
	readonly entry: string;
	readonly onEntry: (text: string) => void;
	readonly onPreset: (amountMinor: number) => void;
	/**
	 * the way past the presets taken. `pointer` is a press on the tile, which takes the caret into the
	 * box; an arrow key or Space leaves it on the radio, where the donor is still moving through the
	 * group, and Tab reaches the box next.
	 */
	readonly onOther: (via: 'pointer' | 'keyboard') => void;
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
	/** whether the card draws the program choice; false where the page around it draws one. */
	readonly drawsProgram: boolean;
	/** the words under each suggested amount, by the amount in minor units; none draws the figure alone. */
	readonly amountLabels?: Readonly<Record<string, string>> | undefined;
};

/**
 * the measurement pass, before paint where there is one to be before.
 *
 * the chip's position is read off laid-out boxes and written back into style, so doing it after
 * paint is a visible jump. this route renders on the server too, where there is no layout to read
 * and `useLayoutEffect` would only warn.
 */
const useMeasure = typeof document === 'undefined' ? useEffect : useLayoutEffect;

export function AmountStep({
	api,
	config,
	head,
	hidden,
	missing,
	amountProblem,
	refusal,
	unpriced,
	refusedAmount,
	unitOpen,
	onPill,
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
	refs,
	drawsProgram,
	amountLabels
}: AmountStepProps) {
	const { locale, currency } = config;
	const offer = (minor: number) => formatOffer(minor, locale, currency);

	const busy = api.continueButton['aria-busy'];
	const missingAmount = missing.includes('amount');
	const missingNote = missing.includes('note');
	const noteAsked = api.noteToggle.pressed === true;
	const noteShown = api.notePublicToggle.pressed === true;
	const noteAnonymous = api.noteAnonymousToggle.pressed === true;
	const amountWords = missingAmount ? amountProblem : refusal !== '' ? refusal : unpriced;
	const amountDescribed = amountWords === '' ? undefined : 'amount-problem';
	// what the donor gives, as `connect` words it: a coin or a share count takes one box in the tiles'
	// place (`unitEntry` is null on a gift in the currency), and a refusal of its amount is marked on
	// that box the way a missing one is. a missing one is marked with no sentence, and a coin amount
	// priced outside the bounds with the bounds sentence, which is the currency's (`AmountDecision` in
	// @better-giving/form/value). a coin amount whose price check failed is described by `unpriced`.
	const { pill, entry: unitEntry, cadenceNote, next } = api.unit;
	// the box is described by its estimate in words while one is drawn, and by the refusal beside it.
	const quantityDescribed =
		[
			...(unitEntry?.estimateDescription ? ['amount-estimate'] : []),
			...(amountDescribed === undefined ? [] : [amountDescribed])
		].join(' ') || undefined;
	const quantityRefused =
		unitEntry !== null && (missing.includes('quantity') || missingAmount || refusedAmount);
	// a coin the account no longer takes is fixed on the pill, where its arrival puts the caret.
	const coinRefused =
		api.state.step === 'amount' && api.state.coinRefusal?.code === 'coin_not_accepted';
	/** the Continue toward the payment step, or `null` on a gift in kind, which chooses no method. */
	const toPayment = next.case === 'in-kind' ? null : next;

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
	const choosesProgram = drawsProgram && api.programSelect.options.length > 1;

	// two marks, one at each end of the box: the symbol in front of the figure and the code behind
	// it. the leading one is conditional and the trailing one is not — `en-US` writes `CHF` as `CHF`,
	// and a card drawing that at both ends states the currency twice.
	const symbol = currencySymbol(locale, currency);
	const code = currency.toUpperCase();

	const track = useRef<HTMLDivElement | null>(null);
	const chips = useRef<(HTMLLabelElement | null)[]>([]);
	/** where the chip stood after the last pass, so a move along a row is told from a move across a wrap. */
	const chipAt = useRef<{ x: number; y: number } | null>(null);
	/** a pointer went down on Other and the change it brings has not arrived yet. */
	const pointed = useRef(false);
	const tray = useRef<HTMLDivElement | null>(null);

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

		if (!chooses) return;
		placeThumb(false);

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
				placeThumb(true);
			});
		};
		window.addEventListener('resize', rewrapped);
		return () => {
			window.removeEventListener('resize', rewrapped);
			if (frame !== 0) window.cancelAnimationFrame(frame);
		};
	});

	// the estimate in the box's trailing group, or under the box where the typed amount and it
	// cannot share it, on the form's terms (`placeFigure` in packages/form/src/views.ts). the box's
	// own `scrollWidth` cannot say which: the page draws the form's `[data-figure='inside']` rules,
	// so the input is a flex item beside its marks and scrolls a value too long for it under them
	// rather than reporting it. what is measured instead is the value's width on one line, set in
	// the box's own face, against the room the tile's content box leaves once the row's gap, the
	// figure and the unit are taken out of it. placed before paint, again on every resize, and once
	// the document's faces have loaded — an unloaded face's string reads as loaded and its width is
	// the fallback face's — read and written in one pass so no frame paints the trial.
	const textWidth = (box: HTMLInputElement): number | null => {
		const line = document.createElement('canvas').getContext('2d');
		if (box.value === '' || line === null) return 0;
		if (document.fonts?.status === 'loading') return null;
		const face = getComputedStyle(box);
		line.font = `${face.fontWeight} ${face.fontSize} ${face.fontFamily}`;
		return line.measureText(box.value).width;
	};
	const rowRoom = (
		row: HTMLElement,
		box: HTMLInputElement,
		marks: readonly HTMLElement[]
	): number => {
		const face = getComputedStyle(row);
		const sides = (start: string, end: string): number =>
			(Number.parseFloat(face.getPropertyValue(start)) || 0) +
			(Number.parseFloat(face.getPropertyValue(end)) || 0);
		const taken = marks.reduce((width, mark) => width + mark.getBoundingClientRect().width, 0);
		const inset =
			sides('padding-inline-start', 'padding-inline-end') +
			sides('border-inline-start-width', 'border-inline-end-width');
		return (
			row.clientWidth - taken - inset - (Number.parseFloat(face.columnGap) || 0) * marks.length
		);
	};
	let measuring = document.fonts?.status === 'loading';
	useMeasure(() => {
		const placeFigure = (): void => {
			const node = tray.current;
			const input = refs.quantity.current;
			const figure = node?.querySelector<HTMLElement>('.adorn-figure') ?? null;
			if (node === null || input === null) return;
			if (figure === null || figure.hidden) {
				node.removeAttribute('data-figure');
				return;
			}
			node.setAttribute('data-figure', 'inside');
			const unit = node.querySelector<HTMLElement>('.adorn-unit');
			const tile = input.closest<HTMLElement>('[part~="amount-input"]');
			if (unit === null || tile === null) return;
			const amount = textWidth(input);
			if (amount === null) {
				node.removeAttribute('data-figure');
				if (!measuring) return;
				document.fonts.ready.then(() => {
					measuring = false;
					placeFigure();
				});
				return;
			}
			const figureWidth = figure.getBoundingClientRect().width;
			if (amount + figureWidth > rowRoom(tile, input, [figure, unit])) {
				node.setAttribute('data-figure', 'below');
			}
		};
		placeFigure();
		let frame = 0;
		const rewrapped = (): void => {
			if (frame !== 0) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				placeFigure();
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
								{/*
								 * a repeating cadence a gift in kind does not take is still a control: it keeps
								 * its place and its press, which the flow refuses, and says why through the note.
								 */}
								<input
									type="radio"
									name={api.frequencyGroup.name}
									value={String(option.value)}
									checked={option.checked}
									aria-disabled={option.unavailable === true ? true : undefined}
									aria-describedby={option.unavailable === true ? 'cadence-note' : undefined}
									onChange={option.onChange}
								/>
								<span>{option.label ?? String(option.value)}</span>
							</label>
						))}
					</div>
					{cadenceNote === null ? null : (
						<p className="unit-note" id="cadence-note">
							{cadenceNote}
						</p>
					)}
				</fieldset>
			) : null}

			{/*
			 * no `radiogroup` role, and the difference is the free entry: this group holds a text box
			 * beside its radios, which is not what that role describes. the invalid state is carried by
			 * the box itself, where the role does support it, and the sentence reaches the group through
			 * `aria-describedby`, which is global and works on the role a fieldset already has.
			 *
			 * a key pressed anywhere in the group spends a pointer press that selected nothing — one
			 * dragged off the tile, or on Other already chosen — so a later arrow onto Other is not taken
			 * for it.
			 */}
			<fieldset
				className="group"
				ref={refs.group}
				aria-labelledby="amount-label"
				aria-describedby={amountDescribed}
				onKeyDown={() => {
					pointed.current = false;
				}}
			>
				{/*
				 * the How much line: the words at its start and what the donor gives at its end — the unit
				 * pill, or the currency's code as plain text where it is the one unit offered. a line of
				 * its own rather than the fieldset's legend, which would take the pill's words into the
				 * group's name; the group is named by the words alone. the unit panel's host is placed
				 * after the pill once the card is live (../unit-panel.ts).
				 */}
				<div className="amount-head" ref={refs.line}>
					<span part={part('label')} id="amount-label">
						{copy.HOW_MUCH}
					</span>
					{pill.state === 'text' ? (
						<span className="unit-text">{pill.code}</span>
					) : (
						<UnitPillButton
							pill={pill}
							open={unitOpen}
							onPress={onPill}
							buttonRef={refs.pill}
							describedBy={coinRefused && amountWords !== '' ? 'amount-problem' : undefined}
						/>
					)}
				</div>
				{unitEntry !== null ? (
					<>
						<div className="tiles bare" ref={tray}>
							<div
								part={partWhen('amount-input', { invalid: quantityRefused })}
								className="tile entry"
							>
								<input
									{...api.quantityField.box}
									id="quantity-entry"
									ref={refs.quantity}
									type="text"
									inputMode="decimal"
									autoComplete="off"
									aria-invalid={quantityRefused ? true : undefined}
									aria-describedby={quantityDescribed}
								/>
								<span className="adorn-trail" aria-hidden="true">
									<span className="adorn-figure" hidden={unitEntry.estimate === null}>
										{unitEntry.estimate ?? ''}
									</span>
									<span className="adorn-unit">{unitEntry.unitLabel}</span>
								</span>
							</div>
							<p className="unit-figure" aria-hidden="true" hidden={unitEntry.estimate === null}>
								{unitEntry.estimate ?? ''}
							</p>
						</div>
						<label part={part('label')} className="vh" htmlFor="quantity-entry">
							{unitEntry.name}
						</label>
						<span className="vh" id="amount-estimate">
							{unitEntry.estimateDescription ?? ''}
						</span>
					</>
				) : (
					<>
						<div className={tiled ? 'tiles' : 'tiles bare'}>
							{tiled
								? api.amountGroup.options.map((option) => (
										<label
											key={String(option.value)}
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
											{amountLabels?.[String(option.value)] ? (
												<span className="amount-label">{amountLabels[String(option.value)]}</span>
											) : null}
										</label>
									))
								: null}
							{tiled ? (
								<label
									className="other"
									part={partWhen('amount-option', { selected: otherHolds, invalid: missingAmount })}
									onPointerDown={() => {
										pointed.current = true;
									}}
								>
									<input
										type="radio"
										name={api.amountGroup.name}
										value=""
										checked={otherHolds}
										onChange={() => {
											const via = pointed.current ? 'pointer' : 'keyboard';
											pointed.current = false;
											onOther(via);
										}}
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
								 * only while the sentence under the group stands — a missing or out-of-range figure:
								 * a description written here otherwise would be read whether the sentence is on
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
									aria-describedby={amountDescribed}
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
					</>
				)}
				<p className="message" id="amount-problem" hidden={amountWords === ''}>
					{amountWords}
				</p>
			</fieldset>

			{choosesProgram ? (
				<Choice
					id="program"
					label={copy.PROGRAM}
					choice={api.programSelect}
					className="field-row program"
				/>
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
						className={REGISTRY_CLASS.checkbox}
						type="checkbox"
						checked={noteAsked}
						onChange={onNoteToggle}
					/>
					<span>
						{copy.ADD_A_NOTE}
						<span className="optional">{copy.OPTIONAL}</span>
					</span>
				</label>
				<div className="disclosure-body" hidden={!noteAsked}>
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
							className={REGISTRY_CLASS.field}
							aria-invalid={missingNote ? true : undefined}
							aria-describedby={missingNote ? 'note-problem' : undefined}
						/>
						<p className="message" id="note-problem" hidden={!missingNote}>
							{copy.NOTE_PROBLEM}
						</p>
						{/*
						 * each row is in the tree only while the flow says it applies, the first while the
						 * note is open and the second while the first is ticked, and each is its own child so
						 * the second arriving leaves the first's box, and its focus, where it was. the hint
						 * sits inside the label so pressing it ticks the box; a wrapping label names its box
						 * by its whole subtree, so `aria-labelledby` names it by its words alone and the
						 * hint is read once, as the description, ticked Anonymous or not; only its words
						 * change, to the name the note will be signed with.
						 */}
						{/* biome-ignore lint/a11y/useSemanticElements: the rows are a group named by the first
						    one's words, so "Show it as Anonymous" is read as qualifying that box, as the
						    element's `noteConsent` (packages/form/src/views.ts) is; a `<fieldset>` brings a
						    border, padding and `min-inline-size` the form's `.consent`
						    (packages/form/src/styles/layout.css) would have to undo. */}
						<div className="consent" role="group" aria-labelledby="note-public-words">
							{noteAsked ? (
								<label className="check-row">
									<input
										part={part('checkbox')}
										className={REGISTRY_CLASS.checkbox}
										type="checkbox"
										id="note-public"
										aria-labelledby="note-public-words"
										aria-describedby="note-public-hint"
										checked={noteShown}
										onChange={() => api.notePublicToggle.onClick()}
									/>
									<span>
										<span id="note-public-words">{copy.notePublicLabel(config.orgLegalName)}</span>
										<small className="hint" id="note-public-hint">
											{noteAnonymous
												? copy.notePublicHintAnonymous(config.orgLegalName)
												: copy.NOTE_PUBLIC_HINT}
										</small>
									</span>
								</label>
							) : null}
							{noteShown ? (
								<label className="check-row sub">
									<input
										part={part('checkbox')}
										className={REGISTRY_CLASS.checkbox}
										type="checkbox"
										id="note-anonymous"
										checked={noteAnonymous}
										onChange={() => api.noteAnonymousToggle.onClick()}
									/>
									<span>{copy.NOTE_ANONYMOUS}</span>
								</label>
							) : null}
						</div>
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
						className={REGISTRY_CLASS.checkbox}
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
						<Choice
							id="tribute-kind"
							label={copy.TRIBUTE_KIND_LABEL}
							hideLabel
							choice={api.tributeKindSelect}
							className="dedication"
						>
							<TributeBox
								id="tribute-honoree"
								label={copy.TRIBUTE_HONOREE_LABEL}
								placeholder={copy.TRIBUTE_HONOREE_PLACEHOLDER}
								sentence={copy.TRIBUTE_HONOREE_PROBLEM}
								field={api.tributeHonoreeField}
								wrong={missing.includes('tribute-honoree')}
								inputRef={refs.honoree}
							/>
						</Choice>

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
										sentence={
											api.tributeNotifyEmailField.box.value.trim() === ''
												? copy.NOTIFY_EMAIL_PROBLEM
												: copy.NOTIFY_EMAIL_MALFORMED
										}
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

			{/*
			 * the Continue's case (`continueCase` in @better-giving/form/unit): toward the payment step it
			 * is headed by the eyebrow, named for where it goes and described by the methods there; a gift
			 * in kind, a coin or a stock, chooses no payment method and it is a plain Continue. the wrapper
			 * stands the eyebrow over the button, the inside step apart (`.next` in
			 * packages/form/src/styles/layout.css).
			 */}
			<div className="next">
				{toPayment === null ? null : <p className="eyebrow">{toPayment.eyebrow}</p>}
				<button
					part={partWhen('action', { busy })}
					className={REGISTRY_CLASS.action}
					type={submits ? 'submit' : 'button'}
					aria-busy={busy}
					aria-label={toPayment?.name}
					aria-describedby={toPayment === null ? undefined : 'continue-methods'}
					data-next={toPayment === null ? undefined : 'payment'}
					onClick={onContinue}
				>
					<span className="action-label">{next.label}</span>
					{/* where the payment methods' circles stand once they are decided; empty, so hidden. */}
					<span className="method-marks" aria-hidden="true" hidden />
					<span className="ds-spinner" aria-hidden="true" />
				</button>
				{toPayment === null ? null : (
					<span className="vh" id="continue-methods">
						{toPayment.description}
					</span>
				)}
			</div>
		</section>
	);
}

/**
 * the unit pill: the code, then the marks of what it stands for in the registry's 14px avatar stack
 * (avatar-css.usage.md, `ds-avatar-xs` in a `ds-avatar-group`), decorative inside a control named
 * by its own `aria-label` (`unitPill` in @better-giving/form/unit). drawn as the element draws it
 * (`unitPillButton` in packages/form/src/views.ts), so its look is that file's sheets'.
 */
function UnitPillButton({
	pill,
	open,
	onPress,
	buttonRef,
	describedBy
}: {
	readonly pill: UnitPill;
	readonly open: boolean;
	readonly onPress: () => void;
	readonly buttonRef: RefObject<HTMLButtonElement | null>;
	readonly describedBy: string | undefined;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className="unit-pill"
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-label={pill.name}
			aria-describedby={describedBy}
			onClick={onPress}
		>
			<span className="unit-code">{pill.code}</span>
			{pill.marks.length === 0 ? null : (
				<span className="ds-avatar-group" aria-hidden="true">
					{pill.marks.map((mark) => (
						<UnitDisc key={mark.src} mark={mark} />
					))}
				</span>
			)}
		</button>
	);
}

/**
 * a 14px disc holding one mark. a coin's logo is the processor's, so it is fetched lazily and with no
 * referrer, as the panel fetches it. xs draws no letter (avatar-css.usage.md), so an image that fails
 * takes its disc with it — including one that failed in the server render, before hydration put
 * the `error` listener on it. `decode()` rejects for a broken image whenever it broke, where
 * `naturalWidth` is no test: an SVG with no intrinsic size reads 0 once loaded.
 */
function UnitDisc({ mark }: { readonly mark: UnitMark }) {
	const [failed, setFailed] = useState(false);
	const image = useRef<HTMLImageElement | null>(null);
	useEffect(() => {
		let mounted = true;
		image.current?.decode().catch(() => {
			if (mounted) setFailed(true);
		});
		return () => {
			mounted = false;
		};
	}, []);
	if (failed) return null;
	const remote = mark.mark === 'logo';
	return (
		<span className="ds-avatar ds-avatar-xs">
			<img
				ref={image}
				className="ds-avatar-img"
				alt=""
				decoding="async"
				src={mark.src}
				loading={remote ? 'lazy' : undefined}
				referrerPolicy={remote ? 'no-referrer' : undefined}
				onError={() => setFailed(true)}
			/>
		</span>
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
				className={REGISTRY_CLASS.field}
				aria-invalid={wrong ? true : undefined}
				aria-describedby={wrong ? problemId : undefined}
			/>
			<p className="message" id={problemId} hidden={!wrong}>
				{sentence}
			</p>
		</>
	);
}
