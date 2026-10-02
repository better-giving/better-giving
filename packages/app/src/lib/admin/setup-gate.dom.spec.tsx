import { Fragment, type ReactNode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Link, useLoaderData } from 'react-router';
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

/**
 * lets the stub's loaders run and the router commit until `done` holds, a task at a time.
 *
 * a loop of its own rather than `vi.waitFor`: the router's commits have to land inside `act`, and
 * an `act` scope holds back every render until it closes, so a poll inside one never sees a change.
 * the cap is a hang's bound and nothing a case waits on comes near it.
 */
async function until(done: () => boolean, what: string): Promise<void> {
	for (let task = 0; task < 50; task += 1) {
		if (done()) return;
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
	throw new Error(`waited fifty tasks and ${what} never held`);
}

/** whether the gate's press is held for a read in flight. */
const busy = (press: HTMLElement) => () => press.getAttribute('aria-disabled') === 'true';

/** whether the gate's press is open again, every read landed. */
const idle = (press: HTMLElement) => () => !press.hasAttribute('aria-disabled');

/**
 * the gate over a loader, the way the layout draws it, with every read after the first held until
 * the case lets it land on what `next` answers.
 *
 * a link to the same address stands beside it, for a navigation that is not the gate's own press.
 */
async function reread(next: readonly SetupLine[], first: readonly SetupLine[] = lines) {
	let reads = 0;
	let land: () => void = () => {};
	const Stub = createRoutesStub([
		{
			path: '/admin',
			loader: async () => {
				reads += 1;
				if (reads === 1) return { lines: first };
				await new Promise<void>((resolve) => {
					land = resolve;
				});
				return { lines: next };
			},
			Component: () =>
				createElement(
					Fragment,
					null,
					createElement(SetupGate, { lines: useLoaderData<{ lines: SetupLine[] }>().lines }),
					createElement(Link, { to: '/admin' }, 'Dashboard')
				)
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: ['/admin'] }));
	await until(() => root.querySelector('button') !== null, 'the gate was drawn');
	const press = root.querySelector('button');
	if (press === null) throw new Error('the gate drew no press');
	const link = root.querySelector('a');
	if (link === null) throw new Error('the stub drew no link');
	return {
		root,
		press,
		link,
		reads: () => reads,
		land: async () => {
			land();
			await until(idle(press), 'the re-read landed');
		}
	};
}

/** what the gate says beside its press, which is where a press that moved nothing is reported. */
function outcome(press: HTMLElement): string {
	return press.parentElement?.querySelector('[role="status"]')?.textContent ?? '';
}

it('keeps the caret on Check again while the re-read is in flight, and takes the press once', async () => {
	const gate = await reread(lines);
	gate.press.focus();

	await act(async () => gate.press.click());
	await until(() => gate.reads() === 2 && busy(gate.press)(), 'the re-read was in flight');

	expect(document.activeElement).toBe(gate.press);
	expect((gate.press as HTMLButtonElement).disabled).toBe(false);

	// a press the handler turned down submits nothing, so there is no later read to wait out.
	let taken = true;
	await act(async () => {
		taken = gate.press.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	expect(taken).toBe(false);
	expect(gate.reads()).toBe(2);
});

it('says so at the press when the re-read comes back with nothing changed', async () => {
	const gate = await reread(lines);
	expect(outcome(gate.press)).toBe('');

	await act(async () => gate.press.click());
	await until(busy(gate.press), 'the re-read was in flight');
	expect(outcome(gate.press)).toBe('');
	await gate.land();

	expect(outcome(gate.press)).toBe('Nothing has changed yet.');
	expect(gate.press.hasAttribute('aria-disabled')).toBe(false);
});

it('says nothing at the press after a navigation the press did not make', async () => {
	const gate = await reread(lines);

	await act(async () => gate.link.click());
	await until(() => gate.reads() === 2, 'the link’s read started');
	await gate.land();

	expect(outcome(gate.press)).toBe('');
});

it('leaves a re-read that moved a line to the ledger, which says what moved', async () => {
	const done = lines.map((line) => ({
		...line,
		state: 'ready' as const,
		word: 'Configured',
		note: null
	}));
	const gate = await reread(done);

	await act(async () => gate.press.click());
	await until(busy(gate.press), 'the re-read was in flight');
	await gate.land();

	expect(gate.root.textContent).not.toContain('Incomplete');
	expect(outcome(gate.press)).toBe('');
});

// a field a later reading adds to a line is part of what moved, and the gate has no list of the
// fields to keep up to date with it.
it('counts a field it does not know of as a line that moved', async () => {
	const since = (at: string) => lines.map((line) => ({ ...line, since: at }) as SetupLine);
	const gate = await reread(since('tuesday'), since('monday'));

	await act(async () => gate.press.click());
	await until(busy(gate.press), 'the re-read was in flight');
	await gate.land();

	expect(outcome(gate.press)).toBe('');
});

// the layout draws the gate from a pathless route, in place of whatever screen the address names,
// so a form resolving its own address from the route it is drawn in would re-read `/`.
it('re-reads the screen the operator was going to, search and all, from a deep link', async () => {
	const read: string[] = [];
	const Stub = createRoutesStub([
		{
			id: 'app',
			loader: ({ request }: { request: Request }) => {
				const url = new URL(request.url);
				read.push(`${url.pathname}${url.search}`);
				return { lines };
			},
			Component: () => createElement(SetupGate, { lines }),
			children: [{ path: 'admin/donations', Component: () => null }]
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: ['/admin/donations?x=1'] }));
	await until(() => root.querySelector('button') !== null, 'the gate was drawn');
	const press = root.querySelector('button');
	if (press === null) throw new Error('the gate drew no press');

	await act(async () => press.click());
	await until(() => read.length === 2 && idle(press)(), 'the re-read landed');

	expect(read).toEqual(['/admin/donations?x=1', '/admin/donations?x=1']);
});
