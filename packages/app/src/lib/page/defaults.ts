// the two pages every other page starts from: the Donation page as first need makes it (and as
// Reset to default puts it back), and the clean campaign New campaign opens on. changing what a
// fresh page looks like is an edit here and nowhere else.
//
// each is a page `parsePage` accepts for its own type, held by ./defaults.spec.ts. the look is
// absent, so both draw ./keys.ts's `DEFAULT_SHADE` and `DEFAULT_CORNER`. a block with nothing to
// show yet — the campaign's hero with no photo, its goal bar with no goal, its story with a blank
// body — is placed anyway and leaves itself out at render until it has content. both title
// headings are empty, which draws the campaign's name, and on the donation page "Donate to" the
// organisation's name as it stands when the page is drawn (`BLOCK_DATA.title` in ./catalog.ts,
// `titleHeading` in ../donate/page-view.tsx) — so a page made before set-up named the
// organisation, or before a rename, greets donors by today's name.
//
// a block an operator adds is made here too (`startingBlock`): its type's first variant and first
// background, around the same starting words the pages below give it, or none.
//
// a fresh object per call: the editor changes what it is handed.
import { BLOCKS, type Block, type BlockType, type Page } from './catalog';

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

/** a block an operator may add: every one but the donation box, which a page holds exactly once. */
export type AddableBlockType = Exclude<BlockType, 'donation-box'>;

/** a block of `type` as it is added, under `id`. */
export function startingBlock(type: AddableBlockType, id: string): Block {
	switch (type) {
		case 'title':
			return { ...framed(type, id), heading: '' };
		case 'story':
			return { ...framed(type, id), body: blankStory() };
		case 'impact-tiers':
			return { ...framed(type, id), tiers: [] };
		case 'faq':
			return { ...framed(type, id), items: [] };
		case 'hero':
			return { ...framed(type, id), imageId: null, alt: null };
		case 'image':
			return { ...framed(type, id), imageId: null, alt: null };
		case 'about-us':
			return framed(type, id);
		case 'org-info':
			return framed(type, id);
		case 'share':
			return framed(type, id);
		case 'goal-bar':
			return framed(type, id);
		case 'program-chooser':
			return framed(type, id);
	}
}

type Frame<T extends AddableBlockType> = {
	id: string;
	type: T;
	variant: (typeof BLOCKS)[T]['variants'][0];
	background: (typeof BLOCKS)[T]['backgrounds'][0];
};

function framed<T extends AddableBlockType>(type: T, id: string): Frame<T> {
	const { variants, backgrounds } = BLOCKS[type];
	// indexing `BLOCKS` by a type parameter widens to every block's names; `Frame` holds them to T's.
	return { id, type, variant: variants[0], background: backgrounds[0] } as Frame<T>;
}
