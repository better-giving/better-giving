import { Button } from '@better-giving/operator/components/controls/Button';
import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';
import { Field } from '@better-giving/operator/components/forms/Field';
import {
	RepeatingRows,
	type RowControl
} from '@better-giving/operator/components/forms/RepeatingRows';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type FormEvent, type ReactElement, useId, useRef, useState } from 'react';
import { FORM_CURRENCY, majorEntry, readAmount } from '$lib/forms/amounts';
import { REQUIRED } from '$lib/forms/input-schema';
import { BUYS_MAX, TIERS_MAX } from '$lib/page/catalog';
import type { Answer, Question, TierAnswer, TiersQuestion } from '$lib/page/questions';
import { MoneyField } from '../editor/money-field';

// the questions an asked turn puts to the operator, answered in one card: every question at once,
// all of them optional, sent by one press and skipped by the other. the same card at both widths —
// in the docked AI column and in the AI sheet (./ai-panel.tsx).
//
// a question arrives as the wire holds it ($lib/page/questions.ts), and every string in it is drawn
// as text. a choice is ChoiceChips' radios, several choices its checkboxes, and both end on an
// Other chip whose words are the answer — Other taken with nothing typed is no answer. an amount is
// read by the app's own amount parse ($lib/forms/amounts) into minor units of the form currency,
// its box starting on the question's prefill and showing its example, a date is the platform's
// date box, which hands back `YYYY-MM-DD`.
//
// a tiers question is repeating rows, each an amount and what it does, seeded from the question's
// rows and each row's example; the operator adds rows up to `TIERS_MAX` and drops them down to one.
// a row left empty is no tier, and the answer is the rows that are filled, in order. a row holding
// one half and not the other is refused at the empty half, and an amount a row above already holds
// at the second.
//
// the boxes are the form's and the card reads them once, on the press, from the form's own data;
// the amounts and the tiers' rows are held here, because a box refused on a press is re-read as it
// is typed until it clears, and a row is added and dropped without a round trip. a refused box
// sends nothing: its predicate stands under it and the focus goes into the first.
//
// while the answers are on their way (`busy`) both presses are held with `aria-disabled` rather
// than `disabled`, so the focus stays on the one pressed, and the boxes stay as typed.
//
// answers the route stored nothing from come back as `refusal`, said under the presses — the card
// is still up, every box as it was, and the focus still on the press that sent them, so that is
// where it is read. the region is on the card before it has anything to say, so it is announced
// when it does, and both presses are described by it while it speaks. a server's sentence marks a
// command or a name in backticks, which is drawn as code here as the chat log draws it.

/** one question, as the wire carries it. */
export type CardQuestion = Question;

/** one answer. a question left unanswered has none. */
export type CardAnswer = Answer;

/** an opening ask drafts the page; a later one updates it. */
export type QuestionRound = 'opening' | 'follow-up';

export interface QuestionCardProps {
	readonly questions: readonly CardQuestion[];
	readonly round: QuestionRound;
	/** the answers given, in the questions' order. the skip press sends none. */
	readonly onSubmit: (answers: readonly CardAnswer[]) => void;
	/** the answers are on their way. */
	readonly busy: boolean;
	/** the questions are the page's usual ones, asked because the AI did not answer. */
	readonly starter?: boolean | undefined;
	/** why the last answers sent were not taken, as a sentence the operator reads. */
	readonly refusal?: string | undefined;
}

const PRESSES = {
	opening: { send: 'Draft my page', skip: 'Skip, draft anyway' },
	'follow-up': { send: 'Update the page', skip: 'Just do your best' }
} as const;

/** what a card of the page's usual questions says above them. */
export const STARTER_NOTE =
	'The AI isn’t answering right now, so here are the usual questions. Your page is drafted once it’s back.';

/** what the Other chip's words are submitted under, which no question's id can be. */
const otherName = (id: string) => `${id}:other`;

/** one row of a tiers question as it is typed, `key` the row's own identity. */
type TierRow = {
	readonly key: string;
	readonly amount: string;
	readonly text: string;
	readonly example?: string | undefined;
};

/** what the card holds that the form's own data does not: the amount boxes and the tiers' rows. */
type Held = {
	readonly amounts: Readonly<Record<string, string>>;
	readonly tiers: Readonly<Record<string, readonly TierRow[]>>;
};

/** a question's answer as the card holds it, or none, and each box refused, by its id. */
type Read = {
	readonly answer: CardAnswer | null;
	readonly refused: Readonly<Record<string, string>>;
};

type HeldQuestion = Extract<CardQuestion, { kind: 'amount' | 'tiers' }>;

/** a tiers row's box ids, under the question's own: no question's id holds a `:`. */
const tierBox = (base: string, row: TierRow, half: 'amount' | 'text') =>
	`${base}:${row.key}:${half}`;

/** a tiers question's rows as the card first draws them: the question's own, and its examples. */
function seedRows(question: TiersQuestion): TierRow[] {
	return question.rows.map((row, at) => ({
		key: `asked-${at}`,
		amount: majorEntry(row.amount, FORM_CURRENCY),
		text: row.text ?? '',
		example: question.placeholders?.[at]
	}));
}

/**
 * an amount box's words as minor units, nothing for an empty box, or the predicate refusing it. a
 * `$` typed in front of the figure is the affix the box already states, so it is taken off rather
 * than refused.
 */
function readAmountBox(text: string): { minor: number | null; problem: string | null } {
	const figure = text.trim().replace(/^\$\s*/, '');
	if (figure === '') return { minor: null, problem: null };
	const read = readAmount(figure, FORM_CURRENCY);
	if (read.problem !== null) return read;
	if (read.minor === 0) return { minor: null, problem: 'must be more than $0' };
	return read;
}

/** a tiers question's filled rows, each empty half of a row and each repeated amount refused. */
function readTiers(
	rows: readonly TierRow[],
	base: string
): { value: TierAnswer[]; refused: Record<string, string> } {
	const value: TierAnswer[] = [];
	const refused: Record<string, string> = {};
	const holder = new Map<number, number>();
	for (const [at, row] of rows.entries()) {
		const amount = readAmountBox(row.amount);
		const text = row.text.trim();
		if (amount.minor === null && amount.problem === null && text === '') continue;
		const before = amount.minor === null ? undefined : holder.get(amount.minor);
		const problem =
			amount.problem ??
			(amount.minor === null
				? REQUIRED
				: before === undefined
					? null
					: `different from tier ${before + 1}`);
		if (problem !== null) refused[tierBox(base, row, 'amount')] = problem;
		if (text === '') refused[tierBox(base, row, 'text')] = REQUIRED;
		if (amount.minor === null) continue;
		if (before === undefined) holder.set(amount.minor, at);
		if (problem === null && text !== '') value.push({ amount: amount.minor, text });
	}
	return { value, refused };
}

/** the answer the card holds for an amount or a tiers question, refused where a box is wrong. */
function heldAnswerOf(question: HeldQuestion, held: Held, base: string): Read {
	const { id } = question;
	if (question.kind === 'tiers') {
		const { value, refused } = readTiers(held.tiers[id] ?? [], base);
		return { answer: value.length === 0 ? null : { id, value }, refused };
	}
	const read = readAmountBox(held.amounts[id] ?? '');
	if (read.problem !== null) return { answer: null, refused: { [base]: read.problem } };
	return { answer: read.minor === null ? null : { id, value: read.minor }, refused: {} };
}

/** the answer to one question, from the form's data or what the card holds. */
function answerOf(question: CardQuestion, data: FormData, held: Held, base: string): Read {
	const { id } = question;
	const otherWords = String(data.get(otherName(id)) ?? '').trim();
	const read = (value: CardAnswer['value'] | null): Read => ({
		answer: value === null ? null : { id, value },
		refused: {}
	});
	switch (question.kind) {
		case 'choice': {
			const picked = data.get(id);
			if (picked === null) return read(null);
			const value = picked === '' ? otherWords : String(picked);
			return read(value === '' ? null : value);
		}
		case 'choices': {
			const picked = data.getAll(id).map(String);
			const value = picked.flatMap((one) => (one !== '' ? [one] : otherWords ? [otherWords] : []));
			return read(value.length === 0 ? null : value);
		}
		case 'text':
		case 'date': {
			const value = String(data.get(id) ?? '').trim();
			return read(value === '' ? null : value);
		}
		case 'amount':
		case 'tiers':
			return heldAnswerOf(question, held, base);
	}
}

export function QuestionCard({
	questions,
	round,
	onSubmit,
	busy,
	starter,
	refusal = ''
}: QuestionCardProps) {
	const uid = useId();
	const refusalId = `${uid}-refusal`;
	const describedBy = refusal === '' ? undefined : refusalId;
	const domId = (question: CardQuestion) => `${uid}-${question.id}`;
	const [amounts, setAmounts] = useState<Held['amounts']>(() =>
		Object.fromEntries(
			questions.flatMap((question) =>
				question.kind === 'amount' && question.prefill !== undefined
					? [[question.id, majorEntry(question.prefill, FORM_CURRENCY)]]
					: []
			)
		)
	);
	const [tiers, setTiers] = useState<Held['tiers']>(() =>
		Object.fromEntries(
			questions.flatMap((question) =>
				question.kind === 'tiers' ? [[question.id, seedRows(question)]] : []
			)
		)
	);
	const added = useRef(0);
	// the predicates a press found, by question and then by box, each re-read as its question's
	// boxes change until it clears.
	const [refused, setRefused] = useState<Readonly<Record<string, Record<string, string>>>>({});
	const [pressed, setPressed] = useState<'send' | 'skip' | null>(null);
	const words = PRESSES[round];

	// a box already refused is read again with what it holds now; a box the press did not refuse
	// stays unmarked until the next press.
	const recheck = (question: HeldQuestion, held: Held) => {
		const was = refused[question.id];
		if (was === undefined) return;
		const now = heldAnswerOf(question, held, domId(question)).refused;
		setRefused(({ [question.id]: _, ...rest }) => {
			const still = Object.fromEntries(
				Object.keys(was).flatMap((box) => (now[box] === undefined ? [] : [[box, now[box]]]))
			);
			return Object.keys(still).length === 0 ? rest : { ...rest, [question.id]: still };
		});
	};

	const typeAmount = (question: HeldQuestion, text: string) => {
		const next = { ...amounts, [question.id]: text };
		setAmounts(next);
		recheck(question, { amounts: next, tiers });
	};

	const changeRows = (
		question: HeldQuestion,
		change: (rows: readonly TierRow[]) => readonly TierRow[]
	) => {
		const next = { ...tiers, [question.id]: change(tiers[question.id] ?? []) };
		setTiers(next);
		recheck(question, { amounts, tiers: next });
	};

	const send = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		const data = new FormData(event.currentTarget);
		const held = { amounts, tiers };
		const reads = questions.map((question) => ({
			question,
			...answerOf(question, data, held, domId(question))
		}));
		setRefused(
			Object.fromEntries(
				reads.flatMap(({ question, refused }) =>
					Object.keys(refused).length === 0 ? [] : [[question.id, refused]]
				)
			)
		);
		const first = reads.flatMap(({ refused }) => Object.keys(refused))[0];
		if (first !== undefined) {
			document.getElementById(first)?.focus();
			return;
		}
		setPressed('send');
		onSubmit(reads.flatMap(({ answer }) => (answer === null ? [] : [answer])));
	};

	const skip = () => {
		if (busy) return;
		setPressed('skip');
		onSubmit([]);
	};

	/** a press that changes a tiers question's rows in place, never the form's default button. */
	const rowPress = (value: string, onClick: () => void): RowControl & { type: 'button' } => ({
		name: 'tiers',
		value,
		type: 'button',
		onClick
	});

	const tierRows = (question: TiersQuestion): ReactElement => {
		const base = domId(question);
		const rows = tiers[question.id] ?? [];
		const said = refused[question.id] ?? {};
		const full = rows.length >= TIERS_MAX;
		// held at the cap the way the card's own presses are held, so the focus stays on it.
		const add: RowControl & { 'aria-disabled'?: 'true' } = {
			...rowPress('add', () => {
				if (full) return;
				added.current += 1;
				const key = `added-${added.current}`;
				changeRows(question, (was) => [...was, { key, amount: '', text: '' }]);
			}),
			...(full ? { 'aria-disabled': 'true' } : {})
		};
		return (
			<RepeatingRows
				key={question.id}
				id={base}
				legend={question.prompt}
				hint={question.hint}
				rowLabel="tier"
				add={add}
				rows={rows.map((row, at) => {
					const amountId = tierBox(base, row, 'amount');
					const textId = tierBox(base, row, 'text');
					const edit = (patch: Partial<TierRow>) =>
						changeRows(question, (was) =>
							was.map((one) => (one.key === row.key ? { ...one, ...patch } : one))
						);
					return {
						id: amountId,
						key: row.key,
						remove:
							rows.length > 1
								? rowPress(`remove:${row.key}`, () =>
										changeRows(question, (was) => was.filter((one) => one.key !== row.key))
									)
								: undefined,
						boxes: (
							<>
								<MoneyField
									id={amountId}
									aria-label={`Tier ${at + 1} amount`}
									affix="$"
									affixAt="start"
									currency={FORM_CURRENCY}
									value={row.amount}
									onValueChange={(amount) => edit({ amount })}
									error={said[amountId]}
								/>
								<Field
									id={textId}
									aria-label={`What tier ${at + 1} does`}
									placeholder={row.example}
									maxLength={BUYS_MAX}
									autoComplete="off"
									value={row.text}
									onChange={(event) => edit({ text: event.currentTarget.value })}
									error={said[textId]}
								/>
							</>
						)
					};
				})}
			/>
		);
	};

	const field = (question: CardQuestion): ReactElement => {
		const id = domId(question);
		switch (question.kind) {
			case 'choice':
			case 'choices':
				return (
					<ChoiceChips
						key={question.id}
						id={id}
						name={question.id}
						type={question.kind === 'choice' ? 'radio' : 'checkbox'}
						legend={question.prompt}
						hint={question.hint}
						options={question.options.map((option) => ({ value: option, label: option }))}
						other={{ name: otherName(question.id) }}
					/>
				);
			case 'text':
				return (
					<Field
						key={question.id}
						id={id}
						name={question.id}
						label={question.prompt}
						hint={question.hint}
						placeholder={question.placeholder}
						defaultValue={question.prefill}
						autoComplete="off"
					/>
				);
			case 'date':
				return (
					<Field
						key={question.id}
						id={id}
						name={question.id}
						type="date"
						label={question.prompt}
						hint={question.hint}
					/>
				);
			case 'amount':
				return (
					<MoneyField
						key={question.id}
						id={id}
						label={question.prompt}
						hint={question.hint}
						affix="$"
						affixAt="start"
						currency={FORM_CURRENCY}
						placeholder={
							question.placeholder === undefined
								? undefined
								: majorEntry(question.placeholder, FORM_CURRENCY)
						}
						value={amounts[question.id] ?? ''}
						onValueChange={(text) => typeAmount(question, text)}
						error={refused[question.id]?.[id]}
					/>
				);
			case 'tiers':
				return tierRows(question);
		}
	};

	return (
		<form className="adm-questions" noValidate onSubmit={send}>
			{starter ? <Banner tone="attention">{STARTER_NOTE}</Banner> : null}
			{questions.map(field)}
			<div className="adm-actions">
				<Button
					type="submit"
					variant="primary"
					aria-disabled={busy || undefined}
					aria-busy={busy && pressed === 'send'}
					aria-describedby={describedBy}
					onClick={(event) => {
						if (busy) event.preventDefault();
					}}
				>
					{words.send}
				</Button>
				<Button
					type="button"
					variant="quiet"
					aria-disabled={busy || undefined}
					aria-busy={busy && pressed === 'skip'}
					aria-describedby={describedBy}
					onClick={skip}
				>
					{words.skip}
				</Button>
			</div>
			<p className="adm-questions__refusal" id={refusalId} role="status">
				{refusal === '' ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						<MarkedText text={refusal} />
					</StatusWord>
				)}
			</p>
		</form>
	);
}
