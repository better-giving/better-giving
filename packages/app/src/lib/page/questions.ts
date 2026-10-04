// the questions a chat reply may ask in place of a page change, and the answers the operator gives
// them: plain data, read by shape alone, since a model writes the questions and anyone may post the
// answers. ./accept-reply.ts is the door an ask comes through; $lib/server/pages/draft.ts stores an
// ask on the assistant turn's `questions` and the answers on the operator turn's `answers`.
//
// every string a question shows is plain text and is drawn as text: one holding `<`, `>`, a URL
// scheme or `www.` refuses the ask whole. "Other" is never an option, since the card adds it to every
// choice, so a choice's answer is one of its options or the Other words, and a several-choices
// answer holds at most one string that is not an option.
//
// the operator turn's text is `answerWords`, one line per answered question, an amount in dollars
// and a day in words. the model reads those words, and ./accept-reply.ts reads a figure in them as
// one the operator stated.
//
// pure and not under `$lib/server/**`, beside the catalog its replies edit.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { FORM_CURRENCY } from '../forms/amounts';
import type { CampaignType } from './campaign-types';
import { dayWords } from './end-date';
import type { PageType } from './keys';

/** the most questions one ask holds. */
export const QUESTIONS_MAX = 5;

const PROMPT_MAX = 120;
const HINT_MAX = 160;
const PLACEHOLDER_MAX = 80;
const OPTION_MAX = 60;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 6;
/** the longest words a text answer, an Other answer or a text prefill holds. */
const WORDS_MAX = 400;

/** a link, a scheme or markup in words a question shows; `www.` too, which a reader takes as one. */
const NOT_PLAIN = /[<>]|\b(?:https?|mailto|javascript|data):|\bwww\./i;

function plain(max: number, what: string) {
	return z
		.string()
		.trim()
		.min(1, { error: `${what} holds no words` })
		.max(max, { error: `${what} holds at most ${max} characters` })
		.refine((text) => !NOT_PLAIN.test(text), {
			error: `${what} is plain text: no "<", ">", link or web address`
		});
}

const common = {
	id: z.string().regex(/^[a-z0-9-]{1,40}$/, {
		error: 'id is 1 to 40 lowercase letters, digits or "-"'
	}),
	prompt: plain(PROMPT_MAX, 'prompt'),
	hint: plain(HINT_MAX, 'hint').optional()
};

const options = z
	.array(plain(OPTION_MAX, 'an option'))
	.min(OPTIONS_MIN, { error: `a choice offers ${OPTIONS_MIN} to ${OPTIONS_MAX} options` })
	.max(OPTIONS_MAX, { error: `a choice offers ${OPTIONS_MIN} to ${OPTIONS_MAX} options` })
	.refine((list) => new Set(list).size === list.length, { error: 'an option is listed twice' })
	.refine((list) => !list.some((option) => /^other$/i.test(option)), {
		error: '"Other" is added to every choice by the card, so it is never an option'
	});

const questionSchema = z.discriminatedUnion('kind', [
	z.strictObject({ ...common, kind: z.literal('choice'), options }),
	z.strictObject({ ...common, kind: z.literal('choices'), options }),
	z.strictObject({
		...common,
		kind: z.literal('text'),
		placeholder: plain(PLACEHOLDER_MAX, 'placeholder').optional(),
		prefill: plain(WORDS_MAX, 'prefill').optional()
	}),
	z.strictObject({ ...common, kind: z.literal('amount') }),
	z.strictObject({ ...common, kind: z.literal('date') })
]);
export type Question = z.infer<typeof questionSchema>;

export const askSchema = z
	.array(questionSchema)
	.min(1, { error: 'an ask holds at least one question' })
	.max(QUESTIONS_MAX, { error: `an ask holds at most ${QUESTIONS_MAX} questions` })
	.refine((asked) => new Set(asked.map(({ id }) => id)).size === asked.length, {
		error: 'two questions share an id'
	});

export function readAsk(
	json: unknown
): { ok: true; questions: Question[] } | { ok: false; reason: string } {
	const read = askSchema.safeParse(json);
	return read.success
		? { ok: true, questions: read.data }
		: { ok: false, reason: issueText(read.error) };
}

/** one answer: the option or Other words, a list of those, the words, minor units, or a day. */
export type Answer = { id: string; value: string | string[] | number };

const words = z
	.string()
	.trim()
	.max(WORDS_MAX, { error: `holds at most ${WORDS_MAX} characters` });
const picked = words.min(1, { error: 'holds no words' });

function answerSchema(question: Question): z.ZodType<Answer['value']> {
	switch (question.kind) {
		case 'choice':
			return picked;
		case 'choices':
			return z
				.array(picked)
				.min(1, { error: 'names no choice; leave the answer out to skip it' })
				.refine((list) => new Set(list).size === list.length, { error: 'names a choice twice' })
				.check((ctx) => {
					const [, second] = ctx.value.filter((one) => !question.options.includes(one));
					if (second === undefined) return;
					ctx.issues.push({
						code: 'custom',
						input: ctx.value,
						message: `"${second}" is not an option of "${question.id}", and a choice takes one Other answer`
					});
				});
		case 'text':
			return words;
		case 'amount':
			return z
				.int({ error: 'is an amount in minor units' })
				.positive({ error: 'is more than nothing' });
		case 'date':
			return z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'is a day, YYYY-MM-DD' })
				.refine(isDay, { error: (issue) => `"${String(issue.input)}" is no day` });
	}
}

function isDay(day: string) {
	const at = Date.parse(`${day}T00:00:00Z`);
	return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === day;
}

const answerShape = z.strictObject({ id: z.string(), value: z.unknown() });

/**
 * `json` as the answers to `questions`: each names a question asked, once, with a value of its kind.
 * a blank text answer is a skipped one, left out. a reason names the answer by its index.
 */
export function readAnswers(
	questions: readonly Question[],
	json: unknown
): { ok: true; answers: Answer[] } | { ok: false; reason: string } {
	const list = z
		.array(answerShape, { error: 'answers is a list of {id, value}' })
		.max(QUESTIONS_MAX)
		.safeParse(json);
	if (!list.success) return { ok: false, reason: issueText(list.error, ['answers']) };
	const answers: Answer[] = [];
	for (const [index, { id, value }] of list.data.entries()) {
		const at = `answers.${index}`;
		const question = questions.find((one) => one.id === id);
		if (question === undefined) return { ok: false, reason: `${at}: "${id}" is no question asked` };
		if (answers.some((one) => one.id === id)) {
			return { ok: false, reason: `${at}: "${id}" is answered twice` };
		}
		const read = answerSchema(question).safeParse(value);
		if (!read.success) return { ok: false, reason: issueText(read.error, [at, 'value']) };
		if (read.data !== '') answers.push({ id, value: read.data });
	}
	return { ok: true, answers };
}

/** each answered question, in the order asked, with its prompt and its answer as words. */
export function answeredLines(
	questions: readonly Question[],
	answers: readonly Answer[]
): { id: string; prompt: string; words: string }[] {
	return questions.flatMap(({ id, kind, prompt }) => {
		const answer = answers.find((one) => one.id === id);
		if (answer === undefined) return [];
		const { value } = answer;
		const said =
			kind === 'amount' && typeof value === 'number'
				? formatMinorBrief(value, FORM_CURRENCY)
				: kind === 'date' && typeof value === 'string'
					? dayWords(value)
					: Array.isArray(value)
						? value.join(', ')
						: String(value);
		return [{ id, prompt, words: said }];
	});
}

/** the operator turn's text for `answers`: one line per answered question, the model's to read. */
export function answerWords(questions: readonly Question[], answers: readonly Answer[]): string {
	const lines = answeredLines(questions, answers);
	if (lines.length === 0) return 'Skipped the questions.';
	return lines.map(({ prompt, words }) => `${prompt} — ${words}`).join('\n');
}

/**
 * the question the server puts first in a page's opening while the Organisation's mission is empty.
 * its answer is written to the mission where the asked question is this one, id, kind and prompt
 * alike, and a model's question under its id is dropped from an opening.
 */
export const MISSION_QUESTION = {
	id: 'mission',
	kind: 'text',
	prompt: 'Your mission, in a sentence'
} as const satisfies Question;

const DONATION_PAGE_STARTER: readonly Question[] = [
	{
		id: 'who',
		kind: 'choice',
		prompt: 'Who do gifts mostly help?',
		options: [
			'Children and young people',
			'Families',
			'Older people',
			'Animals',
			'The environment',
			'Our whole community'
		]
	},
	{
		id: 'first',
		kind: 'choice',
		prompt: 'What should donors see first?',
		options: ['The story', 'A photo', 'What a gift buys']
	},
	{
		id: 'ways',
		kind: 'choices',
		prompt: 'Which ways to give should stand out?',
		options: ['One-time gifts', 'Monthly gifts', 'Gifts in someone’s honour']
	},
	{ id: 'typical-gift', kind: 'amount', prompt: 'A typical gift' }
];

const CAMPAIGN_STARTER: readonly Question[] = [
	{ id: 'purpose', kind: 'text', prompt: 'What is this campaign for?' },
	{ id: 'who', kind: 'text', prompt: 'Who does it help?' },
	{ id: 'pays-for', kind: 'text', prompt: 'What will gifts pay for?' },
	{ id: 'goal', kind: 'amount', prompt: 'Your goal', hint: 'Leave it blank for no goal' },
	{ id: 'end-date', kind: 'date', prompt: 'When does it end?', hint: 'Leave it blank for no end' }
];

/**
 * the questions a page opens on when no model drafts its own: the mission first while it is empty,
 * then the page's set, `QUESTIONS_MAX` at most. every campaign type asks the same set.
 */
export function starterQuestions(
	type: PageType,
	_campaignType: CampaignType | null,
	missionEmpty: boolean
): Question[] {
	const set = type === 'donation_page' ? DONATION_PAGE_STARTER : CAMPAIGN_STARTER;
	return [...(missionEmpty ? [MISSION_QUESTION] : []), ...set].slice(0, QUESTIONS_MAX);
}

function issueText(error: z.ZodError, from: readonly (string | number)[] = []) {
	const [issue] = error.issues;
	if (issue === undefined) return 'off its schema';
	const path = [...from, ...issue.path.filter((key) => typeof key !== 'symbol')];
	return path.length === 0 ? issue.message : `${path.join('.')}: ${issue.message}`;
}
