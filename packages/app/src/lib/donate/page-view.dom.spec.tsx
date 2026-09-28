import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { BLOCK_TYPES, BLOCKS, type Block, type Page, parsePage } from '../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../page/defaults';
import { LAYOUTS, type Layout, PAGE_TYPES, type PageType } from '../page/keys';
import { BLOCK_MESSAGE } from '../page/preview-message';
import type { RichTextDocument } from '../rich-text/document';
import { PageView, type PageViewProps } from './page-view';

// the page's renderer, mounted: which blocks draw and which leave themselves out, where each stands
// in each layout, and that the donation box is always there, once, outside every block. the page is
// built from `BLOCKS`, so a variant added to the catalog is drawn here without a line of this file
// changing. how any of it looks is left to a person looking at it.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words = (text: string): RichTextDocument => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});
const blank = (): RichTextDocument => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** one block of each type and variant, holding what it draws. */
function blockOf(type: Block['type'], variant: string | null, id: string): unknown {
	const frame = { id, type, variant, background: 'none' };
	switch (type) {
		case 'title':
			return { ...frame, heading: 'Winter coat drive', lede: 'Every kid starts winter warm.' };
		case 'story':
			return {
				...frame,
				body: {
					type: 'doc',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: 'Last winter, 300 kids came without a coat.' }]
						},
						{
							type: 'paragraph',
							content: [{ type: 'text', text: 'This year we are buying one for each.' }]
						}
					]
				}
			};
		case 'impact-tiers':
			return {
				...frame,
				tiers: [
					{ amountMinor: 2500, buys: 'Hat and gloves for one child' },
					{ amountMinor: 5000, buys: 'One new winter coat' }
				]
			};
		case 'faq':
			return {
				...frame,
				items: [
					{ question: 'Can I drop off a coat instead?', answer: words('Yes, on Saturdays.') },
					{ question: 'Can I give monthly?', answer: words('Yes. Choose Monthly in the box.') }
				]
			};
		case 'about-us':
		case 'org-info':
		case 'share':
		case 'goal-bar':
		case 'program-chooser':
			return frame;
		case 'donation-box':
			return { id, type, background: 'none' };
	}
}

/** a page of the type holding every block it takes in every variant, the box after the companions. */
function everyBlock(type: PageType, layout: Layout): Page {
	const blocks: unknown[] = [];
	for (const blockType of BLOCK_TYPES) {
		const { variants, pages } = BLOCKS[blockType];
		if (blockType === 'donation-box' || !(pages as readonly PageType[]).includes(type)) continue;
		for (const variant of variants ?? [])
			blocks.push(blockOf(blockType, variant, `${blockType}-${variant}`));
	}
	const companions = blocks.filter((b) =>
		['goal-bar', 'program-chooser'].includes((b as Block).type)
	);
	const rest = blocks.filter((b) => !companions.includes(b));
	const page = {
		layout,
		palette: 'tint',
		switches: { openOnMonthly: false, dedicationOn: false },
		blocks: [
			...rest.slice(0, 2),
			...companions,
			blockOf('donation-box', null, 'donate'),
			...rest.slice(2)
		]
	};
	return parsed(type, page);
}

function parsed(type: PageType, input: unknown): Page {
	const result = parsePage(type, input);
	if (!result.ok) throw new Error(result.message);
	return result.page;
}

const PROGRAMS = [
	{
		id: 'prog-food',
		name: 'Food pantry',
		description: 'Groceries for 180 families, every Thursday.'
	},
	{ id: 'prog-coats', name: 'Winter coats' }
];

function props(type: PageType, page: Page, over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type,
		page,
		pageName: type === 'campaign' ? 'Winter coat drive' : null,
		org: {
			name: 'Northside Neighbors',
			mission: words('No family on the north side goes without food or warmth.'),
			vision: words('A north side where every neighbor has what they need.'),
			info: {
				legalName: 'Northside Neighbors',
				ein: '84-2913377',
				addressLines: ['40 Elm Street', 'Easton, PA 18042', 'United States'],
				email: 'hello@northsideneighbors.org',
				links: [{ label: 'Instagram', href: 'https://instagram.com/northside' }]
			}
		},
		look: { brandColour: '#1d6b4f', shade: 'warm', corner: 'round' },
		sharing: {
			channels: ['facebook', 'whatsapp', 'email', 'copy-link', 'linkedin', 'x'],
			message: 'Help us get every kid a coat.',
			url: 'https://give.example.org/coats'
		},
		goal:
			type === 'campaign'
				? { raisedMinor: 984000, goalMinor: 1500000, endsAt: 'December 31' }
				: null,
		money: { locale: 'en-US', currency: 'usd' },
		programs: PROGRAMS,
		programMode: 'choice',
		donationBox: () => <div data-testid="box">the donation box</div>,
		...over
	};
}

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const drawn = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>('[data-block]')].map((node) => node.dataset.block);

/** the one box, and the block wrapper it stands in, if any but its own. */
function theBox(root: HTMLElement) {
	const boxes = root.querySelectorAll('[data-testid="box"]');
	expect(boxes).toHaveLength(1);
	const box = boxes[0] as HTMLElement;
	const own = box.closest<HTMLElement>('[data-block]');
	expect(own?.dataset.block).toBe('donation-box');
	return { own, outside: own?.parentElement?.closest('[data-block]') ?? null };
}

const cases = PAGE_TYPES.flatMap((type) => LAYOUTS.map((layout) => [type, layout] as const));

describe('every block in every variant, in every layout', () => {
	it.each(cases)('the %s draws each block it takes, laid out %s', (type, layout) => {
		const page = everyBlock(type, layout);
		const root = mount(<PageView {...props(type, page)} />);
		const expected = page.blocks.map((block) => block.type);
		expect(drawn(root).sort()).toEqual([...expected].sort());
		for (const block of page.blocks)
			expect(root.querySelector(`#blk-${block.id}`), block.id).not.toBeNull();
	});

	it.each(cases)('the %s laid out %s holds the box once, outside every block', (type, layout) => {
		const root = mount(<PageView {...props(type, everyBlock(type, layout))} />);
		const { outside } = theBox(root);
		expect(outside).toBeNull();
	});

	it.each(PAGE_TYPES)('the %s default holds the box once, outside every block', (type) => {
		const page =
			type === 'campaign'
				? defaultCampaign()
				: defaultDonationPage({ name: 'Northside Neighbors' });
		for (const layout of LAYOUTS) {
			const root = mount(<PageView {...props(type, { ...page, layout })} />);
			expect(theBox(root).outside).toBeNull();
		}
	});
});

describe('where the blocks stand', () => {
	it('moves a companion listed directly before the box into the box’s column', () => {
		const page = everyBlock('campaign', 'box-right');
		const root = mount(<PageView {...props('campaign', page)} />);
		const aside = root.querySelector('.page-aside');
		expect(
			[...(aside?.querySelectorAll<HTMLElement>('[data-block]') ?? [])].map((n) => n.dataset.block)
		).toEqual(['goal-bar', 'goal-bar', 'donation-box']);
	});

	it('keeps the stored order in one column', () => {
		const page = everyBlock('campaign', 'column');
		const root = mount(<PageView {...props('campaign', page)} />);
		expect(root.querySelector('.page-split')).toBeNull();
		const body = [...root.querySelectorAll<HTMLElement>('main [data-block]')].map(
			(n) => n.dataset.blockId
		);
		expect(body).toEqual(
			page.blocks.filter((b) => !(b.type === 'org-info' && b.variant === 'footer')).map((b) => b.id)
		);
	});

	it('draws a cover page with no hero as box-right', () => {
		const root = mount(<PageView {...props('campaign', everyBlock('campaign', 'cover'))} />);
		expect(root.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('box-right');
		expect(root.querySelector('.page-aside [data-block="donation-box"]')).not.toBeNull();
	});

	it('closes the page with an org-info footer wherever it is listed', () => {
		const page = defaultCampaign();
		const footer = page.blocks.find((b) => b.type === 'org-info');
		if (footer === undefined) throw new Error('the default campaign has an org-info footer');
		const moved = { ...page, blocks: [footer, ...page.blocks.filter((b) => b !== footer)] };
		const root = mount(<PageView {...props('campaign', moved)} />);
		expect(root.querySelector('footer [data-block="org-info"]')).not.toBeNull();
		expect(drawn(root).at(-1)).toBe('org-info');
	});

	it('prefixes each block’s element id', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		expect(root.querySelector('#blk-donate')?.getAttribute('data-block-id')).toBe('donate');
	});
});

describe('a block with nothing to show leaves itself out', () => {
	const donation = () => defaultDonationPage({ name: 'Northside Neighbors' });
	const box =
		(calls: { hideProgramSelect: boolean }[]) => (options: { hideProgramSelect: boolean }) => {
			calls.push(options);
			return <div data-testid="box" />;
		};

	it('draws the chooser on the Donation page when donors choose among two programs or more', () => {
		const calls: { hideProgramSelect: boolean }[] = [];
		const root = mount(
			<PageView {...props('donation_page', donation(), { donationBox: box(calls) })} />
		);
		expect(drawn(root)).toContain('program-chooser');
		expect(calls.at(-1)).toEqual({ hideProgramSelect: true });
	});

	it.each([
		['one program', { programMode: 'pinned' as const }],
		['no program', { programMode: 'none' as const }],
		['a single program to choose', { programs: PROGRAMS.slice(0, 1) }]
	])('leaves the chooser out under %s, and the box keeps its own select', (_, over) => {
		const calls: { hideProgramSelect: boolean }[] = [];
		const root = mount(
			<PageView {...props('donation_page', donation(), { ...over, donationBox: box(calls) })} />
		);
		expect(drawn(root)).not.toContain('program-chooser');
		expect(calls.at(-1)).toEqual({ hideProgramSelect: false });
	});

	it('leaves the goal bar out of a campaign with no goal', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign(), { goal: null })} />);
		expect(drawn(root)).not.toContain('goal-bar');
	});

	it('leaves out a blank story, and tiers and questions with none listed', () => {
		const page = parsed('campaign', {
			...defaultCampaign(),
			blocks: [
				...defaultCampaign().blocks,
				{ id: 'tiers', type: 'impact-tiers', variant: 'cards', background: 'none', tiers: [] },
				{ id: 'faq', type: 'faq', variant: 'open', background: 'none', items: [] }
			]
		});
		const root = mount(<PageView {...props('campaign', page)} />);
		expect(drawn(root)).not.toContain('story');
		expect(drawn(root)).not.toContain('impact-tiers');
		expect(drawn(root)).not.toContain('faq');
	});

	it('leaves about-us out when the mission and the vision are both empty', () => {
		const org = props('donation_page', donation()).org;
		const none = mount(
			<PageView
				{...props('donation_page', donation(), { org: { ...org, mission: null, vision: blank() } })}
			/>
		);
		expect(drawn(none)).not.toContain('about-us');
		const one = mount(
			<PageView {...props('donation_page', donation(), { org: { ...org, mission: null } })} />
		);
		expect(drawn(one)).toContain('about-us');
		expect(one.querySelector('[data-block="about-us"]')?.textContent).not.toContain('Our mission');
	});

	it('leaves share out with no channels to offer', () => {
		const sharing = { channels: [], message: '', url: 'https://give.example.org/donate' };
		const root = mount(<PageView {...props('donation_page', donation(), { sharing })} />);
		expect(drawn(root)).not.toContain('share');
	});
});

describe('the title', () => {
	const titled = (heading: string, lede?: string) => ({
		...defaultCampaign(),
		blocks: defaultCampaign().blocks.map((b) =>
			b.type === 'title'
				? { ...b, variant: 'center' as const, heading, ...(lede === undefined ? {} : { lede }) }
				: b
		)
	});

	it('draws a campaign’s name for an empty heading, and the organisation on the Donation page', () => {
		const campaign = mount(<PageView {...props('campaign', titled(''))} />);
		expect(campaign.querySelector('h1')?.textContent).toBe('Winter coat drive');
		const page = { ...titled(''), blocks: titled('').blocks.filter((b) => b.type !== 'goal-bar') };
		const donation = mount(<PageView {...props('donation_page', page)} />);
		expect(donation.querySelector('h1')?.textContent).toBe('Donate to Northside Neighbors');
	});

	it('draws a centred title left when its lede runs past 120 characters', () => {
		const long = mount(<PageView {...props('campaign', titled('Coats', 'x'.repeat(121)))} />);
		expect(long.querySelector('.page-title')?.getAttribute('data-variant')).toBe('left');
		const short = mount(<PageView {...props('campaign', titled('Coats', 'x'.repeat(120)))} />);
		expect(short.querySelector('.page-title')?.getAttribute('data-variant')).toBe('center');
	});
});

describe('the program chooser', () => {
	it('hands a pick to the route, and draws the pick it is handed', () => {
		const onProgramPick = vi.fn();
		const page = defaultDonationPage({ name: 'Northside Neighbors' });
		const root = mount(
			<PageView
				{...props('donation_page', page, { onProgramPick, chosenProgramId: 'prog-food' })}
			/>
		);
		const radios = [
			...root.querySelectorAll<HTMLInputElement>(
				'[data-block="program-chooser"] input[type="radio"]'
			)
		];
		expect(radios.map((r) => r.parentElement?.textContent)).toEqual([
			'Where it’s needed most',
			'Food pantryGroceries for 180 families, every Thursday.',
			'Winter coats'
		]);
		expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
		act(() => radios[2]?.click());
		expect(onProgramPick).toHaveBeenLastCalledWith('prog-coats');
		act(() => radios[0]?.click());
		expect(onProgramPick).toHaveBeenLastCalledWith(null);
	});
});

describe('share', () => {
	it('copies the page’s address and says so at the press and out loud', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const status = root.querySelector('[data-block="share"] [role="status"]');
		expect(status?.textContent).toBe('');
		const press = root.querySelector<HTMLButtonElement>('[data-block="share"] button');
		await act(async () => press?.click());
		expect(writeText).toHaveBeenCalledWith('https://give.example.org/coats');
		expect(status?.textContent).toBe('Link copied');
		expect(press?.querySelector('[data-shown]')?.textContent).toBe('Link copied');
	});

	it('draws the channels in the organisation’s order, each opening its own share', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const hrefs = [...root.querySelectorAll<HTMLAnchorElement>('[data-block="share"] a')].map(
			(a) => new URL(a.href).host || a.href.split(':')[0]
		);
		expect(hrefs).toEqual(['www.facebook.com', 'wa.me', 'mailto', 'www.linkedin.com', 'x.com']);
	});
});

describe('the preview', () => {
	it('reports the block a click lands in to the editor, and follows nothing', () => {
		const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
		onTestFinished(() => post.mockRestore());
		const root = mount(<PageView {...props('campaign', defaultCampaign())} preview />);
		const link = root.querySelector<HTMLAnchorElement>('[data-block="share"] a');
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		act(() => link?.dispatchEvent(event));
		expect(event.defaultPrevented).toBe(true);
		expect(post).toHaveBeenCalledWith({ type: BLOCK_MESSAGE, id: 'share' }, window.location.origin);
	});

	it('posts nothing outside the preview', () => {
		const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
		onTestFinished(() => post.mockRestore());
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		act(() => root.querySelector<HTMLElement>('[data-block="title"]')?.click());
		expect(post).not.toHaveBeenCalled();
	});
});
