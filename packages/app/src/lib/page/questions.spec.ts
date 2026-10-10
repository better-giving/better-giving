import { describe, expect, it } from 'vitest';
import { CAMPAIGN_TYPES } from './campaign-types';
import {
	answerWords,
	MISSION_QUESTION,
	type Question,
	readAnswers,
	readAsk,
	starterQuestions
} from './questions';

// node pool: questions and answers are plain data, read by shape.

const pick: Question = {
	id: 'who',
	kind: 'choice',
	prompt: 'Who do gifts mostly help?',
	options: ['Children', 'Families']
};

describe('an ask', () => {
	it('of questions on the rule is read as asked', () => {
		const ask = [
			pick,
			{ id: 'goal', kind: 'amount', prompt: 'Your goal', hint: 'Leave it out for none' },
			{ id: 'about', kind: 'text', prompt: 'What is it for?', placeholder: 'Coats for kids' }
		];
		expect(readAsk(ask)).toEqual({ ok: true, questions: ask });
	});
});

describe('an ask off the rule', () => {
	const text = (id: string) => ({ id, kind: 'text', prompt: 'Tell me more' });
	it.each([
		['no question', [], 'at least one question'],
		['six questions', ['a', 'b', 'c', 'd', 'e', 'f'].map(text), 'at most 5 questions'],
		['two questions sharing an id', [text('a'), text('a')], 'share an id'],
		['an id off its letters', [text('Who')], '0.id: '],
		['an unknown kind', [{ id: 'a', kind: 'slider', prompt: 'How much?' }], '0.kind: '],
		['one option', [{ ...pick, options: ['Children'] }], '0.options: a choice offers 2 to 6'],
		[
			'seven options',
			[{ ...pick, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
			'0.options: a choice offers 2 to 6'
		],
		['an option twice', [{ ...pick, options: ['a', 'a'] }], 'listed twice'],
		['Other among the options', [{ ...pick, options: ['a', 'other'] }], '"Other" is added'],
		['options on a text question', [{ ...text('a'), options: ['a', 'b'] }], '0: '],
		['a prompt past its length', [{ ...text('a'), prompt: 'x'.repeat(121) }], '0.prompt: '],
		['markup in a prompt', [{ ...text('a'), prompt: 'Your <b>mission</b>' }], 'plain text'],
		['a link in a hint', [{ ...text('a'), hint: 'see https://example.org' }], '0.hint: '],
		['a web address in an option', [{ ...pick, options: ['a', 'www.example.org'] }], 'plain text'],
		['a script scheme', [{ ...text('a'), placeholder: 'javascript:alert(1)' }], 'plain text']
	])('is refused for %s, naming where', (_, ask, reason) => {
		expect(readAsk(ask)).toEqual({ ok: false, reason: expect.stringContaining(reason) });
	});
});

describe('an amount question', () => {
	const amount = { id: 'goal', kind: 'amount', prompt: 'Your goal' } as const;

	it('carries a prefilled guess and an example, each in minor units', () => {
		const ask = [{ ...amount, prefill: 1000000, placeholder: 2500000 }];
		expect(readAsk(ask)).toEqual({ ok: true, questions: ask });
	});

	it.each([
		['a prefill of nothing', { prefill: 0 }, '0.prefill: '],
		['a prefill in fractions of a cent', { prefill: 12.5 }, '0.prefill: '],
		['a prefill in words', { prefill: '$10,000' }, '0.prefill: '],
		['an example in words', { placeholder: 'e.g. $10,000' }, '0.placeholder: ']
	])('is refused for %s, naming it', (_, extra, reason) => {
		expect(readAsk([{ ...amount, ...extra }])).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});
});

const tiers: Question = {
	id: 'impact',
	kind: 'tiers',
	prompt: 'What can a gift do?',
	rows: [{ amount: 2500, text: 'Medicine for a week' }, { amount: 5000 }, { amount: 10000 }]
};

describe('a tiers question', () => {
	it('of 1 to 6 rows, each an amount and what it does, is read as asked', () => {
		const ask = [tiers, { ...tiers, id: 'one', rows: [{ amount: 100 }] }];
		expect(readAsk(ask)).toEqual({ ok: true, questions: ask });
	});

	it('takes an example sentence per row for the card to show', () => {
		const ask = [{ ...tiers, placeholders: ['A meal', 'A night of shelter', 'A week of care'] }];
		expect(readAsk(ask)).toEqual({ ok: true, questions: ask });
	});

	const row = (amount: unknown, text?: unknown) => ({
		amount,
		...(text === undefined ? {} : { text })
	});
	it.each([
		['no row', [], '0.rows: '],
		['seven rows', [1, 2, 3, 4, 5, 6, 7].map((n) => row(n * 100)), '0.rows: '],
		['an amount twice', [row(2500), row(2500)], 'amount is listed twice'],
		['an amount of nothing', [row(0)], '0.rows.0.amount: '],
		['an amount in fractions of a cent', [row(12.5)], '0.rows.0.amount: '],
		['an amount in words', [row('$25')], '0.rows.0.amount: '],
		['words past what a tier buys', [row(2500, 'x'.repeat(141))], '0.rows.0.text: '],
		['markup in the words', [row(2500, 'a <b>meal</b>')], 'plain text'],
		['blank words', [row(2500, '  ')], '0.rows.0.text: '],
		['a key beside the amount', [{ amount: 2500, buys: 'A meal' }], '0.rows.0: ']
	])('is refused for %s, naming where', (_, rows, reason) => {
		expect(readAsk([{ ...tiers, rows }])).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});

	it.each([
		['more examples than rows', ['A meal', 'A bed', 'A coat', 'A book'], '0.placeholders: '],
		['markup in an example', ['A <i>meal</i>'], 'plain text']
	])('is refused for %s', (_, placeholders, reason) => {
		expect(readAsk([{ ...tiers, placeholders }])).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});
});

describe('answers to a tiers question', () => {
	const rows = [
		{ amount: 2500, text: 'Medicine' },
		{ amount: 5000, text: '  A meal  ' },
		{ amount: 10000, text: 'A super meal' }
	];

	it('are its rows, trimmed, said as each amount and what it does', () => {
		const read = readAnswers([tiers], [{ id: 'impact', value: rows }]);
		expect(read).toEqual({
			ok: true,
			answers: [{ id: 'impact', value: [rows[0], { amount: 5000, text: 'A meal' }, rows[2]] }]
		});
		expect(read.ok && answerWords([tiers], read.answers)).toBe(
			'What can a gift do? — $25: Medicine; $50: A meal; $100: A super meal'
		);
	});

	it('may hold amounts the question did not prefill', () => {
		const value = [{ amount: 1500, text: 'A blanket' }];
		expect(readAnswers([tiers], [{ id: 'impact', value }])).toEqual({
			ok: true,
			answers: [{ id: 'impact', value }]
		});
	});

	it.each([
		['words', 'medicine, a meal', 'answers.0.value: '],
		['no row', [], 'answers.0.value: '],
		[
			'seven rows',
			[1, 2, 3, 4, 5, 6, 7].map((n) => ({ amount: n * 100, text: 'A meal' })),
			'answers.0.value: '
		],
		['an amount twice', [rows[0], rows[0]], 'an amount is listed twice'],
		['an amount of nothing', [{ amount: 0, text: 'A meal' }], 'answers.0.value.0.amount: '],
		[
			'an amount in fractions of a cent',
			[{ amount: 12.5, text: 'A meal' }],
			'answers.0.value.0.amount: '
		],
		['a row saying nothing', [{ amount: 2500, text: ' ' }], 'answers.0.value.0.text: '],
		['a row with no words', [{ amount: 2500 }], 'answers.0.value.0.text: '],
		[
			'words past what a tier buys',
			[{ amount: 2500, text: 'x'.repeat(141) }],
			'answers.0.value.0.text: '
		],
		['markup', [{ amount: 2500, text: '<b>A meal</b>' }], 'plain text'],
		['a link', [{ amount: 2500, text: 'see www.example.org' }], 'plain text']
	])('are refused for %s, naming it', (_, value, reason) => {
		expect(readAnswers([tiers], [{ id: 'impact', value }])).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});
});

const asked: Question[] = [
	pick,
	{ id: 'ways', kind: 'choices', prompt: 'Ways to give', options: ['One-time', 'Monthly'] },
	{ id: 'about', kind: 'text', prompt: 'What is it for?' },
	{ id: 'typical', kind: 'amount', prompt: 'A typical gift' },
	{ id: 'ends', kind: 'date', prompt: 'When does it end?' }
];

describe('answers to the questions asked', () => {
	it('are read as given, and composed one line each in the order asked', () => {
		const answers = [
			{ id: 'ends', value: '2026-12-31' },
			{ id: 'typical', value: 5000 },
			{ id: 'ways', value: ['Monthly', 'In someone’s honour'] },
			{ id: 'who', value: 'Our neighbours' },
			{ id: 'about', value: '  Coats for kids  ' }
		];
		const read = readAnswers(asked, answers);
		expect(read).toEqual({
			ok: true,
			answers: [...answers.slice(0, 4), { id: 'about', value: 'Coats for kids' }]
		});
		expect(read.ok && answerWords(asked, read.answers)).toBe(
			[
				'Who do gifts mostly help? — Our neighbours',
				'Ways to give — Monthly, In someone’s honour',
				'What is it for? — Coats for kids',
				'A typical gift — $50',
				'When does it end? — Dec 31, 2026'
			].join('\n')
		);
	});

	it('that skip every question say so', () => {
		const read = readAnswers(asked, []);
		expect(read).toEqual({ ok: true, answers: [] });
		expect(answerWords(asked, [])).toBe('Skipped the questions.');
	});

	it('leave a blank text answer out, as skipped', () => {
		expect(readAnswers(asked, [{ id: 'about', value: '   ' }])).toEqual({ ok: true, answers: [] });
	});

	it.each([
		['not a list', { id: 'who', value: 'Children' }, 'answers is a list'],
		[
			'an unknown question',
			[{ id: 'colour', value: 'red' }],
			'answers.0: "colour" is no question asked'
		],
		[
			'one question twice',
			[
				{ id: 'who', value: 'Children' },
				{ id: 'who', value: 'Families' }
			],
			'answers.1: "who" is answered twice'
		],
		['a list for one choice', [{ id: 'who', value: ['Children'] }], 'answers.0.value: '],
		['words for an amount', [{ id: 'typical', value: '$50' }], 'answers.0.value: '],
		['an amount of nothing', [{ id: 'typical', value: 0 }], 'answers.0.value: '],
		['a negative amount', [{ id: 'typical', value: -500 }], 'answers.0.value: '],
		['an amount in fractions of a cent', [{ id: 'typical', value: 12.5 }], 'answers.0.value: '],
		['a day off its format', [{ id: 'ends', value: '31/12/2026' }], 'answers.0.value: '],
		['a day that is none', [{ id: 'ends', value: '2026-02-30' }], 'answers.0.value: '],
		['words past their length', [{ id: 'about', value: 'x'.repeat(401) }], 'answers.0.value: '],
		[
			'two answers that are not options',
			[{ id: 'ways', value: ['Weekly', 'Yearly'] }],
			'answers.0.value: "Yearly" is not an option of "ways"'
		],
		[
			'an option chosen twice',
			[{ id: 'ways', value: ['Monthly', 'Monthly'] }],
			'answers.0.value: '
		],
		['no choice of several', [{ id: 'ways', value: [] }], 'answers.0.value: ']
	])('are refused for %s, naming it', (_, answers, reason) => {
		expect(readAnswers(asked, answers)).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});
});

describe('the starter questions', () => {
	it('of the Donation page open on the mission while it is empty, and are on the rule', () => {
		const starter = starterQuestions('donation_page', null, true);
		expect(starter.map(({ id, kind }) => [id, kind])).toEqual([
			['mission', 'text'],
			['who', 'choice'],
			['first', 'choice'],
			['ways', 'choices'],
			['typical-gift', 'amount']
		]);
		expect(starter[0]).toEqual(MISSION_QUESTION);
		expect(readAsk(starter)).toEqual({ ok: true, questions: starter });
	});

	it('of the Donation page leave the mission out once it is written', () => {
		expect(starterQuestions('donation_page', null, false).map(({ id }) => id)).toEqual([
			'who',
			'first',
			'ways',
			'typical-gift'
		]);
	});

	it('of a campaign made before types ask what it is for, who it helps, what gifts pay for, a goal and an end', () => {
		const starter = starterQuestions('campaign', null, false);
		expect(starter.map(({ id, kind }) => [id, kind])).toEqual([
			['purpose', 'text'],
			['who', 'text'],
			['pays-for', 'tiers'],
			['goal', 'amount'],
			['end-date', 'date']
		]);
		expect(readAsk(starter)).toEqual({ ok: true, questions: starter });
	});

	it('of a campaign made before types stay at five with the mission first', () => {
		const starter = starterQuestions('campaign', null, true);
		expect(starter.map(({ id }) => id)).toEqual(['mission', 'purpose', 'who', 'pays-for', 'goal']);
	});

	it.each([null, 'year_end', 'program'] as const)(
		'of a %s campaign say its goal and its end may be left blank',
		(type) => {
			const starter = starterQuestions('campaign', type, false);
			expect(
				starter.filter(({ id }) => id === 'goal' || id === 'end-date').map(({ hint }) => hint)
			).toEqual(['Leave it blank for no goal', 'Leave it blank for no end']);
		}
	);

	it('of a campaign made before types are those of one of type other', () => {
		expect(starterQuestions('campaign', null, true)).toEqual(
			starterQuestions('campaign', 'other', true)
		);
	});

	it('of an event are its own, in the order the type asks them', () => {
		const starter = starterQuestions('campaign', 'event', false);
		expect(starter.map(({ kind, prompt }) => [kind, prompt])).toEqual([
			['text', 'What’s the event?'],
			['date', 'When is it?'],
			['tiers', 'What will the money raised do?'],
			['amount', 'Goal']
		]);
	});

	it('of a tribute ask in memory or in honour as a choice of the two', () => {
		const starter = starterQuestions('campaign', 'tribute', false);
		expect(starter[1]).toMatchObject({
			kind: 'choice',
			prompt: 'In memory or in honour?',
			options: ['In memory', 'In honour']
		});
	});

	it('of a typed campaign put the mission first while it is empty, dropping the type’s last to stay at five', () => {
		const starter = starterQuestions('campaign', 'emergency', true);
		expect(starter.map(({ prompt }) => prompt)).toEqual([
			'Your mission, in a sentence',
			'What happened?',
			'Who and where are you helping?',
			'What will gifts pay for?',
			'Goal'
		]);
	});

	const STARTERS = [
		['the Donation page', starterQuestions('donation_page', null, true)],
		...CAMPAIGN_TYPES.map((type) => [type, starterQuestions('campaign', type, true)] as const)
	] as const;

	it.each(STARTERS)('of %s arrive prefilled or with an example in every box', (_, starter) => {
		const bare = starter.filter((question) =>
			question.kind === 'text' || question.kind === 'amount'
				? question.prefill === undefined && question.placeholder === undefined
				: false
		);
		expect(bare).toEqual([]);
	});

	it.each([
		['year_end', 'next-year'],
		['emergency', 'pays-for'],
		['event', 'raised-for'],
		['monthly', 'keeps-going'],
		['program', 'pays-for'],
		['other', 'pays-for']
	] as const)(
		'of a %s campaign ask what gifts do as rows of 25, 50 and 100 dollars with the type’s own examples',
		(type, id) => {
			const impact = starterQuestions('campaign', type, false).find((one) => one.id === id);
			expect(impact).toMatchObject({
				kind: 'tiers',
				rows: [{ amount: 2500 }, { amount: 5000 }, { amount: 10000 }]
			});
			const examples = impact?.kind === 'tiers' ? (impact.placeholders ?? []) : [];
			expect(examples).toHaveLength(3);
			const others = CAMPAIGN_TYPES.filter((one) => one !== type).flatMap((one) =>
				starterQuestions('campaign', one, false).flatMap((question) =>
					question.kind === 'tiers' ? (question.placeholders ?? []) : []
				)
			);
			expect(examples.filter((example) => others.includes(example))).toEqual([]);
		}
	);

	it.each(STARTERS)('of %s leave a tier’s words for the operator to write', (_, starter) => {
		const prefilled = starter.flatMap((question) =>
			question.kind === 'tiers' ? question.rows.filter(({ text }) => text !== undefined) : []
		);
		expect(prefilled).toEqual([]);
	});

	it.each(CAMPAIGN_TYPES)('of a %s campaign are on the rule, with the mission first', (type) => {
		const starter = starterQuestions('campaign', type, true);
		expect(readAsk(starter)).toEqual({ ok: true, questions: starter });
	});
});
