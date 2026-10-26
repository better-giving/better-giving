// the two pages every other page starts from: the Donation page as first need makes it (and as
// Reset to default puts it back), and the clean campaign New campaign opens on. changing what a
// fresh page holds is an edit here and nowhere else.
//
// each is a page `parsePage` accepts for its own type, held by ./defaults.spec.ts. both headings
// are empty, which draws the campaign's name, and on the Donation page "Donate to" the
// organisation's name as it stands when the page is drawn (`SECTION_DATA.heading` in ./catalog.ts,
// `titleHeading` in ../donate/page-view.tsx) — so a page made before set-up named the
// organisation, or before a rename, greets donors by today's name. a fresh campaign holds no story,
// photo, tier or question, so ./shape.ts draws it as the card.
//
// a fresh object per call: the editor changes what it is handed.
import type { Page } from './catalog';

const switchesOff = () => ({ openOnMonthly: false, dedicationOn: false });

export function defaultDonationPage(): Page {
	return { heading: '', switches: switchesOff() };
}

export function defaultCampaign(): Page {
	return { heading: '', switches: switchesOff() };
}
