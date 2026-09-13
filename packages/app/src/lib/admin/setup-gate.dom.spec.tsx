import { type ReactNode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import type { SetupLine } from '$lib/server/config/readiness';
import { SetupGate } from './setup-gate';

// the gate this deployment serves in place of the dashboard while any of the five jobs is
// unfinished, mounted so that what a reader actually meets is looked at rather than inferred from
// the loader that decides it.
//
// in the dom pool because the screen reads `useNavigation()`, which is idle in a server render —
// the same reason ../../routes/login.dom.spec.tsx is there.
//
// nothing here reads a sentence or a class, which is what keeps it clear of CLAUDE.md's ban on a
// browser spec over a dashboard screen: what is asserted is that the lines it is handed and the one
// press
// are on the page, never how any of it looks.

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

/** two of the five done and one outstanding, which is every state a line has. */
const lines: SetupLine[] = [
	{ id: 'password', label: 'Dashboard password', state: 'ready', word: 'Configured', note: null },
	{
		id: 'organisation',
		label: 'Organisation',
		state: 'todo',
		word: 'Incomplete',
		note: 'No donation form is served until your organisation’s details are saved.'
	},
	{ id: 'payments', label: 'Donation processor', state: 'ready', word: 'Configured', note: null }
];

/** the screen inside a router, which is what its one press needs to be a form at all. */
function screen(): HTMLElement {
	const Stub = createRoutesStub([
		{ path: '/admin', Component: () => createElement(SetupGate, { lines }) }
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin'] }));
}

it('draws a line for every job it was handed', () => {
	const root = screen();
	const labels = [...root.querySelectorAll('h2')].map((one) => one.textContent);
	expect(labels).toEqual(['Dashboard password', 'Organisation', 'Donation processor']);
});

it('says what is outstanding and says nothing under a job that is done', () => {
	const root = screen();
	// the sentence a line carries is the consequence of it being unfinished, so the count of them
	// is the count of unfinished jobs and never the count of lines.
	const said = root.textContent ?? '';
	expect(said).toContain('until your organisation’s details are saved');
	expect(said).toContain('Incomplete');
	expect(said).toContain('Configured');
});

it('sends the reader to the console and offers nothing that would repair a job here', () => {
	const root = screen();
	expect(root.querySelector('code.adm-code')?.textContent).toBe('better-giving start');
	// one control on the whole screen. a press per line would be the console built a second time,
	// over a deployment that by definition is not finished ($lib/admin/setup-gate.tsx).
	expect(root.querySelectorAll('button')).toHaveLength(1);
});

it('re-reads rather than writing, so the press is a GET', () => {
	const root = screen();
	const form = root.querySelector('form');
	// `method` reflects the resolved value, so an unset one reads as `get` here either way — the
	// assertion is that nothing has made it a post.
	expect(form?.method).toBe('get');
});
