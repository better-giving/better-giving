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
// a `tiers` question asks what amounts do, a row per amount: its rows are the model's guess, every
// amount and the words where it has them, and an example per row may stand where the words are
// empty. its answer is rows the operator wrote, each an amount and what it does, held to the bound
// of what an impact tier buys in ./catalog.ts, since each becomes one. an `amount` question's
// prefill and example are minor units.
//
// the operator turn's text is `answerWords`, one line per answered question, its prompt and its
// answer, an amount in dollars, a day in words and a tier as its amount and words; the model reads
// those words. ./accept-reply.ts reads a figure the operator stated out of `answerValueWords`
// alone, the answers without their prompts: a prompt is the model's words, and "Is your goal
// $10,000 or more?" answered "No" states no figure. an option the operator picked is their answer,
// figure and all, and a tiers row is their saying what its amount does.
//
// pure and not under `$lib/server/**`, beside the catalog its replies edit.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { FORM_CURRENCY } from '../forms/amounts';
import { CAMPAIGN_TYPE_DETAILS, type CampaignType } from './campaign-types';
import { BUYS_MAX, TIERS_MAX } from './catalog';
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

const minor = z
	.int({ error: 'is an amount in minor units' })
	.positive({ error: 'is more than nothing' });

/** an impact tier's amounts: 1 to `TIERS_MAX` of them, each listed once. */
function tierRows<Row extends z.ZodType<{ amount: number }>>(row: Row) {
	return z
		.array(row)
		.min(1, { error: `a tiers question holds 1 to ${TIERS_MAX} rows` })
		.max(TIERS_MAX, { error: `a tiers question holds 1 to ${TIERS_MAX} rows` })
		.refine((rows) => new Set(rows.map(({ amount }) => amount)).size === rows.length, {
			error: 'an amount is listed twice'
		});
}

const tiersQuestion = z
	.strictObject({
		...common,
		kind: z.literal('tiers'),
		// the model's guess: every amount, and what it does where it can say.
		rows: tierRows(
			z.strictObject({ amount: minor, text: plain(BUYS_MAX, 'what a tier does').optional() })
		),
		// an example of what each row's amount does, by index, shown where its words are empty.
		placeholders: z
			.array(plain(BUYS_MAX, 'an example'))
			.max(TIERS_MAX, { error: 'a tiers question gives at most one example per row' })
			.optional()
	})
	.refine(({ rows, placeholders = [] }) => placeholders.length <= rows.length, {
		error: 'a tiers question gives at most one example per row',
		path: ['placeholders']
	});
export type TiersQuestion = z.infer<typeof tiersQuestion>;

const questionSchema = z.discriminatedUnion('kind', [
	z.strictObject({ ...common, kind: z.literal('choice'), options }),
	z.strictObject({ ...common, kind: z.literal('choices'), options }),
	z.strictObject({
		...common,
		kind: z.literal('text'),
		placeholder: plain(PLACEHOLDER_MAX, 'placeholder').optional(),
		prefill: plain(WORDS_MAX, 'prefill').optional()
	}),
	z.strictObject({
		...common,
		kind: z.literal('amount'),
		placeholder: minor.optional(),
		prefill: minor.optional()
	}),
	z.strictObject({ ...common, kind: z.literal('date') }),
	tiersQuestion
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

/** a `tiers` answer's row: an amount in minor units and what it does, in the operator's words. */
export type TierAnswer = { amount: number; text: string };

/**
 * one answer: the option or Other words, a list of those, the words, minor units, a day, or a
 * tiers question's rows.
 */
export type Answer = { id: string; value: string | string[] | number | TierAnswer[] };

const tierAnswer = tierRows(
	z.strictObject({ amount: minor, text: plain(BUYS_MAX, 'what a tier does') })
);

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
			return minor;
		case 'tiers':
			return tierAnswer;
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
		.max(QUESTIONS_MAX, {
			error: `holds at most ${QUESTIONS_MAX} answers, one per question asked`
		})
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
						? value.map(choiceOrTier).join(kind === 'tiers' ? '; ' : ', ')
						: String(value);
		return [{ id, prompt, words: said }];
	});
}

function choiceOrTier(one: string | TierAnswer) {
	return typeof one === 'string'
		? one
		: `${formatMinorBrief(one.amount, FORM_CURRENCY)}: ${one.text}`;
}

/** the operator turn's text for `answers`: one line per answered question, the model's to read. */
export function answerWords(questions: readonly Question[], answers: readonly Answer[]): string {
	const lines = answeredLines(questions, answers);
	if (lines.length === 0) return 'Skipped the questions.';
	return lines.map(({ prompt, words }) => `${prompt} — ${words}`).join('\n');
}

/**
 * the operator's own words in `answers`, one line per answered question: the answers alone, never
 * the prompts, which the model wrote. what ./accept-reply.ts reads an answers turn's figures from.
 */
export function answerValueWords(
	questions: readonly Question[],
	answers: readonly Answer[]
): string {
	return answeredLines(questions, answers)
		.map(({ words }) => words)
		.join('\n');
}

/**
 * the question the server puts first in a page's opening while the profile's mission is empty. its
 * answer reaches the model as any answer does and is kept in the chat alone; the mission is the
 * console's to save. a model's question under its id is dropped from an opening that asks this one.
 */
export const MISSION_QUESTION = {
	id: 'mission',
	kind: 'text',
	prompt: 'Your mission, in a sentence',
	placeholder: 'We help families in our city find a stable home'
} as const satisfies Question;

/** on the starter rule ./campaign-types.ts states, and asking nothing of how the page is laid out. */
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
	}
];

/**
 * the questions a page opens on when no model drafts its own: the mission first while it is empty,
 * then the page's set — a campaign's its type's, and `other`'s for one made before its type was
 * asked — `QUESTIONS_MAX` at most, the set's last dropped.
 */
export function starterQuestions(
	type: PageType,
	campaignType: CampaignType | null,
	missionEmpty: boolean
): Question[] {
	const set =
		type === 'donation_page'
			? DONATION_PAGE_STARTER
			: CAMPAIGN_TYPE_DETAILS[campaignType ?? 'other'].starter;
	return [...(missionEmpty ? [MISSION_QUESTION] : []), ...set].slice(0, QUESTIONS_MAX);
}

function issueText(error: z.ZodError, from: readonly (string | number)[] = []) {
	const [issue] = error.issues;
	if (issue === undefined) return 'off its schema';
	const path = [...from, ...issue.path.filter((key) => typeof key !== 'symbol')];
	return path.length === 0 ? issue.message : `${path.join('.')}: ${issue.message}`;
}
