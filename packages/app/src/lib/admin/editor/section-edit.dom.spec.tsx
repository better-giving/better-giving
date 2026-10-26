import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { FAQ_MAX, TIERS_MAX } from '$lib/page/catalog';
import { CONTENT_FORMS, type EditorSection } from '$lib/page/content-edit';
import { SectionEditSheet } from './section-edit';

// a section's sheet as the editor routes mount it, each press posted through a fetcher to a stubbed
// action: what a tier's row posts, how rows come and go, where a refusal lands, that a sheet opened
// over Settings stands over it, and that the sheet draws the section's words and photo and nothing
// that says how the page draws them.
//
// `stacked` has one output, the class packages/operator/src/components/shell/Sheet.jsx writes for
// it, and that file's own spec holds what the class is; the one case reading it here asks only
// whether the prop arrived.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// a control's name that only a layout, a look, a background or a section's place would carry.
// `\bmove` keeps a row's own Remove out of it.
const NOT_CONTENT =
	/layout|look|colou?r|palette|shade|corner|style|variant|background|share buttons|\bmove\b|add a block|remove block/i;

const STALE = 'The page changed while this was open. Reload to see it.';

/**
 * `tree` under the editor's route, whose action refuses `refusing` with `error` — the stale sentence
 * unless stated — and records every body.
 */
function editor(
	tree: ReactNode,
	refusing: string,
	error: Record<string, string[]> = { '': [STALE] }
) {
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
					? { form: { id: form, result: { status: 'error', error } } }
					: { saved: 'content' };
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

const title: EditorSection = {
	id: 'title',
	label: 'Title',
	summary: 'Keep 300 kids warm this winter',
	empty: false,
	text: { kind: 'title', heading: 'Keep 300 kids warm this winter', lede: 'Coats for every child' }
};

const tiers: EditorSection = {
	id: 'tiers',
	label: 'Impact tiers',
	summary: '$40, $120',
	empty: false,
	text: {
		kind: 'tiers',
		currency: 'USD',
		tiers: [
			{ amount: '40.00', buys: 'one winter coat' },
			{ amount: '120.00', buys: 'coats for a family of three' }
		]
	}
};

const sheet = (section: EditorSection, stacked?: boolean) => (
	<SectionEditSheet
		section={section}
		version={3}
		onDismiss={() => {}}
		onSaved={() => {}}
		stacked={stacked}
	/>
);

describe('a section sheet', () => {
	it('stands over Settings only when it is opened from there', () => {
		const over = editor(sheet(title, true), '').root.querySelector('dialog');
		expect(over?.classList.contains('adm-sheet--stacked')).toBe(true);
		const alone = editor(sheet(title), '').root.querySelector('dialog');
		expect(alone?.classList.contains('adm-sheet--stacked')).toBe(false);
	});

	it('posts the title’s words with the version and the section’s form, and nothing else', async () => {
		const { root, posted } = editor(sheet(title), '');
		await press(done(root));
		expect(posted.map((body) => [...body.entries()])).toEqual([
			[
				[WHICH_FORM, CONTENT_FORMS.title],
				[RECORD_VERSION, '3'],
				['heading', 'Keep 300 kids warm this winter'],
				['lede', 'Coats for every child']
			]
		]);
	});

	it('reports a refused Done at Done', async () => {
		const { root } = editor(sheet(title), CONTENT_FORMS.title);
		await press(done(root));
		expect(
			[...root.querySelectorAll('dialog [role="status"]')].map((one) => one.textContent)
		).toContain(STALE);
	});

	it('draws no control for how the page is laid out or dressed, whichever section it opens', () => {
		const { root: titled } = editor(sheet(title), '');
		const { root: tiered } = editor(sheet(tiers), '');
		for (const root of [titled, tiered]) {
			const names = [
				...root.querySelectorAll(
					'dialog legend, dialog label, dialog button, dialog [role="radio"]'
				)
			].map((one) => one.getAttribute('aria-label') ?? one.textContent ?? '');
			expect(names.filter((name) => NOT_CONTENT.test(name))).toEqual([]);
			expect(root.querySelector('dialog input[type="radio"]')).toBeNull();
		}
	});
});

/** the amount box drawn in tier `at`'s row. */
function amountBox(root: Element, at: number): HTMLInputElement {
	const found = root
		.querySelectorAll('dialog fieldset')
		[at]?.querySelector<HTMLInputElement>('.adm-affixed__input');
	if (found == null) throw new Error(`no amount box in tier ${at + 1}`);
	return found;
}

describe('the tiers', () => {
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

	it('group an amount’s thousands as typed, and post the amount as drawn', async () => {
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
		expect(posted[0]?.getAll('tier_amount[1]')).toEqual(['1,200']);
	});
});

describe('a list’s rows', () => {
	const empty = (kind: 'tiers' | 'faq'): EditorSection =>
		kind === 'tiers'
			? { ...tiers, text: { kind: 'tiers', currency: 'USD', tiers: [] } }
			: {
					...tiers,
					id: 'faq',
					label: 'Questions',
					text: { kind: 'faq', items: [] }
				};
	const full = (kind: 'tiers' | 'faq', count: number): EditorSection => {
		const block = empty(kind);
		if (block.text.kind === 'tiers')
			return {
				...block,
				text: {
					...block.text,
					tiers: Array.from({ length: count }, (_, at) => ({
						amount: String(at + 1),
						buys: 'a coat'
					}))
				}
			};
		return {
			...block,
			text: {
				kind: 'faq',
				items: Array.from({ length: count }, (_, at) => ({
					question: `Question ${at + 1}?`,
					answer: { type: 'doc', content: [{ type: 'paragraph' }] }
				}))
			}
		};
	};
	const rows = (root: Element) => root.querySelectorAll('dialog fieldset').length;
	const typeInto = (box: HTMLInputElement | null, text: string) =>
		act(() => {
			if (box === null) throw new Error('no box');
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
	const named = (root: Element, name: string) =>
		[...root.querySelectorAll<HTMLButtonElement>('dialog button')].find(
			(one) => (one.getAttribute('aria-label') ?? one.textContent) === name
		) ?? null;

	it('offer an empty tiers section a first row, and post it', async () => {
		const { root, posted } = editor(sheet(empty('tiers')), '');
		expect(rows(root)).toBe(1);
		expect(named(root, 'Remove tier 1')).toBeNull();

		typeInto(amountBox(root, 0), '25');
		typeInto(
			root.querySelector<HTMLInputElement>('input[name="tier_buys[0]"]'),
			'a pair of gloves'
		);
		await press(done(root));

		expect(posted[0]?.getAll('tier_amount[0]')).toEqual(['25']);
		expect(posted[0]?.getAll('tier_buys[0]')).toEqual(['a pair of gloves']);
	});

	it('offer an empty questions section a first row, and post it', async () => {
		const { root, posted } = editor(sheet(empty('faq')), '');
		expect(rows(root)).toBe(1);

		typeInto(
			root.querySelector<HTMLInputElement>('input[name="question[0]"]'),
			'Where do coats go?'
		);
		await press(done(root));

		expect(posted[0]?.get(WHICH_FORM)).toBe(CONTENT_FORMS.faq);
		expect(posted[0]?.getAll('question[0]')).toEqual(['Where do coats go?']);
		expect(posted[0]?.getAll('answer[0]')).toHaveLength(1);
	});

	it('add a row with the caret in it, and drop one with the caret on the row above', async () => {
		const { root, posted } = editor(sheet(tiers), '');
		await press(named(root, 'Add a tier'));
		expect(rows(root)).toBe(3);
		expect(document.activeElement).toBe(amountBox(root, 2));

		await press(named(root, 'Remove tier 2'));
		expect(rows(root)).toBe(2);
		expect(document.activeElement).toBe(amountBox(root, 0));
		await press(done(root));
		expect(posted[0]?.getAll('tier_buys[0]')).toEqual(['one winter coat']);
		expect(posted[0]?.getAll('tier_buys[1]')).toEqual(['']);
	});

	it('keep a refusal on the row it was said of as rows come and go, with the caret where Remove put it', async () => {
		const three: EditorSection = {
			...tiers,
			text: {
				kind: 'tiers',
				currency: 'USD',
				tiers: [
					{ amount: '40.00', buys: 'one winter coat' },
					{ amount: '120.00', buys: 'coats for a family of three' },
					{ amount: '0', buys: 'a scarf' }
				]
			}
		};
		const { root } = editor(sheet(three), CONTENT_FORMS.tiers, {
			'tier_amount[2]': ['more than $0']
		});
		const refused = () =>
			[...root.querySelectorAll('dialog fieldset')].map(
				(one) => one.querySelector('.adm-affixed__input')?.getAttribute('aria-invalid') === 'true'
			);

		await press(done(root));
		expect(refused()).toEqual([false, false, true]);
		expect(document.activeElement).toBe(amountBox(root, 2));

		await press(named(root, 'Remove tier 1'));
		expect(refused()).toEqual([false, true]);
		expect(document.activeElement).toBe(amountBox(root, 0));

		await press(named(root, 'Add a tier'));
		expect(refused()).toEqual([false, true, false]);
		expect(document.activeElement).toBe(amountBox(root, 2));

		await press(named(root, 'Remove tier 2'));
		expect(refused()).toEqual([false, false]);
		expect(document.activeElement).toBe(amountBox(root, 0));
	});

	it.each([
		['tiers', TIERS_MAX, 'Add a tier'],
		['faq', FAQ_MAX, 'Add a question']
	] as const)('offer a full %s section no more rows', (kind, max, add) => {
		const { root } = editor(sheet(full(kind, max)), '');
		expect(rows(root)).toBe(max);
		expect(named(root, add)).toBeNull();
		const short = editor(sheet(full(kind, max - 1)), '').root;
		expect(named(short, add)).not.toBeNull();
	});
});
