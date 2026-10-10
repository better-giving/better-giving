// the kinds of campaign an operator picks from when starting one, stored on the campaign's page row
// as `page.campaign_type` and checked there by `$lib/server/db/schema.ts`. a campaign made before
// the type was asked holds none. each type's label and line are what New campaign shows, the label
// is what the chat's model is told the campaign is, and the starter questions are what its opening
// asks when no model writes its own (`starterQuestions` in ./questions.ts), `other`'s for a campaign
// that holds none. a starter asks only what the page cannot be written without: a goal, an end date,
// amounts and what they buy leave a complete page when blank, so none is asked here, and each stays
// the operator's to set by Edit or through the chat. an event's day is asked, since its page reads
// incomplete without one.
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

export const CAMPAIGN_TYPE_DETAILS: Record<CampaignType, CampaignTypeDetails> = {
	year_end: {
		label: 'Year-end appeal',
		description: 'The giving-season ask',
		starter: [
			{
				id: 'this-year',
				kind: 'text',
				prompt: 'What did this year’s gifts make possible?',
				placeholder: 'Hot meals for families all through the winter'
			},
			{
				id: 'next-year',
				kind: 'text',
				prompt: 'What will a gift do next year?',
				placeholder: 'A month of meals for a family'
			}
		]
	},
	emergency: {
		label: 'Emergency response',
		description: 'A crisis, right now',
		starter: [
			{
				id: 'what-happened',
				kind: 'text',
				prompt: 'What happened?',
				placeholder: 'A flood hit the east side of town last night'
			},
			{
				id: 'who-where',
				kind: 'text',
				prompt: 'Who and where are you helping?',
				placeholder: 'Families sheltering in the east side’s schools'
			}
		]
	},
	building: {
		label: 'Building fund',
		description: 'A place, a roof, a van',
		starter: [
			{
				id: 'building',
				kind: 'text',
				prompt: 'What are you building or buying?',
				placeholder: 'A new roof for our community kitchen'
			},
			{
				id: 'why',
				kind: 'text',
				prompt: 'Why does it matter to the people you serve?',
				placeholder: 'It keeps the kitchen open through the winter'
			}
		]
	},
	event: {
		label: 'Event or fundraiser',
		description: 'A run, a gala, a bake sale',
		starter: [
			{
				id: 'event',
				kind: 'text',
				prompt: 'What’s the event?',
				placeholder: 'A fun run in the park'
			},
			{ id: 'event-date', kind: 'date', prompt: 'When is it?' },
			{
				id: 'raised-for',
				kind: 'text',
				prompt: 'What will the money raised do?',
				placeholder: 'A seat at summer camp for one child'
			}
		]
	},
	tribute: {
		label: 'In memory or honour',
		description: 'Gifts in someone’s name',
		starter: [
			{
				id: 'honoree',
				kind: 'text',
				prompt: 'Who are the gifts in memory or honour of?',
				placeholder: 'Maria Lopez, our founder'
			},
			{
				id: 'memory-or-honour',
				kind: 'choice',
				prompt: 'In memory or in honour?',
				options: ['In memory', 'In honour']
			},
			{
				id: 'support',
				kind: 'text',
				prompt: 'What would they want gifts to support?',
				placeholder: 'The reading club she started'
			}
		]
	},
	monthly: {
		label: 'Monthly giving drive',
		description: 'Grow regular donors',
		starter: [
			{
				id: 'keeps-going',
				kind: 'text',
				prompt: 'What does a monthly gift keep going?',
				placeholder: 'A hot lunch every week'
			},
			{
				id: 'who',
				kind: 'text',
				prompt: 'Who do monthly donors help?',
				placeholder: 'Children in our reading program'
			}
		]
	},
	program: {
		label: 'A program or project',
		description: 'One piece of your work',
		starter: [
			{
				id: 'program',
				kind: 'text',
				prompt: 'Which program or project?',
				placeholder: 'Our after-school reading club'
			},
			{
				id: 'what-for-whom',
				kind: 'text',
				prompt: 'What does it do, and for whom?',
				placeholder: 'Weekly reading help for children behind at school'
			}
		]
	},
	other: {
		label: 'Something else',
		description: 'Tell the AI what it is',
		starter: [
			{
				id: 'purpose',
				kind: 'text',
				prompt: 'What is this campaign for?',
				placeholder: 'A new community garden'
			},
			{
				id: 'who',
				kind: 'text',
				prompt: 'Who does it help?',
				placeholder: 'Families in our neighbourhood'
			}
		]
	}
};
