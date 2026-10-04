// the kinds of campaign an operator picks from when starting one, stored on the campaign's page row
// as `page.campaign_type` and checked there by `$lib/server/db/schema.ts`. a campaign made before
// the type was asked holds none. pure and imports nothing, for the reason ./keys.ts gives.

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
