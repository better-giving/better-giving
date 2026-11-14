import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
	FundraiserEndedPage,
	FundraiserNotFoundPage,
	FundraiserPage,
	type FundraiserPageViewProps,
	firstName
} from './fundraiser-page';
import type { EndedFundraiserView, LiveFundraiserView } from './types';

// a supporter's fundraiser at /f/<slug>, mounted in each answer the public read gives and each
// state a live one is in: part way, just started, past its goal, ended, and hidden as a visitor
// meets it. how any of it looks is the stylesheet's and a person's looking at it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-11-11T15:00:00.000Z';

const PART_WAY: LiveFundraiserView = {
	title: 'Keep the pantry trucks running this winter',
	story:
		'I drive the Thursday route for Harbor Light’s pantry.\n\nMy goal is $5,000, enough to cover the winter.',
	name: 'Maya Reyes',
	startedAt: '2026-11-02T09:30:00.000Z',
	photoId: '0192a4c1-0000-7000-8000-000000000001',
	raisedMinor: 324_000,
	goalMinor: 500_000,
	gifts: 41,
	goalReached: false,
	messages: {
		messages: [
			{
				name: 'Priya S.',
				note: 'Matching my coworkers’ gifts.',
				receivedAt: '2026-11-11T08:00:00Z'
			}
		],
		total: 1,
		next: null
	}
};

const JUST_STARTED: LiveFundraiserView = {
	...PART_WAY,
	title: 'Birthday pantry drive',
	name: 'Jo Okafor',
	startedAt: '2026-11-11T07:00:00.000Z',
	photoId: null,
	raisedMinor: 0,
	goalMinor: 100_000,
	gifts: 0,
	messages: null
};

const MET: LiveFundraiserView = {
	...PART_WAY,
	raisedMinor: 542_000,
	gifts: 63,
	goalReached: true
};

const WIRING = { now: NOW, status: 'idle', arrived: null, onShowMore: () => {} } as const;

function props(
	fundraiser: LiveFundraiserView,
	over: Partial<FundraiserPageViewProps> = {}
): FundraiserPageViewProps {
	return {
		fundraiser,
		org: {
			name: 'Harbor Light',
			taxId: '84-1234567',
			logo: { imageId: 'logo-1', width: 400, height: 400 }
		},
		look: { brandColour: '#1d6b4f' },
		money: { locale: 'en-US', currency: 'USD' },
		now: NOW,
		sharing: { message: '', url: 'https://give.example.org/f/keep-the-pantry-trucks-7k2p' },
		contact: {
			addressLines: ['2200 Lake Avenue', 'Cleveland, Ohio'],
			email: 'hello@harborlight.example',
			socialLinks: []
		},
		fundraiserEntry: true,
		donationBox: <div data-testid="box">the donation box</div>,
		donorMessages: WIRING,
		...over
	};
}

function mount(tree: ReactNode): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(tree));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const bar = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="progressbar"]');
const text = (root: HTMLElement) => root.textContent ?? '';

describe('a live fundraiser, part way', () => {
	it('names who it is for, linking to /donate, over the title and the supporter’s byline', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		const forLine = root.querySelector<HTMLAnchorElement>('.fundraiser-for');
		expect(forLine?.getAttribute('href')).toBe('/donate');
		expect(forLine?.textContent).toBe('A fundraiser for Harbor Light');
		expect(forLine?.querySelector('img')?.getAttribute('alt')).toBe('');
		expect(root.querySelector('h1')?.textContent).toBe(PART_WAY.title);
		expect(root.querySelectorAll('h1')).toHaveLength(1);
		const avatar = root.querySelector('.fundraiser-byline > .ds-avatar');
		expect(avatar?.classList.contains('ds-avatar-lg')).toBe(true);
		expect(avatar?.getAttribute('aria-hidden')).toBe('true');
		expect(avatar?.textContent).toBe('MR');
		expect(root.querySelector('.fundraiser-by')?.textContent).toBe(
			'Maya ReyesStarted this fundraiser on Nov 2, 2026'
		);
	});

	it('states the figure, the goal and the gift count, and lists no gift’s amount', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		expect(root.querySelector('.fundraiser-figures')?.textContent).toBe(
			'$3,240 raised of $5,000 goal · 41 gifts'
		);
		expect(root.querySelectorAll('.ds-badge')).toHaveLength(0);
		expect(text(root)).not.toContain('No gifts yet');
		expect(text(root)).not.toContain('Gifts are still open');
	});

	it('draws the registry’s bar at the floored percent, named, its label out of the reading', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		const track = bar(root);
		expect(track?.getAttribute('aria-label')).toBe('Amount raised');
		expect(track?.getAttribute('aria-valuemin')).toBe('0');
		expect(track?.getAttribute('aria-valuemax')).toBe('100');
		expect(track?.getAttribute('aria-valuenow')).toBe('64');
		expect(track?.getAttribute('aria-valuetext')).toBe('64% of goal');
		expect(track?.hasAttribute('data-state')).toBe(false);
		expect(track?.querySelector<HTMLElement>('.ds-progress-fill')?.style.width).toBe('64%');
		const label = root.querySelector('.ds-progress-label');
		expect(label?.textContent).toBe('64%');
		expect(label?.getAttribute('aria-hidden')).toBe('true');
	});

	it('stands the box ahead of the story, then who the gift goes to, named for the supporter', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		const areas = [...root.querySelectorAll<HTMLElement>('.fundraiser-layout > [data-area]')].map(
			(node) => node.dataset.area
		);
		expect(areas).toEqual(['who', 'side', 'more']);
		const box = root.querySelector('section.page-box');
		expect(box?.getAttribute('aria-label')).toBe("Give to Maya's fundraiser");
		expect(box?.querySelectorAll('[data-testid="box"]')).toHaveLength(1);
		const recipient = root.querySelector('.fundraiser-recipient');
		expect(recipient?.textContent).toContain('Your gift goes to');
		expect(recipient?.querySelector('.page-profile-ein')?.textContent).toBe('EIN 84-1234567');
		expect(recipient?.textContent).toContain(
			'It goes to Harbor Light, not to Maya. Harbor Light sends your receipt.'
		);
		const about = recipient?.querySelector('a');
		expect(about?.textContent).toBe('About Harbor Light');
		expect(about?.getAttribute('href')).toBe('/donate');
	});

	it('tells the story under the supporter’s first name, a paragraph per blank line', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		const story = root.querySelector('[data-area="story"]');
		expect(story?.querySelector('h2')?.textContent).toBe("Maya's story");
		expect(story?.querySelectorAll('.fundraiser-story > p')).toHaveLength(2);
	});

	it('closes on the share row and the footer, with the way to start one while the feature is on', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		expect(root.querySelector('.page-share-heading')?.textContent).toBe('Share this page');
		const foot = root.querySelector('footer');
		expect(foot?.textContent).toContain('2200 Lake Avenue, Cleveland, Ohio');
		expect(foot?.querySelector('a[href="mailto:hello@harborlight.example"]')).not.toBeNull();
		const start = foot?.querySelector<HTMLAnchorElement>('a[href="/fundraise"]');
		expect(start?.textContent).toBe('Start your own fundraiser');
	});

	it('calls a supporter by the whole name where its first word is a title or an initial', () => {
		expect(firstName('  Maya Reyes ')).toBe('Maya');
		expect(firstName('Dr. Maya Reyes')).toBe('Dr. Maya Reyes');
		expect(firstName('Mrs Okafor')).toBe('Mrs Okafor');
		expect(firstName('J. Robert Reyes')).toBe('J. Robert Reyes');
		expect(firstName('Drew Okafor')).toBe('Drew');
		const root = mount(<FundraiserPage {...props({ ...PART_WAY, name: 'Dr. Maya Reyes' })} />);
		expect(root.querySelector('[data-area="story"] h2')?.textContent).toBe(
			"Dr. Maya Reyes's story"
		);
		expect(text(root)).not.toContain("Dr.'s");
		expect(text(root)).toContain('not to Dr. Maya Reyes.');
	});

	it('names no one as who the gift goes to where the organisation has no name set', () => {
		const base = props(PART_WAY);
		const root = mount(<FundraiserPage {...base} org={{ ...base.org, name: null }} />);
		expect(root.querySelector('.fundraiser-for')).toBeNull();
		expect(root.querySelector('.fundraiser-recipient')).toBeNull();
		expect(text(root)).not.toContain('It goes to');
		expect(root.querySelector('section.page-box')).not.toBeNull();
	});

	it('draws no way to start one while Supporter fundraisers is off', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY, { fundraiserEntry: false })} />);
		expect(root.querySelector('a[href="/fundraise"]')).toBeNull();
		expect(text(root)).not.toContain('Start your own fundraiser');
	});
});

describe('staff’s preview', () => {
	const notice = (root: HTMLElement) => root.querySelector<HTMLElement>('.ds-notice-card');
	const preview = (staffNotice: FundraiserPageViewProps['staffNotice']) =>
		mount(<FundraiserPage {...props(PART_WAY, { donationBox: null, staffNotice })} />);

	it('says over the title of a hidden page what a visitor sees instead', () => {
		const root = preview({ hidden: true, note: null });
		const card = notice(root);
		expect(card?.className).toBe('ds-notice-card ds-notice-card-warning');
		const title = card?.querySelector('.ds-notice-card-title');
		expect(title?.textContent).toBe('Hidden from visitors');
		expect(card?.getAttribute('aria-labelledby')).toBe(title?.id);
		expect(card?.hasAttribute('role')).toBe(false);
		expect(
			[...(card?.querySelectorAll('.ds-notice-card-body > p') ?? [])].map((p) => p.textContent)
		).toEqual(['Visitors see “This page is not taking gifts right now.” instead of this page.']);
		const order = [...root.querySelectorAll('.ds-notice-card, h1')].map((node) => node.tagName);
		expect(order).toEqual(['SECTION', 'H1']);
	});

	it('gives staff’s note word for word on its own line', () => {
		const root = preview({ hidden: true, note: 'Please take out the phone number.' });
		const lines = [...(notice(root)?.querySelectorAll('.ds-notice-card-body > p') ?? [])];
		expect(lines.map((p) => p.textContent)).toEqual([
			'Visitors see “This page is not taking gifts right now.” instead of this page.',
			'Note for the supporter: Please take out the phone number.'
		]);
	});

	it('writes the note as text, never as markup', () => {
		const note = '<b>Call</b> <img src=x onerror="alert(1)"> us';
		const root = preview({ hidden: true, note });
		const line = notice(root)?.querySelectorAll('.ds-notice-card-body > p')[1];
		expect(line?.textContent).toBe(`Note for the supporter: ${note}`);
		expect(line?.children).toHaveLength(0);
	});

	it('says over the title of a page not yet published that it is not public, and dates nothing', () => {
		const root = mount(
			<FundraiserPage
				{...props(
					{ ...PART_WAY, startedAt: null },
					{ donationBox: null, staffNotice: { hidden: false, pending: true, note: null } }
				)}
			/>
		);
		const card = notice(root);
		expect(card?.className).toBe('ds-notice-card ds-notice-card-info');
		expect(card?.querySelector('.ds-notice-card-title')?.textContent).toBe('Not published yet');
		expect(card?.textContent).toContain(
			'visitors see “This page is not taking gifts right now.” instead of this page.'
		);
		expect(root.querySelector('.fundraiser-by')?.textContent).toBe('Maya Reyes');
		expect(text(root)).not.toContain('Started this fundraiser');
	});

	it('draws no donation landmark where the preview hands no box', () => {
		const root = preview({ hidden: true, note: null });
		expect(root.querySelector('section.page-box')).toBeNull();
		expect(root.querySelector('[aria-label^="Give to"]')).toBeNull();
	});

	it('draws nothing over a page visitors can see, nor where no notice is passed', () => {
		for (const root of [preview({ hidden: false, note: 'left from before' }), preview(undefined)]) {
			expect(notice(root)).toBeNull();
			expect(text(root)).not.toContain('Hidden from visitors');
			expect(text(root)).not.toContain('left from before');
		}
	});
});

describe('the photo', () => {
	it('stands in its 16:9 block where there is one', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		const photo = root.querySelector('.fundraiser-photo img');
		expect(photo?.getAttribute('src')).toBe(`/image/${PART_WAY.photoId}`);
	});

	it('leaves no block where there is none', () => {
		const root = mount(<FundraiserPage {...props({ ...PART_WAY, photoId: null })} />);
		expect(root.querySelector('.fundraiser-photo')).toBeNull();
		expect(root.querySelector('[data-area="photo"]')).toBeNull();
	});
});

describe('messages from donors', () => {
	it('draws the section with one message or more', () => {
		const root = mount(<FundraiserPage {...props(PART_WAY)} />);
		expect(text(root)).toContain('Messages from donors');
		expect(text(root)).toContain('Matching my coworkers’ gifts.');
	});

	it('draws nothing where there is none', () => {
		const none = mount(<FundraiserPage {...props({ ...PART_WAY, messages: null })} />);
		const empty = mount(
			<FundraiserPage
				{...props({ ...PART_WAY, messages: { messages: [], total: 0, next: null } })}
			/>
		);
		for (const root of [none, empty]) expect(text(root)).not.toContain('Messages from donors');
	});
});

describe('a fundraiser just started', () => {
	it('reads $0, starts the bar empty, invites the first gift, and draws no messages', () => {
		const root = mount(<FundraiserPage {...props(JUST_STARTED)} />);
		expect(root.querySelector('.fundraiser-figures')?.textContent).toBe('$0 raised of $1,000 goal');
		expect(bar(root)?.getAttribute('data-state')).toBe('empty');
		expect(bar(root)?.getAttribute('aria-valuenow')).toBe('0');
		expect(bar(root)?.getAttribute('aria-valuetext')).toBe('0% of goal');
		expect(text(root)).toContain('No gifts yet. Yours could be the first.');
		expect(text(root)).not.toContain('Messages from donors');
		expect(root.querySelector('.fundraiser-by-when')?.textContent).toBe(
			'Started this fundraiser today'
		);
		expect(root.querySelector('[data-testid="box"]')).not.toBeNull();
	});
});

describe('a fundraiser past its goal', () => {
	it('says the goal is reached, turns the bar met, and lets the label pass 100% while the value stops', () => {
		const root = mount(<FundraiserPage {...props(MET)} />);
		const badge = root.querySelector('.ds-badge');
		expect(badge?.className).toBe('ds-badge ds-badge-success');
		expect(badge?.textContent).toBe('Goal reached');
		expect(bar(root)?.getAttribute('data-state')).toBe('met');
		expect(bar(root)?.getAttribute('aria-valuenow')).toBe('100');
		expect(bar(root)?.getAttribute('aria-valuetext')).toBe('108% of goal');
		expect(bar(root)?.querySelector<HTMLElement>('.ds-progress-fill')?.style.width).toBe('100%');
		expect(root.querySelector('.ds-progress-label')?.textContent).toBe('108%');
		expect(text(root)).toContain('Thank you. Gifts are still open.');
		expect(root.querySelector('[data-testid="box"]')).not.toBeNull();
	});
});

describe('an ended fundraiser', () => {
	const ENDED: EndedFundraiserView = {
		title: 'Keep the pantry trucks running this winter',
		name: 'Maya Reyes',
		raisedMinor: 542_000,
		goalMinor: 500_000,
		gifts: 63
	};

	function ended() {
		return mount(
			<FundraiserEndedPage
				fundraiser={ENDED}
				org={{ name: 'Harbor Light', taxId: '84-1234567', logo: null }}
				look={{ brandColour: '#1d6b4f' }}
				money={{ locale: 'en-US', currency: 'USD' }}
			/>
		);
	}

	it('names the organisation, says it ended, thanks, and states the final total', () => {
		const root = ended();
		expect(root.querySelector('.page-mast-name')?.textContent).toBe('Harbor Light');
		expect(root.querySelector('h1')?.textContent).toBe(
			'Ended: Keep the pantry trucks running this winter'
		);
		expect(text(root)).toContain('Thank you to everyone who gave.');
		expect(root.querySelector('.fundraiser-ended-total')?.textContent).toBe(
			'Maya Reyes raised $5,420 of $5,000 from 63 gifts.'
		);
	});

	it('takes no gift: the way on is Donate to the organisation, and there is no box', () => {
		const root = ended();
		const on = root.querySelector('main a');
		expect(on?.textContent).toBe('Donate to Harbor Light');
		expect(on?.getAttribute('href')).toBe('/donate');
		expect(root.querySelector('.page-box, [data-donate-root] [data-donate-root], form')).toBeNull();
		expect(bar(root)).toBeNull();
	});
});

describe('a hidden, pending or unknown fundraiser, as a visitor meets it', () => {
	it('is the plain notice an unknown address gets, with no title, name or total anywhere', () => {
		const root = mount(<FundraiserNotFoundPage />);
		expect(text(root)).toBe('This page is not taking gifts right now.');
		const markup = root.innerHTML;
		for (const leak of [PART_WAY.title, 'Maya', '$3,240', '5,000', 'Harbor Light']) {
			expect(markup).not.toContain(leak);
		}
		expect(root.querySelector('a, h1, [role="progressbar"]')).toBeNull();
	});
});
