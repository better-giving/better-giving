// the kinds of campaign an operator picks from when starting one, stored on the campaign's page row
// as `page.campaign_type` and checked there by `$lib/server/db/schema.ts`. a campaign made before
// the type was asked holds none. each type's label and line are what New campaign shows.
//
// pure, and imports nothing, for the reason ./keys.ts gives.

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
};

export const CAMPAIGN_TYPE_DETAILS: Record<CampaignType, CampaignTypeDetails> = {
	year_end: {
		label: 'Year-end appeal',
		description: 'The giving-season ask'
	},
	emergency: {
		label: 'Emergency response',
		description: 'A crisis, right now'
	},
	building: {
		label: 'Building fund',
		description: 'A place, a roof, a van'
	},
	event: {
		label: 'Event or fundraiser',
		description: 'A run, a gala, a bake sale'
	},
	tribute: {
		label: 'In memory or honour',
		description: 'Gifts in someone’s name'
	},
	monthly: {
		label: 'Monthly giving drive',
		description: 'Grow regular donors'
	},
	program: {
		label: 'A program or project',
		description: 'One piece of your work'
	},
	other: {
		label: 'Something else',
		description: 'Any other kind of campaign'
	}
};
