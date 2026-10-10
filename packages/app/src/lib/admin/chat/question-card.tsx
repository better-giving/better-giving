import { Button } from '@better-giving/operator/components/controls/Button';
import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { FORM_CURRENCY, readAmount } from '$lib/forms/amounts';
import { MoneyField } from '../editor/money-field';

// the questions an asked turn puts to the operator, answered in one card: every question at once,
// all of them optional, sent by one press and skipped by the other. the same card at both widths —
// in the docked AI column and in the AI sheet (./ai-panel.tsx).
//
// a question arrives as the wire holds it, and every string in it is drawn as text. a choice is
// ChoiceChips' radios, several choices its checkboxes, and both end on an Other chip whose words
// are the answer — Other taken with nothing typed is no answer. an amount is read by the app's own
// amount parse ($lib/forms/amounts) into minor units of the form currency, a date is the platform's
// date box, which hands back `YYYY-MM-DD`.
//
// the boxes are the form's and the card reads them once, on the press, from the form's own data;
// only the amounts are held here, because an amount refused on a press is re-read as it is typed
// until it clears. an unreadable amount sends nothing: its predicate stands under its box and the
// focus goes into it.
//
// while the answers are on their way (`busy`) both presses are held with `aria-disabled` rather
// than `disabled`, so the focus stays on the one pressed, and the boxes stay as typed.
//
// answers the route stored nothing from come back as `refusal`, said under the presses — the card
// is still up, every box as it was, and the focus still on the press that sent them, so that is
// where it is read. the region is on the card before it has anything to say, so it is announced
// when it does, and both presses are described by it while it speaks. a server's sentence marks a
// command or a name in backticks, which is drawn as code here as the chat log draws it.

export type QuestionKind = 'choice' | 'choices' | 'text' | 'amount' | 'date';

/** one question, as the wire carries it. */
export interface CardQuestion {
	readonly id: string;
	readonly kind: QuestionKind;
	readonly prompt: string;
	readonly hint?: string | undefined;
	/** the choice kinds' options. "Other" is never among them: the card adds it. */
	readonly options?: readonly string[] | undefined;
	/** the text kind's placeholder. */
	readonly placeholder?: string | undefined;
	/** the text kind's starting words. */
	readonly prefill?: string | undefined;
}

/**
 * one answer: an option or the Other words, a list of those, the words typed, an amount in minor
 * units, or a date as `YYYY-MM-DD`. a question left unanswered has none.
 */
export interface CardAnswer {
	readonly id: string;
	readonly value: string | readonly string[] | number;
}

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

/** the answer the form holds for one question that is not an amount, or none. */
function answerOf(question: CardQuestion, data: FormData): CardAnswer | null {
	const { id } = question;
	const otherWords = String(data.get(otherName(id)) ?? '').trim();
	switch (question.kind) {
		case 'choice': {
			const picked = data.get(id);
			if (picked === null) return null;
			const value = picked === '' ? otherWords : String(picked);
			return value === '' ? null : { id, value };
		}
		case 'choices': {
			const picked = data.getAll(id).map(String);
			const value = picked.flatMap((one) => (one !== '' ? [one] : otherWords ? [otherWords] : []));
			return value.length === 0 ? null : { id, value };
		}
		case 'text':
		case 'date': {
			const value = String(data.get(id) ?? '').trim();
			return value === '' ? null : { id, value };
		}
		case 'amount':
			return null;
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
	const [amounts, setAmounts] = useState<Readonly<Record<string, string>>>({});
	// the predicate a press found under each amount box, re-read as the box is typed in until clear.
	const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
	const amountBoxes = useRef(new Map<string, HTMLInputElement>());
	const [pressed, setPressed] = useState<'send' | 'skip' | null>(null);
	const words = PRESSES[round];

	const send = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		const data = new FormData(event.currentTarget);
		const problems: Record<string, string> = {};
		const answers: CardAnswer[] = [];
		for (const question of questions) {
			if (question.kind !== 'amount') {
				const answer = answerOf(question, data);
				if (answer !== null) answers.push(answer);
				continue;
			}
			const read = readAmountBox(amounts[question.id] ?? '');
			if (read.problem !== null) problems[question.id] = read.problem;
			else if (read.minor !== null) answers.push({ id: question.id, value: read.minor });
		}
		setRefused(problems);
		const first = questions.find((question) => problems[question.id] !== undefined);
		if (first !== undefined) {
			amountBoxes.current.get(first.id)?.focus();
			return;
		}
		setPressed('send');
		onSubmit(answers);
	};

	const skip = () => {
		if (busy) return;
		setPressed('skip');
		onSubmit([]);
	};

	const field = (question: CardQuestion): ReactNode => {
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
						options={(question.options ?? []).map((option) => ({
							value: option,
							label: option
						}))}
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
						inputRef={(box) => {
							if (box === null) amountBoxes.current.delete(question.id);
							else amountBoxes.current.set(question.id, box);
						}}
						value={amounts[question.id] ?? ''}
						onValueChange={(text) => {
							setAmounts((was) => ({ ...was, [question.id]: text }));
							if (refused[question.id] === undefined) return;
							const { problem } = readAmountBox(text);
							setRefused(({ [question.id]: _, ...rest }) =>
								problem === null ? rest : { ...rest, [question.id]: problem }
							);
						}}
						error={refused[question.id]}
					/>
				);
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
