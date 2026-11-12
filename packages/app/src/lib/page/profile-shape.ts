// which whole layout the Donation page at /donate is drawn in, picked from what the organisation has
// put on it and never by a setting: the campaign's rule (./shape.ts) over the profile's content.
//
// `storyLength` is the mission and the vision, each trimmed, joined by one blank line, in
// characters of plain text. `extras` is one per video shown, and one more where any donor message
// is approved for the page, whether there is one or 48. it reads `messages.total` and never the
// six first drawn, so Show more cannot move the layout: a page changes layout only when someone
// edits it. the banner, the logo and the EIN are not counted.
//
// pure and not under `$lib/server/**`: ../donate/page-view.tsx draws what this returns, and its
// specs read it alike.
import { type Layout, thresholdLayout } from './shape';

/** what the shape reads of the Donation page's profile (`DonateProfile` in ../donate/profile.ts). */
export type ProfileContent = {
	readonly mission: string | null;
	readonly vision: string | null;
	readonly videos: readonly unknown[];
	readonly messages: { readonly total: number };
};

export type ProfileShape = {
	readonly layout: Layout;
	readonly storyLength: number;
	readonly extras: number;
	/** the organisation has written a mission or a vision: one that is empty after trimming is not written. */
	readonly aboutUs: boolean;
};

export function profileShape(profile: ProfileContent): ProfileShape {
	const written = [profile.mission, profile.vision].flatMap((text) =>
		text === null || text.trim() === '' ? [] : [text.trim()]
	);
	const storyLength = written.join('\n\n').length;
	const extras = profile.videos.length + (profile.messages.total > 0 ? 1 : 0);
	return {
		layout: thresholdLayout(storyLength, extras),
		storyLength,
		extras,
		aboutUs: written.length > 0
	};
}
