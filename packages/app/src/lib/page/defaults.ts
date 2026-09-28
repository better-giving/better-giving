// the two pages every other page starts from: the Donation page as first need makes it (and as
// Reset to default puts it back), and the clean campaign New campaign opens on. changing what a
// fresh page looks like is an edit here and nowhere else.
//
// each is a page `parsePage` accepts for its own type, held by ./defaults.spec.ts. the look is
// absent, so both draw in the organisation's own. a block with nothing to show yet — the campaign's
// hero with no photo, its goal bar with no goal, its story with a blank body — is placed anyway and
// leaves itself out at render until it has content. both title headings are empty, which draws the
// campaign's name, and on the donation page "Donate to" the organisation's name as it stands when
// the page is drawn (`BLOCK_DATA.title` in ./catalog.ts, `titleHeading` in ../donate/page-view.tsx)
// — so a page made before set-up named the organisation, or before a rename, greets donors by
// today's name.
//
// a fresh object per call: the editor changes what it is handed.
import type { Page } from './catalog';

const blankStory = () => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const }] });

const switchesOff = () => ({ openOnMonthly: false, dedicationOn: false });

export function defaultDonationPage(): Page {
	return {
		layout: 'box-right',
		palette: 'tint',
		switches: switchesOff(),
		blocks: [
			{
				id: 'title',
				type: 'title',
				variant: 'left',
				background: 'none',
				heading: ''
			},
			{ id: 'programs', type: 'program-chooser', variant: 'cards', background: 'none' },
			{ id: 'donate', type: 'donation-box', background: 'none' },
			{ id: 'about', type: 'about-us', variant: 'stacked', background: 'soft' },
			{ id: 'share', type: 'share', variant: 'buttons', background: 'none' },
			{ id: 'footer', type: 'org-info', variant: 'footer', background: 'none' }
		]
	};
}

export function defaultCampaign(): Page {
	return {
		layout: 'box-right',
		palette: 'tint',
		switches: switchesOff(),
		blocks: [
			{ id: 'hero', type: 'hero', variant: 'framed', background: 'none', imageId: null, alt: null },
			{ id: 'title', type: 'title', variant: 'left', background: 'none', heading: '' },
			{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none' },
			{ id: 'story', type: 'story', variant: 'plain', background: 'none', body: blankStory() },
			{ id: 'donate', type: 'donation-box', background: 'none' },
			{ id: 'share', type: 'share', variant: 'buttons', background: 'none' },
			{ id: 'footer', type: 'org-info', variant: 'footer', background: 'none' }
		]
	};
}
