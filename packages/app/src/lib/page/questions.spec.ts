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
			['pays-for', 'text'],
			['goal', 'amount'],
			['end-date', 'date']
		]);
		expect(readAsk(starter)).toEqual({ ok: true, questions: starter });
	});

	it('of a campaign made before types stay at five with the mission first', () => {
		const starter = starterQuestions('campaign', null, true);
		expect(starter.map(({ id }) => id)).toEqual(['mission', 'purpose', 'who', 'pays-for', 'goal']);
	});

	it('of an event are its own, in the order the type asks them', () => {
		const starter = starterQuestions('campaign', 'event', false);
		expect(starter.map(({ kind, prompt }) => [kind, prompt])).toEqual([
			['text', 'What’s the event?'],
			['date', 'When is it?'],
			['text', 'What will the money raised do?'],
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

	it.each(CAMPAIGN_TYPES)('of a %s campaign are on the rule, with the mission first', (type) => {
		const starter = starterQuestions('campaign', type, true);
		expect(readAsk(starter)).toEqual({ ok: true, questions: starter });
	});
});
