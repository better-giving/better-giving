import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { useMemo, useRef, useState } from 'react';
import { networkTint } from '../../network-tint';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * one coin the list offers.
 *
 * the code is the value: it is what is stored and what the processor is asked for. the ticker is
 * what the row draws, because the ticker and the network are how the processor's own dashboard
 * names the coin an operator is holding this list up against — so `usdcmatic` is stored and `usdc`
 * over a `matic` pill is read. the name is on the option for two readings that are not a row — a
 * search still finds the coin by it, and its first letter is the lettered mark a missing logo falls
 * back to — and is drawn nowhere, because it says again what the ticker and the network already
 * say and a two-word name pushed the row onto a third line for nothing.
 *
 * @typedef {object} Coin
 * @property {string} code
 * @property {string} ticker the coin's own symbol, in the processor's spelling — one ticker over
 *   every network the coin is carried on. empty where the list this coin came from named none, and
 *   where nothing is known about the coin but its code, which is the one case the row draws the
 *   code instead.
 * @property {string} name
 * @property {string} network the chain, in the processor's own spelling. empty where the list this
 *   coin came from named none, which is the one case the pill is not drawn at all.
 * @property {string} logo the processor's own picture of the coin, and the empty string where the
 *   list carried none — one spelling of absent rather than two, because the list this is built from
 *   sends a coin with no picture as a coin whose picture is empty.
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: every describing block on this control is
 * named from it, so one without an id hands the browser a description nothing points at. it is
 * also the id the box is found by when a refusal moves focus, which is why it lands on the search
 * field and not on the box around it.
 *
 * `label` is stated rather than optional, which is the one place this control is narrower than
 * ./SelectWithNote.jsx. the machine names its list off a label element it expects to exist, so a
 * control drawn without one leaves the list pointing at an id nothing answers to.
 *
 * @typedef {object} CoinPickerOwnProps
 * @property {string} id
 * @property {string} name what the chosen code is submitted under.
 * @property {ReactNode} label
 * @property {ReactNode} [hint] the sentence read before choosing, drawn where ./Field.jsx draws its
 *   own: over the box, in the quiet register.
 * @property {ReactNode} [note] the standing sentence — a coin that should be here is missing and
 *   this says why. it is not a refusal and takes the same register ./Field.jsx's `needed` does.
 * @property {ReactNode} [error] what the last press answered with.
 * @property {readonly Coin[] | undefined} [options]
 * @property {Coin | undefined} [retired] a coin no longer offered, kept until another is chosen.
 * @property {string | undefined} [defaultValue] the code chosen when the control is first drawn.
 * @property {string | undefined} [placeholder] what the closed box asks while nothing is chosen.
 * @property {boolean | undefined} [disabled]
 * @property {((code: string) => void) | undefined} [onChoose] a coin was picked. the code is handed
 *   over because a caller that ends a sentence about this box on an edit has to know an edit
 *   happened, and one that wants the value has it without reading the document.
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached, for
 *   ./Field.jsx's reason. unavailable is not one of them for its reason either: the sheet draws
 *   `.adm-coinbox[data-disabled]` with no twin beside it, so a control that cannot be used takes
 *   the `disabled` above through the machine.
 * @property {string | undefined} [className]
 */

/**
 * `aria-invalid` marks the control refused by a rule that belongs to something larger than this one
 * box, alongside whatever message that larger thing holds. it is written as an intersection because
 * a hyphenated name is not a JSDoc `@property`.
 *
 * @typedef {CoinPickerOwnProps & { 'aria-invalid'?: boolean | 'true' | 'false' | undefined }} CoinPickerProps
 */

/**
 * a coin's first line: its own ticker, and its code where there is no ticker to draw.
 *
 * the fallback is one rule over two coins that are nothing alike — a listed coin the processor
 * named no ticker for, and one the caller knows nothing about but the code the deployment holds —
 * because what they have in common is the whole of what the row needs: the code is the only name
 * either of them has.
 *
 * @param {Coin} coin
 */
const first = (coin) => (coin.ticker === '' ? coin.code : coin.ticker);

/** what the open box asks. the closed one asks the caller's `placeholder`. */
const SEARCH = 'Search by ticker, code, name or network';

/** what a coin the account no longer lists says under its own pill. */
const RETIRED = 'No longer offered';

/** nothing chosen, as one value: a new empty array every render would be a new choice every render. */
const NONE = /** @type {string[]} */ ([]);

/*
 * the payout coin, chosen out of a list an operator searches rather than a list they scroll.
 *
 * **it is ./SelectWithNote.jsx's control with a different list.** the label, the hint, the standing
 * note, the refusal, the coin no longer offered and the describing blocks named off the id are all
 * that file's and behave exactly as they do there — what is different is that the choice is two
 * hundred coins an operator is matching one of against a dashboard in another window, which is a
 * native select's worst case.
 *
 * **the row is a mark and two lines**: the ticker on the first, the network's pill on the second,
 * and the closed box reads the same way along one line. the arrangement is the donation form's
 * (packages/form/src/coin-picker.ts), rebuilt here rather than shared: the two are separate design
 * systems and neither imports the other's sheet, its tokens or its tint (.claude/CLAUDE.md).
 *
 * the machine is ark's combobox, and everything it already answers for is left to it: the listbox
 * roles, `aria-activedescendant`, the arrow keys, Enter, Escape and the dismissal. what is stated
 * here is the filter, because the list is handed down rather than fetched, and the value, because
 * the machine puts its `name` on the search field — whose value is what was typed and not what was
 * chosen.
 *
 * **the chosen code is submitted by a hidden input and by nothing else.** it is the one element on
 * the control carrying the name, so `element.elements.namedItem(name)` finds one control and the
 * body carries one value.
 *
 * that box is then made to say it changed, which is the one thing a `<select>` did for free. a
 * value react writes fires no event, and both layers that read this form are counting the events
 * its boxes fire — the one that arms the save button
 * (`useSavedFormState` in packages/operator/src/saved-form-state.react.ts) and conform's own
 * listener under it — so a choice that stayed silent would be a stored coin under a button nothing
 * could press. the value is put on the element before the event rather than waited for, because a
 * listener reads the element it was handed and react has not re-rendered yet.
 *
 * **what a hidden box cannot do is take focus**, and one form layer moves focus by name: conform
 * walks `form.elements` for the name it holds an error for and calls `focus()` on what it finds, so
 * a refusal its own pass raises about this box moves nothing and leaves the operator at the press.
 * a caller that moves focus by the `id` above reaches the search field and is unaffected — which is
 * how this console's own answers land (`boxId` in
 * packages/console-ui/src/lib/use-console-form.ts).
 */
/** @param {CoinPickerProps} props */
export function CoinPicker({
	id,
	name,
	label,
	hint,
	note,
	error,
	options = [],
	retired,
	defaultValue = '',
	placeholder,
	disabled,
	onChoose,
	state,
	className,
	'aria-invalid': stated
}) {
	const refused = error ? true : stated === true || stated === 'true';

	/** the coin no longer offered is last, the way ./SelectWithNote.jsx appends it. */
	const coins = useMemo(
		() => (retired === undefined ? options : [...options, retired]),
		[options, retired]
	);

	const posted = useRef(/** @type {HTMLInputElement | null} */ (null));
	const [chosen, setChosen] = useState(defaultValue);
	/* the seed the control was last drawn against. a form seeded from the deployment is redrawn
	   with a new one whenever a write lands, and the choice on screen has to follow it there rather
	   than stand as whatever was picked against the reading before it. the hidden box follows with
	   it, being drawn from the same value. */
	const [seed, setSeed] = useState(defaultValue);
	if (seed !== defaultValue) {
		setSeed(defaultValue);
		setChosen(defaultValue);
	}

	/* what has been typed into the box, which is the whole of the filter. it is taken off the
	   machine rather than kept beside it, so the clearing the machine does on a choice and on a
	   dismissal puts the list back with nothing here to remember to do. */
	const [typed, setTyped] = useState('');
	/* the box leads with a search glyph while open and with the chosen coin's mark while closed, and
	   asks two different things in the two states. the sheet picks between the two marks off the
	   machine's own state attribute; the placeholder is a value rather than a rule, so it is read
	   off the state here. */
	const [open, setOpen] = useState(false);

	const shown = useMemo(() => {
		const query = typed.trim().toLowerCase();
		if (query === '') return coins;
		/* the code is searched alongside the ticker rather than behind it: it is what the deployment
		   stores and what an operator pastes back in out of a var, and a list answering nothing to it
		   would be a list that cannot find the coin already chosen. */
		return coins.filter((coin) =>
			[first(coin), coin.code, coin.name, coin.network].some((text) =>
				text.toLowerCase().includes(query)
			)
		);
	}, [coins, typed]);

	const collection = useMemo(
		() =>
			createListCollection({
				items: shown,
				itemToValue: (coin) => coin.code,
				/* every word a search is answered on is in the string the machine stringifies a coin by, so
				   a coin found by its code or its name is found by the machine's own reading of it too. */
				itemToString: (coin) => `${first(coin)} ${coin.code} ${coin.name} ${coin.network}`
			}),
		[shown]
	);

	const picked = coins.find((coin) => coin.code === chosen);
	/* the chosen coin leads the description, because the box itself does not carry it: the search
	   field is emptied by a choice, so a reader landing on a closed box with a coin in it would
	   otherwise hear the label and an empty value. what is read is the words the box is drawing —
	   the ticker and the network — and never a second string composed for the purpose. */
	const describedBy =
		[
			picked === undefined ? null : `${id}-chosen`,
			hint ? `${id}-hint` : null,
			error ? `${id}-err` : null,
			note ? `${id}-note` : null
		]
			.filter(Boolean)
			.join(' ') || undefined;

	return (
		<div className="adm-field">
			<label className="adm-field__label" htmlFor={id} id={`${id}-label`}>
				{label}
			</label>
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			{/* the value the form carries. it is disabled with the control, which is what a `<select>`
			    does by itself: a box an operator cannot answer sends nothing, and the press is refused
			    as blank rather than storing a coin nobody chose. */}
			<input type="hidden" name={name} value={chosen} disabled={disabled} ref={posted} />
			<Combobox.Root
				className="adm-coinwrap"
				collection={collection}
				ids={{ input: id, label: `${id}-label` }}
				disabled={disabled}
				invalid={refused}
				value={chosen === '' ? NONE : [chosen]}
				placeholder={open ? SEARCH : picked === undefined ? placeholder : ''}
				/* the whole box opens the list, which is what makes the mark and the pill inside it part
				   of the affordance rather than decoration standing next to one. */
				openOnClick
				/* the box is emptied by a choice and by a dismissal, so what is in it is always a search
				   and never a value being edited — the chosen coin is drawn over it instead. */
				selectionBehavior="clear"
				onOpenChange={(details) => setOpen(details.open)}
				onInputValueChange={(details) => setTyped(details.inputValue)}
				onValueChange={(details) => {
					const next = details.value[0] ?? '';
					const element = posted.current;
					if (element !== null) {
						element.value = next;
						element.dispatchEvent(new Event('input', { bubbles: true }));
					}
					setChosen(next);
					onChoose?.(next);
				}}
			>
				<Combobox.Control
					className={['adm-coinbox', state ? `is-${state}` : '', className]
						.filter(Boolean)
						.join(' ')}
				>
					<span className="adm-coinbox__lead">
						<Mark name="search" className="adm-coinbox__glyph adm-coinbox__search" />
						{picked === undefined ? null : <CoinMark coin={picked} />}
					</span>
					<span className="adm-coinbox__words">
						<Combobox.Input className="adm-coinbox__input" aria-describedby={describedBy} />
						{picked === undefined ? null : (
							<span className="adm-coinbox__chosen" id={`${id}-chosen`}>
								<CoinWords coin={picked} inline />
							</span>
						)}
					</span>
					<Combobox.Trigger className="adm-coinbox__caret">
						<Mark name="chevron-down" />
					</Combobox.Trigger>
				</Combobox.Control>
				<Combobox.Positioner>
					<Combobox.Content className="adm-coinlist">
						<Combobox.Empty className="adm-coinempty">No coin matches</Combobox.Empty>
						{shown.map((coin) => (
							<Combobox.Item className="adm-coinrow" key={coin.code} item={coin}>
								<CoinMark coin={coin} />
								<CoinWords coin={coin} />
								{retired !== undefined && retired.code === coin.code ? (
									<span className="adm-coinrow__note">{RETIRED}</span>
								) : null}
								<Combobox.ItemIndicator className="adm-coinrow__tick">
									<Mark name="check" />
								</Combobox.ItemIndicator>
							</Combobox.Item>
						))}
					</Combobox.Content>
				</Combobox.Positioner>
			</Combobox.Root>
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

/**
 * a coin's mark: the processor's own logo where the list carries one, standing in the round
 * lettered shape it falls back to.
 *
 * the picture is a third party's, and the fallback is what keeps a row whole without it: a request
 * that failed and a path that stopped resolving both end at `error`, which takes the image out and
 * leaves the letter under it showing. the row loses a picture and nothing else, because the
 * ticker beside it is what names the coin.
 *
 * lazy, and sized by the sheet rather than by the file: the list is closed until it is opened, so
 * nothing is fetched on the step the box is drawn on, and a row stands at the same height before
 * and after its image arrives. the referrer is withheld because the address of a console an
 * operator is running is not the processor's to learn from a picture on it.
 *
 * @param {{ coin: Coin }} props
 */
function CoinMark({ coin }) {
	const [broken, setBroken] = useState(false);
	return (
		<span className="adm-coinmark" aria-hidden="true">
			<span className="adm-coinmark__initial">{coin.name.slice(0, 1).toUpperCase()}</span>
			{coin.logo === '' || broken ? null : (
				<img
					className="adm-coinmark__logo"
					src={coin.logo}
					alt=""
					loading="lazy"
					decoding="async"
					referrerPolicy="no-referrer"
					onError={() => setBroken(true)}
				/>
			)}
		</span>
	);
}

/**
 * the ticker and the network's pill, in two inks — drawn on two lines in a row of the list and
 * along one line in the closed box, which is the sheet's call and not this function's.
 *
 * the network's words are the processor's own and are drawn as they arrive; the pill's colour is
 * `networkTint` and no rule of this file's. a coin whose list named no network draws no pill: an
 * empty one is a shape with nothing in it.
 *
 * `inline` is what tells the two apart to the machine rather than to the sheet — the row's ticker
 * is the item's own text part, so the machine knows what it stringified, and the box's copy is not
 * an item at all.
 *
 * @param {{ coin: Coin, inline?: boolean }} props
 */
function CoinWords({ coin, inline }) {
	const pill =
		coin.network === '' ? null : (
			<span className="adm-netpill" data-tint={networkTint(coin.network)}>
				{coin.network}
			</span>
		);
	if (inline)
		return (
			<>
				<span className="adm-coinbox__ticker">{first(coin)}</span>
				{pill}
			</>
		);
	return (
		<span className="adm-coinrow__words">
			<Combobox.ItemText className="adm-coinrow__ticker">{first(coin)}</Combobox.ItemText>
			{pill}
		</span>
	);
}
