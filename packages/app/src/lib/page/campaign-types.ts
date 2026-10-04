// the kinds of campaign an operator picks from when starting one, stored on the campaign's page row
// as `page.campaign_type` and checked there by `$lib/server/db/schema.ts`. a campaign made before
// the type was asked holds none. each type's label and line are what New campaign shows, the label
// is what the chat's model is told the campaign is, and the starter questions are what its opening
// asks when no model writes its own (`starterQuestions` in ./questions.ts).
//
// pure, and imports nothing at run time, for the reason ./keys.ts gives: the one import is a type.

import type { Question } from './questions';

export const CAMPAIGN_TYPES = [
	'year_end',
	'emergency',
	'building',
	'event',
	'tribute',
	'monthly',
	'program',
	'other'
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export type CampaignTypeDetails = {
	readonly label: string;
	/** one line under the label, saying what the type is for. */
	readonly description: string;
	/** on the question rule (`askSchema` in ./questions.ts), ids unique and none `mission`. */
	readonly starter: readonly Question[];
};

const GOAL = { id: 'goal', kind: 'amount', prompt: 'Goal' } as const satisfies Question;
const END_DATE = { id: 'end-date', kind: 'date', prompt: 'End date' } as const satisfies Question;
const PAYS_FOR = {
	id: 'pays-for',
	kind: 'text',
	prompt: 'What will gifts pay for?'
} as const satisfies Question;

export const CAMPAIGN_TYPE_DETAILS: Record<CampaignType, CampaignTypeDetails> = {
	year_end: {
		label: 'Year-end appeal',
		description: 'The giving-season ask',
		starter: [
			{ id: 'this-year', kind: 'text', prompt: 'What did this year’s gifts make possible?' },
			{ id: 'next-year', kind: 'text', prompt: 'What will next year’s gifts do first?' },
			GOAL,
			END_DATE
		]
	},
	emergency: {
		label: 'Emergency response',
		description: 'A crisis, right now',
		starter: [
			{ id: 'what-happened', kind: 'text', prompt: 'What happened?' },
			{ id: 'who-where', kind: 'text', prompt: 'Who and where are you helping?' },
			PAYS_FOR,
			GOAL,
			END_DATE
		]
	},
	building: {
		label: 'Building fund',
		description: 'A place, a roof, a van',
		starter: [
			{ id: 'building', kind: 'text', prompt: 'What are you building or buying?' },
			{ id: 'why', kind: 'text', prompt: 'Why does it matter to the people you serve?' },
			GOAL,
			END_DATE
		]
	},
	event: {
		label: 'Event or fundraiser',
		description: 'A run, a gala, a bake sale',
		starter: [
			{ id: 'event', kind: 'text', prompt: 'What’s the event?' },
			{ id: 'event-date', kind: 'date', prompt: 'When is it?' },
			{ id: 'raised-for', kind: 'text', prompt: 'What will the money raised do?' },
			GOAL
		]
	},
	tribute: {
		label: 'In memory or honour',
		description: 'Gifts in someone’s name',
		starter: [
			{ id: 'honoree', kind: 'text', prompt: 'Who are the gifts in memory or honour of?' },
			{
				id: 'memory-or-honour',
				kind: 'choice',
				prompt: 'In memory or in honour?',
				options: ['In memory', 'In honour']
			},
			{ id: 'support', kind: 'text', prompt: 'What would they want gifts to support?' },
			GOAL
		]
	},
	monthly: {
		label: 'Monthly giving drive',
		description: 'Grow regular donors',
		starter: [
			{ id: 'keeps-going', kind: 'text', prompt: 'What does a monthly gift keep going?' },
			{ id: 'typical-gift', kind: 'amount', prompt: 'A typical monthly gift' },
			{ id: 'who', kind: 'text', prompt: 'Who do monthly donors help?' }
		]
	},
	program: {
		label: 'A program or project',
		description: 'One piece of your work',
		starter: [
			{ id: 'program', kind: 'text', prompt: 'Which program or project?' },
			{ id: 'what-for-whom', kind: 'text', prompt: 'What does it do, and for whom?' },
			PAYS_FOR,
			GOAL,
			END_DATE
		]
	},
	other: {
		label: 'Something else',
		description: 'Tell the AI what it is',
		starter: [
			{ id: 'purpose', kind: 'text', prompt: 'What is this campaign for?' },
			{ id: 'who', kind: 'text', prompt: 'Who does it help?' },
			PAYS_FOR,
			GOAL,
			END_DATE
		]
	}
};
