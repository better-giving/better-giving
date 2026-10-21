import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import type { FormReadinessLine } from '$lib/forms/readiness';
import { FormsReadiness, type FormsReadinessContext } from './readiness';

// what stands between a form and Live, as each reader is told it: the bands drawn, the sentence for
// each unresolved line, and where a sentence sends the one reader who can act on it.
//
// in the dom pool because the links are react router's and need a router to render. nothing here
// asks how any of it looks — what is asserted is which band, which words and which addresses —
// which is what keeps it clear of AGENTS.md's ban on a browser spec over an /admin screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function block(
	lines: FormReadinessLine[] | null,
	options: { deployer: boolean; context?: FormsReadinessContext }
): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/forms/f1',
			Component: () =>
				createElement(FormsReadiness, {
					lines,
					deployer: options.deployer,
					context: options.context ?? 'form'
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/forms/f1'] }));
}

const ORGANISATION: FormReadinessLine = { job: 'organisation', severity: 'blocker' };
const PROCESSOR: FormReadinessLine = { job: 'processor', severity: 'blocker' };
const NOTICES: FormReadinessLine = { job: 'notices', severity: 'warning' };

/** each band's title and the sentences under it, in the order drawn. */
function bands(root: HTMLElement) {
	return [...root.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]')].map((band) => ({
		role: band.getAttribute('role'),
		title: band.querySelector('.adm-banner__word')?.textContent,
		lines: [...band.querySelectorAll('li')].map((item) => item.textContent),
		text: band.querySelector('.adm-banner__text')?.textContent
	}));
}

/** every address a link in the block goes to. */
function links(root: HTMLElement): string[] {
	return [...root.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '');
}

it('tells the deployer what to fix and where, under one blocker band', () => {
	const root = block([ORGANISATION, PROCESSOR], { deployer: true });

	expect(bands(root)).toEqual([
		{
			role: 'alert',
			title: 'This form can’t go live yet',
			lines: [
				'Receipts need the organisation’s EIN and registered name. Add them in Settings.',
				'No payment processor is set up, so no gift can be charged. Payments says what to ask whoever set up this site.'
			],
			text: undefined
		}
	]);
	expect(links(root)).toEqual(['/admin/settings', '/admin/payments']);
});

it('tells a member who to ask, and links nowhere', () => {
	const root = block([ORGANISATION, PROCESSOR], { deployer: false });

	expect(bands(root)[0]?.lines).toEqual([
		'Receipts need the organisation’s EIN and registered name, which only the person who deployed this site can add. Ask them to add it in Settings.',
		'No payment processor is set up, so no gift can be charged. Ask whoever set up this site to add one.'
	]);
	expect(links(root)).toEqual([]);
});

it('draws only the unresolved lines', () => {
	const root = block([{ job: 'organisation', severity: 'resolved' }, PROCESSOR], {
		deployer: true
	});

	expect(bands(root)[0]?.lines).toEqual([
		'No payment processor is set up, so no gift can be charged. Payments says what to ask whoever set up this site.'
	]);
});

it('draws the notices warning in its own band when nothing blocks', () => {
	const root = block(
		[
			{ job: 'organisation', severity: 'resolved' },
			{ job: 'processor', severity: 'resolved' },
			NOTICES
		],
		{ deployer: true }
	);

	expect(bands(root)).toEqual([
		{
			role: 'status',
			title: 'Payment notices aren’t set up',
			lines: [],
			text: 'Gifts will be charged, but none is marked paid here until the processor can tell this site about it. Payments says what to ask whoever set up this site.'
		}
	]);
	expect(links(root)).toEqual(['/admin/payments']);
});

it('words the notices warning for a member with no link', () => {
	const root = block([NOTICES], { deployer: false });

	expect(bands(root)[0]?.text).toBe(
		'Gifts will be charged, but none is marked paid here until the processor can tell this site about it. Ask whoever set up this site to set it up.'
	);
	expect(links(root)).toEqual([]);
});

it('keeps the warning out of the blocker band beside a blocker', () => {
	const root = block([ORGANISATION, NOTICES], { deployer: true });

	expect(bands(root).map((band) => band.title)).toEqual([
		'This form can’t go live yet',
		'Payment notices aren’t set up'
	]);
	expect(bands(root)[0]?.lines).toHaveLength(1);
});

it('says on the new form that it will be saved as a draft, and when it can go live', () => {
	const root = block([ORGANISATION, PROCESSOR], { deployer: true, context: 'new' });

	const [band] = bands(root);
	// attention rather than blocker: nothing is refused on this screen, the form is saved.
	expect(band?.role).toBe('status');
	expect(band?.title).toBe('This form will be saved as a draft');
	expect(band?.lines).toHaveLength(2);
	expect(root.querySelector('.adm-hint')?.textContent).toBe(
		'It can go live once the items above are done.'
	);
});

it('says nothing about going live on the new form when only the warning stands', () => {
	const root = block([NOTICES], { deployer: true, context: 'new' });

	expect(bands(root).map((band) => band.title)).toEqual(['Payment notices aren’t set up']);
	expect(root.textContent).not.toContain('It can go live');
});

it('renders nothing for a deployment with nothing outstanding', () => {
	expect(block(null, { deployer: true }).textContent).toBe('');
});
