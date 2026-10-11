// the kinds of campaign a campaign may be, stored on its page row as `page.campaign_type` and
// checked there by `$lib/server/db/schema.ts`. nothing in this release writes one: New campaign asks
// for a name alone, so every campaign holds null until a later caller sets it.
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
