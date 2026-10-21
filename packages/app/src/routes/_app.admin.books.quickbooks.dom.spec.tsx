import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import type { QuickbooksScreen } from '$lib/server/accounting/quickbooks-screen';
import Books from './_app.admin.books';

// the QuickBooks half of the Books screen, drawn. ./_app.admin.books.quickbooks.db.spec.ts drives
// the loader and every press against a real database and renders nothing; this is the half that
// reads what the screen composes out of that: which step says what, what each press posts, and
// what is asked before a press that cannot be taken back.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN = '/admin/books';

type LoaderData = Parameters<typeof Books>[0]['loaderData'];

const CALLBACK = 'https://give.example/quickbooks/callback';

const NOTHING_PICKED = {
	income: null,
	fee: null,
	stripeBalance: null,
	paypalBalance: null,
	chariotBalance: null,
	nowpaymentsBalance: null,
	undepositedFunds: null
};

/** a deployment holding Intuit's keys and no company. */
const UNCONNECTED: QuickbooksScreen = {
	unsetKeys: [],
	callback: CALLBACK,
	company: null,
	chart: null,
	holdings: ['undepositedFunds'],
	backlog: null
};

/** a company connected, its chart read, and every account it needs picked. */
const SYNCING: QuickbooksScreen = {
	unsetKeys: [],
	callback: CALLBACK,
	company: {
		name: 'Riverbank Trust',
		awaitingAccounts: false,
		startOn: '2026-01-01',
		picks: {
			...NOTHING_PICKED,
			income: { id: '79', name: 'Contributions' },
			fee: { id: '80', name: 'Merchant fees' },
			stripeBalance: { id: '140', name: 'Stripe balance' },
			undepositedFunds: { id: '4', name: 'Undeposited Funds' }
		}
	},
	chart: {
		state: 'read',
		accounts: [
			{ id: '79', label: 'Contributions — Income', roles: ['income'] },
			{ id: '80', label: 'Merchant fees — Expense', roles: ['fee'] },
			{
				id: '140',
				label: 'Stripe balance — Other Current Asset',
				roles: ['stripeBalance', 'undepositedFunds']
			},
			{ id: '4', label: 'Undeposited Funds — Other Current Asset', roles: ['undepositedFunds'] }
		]
	},
	holdings: ['undepositedFunds'],
	backlog: { failed: 2, behind: '3 days', held: null }
};

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

/**
 * the screen holding `quickbooks`, and every body a press posted. `answer` is what the action
 * gives each body; by default it never settles, which holds the press in flight.
 */
function screen(
	quickbooks: LoaderData['quickbooks'],
	answer: (body: FormData) => unknown = () => new Promise<never>(() => {})
): { root: HTMLElement; posted: FormData[] } {
	const posted: FormData[] = [];
	const loaderData = {
		accounts: [],
		sourceId: '019fb0d2-7d57-7c5e-a7df-baed1f27b405',
		entries: [],
		limit: 50,
		hasMore: false,
		quickbooks
	} as unknown as LoaderData;
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: () => createElement(Books as never, { loaderData, params: {}, matches: [] }),
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				return answer(body);
			}
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: [SCREEN] })), posted };
}

/** the step whose label reads `label`, as the element holding its line and what it opens onto. */
function step(root: HTMLElement, label: string): HTMLElement {
	const heading = [...root.querySelectorAll('h3')].find((h) => h.textContent?.includes(label));
	const line = heading?.closest('details, li, .adm-status');
	if (line == null) throw new Error(`no step reads "${label}"`);
	return line as HTMLElement;
}

function button(within: HTMLElement, label: string): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
	if (found === undefined) throw new Error(`no button reads "${label}"`);
	return found;
}

async function press(control: HTMLButtonElement): Promise<void> {
	await act(async () => {
		control.click();
	});
}

it('draws no QuickBooks for a member’s session', () => {
	const { root } = screen(null);

	expect(root.querySelector('#quickbooks')).toBeNull();
	expect(root.textContent).not.toContain('QuickBooks');
});

it('gives a deployment without Intuit’s keys the server steps and the address to register', () => {
	const { root } = screen({
		...UNCONNECTED,
		unsetKeys: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_API_URL']
	});
	const setup = step(root, 'Setup');

	expect(root.querySelector('#quickbooks')?.textContent).toBe('QuickBooks');
	expect(setup.textContent).toContain('Needs an Intuit app’s keys on the server');
	expect(setup.textContent).toContain('Ask whoever set up this site to add it.');
	expect(setup.textContent).toContain('For whoever runs the server');
	expect(setup.textContent).toContain('docker compose up -d --force-recreate app');
	expect(setup.textContent).toContain('Add this to your Intuit app’s redirect URIs');
	expect(setup.textContent).toContain(CALLBACK);
	expect(root.textContent).toContain('Not connected');
});

it('names the `.env` line of each key the server is short of, and none it holds', () => {
	const { root } = screen({ ...UNCONNECTED, unsetKeys: ['QUICKBOOKS_API_URL'] });
	const setup = step(root, 'Setup');

	expect(setup.textContent).toContain('QUICKBOOKS_API_URL=<value>');
	expect(setup.textContent).not.toContain('QUICKBOOKS_CLIENT_ID');
	expect(setup.textContent).not.toContain('QUICKBOOKS_CLIENT_SECRET');
	expect(setup.textContent).toContain('docker compose up -d --force-recreate app');
});

it('says the keys are on the server, and stands nothing else in Setup’s place', () => {
	const { root } = screen(UNCONNECTED);

	expect(step(root, 'Setup').textContent).toContain('Your Intuit app’s keys are on the server.');
	expect(step(root, 'Setup').textContent).not.toContain('For whoever runs the server');
});

it('sends the connect press as the form it is', async () => {
	const { root, posted } = screen(UNCONNECTED);

	await press(button(step(root, 'Connect'), 'Choose a company'));

	expect(posted.map((body) => body.get('__form_id__'))).toEqual(['quickbooks-connect']);
});

it('asks before it disconnects, naming the company and what is forgotten, and posts once answered', async () => {
	const { root, posted } = screen(SYNCING);
	const connect = step(root, 'Connect');

	await press(button(connect, 'Disconnect'));

	const dialog = root.querySelector('dialog');
	expect(posted).toHaveLength(0);
	expect(dialog?.textContent).toContain('Disconnect Riverbank Trust?');
	expect(dialog?.textContent).toContain('Gifts stop syncing to Riverbank Trust.');
	expect(dialog?.textContent).toContain(
		'This deployment forgets the company, its accounts and the day gifts sync from.'
	);

	await press(button(dialog as HTMLElement, 'Disconnect'));

	expect(posted.map((body) => body.get('__form_id__'))).toEqual(['quickbooks-disconnect']);
});

it('posts every role with an accounts save, a holding with no picker carrying what is stored', async () => {
	// a connection that moved is a save over picks identical to the stored ones: the save is what
	// releases it.
	const company = SYNCING.company;
	if (company === null) throw new Error('the fixture holds a company');
	const { root, posted } = screen({ ...SYNCING, company: { ...company, awaitingAccounts: true } });

	expect(step(root, 'Accounts').textContent).toContain(
		'This connection moved to Riverbank Trust, and nothing is sent to QuickBooks until its accounts are saved.'
	);

	await press(button(step(root, 'Accounts'), 'Save accounts'));

	expect(posted).toHaveLength(1);
	expect(Object.fromEntries(posted[0] as FormData)).toEqual({
		__form_id__: 'quickbooks-accounts',
		income: '79',
		fee: '80',
		stripeBalance: '140',
		paypalBalance: '',
		chariotBalance: '',
		nowpaymentsBalance: '',
		undepositedFunds: '4'
	});
});

it('says how many gifts did not sync and how far behind, and retries them', async () => {
	const { root, posted } = screen(SYNCING);
	const sync = step(root, 'Sync');

	expect(sync.textContent).toContain('2 gifts didn’t sync. QuickBooks is 3 days behind.');
	await press(button(sync, 'Try these again'));

	expect(posted.map((body) => body.get('__form_id__'))).toEqual(['quickbooks-retry']);
});

/** the start-date box, typed into the way a keystroke does. */
async function pickStart(root: HTMLElement, day: string): Promise<void> {
	const box = step(root, 'Sync').querySelector<HTMLInputElement>('input[name="start_on"]');
	if (box === null) throw new Error('no start-date box');
	const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	await act(async () => {
		set?.call(box, day);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

const SEND_PAST = {
	title: 'Send past gifts?',
	press: 'Send gifts',
	rank: 'exit',
	lines: ['Gifts · 2', 'Company · Riverbank Trust']
};

it('previews a move earlier, asks before sending past gifts, and moves once answered', async () => {
	const { root, posted } = screen(SYNCING, (body) =>
		body.get('__form_id__') === 'quickbooks-start-date-preview'
			? { preview: { startOn: body.get('start_on'), ask: SEND_PAST } }
			: { moved: body.get('start_on') }
	);

	await pickStart(root, '2025-11-01');
	await press(button(step(root, 'Sync'), 'Save'));

	const dialog = root.querySelector('dialog');
	expect(dialog?.textContent).toContain('Send past gifts?');
	expect(dialog?.textContent).toContain('Gifts · 2');
	expect(posted.map((body) => body.get('__form_id__'))).toEqual(['quickbooks-start-date-preview']);

	await press(button(dialog as HTMLElement, 'Send gifts'));

	expect(posted.map((body) => [body.get('__form_id__'), body.get('start_on')])).toEqual([
		['quickbooks-start-date-preview', '2025-11-01'],
		['quickbooks-start-date', '2025-11-01']
	]);
});

it('moves straight on where the preview found nothing to ask about', async () => {
	const { root, posted } = screen(SYNCING, (body) =>
		body.get('__form_id__') === 'quickbooks-start-date-preview'
			? { preview: { startOn: body.get('start_on'), ask: null } }
			: { moved: body.get('start_on') }
	);

	await pickStart(root, '2026-03-01');
	await press(button(step(root, 'Sync'), 'Save'));

	expect(root.querySelector('dialog')).toBeNull();
	expect(posted.map((body) => body.get('__form_id__'))).toEqual([
		'quickbooks-start-date-preview',
		'quickbooks-start-date'
	]);
});
