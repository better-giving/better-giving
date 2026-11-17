import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import * as dashboardModule from '../../routes/_app.admin._index';
import * as booksModule from '../../routes/_app.admin.books';
import { handle as campaignHandle } from '../../routes/_app.admin.campaigns.$pageId';
import * as campaignsModule from '../../routes/_app.admin.campaigns._index';
import * as donationPageModule from '../../routes/_app.admin.donation-page';
import { handle as giftHandle } from '../../routes/_app.admin.donations.$id';
import * as giftsModule from '../../routes/_app.admin.donations._index';
import { handle as exportHandle } from '../../routes/_app.admin.donations.export';
import { handle as messagesHandle } from '../../routes/_app.admin.donations.messages';
import { handle as newGiftHandle } from '../../routes/_app.admin.donations.new';
import * as donorsModule from '../../routes/_app.admin.donors._index';
import { handle as formHandle } from '../../routes/_app.admin.forms.$id';
import * as formsModule from '../../routes/_app.admin.forms._index';
import { handle as newFormHandle } from '../../routes/_app.admin.forms.new';
import * as apiModule from '../../routes/_app.admin.integrations.api';
import * as connectorModule from '../../routes/_app.admin.integrations.connector';
import { handle as destinationHandle } from '../../routes/_app.admin.integrations.webhooks.$id';
import * as webhooksModule from '../../routes/_app.admin.integrations.webhooks._index';
import { handle as newDestinationHandle } from '../../routes/_app.admin.integrations.webhooks.new';
import * as zapierModule from '../../routes/_app.admin.integrations.zapier';
import * as membersModule from '../../routes/_app.admin.members';
import { handle as passwordHandle } from '../../routes/_app.admin.members_.password';
import * as paymentsModule from '../../routes/_app.admin.payments';
import { handle as programHandle } from '../../routes/_app.admin.programs.$id';
import * as programsModule from '../../routes/_app.admin.programs._index';
import { handle as newProgramHandle } from '../../routes/_app.admin.programs.new';
import { handle as recurringHandle } from '../../routes/_app.admin.recurring.$id';
import * as recurringModule from '../../routes/_app.admin.recurring._index';
import * as mailModule from '../../routes/_app.admin.settings_.mail';
import * as notificationsModule from '../../routes/_app.admin.settings_.notifications';
import * as organisationModule from '../../routes/_app.admin.settings_.organisation';
import * as supporterPagesModule from '../../routes/_app.admin.supporter-pages';
import { ScreenHeading } from './crumbs';
import { currentDestination } from './destinations';

// the heading each screen's route makes of its `handle`, in page-header-css's two shapes (its usage
// note, packages/operator/src/registry/styles/page-header-css.usage.md), and what a press on the
// way back does.
//
// the trail is read off the matched route's `handle` (./crumbs.tsx), so a case mounts each screen's
// real `handle` under its real address with the loader data that screen reads, and asserts what a
// reader meets. a screen under a section draws the section first and linked, and its own title last
// as the h1. a page with a sidebar entry draws its h1 hidden and no trail.
//
// the press is the same argument as ./rail-navigates.dom.spec.tsx, one part along. `PageHeading` is
// packages/operator's and takes what it is drawn as as a prop; mounted without one it draws a plain
// anchor carrying the same address, and every press back then throws away the running application
// and fetches the section off the network again. nothing in the markup tells the two apart, so the
// press is the only thing a case can hold.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
async function mount(tree: ReactNode): Promise<HTMLElement> {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	// async, because the stub runs the loader before it renders the screen.
	await act(async () => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

type Screen = {
	path: string;
	at: string;
	handle: unknown;
	loaderData?: unknown;
	section?: string;
};

/** one screen under its address, with the section it names standing beside it to be arrived at. */
function screen({ path, at, handle, loaderData, section }: Screen): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			path,
			handle,
			loader: () => loaderData ?? null,
			Component: () => <ScreenHeading title="the screen" />
		},
		...(section === undefined ? [] : [{ path: section, Component: () => <p>arrived</p> }])
	]);
	return mount(<Stub initialEntries={[at]} />);
}

/**
 * the trail as a reader meets it: each crumb's words, its address, and whether it is this page —
 * the page's one h1, carrying `aria-current`.
 */
function trail(root: HTMLElement) {
	const nav = root.querySelector('nav[aria-label="Breadcrumb"]');
	if (!nav) throw new Error('the screen drew no breadcrumb trail');
	return [...nav.querySelectorAll('li')].map((item) => {
		const link = item.querySelector('a');
		return {
			label: item.textContent,
			href: link?.getAttribute('href') ?? null,
			current: item.querySelector('h1[aria-current="page"]') !== null
		};
	});
}

/** every h1 the screen drew, by its words and its class. */
const headings = (root: HTMLElement) =>
	[...root.querySelectorAll('h1')].map((h1) => [h1.textContent, h1.className]);

const FORM = {
	path: '/admin/forms/:id',
	at: '/admin/forms/1',
	handle: formHandle,
	loaderData: { name: 'Spring appeal' },
	section: '/admin/forms'
};

/** each screen under a section, by what it is, with the section its trail starts at and names. */
const NESTED: readonly (readonly [string, Screen & { section: string }, string])[] = [
	['a donation form', FORM, 'Donation forms'],
	[
		'a new donation form',
		{
			path: '/admin/forms/new',
			at: '/admin/forms/new',
			handle: newFormHandle,
			section: '/admin/forms'
		},
		'Donation forms'
	],
	[
		'a program',
		{
			path: '/admin/programs/:id',
			at: '/admin/programs/1',
			handle: programHandle,
			loaderData: { name: 'Clean water' },
			section: '/admin/programs'
		},
		'Programs'
	],
	[
		'a new program',
		{
			path: '/admin/programs/new',
			at: '/admin/programs/new',
			handle: newProgramHandle,
			section: '/admin/programs'
		},
		'Programs'
	],
	[
		'a gift',
		{
			path: '/admin/donations/:id',
			at: '/admin/donations/1',
			handle: giftHandle,
			loaderData: { gift: { donorName: 'Ada Okafor' } },
			section: '/admin/donations'
		},
		'Gifts'
	],
	[
		'a gift added by hand',
		{
			path: '/admin/donations/new',
			at: '/admin/donations/new',
			handle: newGiftHandle,
			section: '/admin/donations'
		},
		'Gifts'
	],
	[
		'the accountant’s export',
		{
			path: '/admin/donations/export',
			at: '/admin/donations/export',
			handle: exportHandle,
			section: '/admin/donations'
		},
		'Gifts'
	],
	[
		'the public messages',
		{
			path: '/admin/donations/messages',
			at: '/admin/donations/messages',
			handle: messagesHandle,
			section: '/admin/donations'
		},
		'Gifts'
	],
	[
		'a recurring gift',
		{
			path: '/admin/recurring/:id',
			at: '/admin/recurring/1',
			handle: recurringHandle,
			loaderData: { donorName: 'Ada Okafor' },
			section: '/admin/recurring'
		},
		'Recurring gifts'
	],
	[
		'a campaign',
		{
			path: '/admin/campaigns/:pageId',
			at: '/admin/campaigns/1',
			handle: campaignHandle,
			loaderData: { name: 'Winter coats' },
			section: '/admin/campaigns'
		},
		'Campaigns'
	],
	[
		'a webhook destination',
		{
			path: '/admin/integrations/webhooks/:id',
			at: '/admin/integrations/webhooks/1',
			handle: destinationHandle,
			loaderData: { title: 'crm.example.net/webhooks/better-giving' },
			section: '/admin/integrations/webhooks'
		},
		'Webhooks'
	],
	[
		'a new webhook destination',
		{
			path: '/admin/integrations/webhooks/new',
			at: '/admin/integrations/webhooks/new',
			handle: newDestinationHandle,
			section: '/admin/integrations/webhooks'
		},
		'Webhooks'
	],
	[
		'your password',
		{
			path: '/admin/members/password',
			at: '/admin/members/password',
			handle: passwordHandle,
			section: '/admin/members'
		},
		'Members'
	]
];

describe('a screen under a section', () => {
	it.each(NESTED)(
		'%s: the section linked, then the title as the current crumb',
		async (_, at, label) => {
			expect(currentDestination(at.at)).toEqual({ label, kind: 'section' });
			const root = await screen(at);

			expect(trail(root)).toEqual([
				{ label, href: at.section, current: false },
				{ label: 'the screen', href: null, current: true }
			]);
			expect(headings(root)).toEqual([['the screen', 'ds-page-title']]);
		}
	);
});

/** a route module's `handle`, or nothing where the module states none. */
const handleOf = (module: object): unknown => ('handle' in module ? module.handle : undefined);

/** each destination's own page by its address, with the route module that draws it. */
const PAGES = [
	['/admin', dashboardModule],
	['/admin/campaigns', campaignsModule],
	['/admin/supporter-pages', supporterPagesModule],
	['/admin/forms', formsModule],
	['/admin/programs', programsModule],
	['/admin/donors', donorsModule],
	['/admin/donations', giftsModule],
	['/admin/recurring', recurringModule],
	['/admin/members', membersModule],
	['/admin/payments', paymentsModule],
	['/admin/integrations/zapier', zapierModule],
	['/admin/integrations/api', apiModule],
	['/admin/integrations/webhooks', webhooksModule],
	['/admin/integrations/connector', connectorModule],
	['/admin/books', booksModule]
] as const;

/** each section of Settings by its address, with the route module that draws it. */
const SETTINGS = [
	['/admin/settings/organisation', organisationModule],
	['/admin/settings/notifications', notificationsModule],
	['/admin/settings/mail', mailModule]
] as const;

/** the heading a page with a sidebar entry draws: its h1 hidden, and no trail. */
async function expectSidebarShape(at: string, module: object) {
	const root = await screen({ path: at, at, handle: handleOf(module) });

	expect(headings(root)).toEqual([['the screen', 'ds-sr-only']]);
	expect(root.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
}

describe('a page with a sidebar entry', () => {
	it.each(PAGES)('%s draws its h1 hidden and no trail', async (at, module) => {
		expect(currentDestination(at)?.kind).toBe('page');
		await expectSidebarShape(at, module);
	});

	it.each(SETTINGS)(
		'%s, a section of Settings, draws its h1 hidden and no trail',
		async (at, module) => {
			expect(currentDestination(at)).toEqual({ label: 'Settings', kind: 'section', child: at });
			await expectSidebarShape(at, module);
		}
	);

	it('the Donation page, reached from the globe beside the organisation’s name, draws its h1 hidden and no trail', async () => {
		expect(currentDestination('/admin/donation-page')).toBeUndefined();
		await expectSidebarShape('/admin/donation-page', donationPageModule);
	});
});

/** the press a browser sends on the section's crumb, and the flush react router does for it. */
async function press(root: HTMLElement): Promise<boolean> {
	const back = root.querySelector('nav[aria-label="Breadcrumb"] a');
	if (!back) throw new Error('the screen drew no crumb to press');
	let claimed = false;
	await act(async () => {
		claimed = !back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	return claimed;
}

it('takes the press itself rather than letting the document navigate', async () => {
	// `dispatchEvent` answers false when a listener called `preventDefault`, which is the router
	// claiming the press. a plain anchor leaves it alone and the browser reloads the whole surface.
	expect(await press(await screen(FORM))).toBe(true);
});

it('arrives at the section the crumb names', async () => {
	const root = await screen(FORM);
	await press(root);

	expect(root.textContent).toBe('arrived');
});
