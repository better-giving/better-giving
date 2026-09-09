import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import type { MouseEventHandler, ReactNode } from 'react';
import { majorEntry } from '$lib/forms/amounts';
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
// a row is a box with a name of its own, so it is refused under itself. `suggestedAmountsRule` in
// `$lib/forms/input-schema.ts` keys an offending amount to `suggested_amounts[1]`, which is the
// second row's input, and that row draws the sentence under its own box. the one sentence keyed to
// the bare group name is the cap on how many amounts there may be, because a list holding too many
// is a fact about no one row — so the message under the group is that one and never another.
//
// every box in this group is the library's `Field`, and the group's own geometry — the row and the
// control that removes it — is written out of the classes packages/operator/src/styles/adm.css
// already draws rather than mounted from the library's `RepeatingRows`
// (packages/operator/src/components/forms/RepeatingRows.jsx). two things that component decides for
// itself are decided by the form here, and either one alone is why:
//
// it mints its own Add and Remove, and each submits a position — an index under `removeName`, and
// an Add carrying no name at all. these rows are a conform list, so adding and removing are that
// form's own intents, minted by the form and handed in as button props by the screen holding it; a
// control submitting a position instead would move no row and the press would do nothing.
//
// and it keys every row by the row's id, which here is the row's *position*:
// `form-create-suggested_amounts[1]` is whichever row is second right now. keyed by that, a removed
// row leaves react re-using the box below it for the row that took its place — see `AmountRow`
// below, which is why a row carries a `key` the form minted as well as an id.
//
// nothing new is drawn and no value is stated.
//
// each bound draws its own message, under its own box: `parseFormGiving` keys every sentence to the
// box whose label it names, the two bounds being the right way round included. every box in this
// group is bound the same way, the amounts' rows included.

/**
 * one control that changes the boxes rather than the record.
 *
 * the four attributes conform's own `getButtonProps` writes, stated here rather than imported as
 * `ButtonHTMLAttributes`: the library's `Button` takes the union of a button's attributes and an
 * anchor's, so the whole of one of those two is not assignable to it — and what a caller actually
 * has to hand over is these four.
 */
type IntentButton = {
	readonly name: string;
	readonly value: string;
	readonly form: string;
	readonly formNoValidate: boolean;
	/** a press the form withholds the intent on — `insertWhenValid` in ../use-admin-form.ts. */
	readonly onClick?: MouseEventHandler<HTMLButtonElement>;
};

/**
 * one amount box, plus the identity the form gives its row.
 *
 * `key` and not `id`. a box's `id` is composed from its name, so it is the row's *position* —
 * `form-create-suggested_amounts[1]` is whichever row is second right now. reconciled by that, a
 * removed row leaves react re-using the box below it for the row that took its place: the box is
 * uncontrolled, so it keeps the figure already typed into it and the group ends up showing an
 * amount the form no longer holds. `key` is minted per row and travels with it.
 */
type AmountRow = Box & {
	/** the row's own identity, as the form minted it when the row appeared. */
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
	/** the control that adds an empty row at the end, as the form states it. */
	readonly add: IntentButton;
	/** the control that drops one row, as the form states it for that position. */
	readonly remove: (index: number) => IntentButton;
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
	const capError = amounts.errors?.[0];

	const capErrorId = boxErrorId(amounts.id);
	const suggestedHintId = `${amounts.id}-hint`;

	// every figure drawn here goes through `$lib/forms/amounts.ts`, the module the save is parsed
	// by: the boxes take money the way a fundraiser writes it and the row stores integers.
	//
	// one tile a fundraiser would plausibly offer, written the way a box takes it. one and not three,
	// because there is one box per amount — a placeholder listing three would read as three amounts
	// to type into one box. `majorEntry` and not the padded `majorText`, so the ghost figure is the
	// keystrokes an operator would actually make: `50`, not `50.00`.
	const suggestedExample = majorEntry(5000, currency);

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
				<fieldset className="adm-fieldset">
					<legend className="adm-fieldset__legend">Gift bounds</legend>

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
							error={
								boxes.max_minor.errors?.[0] === undefined ? undefined : (
									<MarkedText text={boxes.max_minor.errors[0]} />
								)
							}
						/>
					</div>
				</fieldset>

				{/* a fieldset rather than a labelled box, because the amounts are a repeating row
				    editor: the legend names the group, and the one message belonging to the group
				    rather than to a row is the cap on how many amounts there may be. */}
				<fieldset className="adm-fieldset" aria-describedby={capError ? capErrorId : undefined}>
					<legend className="adm-fieldset__legend">{FORM_FIELD_LABELS.suggested_amounts}</legend>

					{/* each one is a button on a card a donor reads on a phone. neither the unit nor how
					    an amount is written is stated here: one box takes one amount and the
					    placeholder shows the shape, and `amountRule` in `$lib/forms/amounts.ts` ends
					    every sentence one of these boxes is refused with. */}
					<p className="adm-hint" id={suggestedHintId}>
						A donor sees these in the order you write them, and can still give any amount within the
						bounds.
					</p>

					<div className="adm-rows">
						{amounts.rows.map((row, index) => (
							// keyed by the row's own key rather than by position: the form is what says
							// which row is which as boxes are added and removed, and a key that was the
							// position would carry a half-typed figure onto the row that took its place
							// — see `AmountRow` above. the id is the fallback and is positional, which
							// is only ever reached by a row the form minted no key for.
							<div className="adm-rows__row" key={row.key ?? row.id}>
								{/* no label on the row: the legend above names the group and the box says
								    which row it is to a screen reader, so a label element here would be
								    an empty one.

								    bound the way every other box on these screens is, which is what
								    keys the refusal to the row: the message under this box is this
								    row's own and the mark on it is that message's, so a row nobody
								    was refused about reads as fine beside one that was. the standing
								    hint describes every row and is composed in rather than replacing
								    the message's id (../use-admin-form.ts).

								    the sentence goes over as a node for the reason the bounds' do —
								    a marked value is drawn as code rather than shown with the marks
								    in it. */}
								<Field
									className="adm-num"
									inputMode="decimal"
									placeholder={suggestedExample}
									aria-label={`Suggested amount ${index + 1}`}
									{...boxProps(row, { describedBy: suggestedHintId })}
									error={
										row.errors?.[0] === undefined ? undefined : <MarkedText text={row.errors[0]} />
									}
								/>
								{/* a lone row draws no Remove: with one box left there is nothing to
								    choose between, and a control that would leave the group empty is one
								    the group has no state for. it comes back on every row the moment
								    there are two.

								    the quiet rank, because it repeats: a bordered control beside every
								    box draws a column of boxes down the side of a group of boxes, and
								    the row a reader is working in is the box rather than the control
								    that drops it.

								    the visible word is the same on every row, which is right beside the
								    box it acts on and useless in a list of controls read out of context
								    — so each says which row it is to a screen reader and nothing extra
								    on the screen. */}
								{amounts.rows.length > 1 ? (
									<Button
										variant="quiet"
										mark="trash-2"
										aria-label={`Remove suggested amount ${index + 1}`}
										{...amounts.remove(index)}
									>
										Remove
									</Button>
								) : null}
							</div>
						))}
					</div>

					{capError ? (
						<FieldMessage id={capErrorId}>
							<MarkedText text={capError} />
						</FieldMessage>
					) : null}

					<div className="adm-actions">
						<Button mark="plus" {...amounts.add}>
							Add an amount
						</Button>
					</div>
				</fieldset>
			</div>

			{footer ? <div className="adm-actions">{footer}</div> : null}
		</>
	);
}
