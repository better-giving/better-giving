import { act, type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import { BLOCK_FORMS, type EditorBlock } from '$lib/page/block-edit';
import { BlockEditSheet, useLayoutPick } from './block-edit';
import { SettingsSheet } from './settings-sheet';

// a block's sheet and the layout pictures as the editor routes mount them, each press posted
// through a fetcher to a stubbed action: where a refused pick is reported, what a tier's row posts,
// and that a sheet opened over Settings stands over it.
//
// `stacked` has one output, the class packages/operator/src/components/shell/Sheet.jsx writes for
// it, and that file's own spec holds what the class is; the one case reading it here asks only
// whether the prop arrived.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STALE = 'The page changed while this was open. Reload to see it.';

/** `tree` under the editor's route, whose action refuses `refusing` and records every body. */
function editor(tree: ReactNode, refusing: string) {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			Component: () => tree,
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				const form = body.get(WHICH_FORM);
				return form === refusing
					? { form: { id: form, result: { status: 'error', error: { '': [STALE] } } } }
					: { saved: 'block' };
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<Stub initialEntries={['/admin/donation-page']} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, posted };
}

/** the landing of a fetcher's round trip, which settles over a few tasks. */
async function press(control: HTMLElement | null) {
	if (control === null) throw new Error('nothing to press');
	await act(async () => {
		control.click();
	});
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
}

function done(root: Element): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
	if (found === undefined) throw new Error('no Done');
	return found;
}

/**
 * every report region in the open sheet, in tree order: the pictures' first, Done's after it. a
 * box's own region, which Write with AI speaks in, is the box's and not one of these.
 */
const reports = (root: Element) =>
	[...root.querySelectorAll('dialog [role="status"]:not(.adm-field__needed)')].map(
		(one) => one.textContent
	);

const title: EditorBlock = {
	id: 'b1',
	type: 'title',
	label: 'Title',
	summary: 'Keep 300 kids warm this winter',
	variant: 'left',
	variants: [
		{ value: 'left', label: 'Left' },
		{ value: 'center', label: 'Centred' }
	],
	text: { kind: 'title', heading: 'Keep 300 kids warm this winter', lede: '' },
	illustration: false
};

const tiers: EditorBlock = {
	id: 'b2',
	type: 'impact-tiers',
	label: 'Impact tiers',
	summary: '$40 buys one winter coat',
	variant: 'cards',
	variants: [
		{ value: 'cards', label: 'Cards' },
		{ value: 'list', label: 'List' }
	],
	text: {
		kind: 'impact-tiers',
		currency: 'USD',
		tiers: [
			{ amount: '40.00', buys: 'one winter coat' },
			{ amount: '120.00', buys: 'coats for a family of three' }
		]
	},
	illustration: false
};

const sheet = (block: EditorBlock, stacked?: boolean) => (
	<BlockEditSheet
		block={block}
		version={3}
		suggestUrl="/admin/pages/p1/suggest"
		onDismiss={() => {}}
		onSaved={() => {}}
		stacked={stacked}
	/>
);

describe('a block sheet', () => {
	it('stands over Settings only when it is opened from there', () => {
		const over = editor(sheet(title, true), '').root.querySelector('dialog');
		expect(over?.classList.contains('adm-sheet--stacked')).toBe(true);
		const alone = editor(sheet(title), '').root.querySelector('dialog');
		expect(alone?.classList.contains('adm-sheet--stacked')).toBe(false);
	});

	it('reports a refused style under the pictures, from a region there before it, and not at Done', async () => {
		const { root, posted } = editor(sheet(title), BLOCK_FORMS.variant);
		expect(reports(root)).toEqual(['', '']);

		await press(root.querySelector<HTMLInputElement>('input[value="center"]'));
		expect(posted.map((body) => body.get('variant'))).toEqual(['center']);
		expect(reports(root)).toEqual([STALE, '']);
		expect(root.querySelector<HTMLInputElement>('input[value="left"]')?.checked).toBe(true);
	});

	it('reports a refused Done at Done, and nothing under the pictures', async () => {
		const { root } = editor(sheet(title), BLOCK_FORMS.title);
		await press(done(root));
		expect(reports(root)).toEqual(['', STALE]);
	});
});

describe('the tiers', () => {
	/** the amount box drawn in tier `at`'s row. */
	function amountBox(root: Element, at: number): HTMLInputElement {
		const found = root
			.querySelectorAll('dialog fieldset')
			[at]?.querySelector<HTMLInputElement>('.adm-affixed__input');
		if (found == null) throw new Error(`no amount box in tier ${at + 1}`);
		return found;
	}

	it('are a row per tier, each named by its place', () => {
		const { root } = editor(sheet(tiers), '');
		expect(
			[...root.querySelectorAll('dialog fieldset')].map(
				(one) => one.querySelector('legend')?.textContent
			)
		).toEqual(['Tier 1', 'Tier 2']);
	});

	it('read the currency with the amount box and post each row as the form names it', async () => {
		const { root, posted } = editor(sheet(tiers), '');
		const amount = amountBox(root, 0);
		const described = (amount.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent);
		expect(described).toContain('USD');

		await press(done(root));
		const [body] = posted;
		expect(body?.getAll('tier_amount[0]')).toEqual(['40.00']);
		expect(body?.getAll('tier_buys[0]')).toEqual(['one winter coat']);
		expect(body?.getAll('tier_amount[1]')).toEqual(['120.00']);
		expect(body?.getAll('tier_buys[1]')).toEqual(['coats for a family of three']);
	});

	it('group an amount’s thousands as typed, and post the figure typed', async () => {
		const { root, posted } = editor(sheet(tiers), '');
		const amount = amountBox(root, 1);
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
				amount,
				'1200'
			);
			amount.dispatchEvent(new Event('input', { bubbles: true }));
		});
		expect(amount.value).toBe('1,200');

		await press(done(root));
		expect(posted[0]?.getAll('tier_amount[1]')).toEqual(['1200']);
	});
});

describe('the layout pictures', () => {
	/** the Settings sheet as an editor route mounts it: the pick held by the editor, the sheet opened and closed. */
	function Layout() {
		const pick = useLayoutPick('box-right', 3);
		const [open, setOpen] = useState(true);
		return open ? (
			<SettingsSheet
				onDismiss={() => setOpen(false)}
				layouts={[
					{ value: 'box-right', label: 'Box beside' },
					{ value: 'banner', label: 'Banner' }
				]}
				{...pick.sheet}
			/>
		) : (
			<button
				type="button"
				onClick={() => {
					pick.startClean();
					setOpen(true);
				}}
			>
				Settings
			</button>
		);
	}

	it('report a refused pick under them, from a region there before it', async () => {
		const { root, posted } = editor(<Layout />, BLOCK_FORMS.layout);
		expect(reports(root)).toEqual(['']);

		await press(root.querySelector<HTMLInputElement>('input[value="banner"]'));
		expect(posted.map((body) => body.get('layout'))).toEqual(['banner']);
		expect(reports(root)).toEqual([STALE]);
		expect(root.querySelector<HTMLInputElement>('input[value="box-right"]')?.checked).toBe(true);
	});

	it('open again without the refusal the sheet was closed on', async () => {
		const { root } = editor(<Layout />, BLOCK_FORMS.layout);
		await press(root.querySelector<HTMLInputElement>('input[value="banner"]'));
		expect(reports(root)).toEqual([STALE]);

		await press(root.querySelector<HTMLButtonElement>('button[aria-label="Close"]'));
		await press(
			[...root.querySelectorAll('button')].find((one) => one.textContent === 'Settings') ?? null
		);

		expect(reports(root)).toEqual(['']);
	});
});
