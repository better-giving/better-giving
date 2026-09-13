import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { handle as formHandle } from '../../routes/_app.admin.forms.$id';
import { handle as newFormHandle } from '../../routes/_app.admin.forms.new';
import { handle as programHandle } from '../../routes/_app.admin.programs.$id';
import { handle as newProgramHandle } from '../../routes/_app.admin.programs.new';
import { handle as recurringHandle } from '../../routes/_app.admin.recurring.$id';
import { ScreenCrumbs } from './crumbs';

// the trail each screen standing under a section draws, and what a press on its way back does.
//
// the trail is read off the matched route's `handle` (./crumbs.tsx), so a case mounts each screen's
// real `handle` under its real address with the loader data that screen reads, and asserts what a
// reader meets: the section first and linked, the screen itself last and not.
//
// the press is the same argument as ./rail-navigates.dom.spec.tsx, one part along. `Breadcrumbs` is
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
	section: string;
};

/** one screen under its address, with the section it names standing beside it to be arrived at. */
function screen({ path, at, handle, loaderData, section }: Screen): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{ path, handle, loader: () => loaderData ?? null, Component: ScreenCrumbs },
		{ path: section, Component: () => <p>arrived</p> }
	]);
	return mount(<Stub initialEntries={[at]} />);
}

/** the trail as a reader meets it: each crumb's words, its address, and whether it is this page. */
function trail(root: HTMLElement) {
	const nav = root.querySelector('nav[aria-label="Breadcrumb"]');
	if (!nav) throw new Error('the screen drew no breadcrumb trail');
	return [...nav.querySelectorAll('li')].map((item) => {
		const link = item.querySelector('a');
		return {
			label: item.textContent,
			href: link?.getAttribute('href') ?? null,
			current: item.querySelector('[aria-current="page"]') !== null
		};
	});
}

const FORM = {
	path: '/admin/forms/:id',
	at: '/admin/forms/1',
	handle: formHandle,
	loaderData: { name: 'Spring appeal' },
	section: '/admin/forms'
};

describe('the trail each screen draws', () => {
	it('a donation form: the section, then the form by its name', async () => {
		expect(trail(await screen(FORM))).toEqual([
			{ label: 'Donation forms', href: '/admin/forms', current: false },
			{ label: 'Spring appeal', href: null, current: true }
		]);
	});

	it('a new donation form: the section, then the screen that makes one', async () => {
		const root = await screen({
			path: '/admin/forms/new',
			at: '/admin/forms/new',
			handle: newFormHandle,
			section: '/admin/forms'
		});

		expect(trail(root)).toEqual([
			{ label: 'Donation forms', href: '/admin/forms', current: false },
			{ label: 'Add a donation form', href: null, current: true }
		]);
	});

	it('a program: the section, then the program by its name', async () => {
		const root = await screen({
			path: '/admin/programs/:id',
			at: '/admin/programs/1',
			handle: programHandle,
			loaderData: { name: 'Clean water' },
			section: '/admin/programs'
		});

		expect(trail(root)).toEqual([
			{ label: 'Programs', href: '/admin/programs', current: false },
			{ label: 'Clean water', href: null, current: true }
		]);
	});

	it('a new program: the section, then the screen that makes one', async () => {
		const root = await screen({
			path: '/admin/programs/new',
			at: '/admin/programs/new',
			handle: newProgramHandle,
			section: '/admin/programs'
		});

		expect(trail(root)).toEqual([
			{ label: 'Programs', href: '/admin/programs', current: false },
			{ label: 'Add a program', href: null, current: true }
		]);
	});

	it('a recurring gift: the section, then the gift by its donor', async () => {
		const root = await screen({
			path: '/admin/recurring/:id',
			at: '/admin/recurring/1',
			handle: recurringHandle,
			loaderData: { donorName: 'Ada Okafor' },
			section: '/admin/recurring'
		});

		expect(trail(root)).toEqual([
			{ label: 'Recurring gifts', href: '/admin/recurring', current: false },
			{ label: 'Ada Okafor', href: null, current: true }
		]);
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
